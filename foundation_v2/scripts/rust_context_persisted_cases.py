"""Read-only route parity inside the owned replay acceptance cluster."""
def context_cases(native,store,artifacts,compare,dsn):
    import json
    from trading_workspace_v2.artifacts import ArtifactStore
    from fastapi.testclient import TestClient
    from trading_workspace_v2.api import create_app
    app=create_app(dsn=dsn,artifact_root=artifacts)
    client=TestClient(app)
    def same(path,workspace='tenant-a',status=200):
        r=client.get(path,headers={'x-workspace-id':workspace})
        if status is not None:assert r.status_code==status,(path,r.status_code,r.text)
        expected=r.text if '.csv' in path else r.json()
        compare('context '+path,native('GET',path,workspace=workspace,status=r.status_code),expected)
    try:
        replay=next(r for r in store.list_records('tenant-a','replay') if r['payload'].get('execution') and not r['payload'].get('asset_states'))
        sid=replay['record_id']
        trades=['closed-a','closed-b']
        for i in range(4):
            store.create_record('tenant-a','journal',{'entry_type':'decision','source':{'kind':'replay','id':trades[i%2],'session_id':sid,'trade_id':trades[i%2]},'tags':['review','same' if i%2 else 'other'],'note':'private note' if i%2 else ''},source_key='context-fixture-'+str(i))
        same('/api/v2/journal/context?session_id='+sid)
        same('/api/v2/journal/context?session_id='+sid,workspace='tenant-b',status=404)
        same('/api/v2/journal/context?session_id=absent',status=404)
        for q in ('','?target_r=1','?stop_multiplier=.5','?side=SELL','?outcome=win','?target_r=0','?target_r=nan','?side=foreign','?cursor_index=999999'):
            same(f'/api/v2/replay/sessions/{sid}/analytics/experiments'+q,status=422 if any(k in q for k in ('target_r=0','target_r=nan','side=foreign','cursor_index=999999')) else 200)
        same(f'/api/v2/replay/sessions/{sid}/analytics/experiments?cursor_index=0',status=None)
        same(f'/api/v2/replay/sessions/{sid}/analytics/experiments',workspace='tenant-b',status=404)
        job=store.create_job('tenant-a','dataset-a','context-fixture',100000)
        prefix=f'/api/v2/research/jobs/{job.job_id}/analytics'
        same(prefix,status=409);same(prefix,workspace='tenant-b',status=404)
        with store.connect() as conn:conn.execute("UPDATE research_jobs SET status='completed' WHERE workspace_id=%s AND job_id=%s",('tenant-a',job.job_id))
        same(prefix,status=503)
        ledger=[{'trade_id':'fixture-a','close_time_utc':1767225600,'side':'BUY','net_pnl':12.5,'gross_pnl':14.5,'fees':2,'planned_risk_budget':10}, {'trade_id':'fixture-b','close_time_utc':1767225660,'side':'SELL','net_pnl':-5.0,'gross_pnl':-3.0,'fees':2}]
        result={'job_id':job.job_id,'workspace_id':'tenant-a','dataset_id':'dataset-a','dataset_sha256':'d'*64,'protocol':{'starting_balance':100000},'ledger':ledger}
        for suffix,result in [('ledger',result),('aggregate',{**result,'ledger':None,'metrics':{'net_pnl':7.5,'closed_trade_count':2}})]:
            path,sha=ArtifactStore(artifacts).write_result('tenant-a',job.job_id+'-'+suffix,result)
            with store.connect() as conn:conn.execute("UPDATE research_jobs SET result_path=%s,result_sha256=%s WHERE workspace_id=%s AND job_id=%s",(path,sha,'tenant-a',job.job_id))
            for ext in ('','.csv'):
                for q in ('','?side=SELL','?outcome=win','?from_close_utc=2026-01-01T00%3A00%3A00Z'):
                    same(prefix+ext+q)
            same(prefix+'?side=invalid',status=422)
            same(prefix+'?from_close_utc=bad',status=422)
            same(prefix+'?from_close_utc=2026-01-01T00%3A00%3A00',status=422)
        # The checksum remains authoritative; a path/hash inconsistency is never a synthetic empty result.
        with store.connect() as conn:conn.execute("UPDATE research_jobs SET result_sha256=%s WHERE workspace_id=%s AND job_id=%s",('0'*64,'tenant-a',job.job_id))
        same(prefix,status=503)
        with store.connect() as conn:conn.execute("UPDATE research_jobs SET result_path=%s WHERE workspace_id=%s AND job_id=%s",('tenant-a/no-such-result.json','tenant-a',job.job_id))
        same(prefix,status=503)
    finally:app.state.store.close()
