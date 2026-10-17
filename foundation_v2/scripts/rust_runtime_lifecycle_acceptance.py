"""Real isolated HTTP runtime start/drain/restart/crash/compatibility rollback."""
from __future__ import annotations
import argparse, hashlib, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from uuid import uuid4
import psycopg

V2 = Path(__file__).resolve().parents[1]
PG_DEFAULT = V2.parents[2] / 'planning/mt5-tradingview-backtester/research/foundation-validation/20260921T115933Z-315e8ddd/pg-dist/pgsql/bin'

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--pg-bin',type=Path,default=PG_DEFAULT)
    parser.add_argument('--bin-dir',type=Path,default=V2/'api-rust/target/debug')
    args = parser.parse_args(); output = args.output.resolve(); output.mkdir(parents=True,exist_ok=True)
    binary = args.bin_dir.resolve(); samples = []; owned = []; logs = []
    flags = getattr(subprocess,'CREATE_NO_WINDOW',0)
    def record(name, **fields):
        samples.append(dict(name=name,passed=True,**fields)); print(json.dumps(samples[-1]),flush=True)
    def run(command, env, name):
        result = subprocess.run(command,env=env,cwd=V2,capture_output=True,text=True,timeout=90,creationflags=flags)
        (output/f'{name}.out.log').write_text(result.stdout,encoding='utf-8')
        (output/f'{name}.err.log').write_text(result.stderr,encoding='utf-8')
        assert result.returncode == 0, f'{name} failed; inspect retained logs'
        return result
    with tempfile.TemporaryDirectory(prefix='tw-native-lifecycle-') as temp:
        root = Path(temp); data = root/'pgdata'; artifacts = root/'artifacts'; artifacts.mkdir()
        pgport = port(); apiport = port(); database = 'rust_lifecycle_'+uuid4().hex
        pglog = (output/'postgres.log').open('w',encoding='utf-8'); logs.append(pglog)
        subprocess.run([str(args.pg_bin/'initdb.exe'),'-D',str(data),'-A','trust','-U','fixture','--encoding=UTF8','--locale=C'],check=True,capture_output=True,creationflags=flags)
        postgres = subprocess.Popen([str(args.pg_bin/'postgres.exe'),'-D',str(data),'-h','127.0.0.1','-p',str(pgport)],stdout=pglog,stderr=pglog,creationflags=flags)
        env = {k:v for k,v in os.environ.items() if not k.startswith('TW_V2_')}
        env.update(TW_V2_DATABASE_URL=f'host=127.0.0.1 port={pgport} user=fixture dbname={database}',
                   TW_V2_ARTIFACT_ROOT=str(artifacts),TW_V2_LOCAL_WORKSPACES='tenant-a',
                   TW_V2_LOCAL_IDENTITY='local-owner',TW_V2_RUNTIME_PROFILE='native',TW_V2_DOWNLOAD_ENGINE='none',
                   PYTHONPATH=os.pathsep.join([str(V2),str(V2.parent)]))
        def http(path, body=None, key=None):
            headers={'x-workspace-id':'tenant-a'}
            if key: headers['idempotency-key']=key
            if body is not None: headers['content-type']='application/json'
            request=Request(f'http://127.0.0.1:{apiport}{path}',data=None if body is None else json.dumps(body).encode(),headers=headers)
            started=time.perf_counter()
            try: response=urlopen(request,timeout=3)
            except HTTPError as error: response=error
            with response:
                return response.status,json.load(response),response.headers.get('x-command-id'),(time.perf_counter()-started)*1000
        engine = 'none'
        def command(profile, manifest):
            return [sys.executable,'-X','utf8',str(V2/'scripts/run_api_platform.py'),'--runtime-profile',profile,
                    '--download-engine',engine,'--port',str(apiport),'--database-name',database,
                    '--artifact-root',str(artifacts),'--manifest',str(manifest),
                    '--rust-binary',str(binary/'trading-workspace-api.exe'),
                    '--rust-admin-binary',str(binary/'rust_runtime_admin.exe'),
                    '--rust-research-binary',str(binary/'rust_research_worker.exe')]
        def launch(profile, label):
            manifest=root/f'{label}/owner.json'; stdout=(output/f'{label}.out.log').open('wb'); stderr=(output/f'{label}.err.log').open('wb'); logs.extend([stdout,stderr])
            started=time.perf_counter(); child=subprocess.Popen(command(profile,manifest),env=env,cwd=V2,stdout=stdout,stderr=stderr,creationflags=flags); owned.append((child,manifest))
            deadline=time.monotonic()+50
            while time.monotonic()<deadline:
                assert child.poll() is None,f'{label} exited; inspect logs'
                if manifest.is_file():
                    state=json.loads(manifest.read_text())
                    if state.get('ready'):
                        health=http('/health/ready'); assert health[0]==200
                        if profile=='native':
                            assert health[1]['command_worker']=='not_required'
                            assert set(state['processes'])=={'supervisor','research','api'}
                        record(label,startup_ms=(time.perf_counter()-started)*1000,roles=list(state['processes']),health=health[1])
                        return child,manifest,state
                time.sleep(.1)
            raise AssertionError(f'{label} readiness timeout')
        def stop(child, manifest, profile, label):
            run(command(profile,manifest)+['--stop'],env,label)
            assert child.wait(timeout=50)==0,f'{label} supervisor failed'
            record(label)
        try:
            for _ in range(100):
                try:
                    with psycopg.connect(f'host=127.0.0.1 port={pgport} user=fixture dbname=postgres',autocommit=True,connect_timeout=1) as conn:
                        conn.execute(f'CREATE DATABASE {database}')
                    break
                except psycopg.OperationalError:
                    assert postgres.poll() is None;time.sleep(.1)
            else: raise AssertionError('fixture PostgreSQL startup timeout')
            run([str(binary/'rust_runtime_admin.exe'),'migrate'],env,'native-migrate')
            routes=json.loads(run([str(binary/'rust_runtime_admin.exe'),'routes'],env,'native-routes').stdout)
            assert routes['required_command_routes']==[];record('native-route-manifest',delegated=0)
            child,manifest,state=launch('native','native-first')
            entry={'entry_type':'decision','note':'isolated lifecycle fixture','source':{'kind':'replay','id':uuid4().hex}}
            first=http('/api/v2/journal',entry,'lifecycle-journal'); assert first[0]==201,first
            repeated=http('/api/v2/journal',entry,'lifecycle-journal'); assert first[:3]==repeated[:3]
            assert http('/api/v2/data/downloads',{'instrument_id':'EUR/USD','from_date':'2026-01-01','to_date':'2026-01-02'},'disabled-provider')[0]==503
            with psycopg.connect(env['TW_V2_DATABASE_URL']) as conn:
                assert conn.execute('SELECT count(*) FROM api_command_workers').fetchone()[0]==0
            record('native-http-write-retry',first_ms=first[3],retry_ms=repeated[3],python_command_workers=0)
            stop(child,manifest,'native','native-drain')
            child,manifest,state=launch('native','native-restart')
            assert http('/api/v2/journal/'+first[1]['record_id'])[1]['payload']==first[1]['payload']
            assert http('/api/v2/journal',entry,'lifecycle-journal')[:3]==first[:3]
            record('native-persisted-restart')
            # Only this run's verified API PID is terminated; other processes remain untouched.
            sys.path.insert(0,str(V2/'scripts')); from run_api_platform import process_identity
            api=state['processes']['api']; assert process_identity(api['pid'])==api
            import ctypes
            from ctypes import wintypes
            kernel=ctypes.WinDLL('kernel32',use_last_error=True)
            kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
            kernel.TerminateProcess.argtypes=[wintypes.HANDLE,wintypes.UINT];kernel.CloseHandle.argtypes=[wintypes.HANDLE]
            handle=kernel.OpenProcess(1,False,api['pid']);assert handle
            try: assert kernel.TerminateProcess(handle,23)
            finally: kernel.CloseHandle(handle)
            assert child.wait(timeout=50)!=0
            assert all(process_identity(p['pid']) is None for role,p in state['processes'].items() if role!='supervisor')
            record('native-api-crash-stops-owned-worker')
            child,manifest,state=launch('compatibility','compatibility-rollback')
            assert http('/api/v2/journal/'+first[1]['record_id'])[0]==200
            assert http('/api/v2/data/market-assets')[0]==200
            record('compatibility-rollback-http')
            stop(child,manifest,'compatibility','compatibility-drain')
            child,manifest,state=launch('native','native-return')
            assert http('/api/v2/journal/'+first[1]['record_id'])[0]==200
            stop(child,manifest,'native','native-final-drain')
            # A harmless Python executable stands in for the Node process protocol.
            # It reads owned synthetic inputs only; no vendor/network/market data.
            fixture = root/'provider.py'
            fixture.write_text('''import json,sys,time
from pathlib import Path
from datetime import datetime,timezone
request_path=Path(sys.argv[1]); folder=request_path.parent; request=json.loads(request_path.read_text())
if request['from_date']=='2026-01-04': time.sleep(20)
if request['from_date']=='2026-01-05':
 print(json.dumps({'event':'error','error':'source_rate_limited','retry_after_seconds':300}),flush=True);sys.exit(1)
stamp=int(datetime.fromisoformat(request['from_date']).replace(tzinfo=timezone.utc).timestamp())
(folder/'candles.csv').write_text('time,open,high,low,close,volume\\n'+f'{stamp},1,2,0,1.5,3\\n{stamp+60},1.5,2,1,1.7,4\\n')
print(json.dumps({'event':'progress','completed_days':1,'transferred_bytes':100,'cached_bytes':0,'network_days':1}),flush=True)
print(json.dumps({'event':'complete','buckets_sha256':'1'*64,'transferred_bytes':100,'cached_bytes':0}),flush=True)
''',encoding='utf-8')
            metadata = root/'metadata.json'
            metadata.write_text(json.dumps({'version':'1.50.0','items':[{'name':'EUR/USD','code':'eurusd','startDayForMinuteCandles':'2003-01-01'}]}))
            (artifacts/'catalog').mkdir()
            (artifacts/'catalog/dukascopy-instruments.json').write_bytes((V2/'api-rust/tests/rust_provider/cache.json').read_bytes())
            env.update(TW_V2_DUKASCOPY_METADATA_PATH=str(metadata),TW_V2_DUKASCOPY_NODE=str(Path(sys.executable).resolve()),
                       TW_V2_DUKASCOPY_NODE_SHA256=hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
                       TW_V2_DUKASCOPY_WORKER=str(fixture),TW_V2_DUKASCOPY_WORKER_SHA256=hashlib.sha256(fixture.read_bytes()).hexdigest())
            engine='dukascopy'
            child,manifest,state=launch('native','native-configured-fixture')
            def wait_job(identifier, expected):
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    result=http('/api/v2/data/downloads'); assert result[0]==200
                    job=next(item for item in result[1]['items'] if item['job_id']==identifier)
                    if job['status']==expected:return job
                    assert job['status'] not in {'failed','cancelled'},job
                    time.sleep(.05)
                raise AssertionError(f'job did not reach {expected}: {job}')
            body={'instrument_id':'EUR/USD','from_date':'2026-01-01','to_date':'2026-01-01'}
            accepted=http('/api/v2/data/downloads',body,'configured-fixture');assert accepted[0]==202,accepted
            job=wait_job(accepted[1]['job_id'],'completed'); assert job['dataset_id']
            with psycopg.connect(env['TW_V2_DATABASE_URL']) as conn:
                manifest_value=conn.execute('SELECT manifest_json FROM datasets WHERE workspace_id=%s AND dataset_id=%s',('tenant-a',job['dataset_id'])).fetchone()[0]
                assert manifest_value['row_count']==2
                artifact=artifacts/manifest_value['artifact_path']; assert hashlib.sha256(artifact.read_bytes()).hexdigest()==manifest_value['artifact_sha256']
                assert conn.execute('SELECT count(*) FROM api_command_workers WHERE heartbeat_at_utc>CURRENT_TIMESTAMP-interval \'20 seconds\'').fetchone()[0]==0
            record('native-configured-fixture-publication',rows=2,vendor_network=False)
            body.update(from_date='2026-01-04',to_date='2026-01-04')
            accepted=http('/api/v2/data/downloads',body,'configured-pause');assert accepted[0]==202,accepted
            identifier=accepted[1]['job_id'];wait_job(identifier,'running')
            assert http(f'/api/v2/data/downloads/{identifier}/pause',{},'configured-pause-now')[0]==202
            wait_job(identifier,'paused')
            assert http(f'/api/v2/data/downloads/{identifier}/resume',{},'configured-resume')[0]==202
            wait_job(identifier,'running')
            assert http(f'/api/v2/data/downloads/{identifier}/cancel',{},'configured-cancel')[0]==200
            record('native-configured-fixture-pause-resume-cancel')
            # Rate limit events persist a source cooldown, even across runtime restart.
            deadline=time.monotonic()+5
            body.update(from_date='2026-01-05',to_date='2026-01-05')
            while True:
                accepted=http('/api/v2/data/downloads',body,uuid4().hex)
                if accepted[0]==202:break
                assert time.monotonic()<deadline,accepted;time.sleep(.1)
            identifier=accepted[1]['job_id'];wait_job(identifier,'paused')
            assert http(f'/api/v2/data/downloads/{identifier}/resume',{},'configured-cooldown')[1]['detail']=='download_cooldown'
            stop(child,manifest,'native','native-configured-drain')
            child,manifest,state=launch('native','native-configured-restart')
            assert http(f'/api/v2/data/downloads/{identifier}/resume',{},'configured-cooldown-restart')[1]['detail']=='download_cooldown'
            record('native-configured-fixture-durable-cooldown')
            stop(child,manifest,'native','native-configured-final-drain')
        finally:
            failed = sys.exc_info()[0] is not None
            for child,manifest in owned:
                if child.poll() is None and manifest.is_file():
                    state=json.loads(manifest.read_text());Path(state['stop_file']).write_text('stop\n')
                    try: child.wait(timeout=50)
                    except subprocess.TimeoutExpired: child.kill();child.wait(timeout=10)
                for log_path in manifest.parent.glob('platform-*.log'):
                    (output/f'{manifest.parent.name}-{log_path.name}').write_bytes(log_path.read_bytes())
            subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(data),'-m','fast','stop'],capture_output=True,timeout=20,creationflags=flags)
            postgres.wait(timeout=20)
            for log in logs: log.close()
            if failed:
                (output/'receipt.json').write_text(json.dumps(dict(passed=False,samples=samples,disposable=True,owner_runtime_touched=False),indent=2),encoding='utf-8')
    hashes={str(path.relative_to(V2)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [V2/'scripts/run_api_platform.py',V2/'api-rust/src/main.rs',V2/'api-rust/src/lib.rs',V2/'api-rust/src/commands.rs']}
    receipt=dict(schema='native-runtime-lifecycle-acceptance-v1',passed=True,disposable=True,owner_runtime_touched=False,build='debug',provider='none plus owned synthetic process protocol',scientific_adapter=False,samples=samples,source_hashes=hashes)
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')

if __name__=='__main__': main()
