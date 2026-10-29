"""Disposable PostgreSQL/native router differential replay acceptance; never owner DB."""
from pathlib import Path
from runtime_paths import postgres_bin
import sys,os,json,tempfile,socket,subprocess,re,time,argparse,hashlib
from decimal import Decimal,InvalidOperation
ROOT=Path(__file__).resolve().parents[2]; V2=ROOT/'foundation_v2';sys.path[:0]=[str(ROOT),str(V2),str(V2/'tests')]
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest,DatasetSource,ReplayActivityRequest
from test_replay_execution_core import initial_state
PG = postgres_bin("TW_PLATFORM_TEST_PG_BIN")
OUT=V2/'evidence/rust-native-20261017/replay-service'
def norm(v):
    if isinstance(v,dict):return {k:norm(x) for k,x in v.items() if k not in {'created_at_utc','updated_at_utc','started_at_utc'}}
    if isinstance(v,list):return [norm(x) for x in v]
    if isinstance(v,str):
        if re.fullmatch('[0-9a-f]{32}',v):return '<uuid>'
        if re.fullmatch(r'\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)',v):return v.removesuffix('+00:00').removesuffix('Z')+'Z'
        try:return Decimal(v).normalize()
        except InvalidOperation:return v
    if isinstance(v,(int,float)) and not isinstance(v,bool):return Decimal(str(v)).normalize()
    return v

def main():
    global OUT
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=OUT)
    parser.add_argument('--probe',type=Path,default=V2/'api-rust/target/debug/examples/rust_replay_service_probe.exe')
    parser.add_argument('--benchmark-samples',type=int,default=0)
    parser.add_argument('--scaling-benchmark',action='store_true')
    parser.add_argument('--scaling-stages',default='0,100,1000,5000')
    parser.add_argument('--scaling-samples',type=int,default=5)
    parser.add_argument('--concurrency',type=int,default=4)
    parser.add_argument('--extended-suites',default='quick,prop,analytics,context',help='Comma-separated quick,prop,analytics,context suites; base replay cases always run')
    cli=parser.parse_args();OUT=cli.output;OUT.mkdir(parents=True,exist_ok=True)
    suites=set(filter(None,cli.extended_suites.split(',')))
    if suites-{'quick','prop','analytics','context'}:parser.error('unknown --extended-suites')
    if not 0<=cli.benchmark_samples<=500:parser.error('--benchmark-samples must be 0..500')
    if not 1<=cli.scaling_samples<=50 or not 1<=cli.concurrency<=8:parser.error('scaling samples 1..50 and concurrency 1..8 required')
    probe_sha256=hashlib.sha256(cli.probe.read_bytes()).hexdigest()
    cases=[]
    with tempfile.TemporaryDirectory(prefix='rust-replay-service-') as temporary:
        work=Path(temporary);artifacts=work/'artifacts';artifacts.mkdir();data=work/'pg'
        with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        def pg(name,*args):subprocess.run([str(PG/(name+'.exe')),*args],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
        pg('initdb','-D',str(data),'-U','fixture','-A','trust','--locale=C','--encoding=UTF8');pg('pg_ctl','-D',str(data),'-l',str(work/'pg.log'),'-o',f'-h 127.0.0.1 -p {port} -c shared_buffers=32MB','-w','start')
        dsn=f'host=127.0.0.1 port={port} user=fixture dbname=postgres';store=PostgresStore(dsn);process=None
        try:
            store.initialize();store.ensure_workspace('tenant-a');store.ensure_workspace('tenant-b');artifact=ArtifactStore(artifacts);service=ReplayService(store,artifact)
            for name,symbol,offset in [('a','EURUSD',0),('b','GBPUSD',0.2)]:
                rows=[{'timestamp':1767225600+i*60,'open':1.1+offset+i*.0001,'high':1.1003+offset+i*.0001,'low':1.0998+offset+i*.0001,'close':1.1001+offset+i*.0001,'volume':100+i} for i in range(60)]
                path,sha=artifact.write_dataset('tenant-a','dataset-'+name,rows);spec=initial_state().instrument_spec;spec={**spec,'instrument_id':symbol,'base_ccy':'EUR' if name=='a' else 'GBP'}
                manifest=DatasetManifest(dataset_id='dataset-'+name,workspace_id='tenant-a',source=DatasetSource(source_id='synthetic',provider='synthetic',instrument_mapping={symbol:symbol},license_use='fixture',retrieved_at_utc='2026-01-01T00:00:00Z',export_settings='fixture'),instrument_id=symbol,timeframe='M1',timeframe_seconds=60,instrument_spec=spec,row_count=len(rows),first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=path,artifact_sha256=sha,created_at_utc='2026-01-01T00:00:00Z');store.put_dataset(manifest)
            env={**os.environ,'TW_V2_DATABASE_URL':dsn,'TW_V2_ARTIFACT_ROOT':str(artifacts),'TW_V2_LOCAL_WORKSPACES':'tenant-a,tenant-b','TW_V2_OPENAPI_PATH':str(V2/'api-rust/openapi.json')}
            log=(OUT/'probe.log').open('w',encoding='utf-8');process=subprocess.Popen([str(cli.probe.resolve())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',env=env,creationflags=subprocess.CREATE_NO_WINDOW)
            probe_measurements=[]
            def native(method,path,body=None,status=200,key=None,workspace='tenant-a'):
                item={'method':method,'path':path,'workspace':workspace};
                if body is not None:item['body']=body
                if key:item['key']=key
                process.stdin.write(json.dumps(item)+'\n');process.stdin.flush();line=process.stdout.readline()
                if not line:raise AssertionError('probe terminated: '+(OUT/'probe.log').read_text(encoding='utf-8'))
                result=json.loads(line);assert result['status']==status,(method,path,result)
                probe_measurements.append({'method':method,'path':path,'router_elapsed_us':result.get('router_elapsed_us')})
                return result['body']
            def compare(label,a,b):
                if norm(a)!=norm(b):
                    (OUT/'mismatch.json').write_text(json.dumps({'case':label,'native':a,'python':b},indent=2),encoding='utf-8');raise AssertionError('differential mismatch '+label)
                cases.append(label)
            config={'dataset_id':'dataset-a','name':'native parity','starting_balance':'100000'}
            n=native('POST','/api/v2/replay/sessions',config,201);p=service.create('tenant-a',**config);compare('create',n,p);np=f'/api/v2/replay/sessions/{n["record_id"]}';pid=p['record_id']
            init={'instrument_spec':initial_state().instrument_spec,'cost_model':initial_state().cost_model,'spread_price':'0.0002','timeframe_seconds':60,'starting_balance':'100000'}
            def mutation(label,tail,args,fn):
                nonlocal n,p
                n=native('POST',np+tail,{'expected_revision':n['revision'],**args});p=fn(p['revision']);compare(label,n,p)
            mutation('initialize','/execution',init,lambda rev:service.initialize_execution('tenant-a',pid,rev,**init))
            args={'operation_id':'sell-immediate','side':'SELL','quantity':'0.12','stop_loss':None,'take_profit':None,'execution_timing':'current_quote'}
            mutation('sell current quote','/orders/market',args,lambda rev:service.queue_market_order('tenant-a',pid,rev,**args))
            for label,sl,tp in [('set protections','1.12','1.09'),('clear protections',None,None)]:
                args={'target_id':n['payload']['execution']['position']['position_id'],'operation_id':label,'stop_loss':sl,'take_profit':tp};mutation(label,'/orders/protection',args,lambda rev:service.change_protection('tenant-a',pid,rev,**args))
            mutation('step with open position','/step',{'steps':3},lambda rev:service.step('tenant-a',pid,rev,3))
            compare('historical view',native('GET',np+'?cursor_index=1'),service.view('tenant-a',pid,cursor_index=1))
            compare('metadata',native('GET',np+'/metadata'),__import__('trading_workspace_v2.dashboard_sessions',fromlist=['read_replay_metadata']).read_replay_metadata(store,'tenant-a',pid))
            args={'target_id':n['payload']['execution']['position']['position_id'],'operation_id':'close'};mutation('close','/orders/close',args,lambda rev:service.close_order('tenant-a',pid,rev,**args))
            compare('reload',native('GET',np),service.view('tenant-a',pid))
            nb=native('POST',np+'/branch',{'expected_revision':n['revision'],'cursor_index':1},201);pb=service.branch('tenant-a',pid,p['revision'],1);compare('branch',nb,pb)
            chart={'dataset_id':'dataset-a','dataset_sha256':n['dataset_sha256'],'cursor_index':3,'resolution':'5','count_back':10};query='&'.join(f'{k}={v}' for k,v in chart.items());compare('chart-window',native('GET',np+'/chart-window?'+query),service.chart_window('tenant-a',pid,**chart))
            compare('tick unavailable',native('GET',np+'/tick-data'),service.tick_options('tenant-a',pid))
            args={'operation_id':'buy-next','side':'BUY','quantity':'0.12','stop_loss':None,'take_profit':'1.2'};mutation('queue next bar','/orders/market',args,lambda rev:service.queue_market_order('tenant-a',pid,rev,**args));mutation('fill next bar','/step',{'steps':1},lambda rev:service.step('tenant-a',pid,rev,1))
            badbody={'expected_revision':1,'steps':1};failed=native('POST',np+'/step',badbody,409,key='stale');assert native('POST',np+'/step',badbody,409,key='stale')==failed;cases.append('stale receipt exact retry');native('POST',np+'/step',{'expected_revision':2,'steps':1},409,key='stale');cases.append('idempotency mismatch');native('GET',np,workspace='tenant-b',status=404);cases.append('cross workspace denied')
            for options in [{'dataset_id':'dataset-a','start_timestamp':1767225720,'end_timestamp':1767226200},{'dataset_id':'dataset-a','dataset_ids':['dataset-a','dataset-b'],'starting_balance':'100000'},{'dataset_id':'dataset-a','dataset_ids':['dataset-a','dataset-b'],'starting_balance':'100000','start_timestamp':1767225720,'end_timestamp':1767226200}]:
                nn=native('POST','/api/v2/replay/sessions',options,201);pp=service.create('tenant-a',**options);compare('period/portfolio create '+str(len(cases)),nn,pp)
                for suffix,args,fn in [('/execution',init,lambda sid,rev:service.initialize_execution('tenant-a',sid,rev,**init)),('/step',{'steps':2},lambda sid,rev:service.step('tenant-a',sid,rev,2)),('/asset',{'dataset_id':'dataset-b'},lambda sid,rev:service.select_asset('tenant-a',sid,rev,'dataset-b'))]:
                    if suffix=='/asset' and not options.get('dataset_ids'):continue
                    nn=native('POST',f'/api/v2/replay/sessions/{nn["record_id"]}'+suffix,{'expected_revision':nn['revision'],**args});pp=fn(pp['record_id'],pp['revision']);compare('portfolio/period '+suffix+' '+str(len(cases)),nn,pp)
            from rust_replay_persisted_cases import quick_cases,analytics_cases,prop_cases
            if 'quick' in suites:quick_cases(native,service,compare,init)
            if 'prop' in suites:prop_cases(native,service,store,compare,init,OUT)
            if 'analytics' in suites:analytics_cases(native,store,artifacts,compare,dsn)
            if 'context' in suites:
                from rust_context_persisted_cases import context_cases
                context_cases(native,store,artifacts,compare,dsn)
            if cli.benchmark_samples:
                from rust_replay_persisted_cases import benchmark_cases
                benchmark_cases(native,service,compare,init,OUT,cli.benchmark_samples,cli.probe)
            if cli.scaling_benchmark:
                from rust_replay_scaling_benchmark import scaling_benchmark
                stages=[int(value) for value in cli.scaling_stages.split(',')]
                scaling_benchmark(native,service,store,artifact,compare,init,OUT,stages,cli.scaling_samples,cli.concurrency,process,probe_measurements)
            (OUT/'receipt.json').write_text(json.dumps({'status':'PASS','scope':'disposable PostgreSQL full native Rust Router vs Python services; synthetic owned artifacts','probe':str(cli.probe.resolve()),'probe_sha256':probe_sha256,'extended_suites':sorted(suites),'cases':cases,'case_count':len(cases)},indent=2),encoding='utf-8');print(json.dumps({'status':'PASS','cases':len(cases)}))
        except Exception as exc:
            (OUT/'receipt.json').write_text(json.dumps({'status':'FAIL','probe':str(cli.probe.resolve()),'probe_sha256':probe_sha256,'completed_cases':cases,'case_count':len(cases),'error':str(exc)},indent=2),encoding='utf-8');raise
        finally:
            if process:process.terminate();process.wait(timeout=10)
            store.close();pg('pg_ctl','-D',str(data),'-m','immediate','-w','stop')
if __name__=='__main__':main()
