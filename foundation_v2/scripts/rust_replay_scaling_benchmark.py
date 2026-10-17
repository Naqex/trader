"""Scaling measurements on the caller's owned disposable cluster only."""
import ctypes,json,math,os,time
from ctypes import wintypes
from concurrent.futures import ThreadPoolExecutor


def process_resources(handle):
    class Counters(ctypes.Structure):
        _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD),('PeakWorkingSetSize',ctypes.c_size_t),('WorkingSetSize',ctypes.c_size_t),('QuotaPeakPagedPoolUsage',ctypes.c_size_t),('QuotaPagedPoolUsage',ctypes.c_size_t),('QuotaPeakNonPagedPoolUsage',ctypes.c_size_t),('QuotaNonPagedPoolUsage',ctypes.c_size_t),('PagefileUsage',ctypes.c_size_t),('PeakPagefileUsage',ctypes.c_size_t)]
    counters=Counters();counters.cb=ctypes.sizeof(counters)
    api=ctypes.WinDLL('kernel32',use_last_error=True)
    if not api.K32GetProcessMemoryInfo(wintypes.HANDLE(handle),ctypes.byref(counters),ctypes.sizeof(counters)):raise ctypes.WinError(ctypes.get_last_error())
    creation=wintypes.FILETIME();exit_time=wintypes.FILETIME();kernel=wintypes.FILETIME();user=wintypes.FILETIME()
    if not api.GetProcessTimes(wintypes.HANDLE(handle),ctypes.byref(creation),ctypes.byref(exit_time),ctypes.byref(kernel),ctypes.byref(user)):raise ctypes.WinError(ctypes.get_last_error())
    ticks=lambda value:(value.dwHighDateTime<<32)|value.dwLowDateTime
    return {'rss_bytes':counters.WorkingSetSize,'peak_rss_bytes':counters.PeakWorkingSetSize,'private_commit_bytes':counters.PagefileUsage,'cpu_kernel_ns':ticks(kernel)*100,'cpu_user_ns':ticks(user)*100,'page_fault_count':counters.PageFaultCount}


def scaling_benchmark(native,service,store,artifacts,compare,init,output,stages,repeats,concurrency,process,probe_measurements):
    from trading_workspace_v2.contracts import DatasetManifest,DatasetSource
    from pathlib import Path
    with store.connect() as conn:
        datadir=Path(conn.execute('SHOW data_directory').fetchone()['data_directory'])
        assert datadir.name=='pg' and datadir.parent.name.startswith('rust-replay-service-'),'refuse non-owned fixture database'
    assert stages==sorted(set(stages)) and stages[0]>=0 and stages[-1]<=20000
    bars=stages[-1]+repeats+10
    # Constant prices keep protection valid while growing the canonical ledger.
    # No barrier hit or P/L path silently turns later cases into a different workload.
    rows=[{'timestamp':1767225600+i*60,'open':1.1,'high':1.1002,'low':1.0998,'close':1.1,'volume':100} for i in range(bars)]
    path,sha=artifacts.write_dataset('tenant-a','dataset-scaling',rows)
    store.put_dataset(DatasetManifest(dataset_id='dataset-scaling',workspace_id='tenant-a',source=DatasetSource(source_id='synthetic-scaling',provider='synthetic',instrument_mapping={'EURUSD':'EURUSD'},license_use='fixture',retrieved_at_utc='2026-01-01T00:00:00Z',export_settings='owned-scaling'),instrument_id='EURUSD',timeframe='M1',timeframe_seconds=60,instrument_spec=init['instrument_spec'],row_count=bars,first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=path,artifact_sha256=sha,created_at_utc='2026-01-01T00:00:00Z'))
    samples=[];stamps=[]
    def measured(runtime,op,stage,index,call):
        handle=int(process._handle) if runtime=='rust-router-stdio' else -1
        before=process_resources(handle);start=time.perf_counter_ns();result=call();elapsed=time.perf_counter_ns()-start;after=process_resources(handle)
        samples.append({'runtime':runtime,'operation':op,'stage':stage,'sample':index,'elapsed_ns':elapsed,'response_json_bytes':len(json.dumps(result,separators=(',',':')).encode()),'ledger_events':len(result['payload']['execution']['ledger']),'resource_before':before,'resource_after':after,'cpu_user_delta_ns':after['cpu_user_ns']-before['cpu_user_ns'],'cpu_kernel_delta_ns':after['cpu_kernel_ns']-before['cpu_kernel_ns']})
        if runtime=='rust-router-stdio':
            samples[-1]['router_elapsed_us']=probe_measurements[-1]['router_elapsed_us']
        return result
    def create_pair(name):
        body={'dataset_id':'dataset-scaling','starting_balance':'100000','name':name}
        n=native('POST','/api/v2/replay/sessions',body,201);p=service.create('tenant-a',**body)
        n=native('POST',f'/api/v2/replay/sessions/{n["record_id"]}/execution',{'expected_revision':n['revision'],**init});p=service.initialize_execution('tenant-a',p['record_id'],p['revision'],**init)
        return n,p
    for stage in stages:
        n,p=create_pair('scaling-'+str(stage));np=f'/api/v2/replay/sessions/{n["record_id"]}'
        remaining=stage
        while remaining:
            steps=min(1000,remaining)
            n=native('POST',np+'/step',{'expected_revision':n['revision'],'steps':steps});p=service.step('tenant-a',p['record_id'],p['revision'],steps)
            remaining-=steps
        compare('scaling canonical stage '+str(stage),n,p)
        args={'operation_id':'scaling-quick-'+str(stage),'side':'SELL','quantity':'0.12','stop_loss':None,'take_profit':None,'execution_timing':'current_quote'}
        n=measured('rust-router-stdio','quick',stage,0,lambda:native('POST',np+'/orders/quick',{'expected_revision':n['revision'],**args}))
        p=measured('python-direct-service','quick',stage,0,lambda:service.quick_market_order('tenant-a',p['record_id'],p['revision'],**args))
        compare('scaling quick '+str(stage),n,p)
        for index in range(repeats):
            args={'operation_id':f'scaling-protection-{stage}-{index}','stop_loss':str(1.12+index*.001),'take_profit':str(1.09-index*.001)}
            na={**args,'target_id':n['payload']['execution']['position']['position_id']};pa={**args,'target_id':p['payload']['execution']['position']['position_id']}
            n=measured('rust-router-stdio','protection',stage,index,lambda:native('POST',np+'/orders/protection',{'expected_revision':n['revision'],**na}))
            p=measured('python-direct-service','protection',stage,index,lambda:service.change_protection('tenant-a',p['record_id'],p['revision'],**pa))
            compare(f'scaling protection {stage}-{index}',n,p)
            n=measured('rust-router-stdio','step',stage,index,lambda:native('POST',np+'/step',{'expected_revision':n['revision'],'steps':1}))
            p=measured('python-direct-service','step',stage,index,lambda:service.step('tenant-a',p['record_id'],p['revision'],1))
            compare(f'scaling step {stage}-{index}',n,p)
        with store.connect() as conn:db=conn.execute("SELECT pg_database_size(current_database()) AS bytes,pg_total_relation_size('workspace_record_revisions') AS replay_revision_bytes,pg_total_relation_size('api_commands') AS receipt_bytes").fetchone()
        stamps.append({'stage':stage,'database':db,'rust_process':process_resources(int(process._handle)),'python_process':process_resources(-1)})
    summary=[]
    for runtime in ('rust-router-stdio','python-direct-service'):
        for stage in stages:
            for operation in ('quick','protection','step'):
                values=sorted(s['elapsed_ns'] for s in samples if s['runtime']==runtime and s['stage']==stage and s['operation']==operation)
                summary.append({'runtime':runtime,'stage':stage,'operation':operation,'count':len(values),'p50_ms':values[math.ceil(len(values)*.5)-1]/1e6,'p95_ms':values[math.ceil(len(values)*.95)-1]/1e6,'max_ms':max(values)/1e6})
    (output/'scaling-latency.json').write_text(json.dumps({'status':'PASS','scope':'owned serial scaling fixture; full financial response parity','stages':stages,'rows':bars,'samples':samples,'summary':summary,'resource_checkpoints':stamps,'limitations':['Rust full router includes stdio JSON; Python direct service. No browser/TCP/HTTP/user-end-to-end claim.','Process resources exclude PostgreSQL server CPU/RSS. CPU clocks have OS accounting granularity; zero per-small-request deltas do not mean zero work.','Quick has one sample per ledger size; protection/step counts are small diagnostic samples, not robust tail estimates.','Concurrent workload not yet run: waiting same-AppState batch probe contract or owned HTTP candidate.']},indent=2),encoding='utf-8')
