"""Production chart journeys against native Rust HTTP and disposable PostgreSQL."""
from __future__ import annotations
import argparse, hashlib, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import urlopen
import psycopg
from rust_runtime_lifecycle_acceptance import PG_DEFAULT, port
from rust_replay_scaling_benchmark import process_resources

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2.parent)]
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.store import PostgresStore

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--pg-bin',type=Path,default=PG_DEFAULT)
    parser.add_argument('--bin-dir',type=Path,default=V2/'api-rust/target/native-candidate/release')
    parser.add_argument('--samples',type=int,default=12)
    args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0);binary=args.bin_dir.resolve();checks=[];api=None
    def run(command,env,name,cwd=V2):
        with (out/f'{name}.log').open('w',encoding='utf-8') as log:
            result=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600,creationflags=flags)
        assert result.returncode==0,f'{name} failed; inspect log'
    with tempfile.TemporaryDirectory(prefix='native-ui-http-') as temp:
        root=Path(temp);data=root/'pgdata';artifacts=root/'artifacts';artifacts.mkdir();pgport=port();apiport=port()
        subprocess.run([str(args.pg_bin/'initdb.exe'),'-D',str(data),'-A','trust','-U','fixture','--encoding=UTF8','--locale=C'],check=True,capture_output=True,creationflags=flags)
        with (out/'postgres.log').open('w',encoding='utf-8') as log:
            pg=subprocess.Popen([str(args.pg_bin/'postgres.exe'),'-D',str(data),'-h','127.0.0.1','-p',str(pgport)],stdout=log,stderr=log,creationflags=flags)
            env={k:v for k,v in os.environ.items() if not k.startswith('TW_V2_')}
            dsn=f'host=127.0.0.1 port={pgport} user=fixture dbname=postgres'
            env.update(TW_V2_DATABASE_URL=dsn,TW_V2_ARTIFACT_ROOT=str(artifacts),TW_V2_LOCAL_WORKSPACES='tenant-a',
                       TW_V2_LOCAL_IDENTITY='local-owner',TW_V2_RUNTIME_PROFILE='native',TW_V2_DOWNLOAD_ENGINE='none',
                       TW_V2_RUST_BIND=f'127.0.0.1:{apiport}',TW_V2_SHUTDOWN_FILE=str(root/'stop'),
                       TW_V2_OPENAPI_PATH=str(V2/'contracts/openapi.json'))
            try:
                for _ in range(100):
                    try:
                        with psycopg.connect(dsn,connect_timeout=1):break
                    except psycopg.OperationalError: assert pg.poll() is None;time.sleep(.1)
                else: raise AssertionError('fixture PG timeout')
                run([str(binary/'rust_runtime_admin.exe'),'migrate'],env,'native-migrate')
                store=PostgresStore(dsn);store.ensure_workspace('tenant-a')
                fixture=json.loads((V2/'web/tests/visual/chart-fixture.json').read_text(encoding='utf-8'))
                spec=fixture['datasets']['items'][0]['instrument_spec'];dataset='native-ui-synthetic'
                rows=[dict(timestamp=1767225600+i*60,open=1.1+(i%20)*.00005,high=1.1015,low=1.0990,close=1.1001+(i%20)*.00005,volume=100+i) for i in range(300)]
                artifact,sha=ArtifactStore(artifacts).write_dataset('tenant-a',dataset,rows)
                source=DatasetSource(source_id='owned-native-ui-fixture',provider='synthetic',instrument_mapping={'EURUSD':'EURUSD'},license_use='owned synthetic only',retrieved_at_utc='2026-01-01T00:00:00Z',export_settings='native HTTP/UI validation')
                store.put_dataset(DatasetManifest(dataset_id=dataset,workspace_id='tenant-a',source=source,instrument_id='EURUSD',timeframe='M1',timeframe_seconds=60,instrument_spec=spec,row_count=len(rows),first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=artifact,artifact_sha256=sha,quality={'disposition':'pass'},created_at_utc='2026-01-01T00:00:00Z'))
                with (out/'api.log').open('w',encoding='utf-8') as api_log:
                    api=subprocess.Popen([str(binary/'trading-workspace-api.exe')],env=env,cwd=V2,stdout=api_log,stderr=api_log,creationflags=flags)
                    origin=f'http://127.0.0.1:{apiport}'
                    for _ in range(100):
                        assert api.poll() is None,'native API exited'
                        try:
                            with urlopen(origin+'/health/ready',timeout=1) as response:
                                health=json.load(response)
                            assert health['command_worker']=='not_required';break
                        except OSError:time.sleep(.1)
                    else:raise AssertionError('native API readiness timeout')
                    before=process_resources(int(api._handle));started=time.perf_counter()
                    node=__import__('shutil').which('node');assert node
                    run([node,'scripts/quick_trading_latency_probe.mjs','--output',str(out/'browser.json'),
                         '--api-base',origin,'--workspace','tenant-a','--dataset-id',dataset,'--samples',str(args.samples)],env,'browser',V2/'web')
                    elapsed=time.perf_counter()-started;after=process_resources(int(api._handle))
                    report=json.loads((out/'browser.json').read_text());assert report['status']=='PASS'
                    with psycopg.connect(dsn) as conn:
                        assert conn.execute('SELECT count(*) FROM api_command_workers').fetchone()[0]==0
                        assert conn.execute('SELECT count(*) FROM api_commands WHERE status IN (\'queued\',\'running\')').fetchone()[0]==0
                        payload=conn.execute("SELECT v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=%s AND r.kind='replay' AND r.record_id=%s",('tenant-a',report['session'])).fetchone()[0]
                        assert payload['execution']['position'] is None
                    checks.append(dict(name='production-native-chart-http',passed=True,summary=report['summary'],seconds=elapsed,api_before=before,api_after=after))
            finally:
                if api is not None and api.poll() is None:
                    (root/'stop').write_text('stop\n')
                    try:api.wait(timeout=40)
                    except subprocess.TimeoutExpired:api.kill();api.wait(timeout=5)
                subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(data),'-m','fast','stop'],capture_output=True,timeout=20,creationflags=flags)
                pg.wait(timeout=20)
                receipt=dict(passed=bool(checks),checks=checks,owner_runtime_touched=False,disposable=True,build='release',broker=False,
                    source_hashes={str(path.relative_to(V2)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [V2/'api-rust/src/main.rs',V2/'web/src/advancedOrderOverlay.js',V2/'web/scripts/quick_trading_latency_probe.mjs']},
                    binary_sha256=hashlib.sha256((binary/'trading-workspace-api.exe').read_bytes()).hexdigest())
                (out/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in receipt.items() if k not in {'source_hashes','binary_sha256'}}))

if __name__=='__main__':main()
