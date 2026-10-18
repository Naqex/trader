"""Bounded quiet/loaded native HTTP diagnostic on an owned disposable cluster."""
from __future__ import annotations
import argparse, ctypes, hashlib, json, math, os, platform, subprocess, sys, tempfile, threading, time
from ctypes import wintypes
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4
import psycopg
from rust_runtime_lifecycle_acceptance import PG_DEFAULT, port
from rust_replay_scaling_benchmark import process_resources

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2.parent)]
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.store import PostgresStore

def windows_tree_resources(roots):
    class Entry(ctypes.Structure):
        _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),('th32ProcessID',wintypes.DWORD),('th32DefaultHeapID',ctypes.c_size_t),('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',wintypes.LONG),('dwFlags',wintypes.DWORD),('szExeFile',wintypes.WCHAR*260)]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
    kernel.OpenProcess.restype=wintypes.HANDLE
    handle=kernel.CreateToolhelp32Snapshot(2,0);entry=Entry();entry.dwSize=ctypes.sizeof(entry);entries={}
    try:
        ok=kernel.Process32FirstW(wintypes.HANDLE(handle),ctypes.byref(entry))
        while ok:
            entries[entry.th32ProcessID]=(entry.th32ParentProcessID,entry.szExeFile)
            ok=kernel.Process32NextW(wintypes.HANDLE(handle),ctypes.byref(entry))
    finally:kernel.CloseHandle(wintypes.HANDLE(handle))
    result={}
    for group,root_pid in roots.items():
        owned={root_pid};previous=set()
        while previous!=owned:
            previous=owned.copy();owned.update(pid for pid,(parent,_) in entries.items() if parent in owned)
        values=[]
        for pid in owned:
            process=kernel.OpenProcess(0x410,False,pid)
            if not process:continue
            try:values.append(dict(pid=pid,name=entries.get(pid,(None,''))[1],**process_resources(int(process))))
            except OSError:pass
            finally:kernel.CloseHandle(wintypes.HANDLE(process))
        result[group]=values
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--pg-bin',type=Path,default=PG_DEFAULT);parser.add_argument('--bin-dir',type=Path,default=V2/'api-rust/target/native-candidate/release')
    parser.add_argument('--block-seconds',type=int,default=30);parser.add_argument('--samples-per-block',type=int,default=30)
    parser.add_argument('--research-rows',type=int,default=50000);parser.add_argument('--max-jobs-per-block',type=int,default=8)
    args=parser.parse_args();assert 3<=args.block_seconds<=30 and 3<=args.samples_per_block<=30 and 5000<=args.research_rows<=50000 and 2<=args.max_jobs_per_block<=8
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);binary=args.bin_dir.resolve();flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    report=dict(passed=False,scope='bounded native foreground/background HTTP diagnostic; synthetic disposable only',configuration=vars(args)|{'output':str(out),'pg_bin':str(args.pg_bin),'bin_dir':str(binary)},machine=dict(platform=platform.platform(),logical_cpus=os.cpu_count(),processor=platform.processor()),blocks=[],latencies=[],resources=[],jobs=[],checks=[],limitations=['Diagnostic samples, not stable tail, capacity, long-duration soak or production promotion.','Loopback HTTP, full canonical responses and exact retries included; browser/rendering excluded.','PostgreSQL RSS sums all descendant working sets; shared pages may be double-counted. CPU includes sampled live/exited processes but sub-second children can be missed.','Background admission is bounded; actual running overlap is recorded rather than assuming uninterrupted CPU load.','Orchestration Python is test tooling; no Python domain/command worker is started.'],owner_runtime_touched=False,broker=False,provider_network=False)
    report['limitations'] += [
        'Running status brackets the protection/retry/GET sequence; it does not prove overlap of every individual request.',
        'The 330s HTTP admission budget is not a hard wall deadline; database work and cleanup can exceed it.',
        'Quiet/loaded financial equality uses the same implementation; research artifacts are checked for identity/hash/count, not full independent metric parity.',
    ]
    def binary_fingerprints():
        return {name:hashlib.sha256((binary/name).read_bytes()).hexdigest() for name in ['trading-workspace-api.exe','rust_runtime_admin.exe','rust_research_worker.exe']}
    def source_fingerprints():
        paths=[Path(__file__),*sorted((V2/'api-rust/src').rglob('*.rs'))]
        return {str(p.relative_to(V2)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    report['binary_hashes']=binary_fingerprints()
    report['source_hashes']=source_fingerprints()
    api=None;worker=None;monitor=None;monitor_stop=threading.Event();phase={'block':-1,'mode':'setup'};owned_roots={};monitor_errors=[]
    with tempfile.TemporaryDirectory(prefix='native-mixed-resource-') as temp:
        root=Path(temp);data=root/'pgdata';artifacts=root/'artifacts';artifacts.mkdir();pgport=port();apiport=port()
        subprocess.run([str(args.pg_bin/'initdb.exe'),'-D',str(data),'-A','trust','-U','fixture','--encoding=UTF8','--locale=C'],check=True,capture_output=True,creationflags=flags)
        with (out/'postgres.log').open('w',encoding='utf-8') as pglog,(out/'api.log').open('w',encoding='utf-8') as apilog,(out/'worker.log').open('w',encoding='utf-8') as workerlog:
            pg=subprocess.Popen([str(args.pg_bin/'postgres.exe'),'-D',str(data),'-h','127.0.0.1','-p',str(pgport),'-c','shared_buffers=32MB','-c','max_connections=40'],stdout=pglog,stderr=pglog,creationflags=flags);owned_roots['postgres']=pg.pid
            env={k:v for k,v in os.environ.items() if not k.startswith('TW_V2_')};dsn=f'host=127.0.0.1 port={pgport} user=fixture dbname=postgres'
            env.update(TW_V2_DATABASE_URL=dsn,TW_V2_ARTIFACT_ROOT=str(artifacts),TW_V2_LOCAL_WORKSPACES='tenant-a',TW_V2_LOCAL_IDENTITY='local-owner',TW_V2_RUNTIME_PROFILE='native',TW_V2_DOWNLOAD_ENGINE='none',TW_V2_RUST_BIND=f'127.0.0.1:{apiport}',TW_V2_SHUTDOWN_FILE=str(root/'api-stop'),TW_V2_OPENAPI_PATH=str(V2/'contracts/openapi.json'))
            origin=f'http://127.0.0.1:{apiport}'
            def http(path,body=None,key=None,expected=200):
                assert time.monotonic()-started_all<330,'scheduled HTTP admission budget exceeded'
                headers={'X-Workspace-Id':'tenant-a','Content-Type':'application/json'}
                if key:headers['Idempotency-Key']=key
                started=time.perf_counter_ns();request=Request(origin+path,data=None if body is None else json.dumps(body,separators=(',',':')).encode(),headers=headers)
                try:response=urlopen(request,timeout=20)
                except HTTPError as error:response=error
                with response:raw=response.read();status=response.status;command=response.headers.get('x-command-id')
                elapsed=(time.perf_counter_ns()-started)/1e6;value=json.loads(raw)
                assert status==expected,(path,status,value)
                return value,dict(elapsed_ms=elapsed,status=status,response_bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),command_id=command)
            def start_worker(label):
                nonlocal worker
                child_env=env|{'TW_V2_SHUTDOWN_FILE':str(root/f'worker-stop-{label}'),'TW_V2_WORKER_ID':f'mixed-{label}'}
                worker=subprocess.Popen([str(binary/'rust_research_worker.exe'),'--poll-ms','100','--lease-seconds','3'],cwd=V2,env=child_env,stdout=workerlog,stderr=workerlog,creationflags=flags);owned_roots['research']=worker.pid
                return Path(child_env['TW_V2_SHUTDOWN_FILE'])
            def stop_worker(stop):
                if worker and worker.poll() is None:
                    stop.write_text('stop\n')
                    try:worker.wait(timeout=15)
                    except subprocess.TimeoutExpired:worker.kill();worker.wait(timeout=5)
                owned_roots.pop('research',None)
            started_all=time.monotonic()
            try:
                for _ in range(100):
                    try:
                        with psycopg.connect(dsn,connect_timeout=1):break
                    except psycopg.OperationalError:assert pg.poll() is None;time.sleep(.1)
                else:raise AssertionError('PG timeout')
                migration=subprocess.run([str(binary/'rust_runtime_admin.exe'),'migrate'],env=env,cwd=V2,capture_output=True,text=True,timeout=60,creationflags=flags);(out/'migrate.log').write_text(migration.stdout+migration.stderr);assert migration.returncode==0
                store=PostgresStore(dsn);store.ensure_workspace('tenant-a');fixture=json.loads((V2/'web/tests/visual/chart-fixture.json').read_text(encoding='utf-8'));spec=fixture['datasets']['items'][0]['instrument_spec'];artifact=ArtifactStore(artifacts)
                source=DatasetSource(source_id='owned-mixed-fixture',provider='synthetic',instrument_mapping={'EURUSD':'EURUSD'},license_use='owned synthetic only',retrieved_at_utc='2026-01-01T00:00:00Z',export_settings='mixed resource diagnostic')
                for dataset,count in [('mixed-foreground',6000),('mixed-research',args.research_rows)]:
                    rows=[dict(timestamp=1767225600+i*60,open=1.1,high=1.1002,low=1.0998,close=1.1+(i%7)*.00001 if dataset=='mixed-research' else 1.1,volume=100) for i in range(count)]
                    artifact_path,sha=artifact.write_dataset('tenant-a',dataset,rows);store.put_dataset(DatasetManifest(dataset_id=dataset,workspace_id='tenant-a',source=source,instrument_id='EURUSD',timeframe='M1',timeframe_seconds=60,instrument_spec=spec,row_count=count,first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=artifact_path,artifact_sha256=sha,quality={'disposition':'pass'},created_at_utc='2026-01-01T00:00:00Z'))
                del rows;store.close()
                api=subprocess.Popen([str(binary/'trading-workspace-api.exe')],cwd=V2,env=env,stdout=apilog,stderr=apilog,creationflags=flags);owned_roots['api']=api.pid
                for _ in range(100):
                    assert api.poll() is None,'API exited'
                    try:
                        with urlopen(origin+'/health/ready',timeout=1) as response:health=json.load(response)
                        assert health['command_worker']=='not_required';break
                    except OSError:time.sleep(.1)
                else:raise AssertionError('API timeout')
                def sample_resources():
                    try:
                        with psycopg.connect(dsn) as conn:
                            while not monitor_stop.is_set():
                                now=time.monotonic();jobs=conn.execute("SELECT status,count(*) FROM research_jobs GROUP BY status").fetchall();resources=windows_tree_resources(owned_roots.copy())
                                report['resources'].append(dict(at_seconds=now-started_all,**phase,processes=resources,research_counts=dict(jobs)))
                                monitor_stop.wait(max(0,1-(time.monotonic()-now)))
                    except BaseException as error:monitor_errors.append(repr(error))
                monitor=threading.Thread(target=sample_resources,daemon=True);monitor.start()
                from tests.test_replay_execution_core import initial_state
                initial=dict(instrument_spec=spec,cost_model=initial_state().cost_model,spread_price='0.0002',timeframe_seconds=60,starting_balance='100000')
                recovery_job=None;financial_baseline=None
                with psycopg.connect(dsn,autocommit=True) as conn:
                    for block,mode in enumerate(['quiet','loaded','loaded','loaded','quiet','loaded','loaded','loaded','quiet']):
                        phase.update(block=block,mode='prepare')
                        record,_=http('/api/v2/replay/sessions',dict(dataset_id='mixed-foreground',starting_balance='100000'),expected=201);path='/api/v2/replay/sessions/'+record['record_id']
                        record,_=http(path+'/orders/quick',dict(expected_revision=record['revision'],operation_id=uuid4().hex,side='SELL',quantity='0.12',stop_loss=None,take_profit=None,execution_timing='current_quote',**initial))
                        record,_=http(path+'/step',dict(expected_revision=record['revision'],steps=500));assert len(record['payload']['execution']['ledger'])>=500
                        position=record['payload']['execution']['position']['position_id'];block_jobs=[];stop=None
                        preserved_account={key:record['payload']['execution'].get(key) for key in ['balance','equity','floating_pl','cost_model','instrument_spec']}
                        preserved_position={key:value for key,value in record['payload']['execution']['position'].items() if key not in ['stop_loss','take_profit']}
                        def submit():
                            value,_=http('/api/v2/research/jobs',dict(dataset_id='mixed-research',strategy_version='close-delta-v1',starting_balance=10000),uuid4().hex,202);block_jobs.append(value['job_id']);report['jobs'].append(value['job_id']);return value['job_id']
                        if mode=='loaded':
                            first_job=submit()
                            if recovery_job is None:
                                canceled,_=http(f'/api/v2/research/jobs/{first_job}/cancel',{},uuid4().hex)
                                assert canceled['status']=='canceled';report['checks'].append(dict(name='queued native research canceled without result',job_id=first_job));submit()
                            stop=start_worker(f'{block}-first')
                            if recovery_job is None:
                                deadline=time.monotonic()+10
                                while time.monotonic()<deadline:
                                    running=conn.execute("SELECT job_id FROM research_jobs WHERE status='running'").fetchone()
                                    if running:break
                                    time.sleep(.01)
                                else:raise AssertionError('could not observe actual running job for crash recovery')
                                recovery_job=running[0];worker.kill();worker.wait(timeout=5);owned_roots.pop('research',None);stop=start_worker(f'{block}-recovered');report['interrupted_job']=recovery_job
                        phase.update(mode=mode);began=time.monotonic()
                        before_db=conn.execute('SELECT pg_database_size(current_database())').fetchone()[0]
                        for iteration in range(args.samples_per_block):
                            due=began+iteration*args.block_seconds/args.samples_per_block
                            if due>time.monotonic():time.sleep(due-time.monotonic())
                            active,running_count=conn.execute("SELECT count(*) FILTER (WHERE status IN ('queued','running')),count(*) FILTER (WHERE status='running') FROM research_jobs").fetchone()
                            if mode=='loaded' and active<2 and len(block_jobs)<args.max_jobs_per_block:submit()
                            body=dict(expected_revision=record['revision'],operation_id=uuid4().hex,target_id=position,stop_loss=str(1.13+iteration*.0001),take_profit=str(1.08-iteration*.0001));key=uuid4().hex
                            changed,timing=http(path+'/orders/protection',body,key);execution=changed['payload']['execution'];assert changed['revision']==record['revision']+1 and execution['position']['stop_loss']==body['stop_loss'] and execution['position']['take_profit']==body['take_profit'] and execution['pending_market_order'] is None
                            assert {key:execution.get(key) for key in preserved_account}==preserved_account
                            assert {key:value for key,value in execution['position'].items() if key not in ['stop_loss','take_profit']}==preserved_position
                            assert len(execution['ledger'])==len(record['payload']['execution']['ledger'])+1
                            retried,retry=http(path+'/orders/protection',body,key);assert retried==changed and timing['sha256']==retry['sha256']
                            read,reading=http(path);assert read==changed
                            running_after=conn.execute("SELECT count(*) FROM research_jobs WHERE status='running'").fetchone()[0]
                            if iteration==0:
                                receipt,_=http('/api/v2/commands/'+timing['command_id']);assert receipt['status']=='completed';assert json.loads(receipt['result_text'])==changed if receipt['result_text'] is not None else receipt['result_body']==changed
                                _,conflict=http(path+'/orders/protection',body|{'operation_id':uuid4().hex},uuid4().hex,409);report['checks'].append(dict(name='stale revision rejected',block=block,status=conflict['status']))
                            for operation,measurement in [('protection',timing),('exact_retry',retry),('read',reading)]:report['latencies'].append(dict(block=block,mode=mode,iteration=iteration,operation=operation,ledger_events=len(execution['ledger']),research_active=active,research_running_before=running_count,research_running_after=running_after,scheduled_block_seconds=iteration*args.block_seconds/args.samples_per_block,completed_block_seconds=time.monotonic()-began,**measurement))
                            record=changed
                        remaining=began+args.block_seconds-time.monotonic()
                        if remaining>0:time.sleep(remaining)
                        phase['mode']='drain'
                        if mode=='loaded':
                            for job in block_jobs:
                                status=conn.execute('SELECT status FROM research_jobs WHERE job_id=%s',(job,)).fetchone()[0]
                                if status in ('queued','running'):http(f'/api/v2/research/jobs/{job}/cancel',{},uuid4().hex)
                            stop_worker(stop)
                        closed,_=http(path+'/orders/close',dict(expected_revision=record['revision'],target_id=position,operation_id=uuid4().hex));assert closed['payload']['execution']['position'] is None
                        final,_=http(path);assert final==closed
                        financial={key:closed['payload']['execution'].get(key) for key in ['balance','equity','floating_pl','cost_model','instrument_spec','pending_market_order']}
                        if financial_baseline is None:financial_baseline=financial
                        else:assert financial==financial_baseline,'quiet/loaded final financial state differs'
                        persisted=conn.execute("SELECT r.current_revision,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id='tenant-a' AND r.kind='replay' AND r.record_id=%s",(closed['record_id'],)).fetchone();assert persisted[0]==closed['revision'] and persisted[1]==closed['payload']
                        report['blocks'].append(dict(block=block,mode=mode,samples=args.samples_per_block,seconds=time.monotonic()-began,jobs=len(block_jobs),db_bytes_before=before_db,db_bytes_after=conn.execute('SELECT pg_database_size(current_database())').fetchone()[0],final_revision=closed['revision'],final_ledger_events=len(closed['payload']['execution']['ledger'])))
                        (out/'progress.json').write_text(json.dumps(dict(block=block,mode=mode,completed_blocks=len(report['blocks']),elapsed_seconds=time.monotonic()-started_all)))
                        print(json.dumps(report['blocks'][-1]),flush=True)
                    rows=conn.execute('SELECT job_id,status,attempt_no,result_path,result_sha256 FROM research_jobs ORDER BY job_id').fetchall();assert rows
                    assert all(row[1] in ('completed','canceled') for row in rows)
                    completed=[row for row in rows if row[1]=='completed'];assert completed
                    for job,status,attempt,result_path,result_sha in rows:
                        if status!='completed':assert result_path is None;continue
                        file=(artifacts/result_path).resolve();assert file.is_relative_to(artifacts);raw=file.read_bytes();assert hashlib.sha256(raw).hexdigest()==result_sha;value=json.loads(raw);assert value['job_id']==job and value['trade_count']==args.research_rows-1 and value['dataset_id']=='mixed-research'
                    recovered=next(row for row in rows if row[0]==recovery_job);assert recovered[1]=='completed' and recovered[2]>=2
                    assert conn.execute('SELECT count(*) FROM api_command_workers').fetchone()[0]==0
                    assert conn.execute("SELECT count(*) FROM api_commands WHERE status IN ('queued','running')").fetchone()[0]==0
                    report['research_final']=[dict(job_id=row[0],status=row[1],attempt_no=row[2]) for row in rows]
                    report['checks'].append(dict(name='crashed native worker job recovered and published validated artifact',job_id=recovery_job,attempts=recovered[2]))
                assert not monitor_errors,monitor_errors
                assert len(report['blocks'])==9
                assert all(any(sample['block']==block and sample['mode']==mode and sample['processes'].get('api') and sample['processes'].get('postgres') for sample in report['resources']) for block,mode in enumerate(['quiet','loaded','loaded','loaded','quiet','loaded','loaded','loaded','quiet']))
                for block in [1,2,3,5,6,7]:
                    running_samples=[sample for sample in report['resources'] if sample['block']==block and sample['mode']=='loaded' and sample['processes'].get('research') and sample['research_counts'].get('running',0)>0]
                    bracketed=[sample for sample in report['latencies'] if sample['block']==block and sample['operation']=='protection' and (sample['research_running_before'] or sample['research_running_after'])]
                    report['checks'].append(dict(name='loaded block has sampled running worker and request-boundary research activity',block=block,running_resource_samples=len(running_samples),request_boundary_samples=len(bracketed)))
                    assert running_samples and bracketed,f'block {block} insufficient observed background load; no loaded comparison verdict'
                report['passed']=True
            except BaseException as error:report['error']=repr(error);raise
            finally:
                monitor_stop.set()
                if monitor:monitor.join(timeout=5)
                if worker and worker.poll() is None:worker.kill();worker.wait(timeout=5)
                if api and api.poll() is None:
                    (root/'api-stop').write_text('stop\n')
                    try:api.wait(timeout=30)
                    except subprocess.TimeoutExpired:api.kill();api.wait(timeout=5)
                subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(data),'-m','fast','stop'],capture_output=True,timeout=20,creationflags=flags);pg.wait(timeout=20)
                report['elapsed_seconds']=time.monotonic()-started_all
                report['source_unchanged']=report['source_hashes']==source_fingerprints()
                report['binaries_unchanged']=report['binary_hashes']==binary_fingerprints()
                if not report['source_unchanged'] or not report['binaries_unchanged']:
                    report['passed']=False
                    report['error']='source or binaries changed during bounded resource acceptance'
                summaries=[]
                for mode in ['quiet','loaded','loaded_sequence_boundary_running']:
                    for operation in ['protection','exact_retry','read']:
                        values=sorted(s['elapsed_ms'] for s in report['latencies'] if (s['mode']==mode or mode=='loaded_sequence_boundary_running' and s['mode']=='loaded' and (s['research_running_before'] or s['research_running_after'])) and s['operation']==operation)
                        if values:summaries.append(dict(mode=mode,operation=operation,count=len(values),p50_ms=values[math.ceil(len(values)*.5)-1],sample_p95_ms=values[math.ceil(len(values)*.95)-1],max_ms=max(values)))
                report['summary']=summaries
                peaks={}
                for mode in ['quiet','loaded']:
                    samples=[s for s in report['resources'] if s['mode']==mode]
                    for group in ['api','research','postgres']:
                        values=[sum(p['rss_bytes'] for p in s['processes'].get(group,[])) for s in samples]
                        if values:peaks[f'{mode}_{group}_peak_rss_bytes']=max(values)
                        commits=[sum(p['private_commit_bytes'] for p in s['processes'].get(group,[])) for s in samples]
                        if commits:peaks[f'{mode}_{group}_peak_private_commit_bytes']=max(commits)
                        # Sum only observed deltas within each phase block. CPU
                        # accrued before a process's first sample is excluded.
                        observed_cpu_ns=0
                        for block in {s['block'] for s in samples}:
                            by_pid={}
                            for sample in samples:
                                if sample['block']!=block:continue
                                for process in sample['processes'].get(group,[]):by_pid.setdefault(process['pid'],[]).append(process['cpu_kernel_ns']+process['cpu_user_ns'])
                            observed_cpu_ns+=sum(max(values)-min(values) for values in by_pid.values())
                        peaks[f'{mode}_{group}_observed_cpu_seconds']=observed_cpu_ns/1e9
                    peaks[f'{mode}_resource_samples']=len(samples);peaks[f'{mode}_running_research_samples']=sum(s['research_counts'].get('running',0)>0 for s in samples)
                report['resource_peaks']=peaks
                (out/'receipt.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    assert report['passed'],report.get('error','bounded resource acceptance incomplete')
    print(json.dumps(dict(passed=report['passed'],summary=report['summary'],resource_peaks=report['resource_peaks'],elapsed_seconds=report['elapsed_seconds'])))

if __name__=='__main__':main()
