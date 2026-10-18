"""Additional cases for the owned, disposable rust_replay_service_acceptance database."""
from datetime import datetime, timezone
from uuid import uuid4


def quick_cases(native, service, compare, init):
    for side in ("BUY", "SELL"):
        config={"dataset_id":"dataset-a","name":"quick "+side,"starting_balance":"100000"}
        n=native("POST","/api/v2/replay/sessions",config,201)
        p=service.create("tenant-a",**config)
        args={**init,"operation_id":"quick-"+side,"side":side,"quantity":"0.12","stop_loss":None,"take_profit":None,"execution_timing":"current_quote"}
        path=f'/api/v2/replay/sessions/{n["record_id"]}/orders/quick'
        body={"expected_revision":n["revision"],**args}
        n=native("POST",path,body,key="first-quick-"+side)
        p=service.quick_market_order("tenant-a",p["record_id"],p["revision"],**args)
        compare("first-use quick "+side,n,p)
        compare("first-use quick exact API receipt "+side,native("POST",path,body,key="first-quick-"+side),n)
        assert n["payload"]["execution"]["position"]["side"]==side
        assert n["payload"]["execution"]["pending_market_order"] is None
    fresh=native("POST","/api/v2/replay/sessions",{"dataset_id":"dataset-a","starting_balance":"100000","name":"atomic quick rejection"},201)
    path=f'/api/v2/replay/sessions/{fresh["record_id"]}'
    native("POST",path+"/orders/quick",{"expected_revision":fresh["revision"],**init,"operation_id":"invalid-quick","side":"SELL","quantity":"0.12","stop_loss":"1.0","take_profit":None,"execution_timing":"current_quote"},status=422,key="invalid-first-quick")
    after=native("GET",path)
    compare("rejected first-use quick preserves revision",after["revision"],fresh["revision"])
    compare("rejected first-use quick preserves uninitialized execution",after["payload"].get("execution"),fresh["payload"].get("execution"))


def analytics_cases(native, store, artifacts, compare, dsn):
    from fastapi.testclient import TestClient
    from trading_workspace_v2.api import create_app
    app=create_app(dsn=dsn,artifact_root=artifacts)
    client=TestClient(app)
    def stable(value):
        if isinstance(value,dict):return {k:stable(v) for k,v in value.items() if k!="as_of_utc"}
        if isinstance(value,list):return [stable(v) for v in value]
        return value
    records=store.list_records("tenant-a","replay")
    executed=next(r for r in records if r["payload"].get("execution") and r["payload"]["execution"].get("position"))
    sid=executed["record_id"]
    closed=next(r for r in records if any(e.get("kind") in {"manual_close","protective_fill"} for e in (r["payload"].get("execution") or {}).get("ledger",[])))
    closedid=closed["record_id"]
    paths=["/api/v2/overview", "/api/v2/overview?session_id="+sid,
           "/api/v2/dashboard/sessions", "/api/v2/dashboard/sessions?sort=profit&page_size=3",
           "/api/v2/dashboard/sessions?search=quick&asset=EURUSD",
           "/api/v2/replay/trades", "/api/v2/replay/trades?page=1&page_size=3",
           "/api/v2/replay/trades?page=1&side=SELL&outcome=all",
           "/api/v2/replay/trades?sessions="+sid,
           f"/api/v2/replay/sessions/{sid}/analytics",
           f"/api/v2/replay/sessions/{sid}/analytics?cursor_index=0",
           f"/api/v2/replay/sessions/{closedid}/analytics?side=SELL",
           f"/api/v2/replay/sessions/{closedid}/analytics?cursor_index=1",
           f"/api/v2/replay/sessions/{closedid}/analytics.csv",
           f"/api/v2/replay/sessions/{sid}/analytics.csv",
           f"/api/v2/replay/sessions/{sid}/analytics?include_ledger=false"]
    try:
        for path in paths:
            response=client.get(path,headers={"x-workspace-id":"tenant-a"})
            assert response.status_code==200,(path,response.text)
            expected=response.text if path.endswith(".csv") else response.json()
            actual=native("GET",path)
            # Execution capability/AI status belong to separate control-route checks.
            if path.startswith("/api/v2/overview"):
                compare("analytics overview counts "+path,actual["counts"],expected["counts"])
                actual,expected=actual["performance"],expected["performance"]
            compare("analytics "+path,stable(actual),stable(expected))
            compare("analytics cached "+path,stable(native("GET",path)["performance"] if path.startswith("/api/v2/overview") else native("GET",path)),stable(expected))
        for path in ["/api/v2/replay/sessions/missing/analytics",f"/api/v2/replay/sessions/{sid}/analytics?cursor_index=99999","/api/v2/dashboard/sessions?sort=unknown"]:
            response=client.get(path,headers={"x-workspace-id":"tenant-a"})
            compare("analytics rejection "+path,native("GET",path,status=response.status_code),response.json())
        for path in [f"/api/v2/replay/sessions/{sid}/analytics","/api/v2/overview?session_id="+sid]:
            response=client.get(path,headers={"x-workspace-id":"tenant-b"})
            compare("analytics cross-workspace "+path,native("GET",path,status=response.status_code,workspace="tenant-b"),response.json())
    finally:
        app.state.store.close()


def prop_cases(native, service, store, compare, init, output):
    from test_ps02_replay_prop_connection import prop_state,phase_spec,BASE_TIME
    from trading_workspace_v2.prop_session import TransitionIntent
    import json,hashlib
    from unittest.mock import patch
    import trading_workspace_v2.store as store_module

    def differential(label,path,body,call,status=200):
        """Run Python and Rust from exactly the same persisted state and identifiers.

        A single fixture-only superuser connection holds temporary table backups.
        This helper is never passed a user database: its parent creates PostgreSQL
        inside TemporaryDirectory before constructing PostgresStore.
        """
        with store.connect() as conn:
            from pathlib import Path
            datadir=Path(conn.execute("SHOW data_directory").fetchone()["data_directory"])
            assert datadir.name=="pg" and datadir.parent.name.startswith("rust-replay-service-"),"refuse non-owned fixture database"
            tables=[r["tablename"] for r in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")]
            for table in tables:conn.execute(f'CREATE TEMP TABLE "acceptance_{table}" AS TABLE public."{table}"')
            conn.commit()
            supplied=[]
            evaluations=[]
            original=store.apply_prop_lifecycle_event
            original_evaluate=store_module.evaluate_prop_lifecycle_event
            def evaluate(*args,**kwargs):
                result=original_evaluate(*args,**kwargs);evaluations.append(result);return result
            def capture(event,*,resume_state=None):
                supplied.append({"event":event.model_dump(mode="json"),"resume_state":resume_state})
                return original(event,resume_state=resume_state)
            try:
                with patch.object(store,"apply_prop_lifecycle_event",capture),patch.object(store_module,"evaluate_prop_lifecycle_event",evaluate):expected=call()
            except Exception as error:
                revisions=conn.execute("SELECT session_id,attempt_id,revision,snapshot_json,phase_json,resume_json FROM prop_attempt_revisions ORDER BY session_id,attempt_id,revision").fetchall()
                receipts=conn.execute("SELECT session_id,attempt_id,operation_id,fingerprint,entity_revision FROM prop_mutation_receipts ORDER BY session_id,attempt_id,entity_revision").fetchall()
                def diagnostic(v):return v.model_dump(mode="json") if hasattr(v,"model_dump") else str(v)
                (output/(label.replace(" ","-")+"-python-error.json")).write_text(json.dumps({"error":repr(error),"evaluations":evaluations,"stored_revisions":revisions,"stored_receipts":receipts},indent=2,default=diagnostic),encoding="utf-8")
                raise
            finally:
                # Replay and Prop intentionally commit together; restore every
                # public fixture table so partial writes cannot be hidden.
                conn.execute("SET LOCAL session_replication_role=replica")
                for table in tables:
                    conn.execute(f'DELETE FROM public."{table}"')
                    conn.execute(f'INSERT INTO public."{table}" SELECT * FROM "acceptance_{table}"')
                    conn.execute(f'DROP TABLE "acceptance_{table}"')
                conn.commit()
            def jsonable(v):
                if hasattr(v,"model_dump"):return v.model_dump(mode="json")
                if isinstance(v,dict):return {k:jsonable(x) for k,x in v.items()}
                if isinstance(v,list):return [jsonable(x) for x in v]
                return v
            actual=native("POST",path,body,status)
            if supplied:
                with store.connect() as receipt_conn:
                    row=receipt_conn.execute("SELECT fingerprint FROM prop_mutation_receipts WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s",("tenant-a",actual["attempt"]["session_id"],actual["attempt"]["attempt_id"],actual["prop_event"]["operation_id"])).fetchone()
                raw=json.dumps(supplied[0],sort_keys=True,separators=(",",":"),ensure_ascii=True)
                native_resume={k:v for k,v in actual["resume_state"].items() if k!="prop_lifecycle"}
                native_input={"event":actual["prop_event"],"resume_state":native_resume}
                (output/(label.replace(" ","-")+"-fingerprint.json")).write_text(json.dumps({"python_input":supplied[0],"python_canonical_json":raw,"python_fingerprint":hashlib.sha256(raw.encode()).hexdigest(),"native_reconstructed_input":native_input,"native_receipt_fingerprint":row["fingerprint"]},indent=2),encoding="utf-8")
            compare(label,actual,jsonable(expected))
            return actual

    n=native("POST","/api/v2/replay/sessions",{"dataset_id":"dataset-a","starting_balance":"100000"},201)
    sid=n["record_id"];base=f"/api/v2/replay/sessions/{sid}"
    n=native("POST",base+"/execution",{"expected_revision":n["revision"],**init})
    manifest=store.get_dataset("tenant-a","dataset-a")
    psid="prop-"+uuid4().hex;aid="attempt-"+uuid4().hex
    session,attempt,phase,resume=prop_state(session_id=psid,attempt_id=aid,dataset_sha256=manifest.artifact_sha256)
    attempt=attempt.model_copy(update={"cost_version":init["cost_model"]["version"]})
    store.create_prop_session_bundle(session,attempt,phase,resume_state=resume)
    scope={"dataset_id":"dataset-a","prop_session_id":psid,"prop_attempt_id":aid,"starting_balance":"100000"}
    unsupported={"detail":"multi-asset replay is not supported by Prop lifecycle"}
    with store.connect() as conn:
        records_before=conn.execute("SELECT count(*) AS n FROM workspace_records WHERE kind='replay'").fetchone()["n"]
    compare("reject new multiasset Prop before persistence",
            native("POST","/api/v2/replay/sessions",{**scope,"dataset_ids":["dataset-a","dataset-b"]},422),unsupported)
    with store.connect() as conn:
        assert conn.execute("SELECT count(*) AS n FROM workspace_records WHERE kind='replay'").fetchone()["n"]==records_before

    # Compatibility creation reproduces the previously accepted invalid record.
    # Keep its history readable, but never save a trade that Prop cannot ingest.
    invalid=service.create("tenant-a",**scope,dataset_ids=["dataset-a","dataset-b"])
    invalid_id=invalid["record_id"];invalid_path=f"/api/v2/replay/sessions/{invalid_id}"
    invalid_before=store.get_record("tenant-a","replay",invalid_id)
    quick={**init,"operation_id":"invalid-prop-order","side":"SELL","quantity":"0.12","stop_loss":None,"take_profit":None,"execution_timing":"current_quote"}
    market={k:v for k,v in quick.items() if k not in init}
    for tail,args in [("execution",init),("orders/quick",quick),("orders/market",market),
                      ("orders/protection",{"target_id":"unreachable","operation_id":"invalid-protection","stop_loss":None,"take_profit":None}),
                      ("orders/close",{"target_id":"unreachable","operation_id":"invalid-close"}),
                      ("step",{"steps":1})]:
        compare("reject existing multiasset Prop "+tail,
                native("POST",invalid_path+"/"+tail,{"expected_revision":invalid["revision"],**args},422),unsupported)
        compare("preserve invalid Prop history after "+tail,store.get_record("tenant-a","replay",invalid_id),invalid_before)
    compare("invalid Prop remains readable",native("GET",invalid_path),invalid)
    invalid=service.quick_market_order("tenant-a",invalid_id,invalid["revision"],**quick)
    invalid_before=store.get_record("tenant-a","replay",invalid_id)
    position_id=invalid["payload"]["execution"]["position"]["position_id"]
    for tail,args in [("orders/quick",quick),("orders/market",market),("step",{"steps":1}),
                      ("orders/protection",{"target_id":position_id,"operation_id":"existing-invalid-protection","stop_loss":None,"take_profit":None}),
                      ("orders/close",{"target_id":position_id,"operation_id":"existing-invalid-close"})]:
        compare("reject initialized multiasset Prop "+tail,
                native("POST",invalid_path+"/"+tail,{"expected_revision":invalid["revision"],**args},422),unsupported)
        compare("preserve initialized Prop position after "+tail,store.get_record("tenant-a","replay",invalid_id),invalid_before)
    compare("invalid Prop order history remains readable",native("GET",invalid_path),invalid)
    valid=native("POST","/api/v2/replay/sessions",{**scope,"dataset_ids":["dataset-a"]},201)
    valid=native("POST",f'/api/v2/replay/sessions/{valid["record_id"]}/orders/quick',
                 {"expected_revision":valid["revision"],**quick,"operation_id":"valid-prop-quick"})
    assert valid["payload"]["execution"]["position"]["side"]=="SELL"
    compare("singleasset Prop quick fills immediately",valid["payload"]["execution"]["pending_market_order"],None)
    propbase=f"/api/v2/prop/sessions/{psid}/attempts/{aid}"
    feedpath=base+f"/prop/sessions/{psid}/attempts/{aid}/feed"
    first=None
    for number in (1,2):
        n=native("POST",base+"/step",{"expected_revision":n["revision"],"steps":1})
        body={"replay_event_sequence":n["payload"]["execution"]["event_sequence"],"expected_prop_revision":number,"prop_event_sequence":number}
        args={"prop_session_id":psid,"prop_attempt_id":aid,**body}
        fed=differential(f"persisted Prop feed {number}",feedpath,body,lambda:service.feed_prop_lifecycle("tenant-a",sid,**args))
        retry=native("POST",feedpath,body)
        assert retry["duplicate"] is True
        compare(f"persisted Prop feed exact native retry {number}",{**retry,"duplicate":False},fed)
        differential(f"persisted Prop feed mixed-runtime retry {number}",feedpath,body,lambda:service.feed_prop_lifecycle("tenant-a",sid,**args))
        if first is None:first=n
    intent=TransitionIntent(workspace_id="tenant-a",session_id=psid,attempt_id=aid,profile_hash=attempt.profile_hash,intent_id="native-abandon",expected_revision=fed["attempt"]["revision"],event_sequence=fed["phase"]["last_event_sequence"],action="abandon")
    terminal=differential("persisted Prop abandon",propbase+"/transitions",intent.model_dump(mode="json"),lambda:store.apply_prop_transition_intent(intent))
    child=native("POST",base+"/branch",{"expected_revision":n["revision"],"cursor_index":first["payload"]["execution"]["cursor_index"]},201)
    body={"expected_replay_revision":child["revision"],"expected_parent_replay_revision":n["revision"],"expected_parent_attempt_revision":terminal["attempt"]["revision"],"operation_id":"native-hindsight"}
    branchpath=f'/api/v2/replay/sessions/{child["record_id"]}/prop/sessions/{psid}/attempts/{aid}/branch'
    args={"prop_session_id":psid,"parent_attempt_id":aid,**body}
    branched=differential("persisted Prop historical branch",branchpath,body,lambda:service.branch_prop_attempt("tenant-a",child["record_id"],**args),201)
    differential("persisted Prop historical branch retry",branchpath,body,lambda:service.branch_prop_attempt("tenant-a",child["record_id"],**args),201)
    assert branched["attempt"]["branch_kind"]=="hindsight_exploratory"
    childaid=branched["attempt"]["attempt_id"]
    childpbase=f"/api/v2/prop/sessions/{psid}/attempts/{childaid}"
    resumeintent=TransitionIntent(workspace_id="tenant-a",session_id=psid,attempt_id=childaid,profile_hash=attempt.profile_hash,intent_id="native-child-resume",expected_revision=branched["attempt"]["revision"],event_sequence=branched["phase"]["last_event_sequence"],action="resume")
    resumed=differential("persisted Prop branch resume",childpbase+"/transitions",resumeintent.model_dump(mode="json"),lambda:store.apply_prop_transition_intent(resumeintent))
    childbase=f'/api/v2/replay/sessions/{child["record_id"]}'
    child=native("POST",childbase+"/step",{"expected_revision":child["revision"],"steps":1})
    feedbody={"replay_event_sequence":child["payload"]["execution"]["event_sequence"],"expected_prop_revision":resumed["attempt"]["revision"],"prop_event_sequence":resumed["phase"]["last_event_sequence"]+1}
    differential("persisted Prop branch continues",childbase+f"/prop/sessions/{psid}/attempts/{childaid}/feed",feedbody,lambda:service.feed_prop_lifecycle("tenant-a",child["record_id"],prop_session_id=psid,prop_attempt_id=childaid,**feedbody))
    differential("persisted Prop historical branch delayed retry",branchpath,body,lambda:service.branch_prop_attempt("tenant-a",child["record_id"],**args),201)

    # Create a canonical passed-phase boundary, as the existing PostgreSQL
    # regression does; the next-phase mutation must update both stores atomically.
    passed=native("POST","/api/v2/replay/sessions",{"dataset_id":"dataset-a","starting_balance":"100000"},201)
    rid=passed["record_id"];rbase=f"/api/v2/replay/sessions/{rid}"
    passed=native("POST",rbase+"/execution",{"expected_revision":passed["revision"],**init})
    passed=native("POST",rbase+"/step",{"expected_revision":passed["revision"],"steps":1})
    snap=passed["payload"]["execution"];event=snap["ledger"][-1]
    session,attempt,phase,resume=prop_state(session_id="phase-"+uuid4().hex,attempt_id="phase-attempt-"+uuid4().hex,dataset_sha256=manifest.artifact_sha256)
    attempt=attempt.model_copy(update={"cost_version":init["cost_model"]["version"]})
    session=session.model_copy(update={"status":"phase_passed","profile":session.profile.model_copy(update={"phases":[phase_spec(phase_index=1,position_policy="must_be_flat"),phase_spec(phase_index=2,initial_capital="50000",position_policy="must_be_flat")]})})
    attempt=attempt.model_copy(update={"status":"phase_passed"})
    stamp=datetime.fromtimestamp(event["virtual_time_utc"],tz=timezone.utc)
    phase=phase.model_copy(update={"virtual_time_utc":stamp,"last_event_sequence":1})
    resume={"cursor":{"bar_index":snap["cursor_index"],"timestamp_utc":stamp.isoformat().replace("+00:00","Z")},"open_positions":[],"pending_orders":[],"replay_binding":{"replay_session_id":rid,"branch_id":snap["branch_id"],"dataset_id":snap["dataset_id"],"dataset_sha256":snap["dataset_sha256"],"last_replay_event_sequence":snap["event_sequence"]}}
    store.create_prop_session_bundle(session,attempt,phase,resume_state=resume)
    pbase=f"/api/v2/prop/sessions/{session.session_id}/attempts/{attempt.attempt_id}"
    intent=TransitionIntent(workspace_id="tenant-a",session_id=session.session_id,attempt_id=attempt.attempt_id,profile_hash=attempt.profile_hash,intent_id="native-next-phase",expected_revision=1,event_sequence=1,action="next_phase")
    advanced=differential("persisted replay-bound next phase",pbase+"/transitions",intent.model_dump(mode="json"),lambda:store.apply_prop_transition_intent(intent))
    differential("persisted replay-bound next phase retry",pbase+"/transitions",intent.model_dump(mode="json"),lambda:store.apply_prop_transition_intent(intent))
    assert advanced["phase"]["phase_index"]==2 and advanced["phase"]["balance"]=="50000"
    assert advanced["replay_record"]["payload"]["execution"]["phase_index"]==2
    startintent=TransitionIntent(workspace_id="tenant-a",session_id=session.session_id,attempt_id=attempt.attempt_id,profile_hash=attempt.profile_hash,intent_id="native-phase2-start",expected_revision=advanced["attempt"]["revision"],event_sequence=advanced["phase"]["last_event_sequence"],action="start")
    started=differential("persisted replay-bound phase2 start",pbase+"/transitions",startintent.model_dump(mode="json"),lambda:store.apply_prop_transition_intent(startintent))
    passed=native("POST",rbase+"/step",{"expected_revision":advanced["replay_record"]["revision"],"steps":1})
    feedbody={"replay_event_sequence":passed["payload"]["execution"]["event_sequence"],"expected_prop_revision":started["attempt"]["revision"],"prop_event_sequence":started["phase"]["last_event_sequence"]+1}
    differential("persisted replay-bound phase2 feed",rbase+f"/prop/sessions/{session.session_id}/attempts/{attempt.attempt_id}/feed",feedbody,lambda:service.feed_prop_lifecycle("tenant-a",rid,prop_session_id=session.session_id,prop_attempt_id=attempt.attempt_id,**feedbody))
    differential("persisted replay-bound phase transition delayed retry",pbase+"/transitions",intent.model_dump(mode="json"),lambda:store.apply_prop_transition_intent(intent))


def benchmark_cases(native, service, compare, init, output, count, probe):
    """Local serial latency diagnostic, not HTTP, capacity, or UI acceptance."""
    from time import perf_counter_ns
    import json,platform,hashlib
    samples=[]
    def measured(runtime,operation,index,call):
        start=perf_counter_ns();value=call();elapsed=perf_counter_ns()-start
        samples.append({"runtime":runtime,"operation":operation,"sample":index,"elapsed_ns":elapsed})
        return value
    for i in range(count+2):
        # Two full workload iterations warm dependency, DB and artifact caches;
        # retain their raw samples while excluding them from reported quantiles.
        config={"dataset_id":"dataset-a","starting_balance":"100000","name":f"benchmark-{i}"}
        n=native("POST","/api/v2/replay/sessions",config,201);p=service.create("tenant-a",**config)
        np=f'/api/v2/replay/sessions/{n["record_id"]}'
        args={**init,"operation_id":f"benchmark-quick-{i}","side":"SELL","quantity":"0.12","stop_loss":None,"take_profit":None,"execution_timing":"current_quote"}
        n=measured("rust-router-stdio","first-use-quick",i,lambda:native("POST",np+"/orders/quick",{"expected_revision":n["revision"],**args}))
        p=measured("python-direct-service","first-use-quick",i,lambda:service.quick_market_order("tenant-a",p["record_id"],p["revision"],**args))
        compare(f"benchmark quick parity {i}",n,p)
        for j in range(3):
            args={"operation_id":f"benchmark-protection-{i}-{j}","stop_loss":str(1.12+j*.001),"take_profit":str(1.09-j*.001)}
            na={**args,"target_id":n["payload"]["execution"]["position"]["position_id"]}
            pa={**args,"target_id":p["payload"]["execution"]["position"]["position_id"]}
            n=measured("rust-router-stdio","protection",i,lambda:native("POST",np+"/orders/protection",{"expected_revision":n["revision"],**na}))
            p=measured("python-direct-service","protection",i,lambda:service.change_protection("tenant-a",p["record_id"],p["revision"],**pa))
            compare(f"benchmark protection parity {i}-{j}",n,p)
        n=measured("rust-router-stdio","step",i,lambda:native("POST",np+"/step",{"expected_revision":n["revision"],"steps":1}))
        p=measured("python-direct-service","step",i,lambda:service.step("tenant-a",p["record_id"],p["revision"],1))
        compare(f"benchmark step parity {i}",n,p)
    summary=[]
    for runtime in sorted({s["runtime"] for s in samples}):
        for operation in sorted({s["operation"] for s in samples}):
            values=sorted(s["elapsed_ns"] for s in samples if s["runtime"]==runtime and s["operation"]==operation and s["sample"]>=2)
            def nearest(q):return values[max(0,__import__("math").ceil(len(values)*q)-1)]/1e6
            summary.append({"runtime":runtime,"operation":operation,"count":len(values),"p50_ms":nearest(.5),"p95_ms":nearest(.95),"p99_ms":nearest(.99),"max_ms":max(values)/1e6})
    (output/"latency.json").write_text(json.dumps({"status":"PASS","scope":"owned disposable PostgreSQL, serial synthetic 60-bar workload; same financial inputs/parity checks","limitations":["Rust includes stdin/stdout IPC, JSON serialization, full Axum router/auth/transaction/receipt. Python measures direct ReplayService calls and PostgreSQL only.","No TCP/HTTP/browser rendering, no old queued API comparison, no concurrency/capacity or long-ledger claim; do not report these numbers as speedup.","First two workload iterations retained as warmups but excluded from quantiles."],"probe":str(probe.resolve()),"probe_sha256":hashlib.sha256(probe.read_bytes()).hexdigest(),"python":platform.python_version(),"samples":samples,"summary":summary},indent=2),encoding="utf-8")
