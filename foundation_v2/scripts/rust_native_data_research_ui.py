"""Real native DATA/RESEARCH HTTP and production browser, disposable PG only."""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import urlopen
import psycopg
from rust_runtime_lifecycle_acceptance import PG_DEFAULT, port

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2.parent)]
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.retained import compute_metrics_v2

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--pg-bin',type=Path,default=PG_DEFAULT)
    parser.add_argument('--bin-dir',type=Path,default=V2/'api-rust/target/native-candidate/release')
    args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    binary=args.bin_dir.resolve();flags=getattr(subprocess,'CREATE_NO_WINDOW',0);api=None;pg=None
    receipt=dict(passed=False,scope='production React + native HTTP + native reference worker; disposable synthetic PostgreSQL/artifacts',owner_runtime_touched=False,provider_network=False,broker=False,checks=[])
    critical=[V2/'api-rust/src/main.rs',V2/'api-rust/src/research_execution.rs',V2/'api-rust/src/research_jobs.rs',V2/'api-rust/src/data_routes.rs',Path(__file__),V2/'web/scripts/native_data_research_probe.mjs',V2/'web/src/ResearchWorkspace.jsx']
    for folder in ['data_routes','research_execution','research_jobs']:
        critical+=sorted((V2/'api-rust/src'/folder).rglob('*.rs'))
    receipt['source_hashes']={str(p.relative_to(V2)):hashlib.sha256(p.read_bytes()).hexdigest() for p in critical}
    receipt['binary_hashes']={name:hashlib.sha256((binary/name).read_bytes()).hexdigest() for name in ['trading-workspace-api.exe','rust_runtime_admin.exe','rust_research_worker.exe']}
    def run(command,env,name,cwd=V2):
        with (out/f'{name}.log').open('w',encoding='utf-8') as log:
            result=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600,creationflags=flags)
        assert result.returncode==0,f'{name} failed; inspect {out/name}.log'
    with tempfile.TemporaryDirectory(prefix='native-data-research-') as temp:
        root=Path(temp);data=root/'pgdata';artifacts=root/'artifacts';artifacts.mkdir();pgport=port();apiport=port()
        subprocess.run([str(args.pg_bin/'initdb.exe'),'-D',str(data),'-A','trust','-U','fixture','--encoding=UTF8','--locale=C'],check=True,capture_output=True,creationflags=flags)
        with (out/'postgres.log').open('w',encoding='utf-8') as log:
            pg=subprocess.Popen([str(args.pg_bin/'postgres.exe'),'-D',str(data),'-h','127.0.0.1','-p',str(pgport)],stdout=log,stderr=log,creationflags=flags)
            env={k:v for k,v in os.environ.items() if not k.startswith('TW_V2_')}
            dsn=f'host=127.0.0.1 port={pgport} user=fixture dbname=postgres'
            env.update(TW_V2_DATABASE_URL=dsn,TW_V2_ARTIFACT_ROOT=str(artifacts),TW_V2_LOCAL_WORKSPACES='tenant-a,tenant-b',TW_V2_LOCAL_IDENTITY='local-owner',TW_V2_RUNTIME_PROFILE='native',TW_V2_DOWNLOAD_ENGINE='none',TW_V2_RUST_BIND=f'127.0.0.1:{apiport}',TW_V2_SHUTDOWN_FILE=str(root/'stop'),TW_V2_OPENAPI_PATH=str(V2/'contracts/openapi.json'))
            try:
                for _ in range(100):
                    try:
                        with psycopg.connect(dsn,connect_timeout=1):break
                    except psycopg.OperationalError:assert pg.poll() is None;time.sleep(.1)
                else:raise AssertionError('PG timeout')
                run([str(binary/'rust_runtime_admin.exe'),'migrate'],env,'native-migrate')
                store=PostgresStore(dsn);store.ensure_workspace('tenant-a');store.ensure_workspace('tenant-b');store.close()
                with (out/'api.log').open('w',encoding='utf-8') as api_log:
                    api=subprocess.Popen([str(binary/'trading-workspace-api.exe')],env=env,cwd=V2,stdout=api_log,stderr=api_log,creationflags=flags)
                    origin=f'http://127.0.0.1:{apiport}'
                    for _ in range(100):
                        assert api.poll() is None,'API exited'
                        try:
                            with urlopen(origin+'/health/ready',timeout=1) as response:health=json.load(response)
                            assert health['command_worker']=='not_required';break
                        except OSError:time.sleep(.1)
                    else:raise AssertionError('native API readiness timeout')
                    node=shutil.which('node');assert node
                    run([node,'scripts/native_data_research_probe.mjs','--output',str(out),'--api-base',origin,'--artifact-root',str(artifacts),'--worker',str(binary/'rust_research_worker.exe')],env,'browser',V2/'web')
                    browser=json.loads((out/'browser.json').read_text());assert browser['passed']
                    result=browser['result']['result']
                    closes=[1.1000+(i%8)*.0001 for i in range(40)]
                    ledger=[dict(trade_id=f'{browser["job"]}-{i}',net_pnl=round((current-previous)*100,8),gross_pnl=round((current-previous)*100,8),fees=0.,planned_risk_budget=100.) for i,(previous,current) in enumerate(zip(closes,closes[1:]),1)]
                    expected=compute_metrics_v2(ledger,10000.)
                    assert result['trade_count']==39
                    assert result['metrics']==expected,'Python/native metrics oracle mismatch'
                    with psycopg.connect(dsn) as conn:
                        assert conn.execute('SELECT count(*) FROM api_command_workers').fetchone()[0]==0
                        assert conn.execute("SELECT count(*) FROM api_commands WHERE status IN ('queued','running')").fetchone()[0]==0
                        rows=conn.execute('SELECT job_id,status,result_path,result_sha256 FROM research_jobs ORDER BY job_id').fetchall()
                        assert len(rows)==2
                        jobs={row[0]:row for row in rows}
                        assert jobs[browser['job']][1]=='completed'
                        result_file=(artifacts/jobs[browser['job']][2]).resolve();assert result_file.is_relative_to(artifacts)
                        result_bytes=result_file.read_bytes();assert hashlib.sha256(result_bytes).hexdigest()==jobs[browser['job']][3]
                        persisted=json.loads(result_bytes)
                        assert persisted==result
                        assert jobs[browser['canceledJob']][1]=='canceled'
                        assert jobs[browser['canceledJob']][2] is None
                        receipt['database_jobs']=[dict(job_id=row[0],status=row[1]) for row in rows]
                    receipt['checks']=browser['checks']+[dict(name='native result exact Python metrics oracle/persisted JSON; no Python command workers',passed=True)]
                    receipt['passed']=True
            except BaseException as error:
                receipt['error']=repr(error);raise
            finally:
                if api is not None and api.poll() is None:
                    (root/'stop').write_text('stop\n')
                    try:api.wait(timeout=40)
                    except subprocess.TimeoutExpired:api.kill();api.wait(timeout=5)
                subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(data),'-m','fast','stop'],capture_output=True,timeout=20,creationflags=flags)
                pg.wait(timeout=20)
                (out/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({'passed':receipt['passed'],'checks':len(receipt['checks'])}))

if __name__=='__main__':main()
