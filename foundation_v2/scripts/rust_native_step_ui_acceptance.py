"""Production forward step/play chart journeys against native Rust HTTP and disposable PostgreSQL."""
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
    parser.add_argument('--samples',type=int,default=6)
    parser.add_argument('--ledger-steps',type=int,default=5000)
    parser.add_argument('--storage-profile',choices=('full','compact'),default='compact')
    parser.add_argument('--resolutions',default='1,5')
    parser.add_argument('--prop-journey',action='store_true')
    args=parser.parse_args();assert 100<=args.ledger_steps<=5000;assert args.storage_profile=='compact'
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0);binary=args.bin_dir.resolve();checks=[];api=None;completed=False
    def fingerprints():
        paths=[*sorted((V2/'api-rust/src').rglob('*.rs')),
               *sorted((V2/'web/src').rglob('*.js')),*sorted((V2/'web/src').rglob('*.jsx')),
               *sorted((V2/'web/src').rglob('*.css')),*sorted((V2/'migrations').glob('*.sql')),
               V2/'web/scripts/replay_step_latency_probe.mjs',V2/'web/scripts/replay_prop_step_journey.mjs',
               V2/'tests/test_ps02_replay_prop_connection.py',V2/'tests/test_replay_execution_core.py',Path(__file__).resolve()]
        return {str(path.relative_to(V2)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    source_hashes=fingerprints()
    binary_sha256={name:hashlib.sha256((binary/name).read_bytes()).hexdigest() for name in ('trading-workspace-api.exe','rust_runtime_admin.exe')}
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
            env['TW_V2_REPLAY_STORAGE_PROFILE']=args.storage_profile
            env.update(TW_V2_REPLAY_TIMINGS='1',RUST_LOG='info')
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
                rows=[dict(timestamp=1767225600+i*60,open=1.1+(i%20)*.00005,high=1.1015,low=1.0990,close=1.1001+(i%20)*.00005,volume=100+i) for i in range(6500)]
                artifact,sha=ArtifactStore(artifacts).write_dataset('tenant-a',dataset,rows)
                source=DatasetSource(source_id='owned-native-ui-fixture',provider='synthetic',instrument_mapping={'EURUSD':'EURUSD'},license_use='owned synthetic only',retrieved_at_utc='2026-01-01T00:00:00Z',export_settings='native HTTP/UI validation')
                store.put_dataset(DatasetManifest(dataset_id=dataset,workspace_id='tenant-a',source=source,instrument_id='EURUSD',timeframe='M1',timeframe_seconds=60,instrument_spec=spec,row_count=len(rows),first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=artifact,artifact_sha256=sha,quality={'disposition':'pass'},created_at_utc='2026-01-01T00:00:00Z'))
                prop_config=None
                if args.prop_journey:
                    sys.path.insert(0,str(V2/'tests'))
                    from test_ps02_replay_prop_connection import prop_state
                    from test_replay_execution_core import initial_state
                    from uuid import uuid4
                    session,attempt,phase,resume=prop_state(session_id=uuid4().hex,attempt_id=uuid4().hex,dataset_sha256=sha)
                    attempt=attempt.model_copy(update={'cost_version':initial_state().cost_model['version']})
                    store.create_prop_session_bundle(session,attempt,phase,resume_state=resume)
                    prop_config=root/'prop-fixture.json'
                    prop_config.write_text(json.dumps(dict(sessionId=session.session_id,attemptId=attempt.attempt_id)),encoding='utf-8')
                store.close()
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
                    browser_args=[node,'scripts/replay_step_latency_probe.mjs','--output',str(out/'browser.json'),
                         '--api-base',origin,'--workspace','tenant-a','--dataset-id',dataset,'--samples',str(args.samples),'--resolutions',args.resolutions]
                    if args.ledger_steps:
                        sys.path.insert(0,str(V2/'tests'))
                        from test_replay_execution_core import initial_state
                        seed=root/'seed-execution.json'
                        seed.write_text(json.dumps(dict(instrument_spec=spec,cost_model=initial_state().cost_model,spread_price='0.0002',timeframe_seconds=60,starting_balance='10000')),encoding='utf-8')
                        browser_args+=['--seed-ledger-steps',str(args.ledger_steps),'--execution-config',str(seed)]
                    if prop_config:browser_args+=['--prop-config',str(prop_config)]
                    run(browser_args,env,'browser',V2/'web')
                    elapsed=time.perf_counter()-started;after=process_resources(int(api._handle))
                    report=json.loads((out/'browser.json').read_text());assert report['status']=='PASS'
                    with psycopg.connect(dsn) as conn:
                        assert conn.execute('SELECT count(*) FROM api_command_workers').fetchone()[0]==0
                        assert conn.execute('SELECT count(*) FROM api_commands WHERE status IN (\'queued\',\'running\')').fetchone()[0]==0
                        payload=conn.execute("SELECT v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=%s AND r.kind='replay' AND r.record_id=%s",('tenant-a',report['session'])).fetchone()[0]
                        assert payload['execution']['position'] is None
                        if args.storage_profile=='compact':
                            row=conn.execute("SELECT storage_format FROM workspace_record_revisions WHERE workspace_id=%s AND kind='replay' AND record_id=%s AND revision=(SELECT current_revision FROM workspace_records WHERE workspace_id=%s AND kind='replay' AND record_id=%s)",('tenant-a',report['session'],'tenant-a',report['session'])).fetchone()
                            assert row[0]=='replay-execution-v1'
                            assert 'ledger' not in payload['execution']
                        if args.prop_journey:
                            prop=report['prop'];assert prop['status']=='PASS'
                            row=conn.execute("SELECT current_revision,snapshot_json,phase_json,resume_json FROM prop_attempts WHERE workspace_id='tenant-a' AND session_id=%s AND attempt_id=%s",(prop['propSession'],prop['propAttempt'])).fetchone()
                            assert row[0]==row[1]['revision']==prop['final']['attemptRevision']
                            assert row[2]==prop['final']['phase'] and row[3]==prop['final']['resumeState']
                            assert row[0]==prop['initialAttemptRevision']+len(prop['final']['ledgerMarks'])
                            receipts=conn.execute("SELECT operation_id FROM prop_mutation_receipts WHERE workspace_id='tenant-a' AND session_id=%s AND attempt_id=%s AND operation_id LIKE 'replay-prop-%%' ORDER BY entity_revision",(prop['propSession'],prop['propAttempt'])).fetchall()
                            assert [item[0] for item in receipts]==prop['final']['successfulOperationIds']
                            events=conn.execute("SELECT sequence,event_json FROM replay_execution_events WHERE workspace_id='tenant-a' AND record_id=%s ORDER BY sequence",(prop['session'],)).fetchall()
                            assert [item[0] for item in events]==list(range(1,prop['final']['replaySequence']+1))
                            assert [item[1] for item in events if item[1]['kind']=='price_mark']==prop['final']['ledgerMarks']
                            current=conn.execute("SELECT r.current_revision,v.storage_format,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id='tenant-a' AND r.kind='replay' AND r.record_id=%s",(prop['session'],)).fetchone()
                            assert current[0]==prop['final']['replayRevision'] and current[1]=='replay-execution-v1'
                            assert current[2]['execution']['event_sequence']==prop['final']['replaySequence']
                            assert 'ledger' not in current[2]['execution']
                            assert prop['final']['binding']['last_replay_event_sequence']==prop['final']['replaySequence']
                            checks.append(dict(name='production-prop-step-publication-feed-lock-and-recovery',passed=True,fixture='validated Prop bundle seeded through PostgresStore; replay initialization/binding via real native HTTP APIs',marks=len(prop['final']['ledgerMarks']),attempt_revision=row[0],sql_receipt_count=len(receipts),artificial_faults=['gated transport before actual native feed','pre-upstream503','stale expected_prop_revision409'],recovery='reload then one new step; retained backlog consumed once'))
                    checks.append(dict(name='production-native-step-play-chart-http',passed=True,summary=report['summary'],seconds=elapsed,api_before=before,api_after=after))
                    phases=[json.loads(line)['fields'] for line in (out/'api.log').read_text(encoding='utf-8').splitlines() if 'native_replay_phases' in line]
                    assert phases
                    (out/'phases.json').write_text(json.dumps(phases,indent=2),encoding='utf-8')
                    assert report['initialLedgerEvents']>=args.ledger_steps
                    assert report['nullInitialization']['execution'] is None
                    completed=True
            finally:
                if api is not None and api.poll() is None:
                    (root/'stop').write_text('stop\n')
                    try:api.wait(timeout=40)
                    except subprocess.TimeoutExpired:api.kill();api.wait(timeout=5)
                subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(data),'-m','fast','stop'],capture_output=True,timeout=20,creationflags=flags)
                pg.wait(timeout=20)
                source_unchanged=source_hashes==fingerprints()
                binary_unchanged=binary_sha256=={name:hashlib.sha256((binary/name).read_bytes()).hexdigest() for name in binary_sha256}
                receipt=dict(passed=completed and source_unchanged and binary_unchanged,checks=checks,owner_runtime_touched=False,disposable=True,build='release',broker=False,
                    storage_profile=args.storage_profile,
                    source_unchanged=source_unchanged,binary_unchanged=binary_unchanged,source_hashes=source_hashes,binary_sha256=binary_sha256)
                (out/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in receipt.items() if k not in {'source_hashes','binary_sha256'}}))
    assert receipt['passed'],'incomplete journey or source/binary changed during acceptance'

if __name__=='__main__':main()
