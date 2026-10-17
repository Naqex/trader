"""Exact native research oracle and disposable PostgreSQL execution acceptance."""
from __future__ import annotations
import hashlib
import copy
import json
import math
import os
from pathlib import Path
import random
import socket
import subprocess
import sys
import tempfile
import time
import argparse

F = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(F),str(F.parent)]
from trading_workspace_v2.artifacts import ArtifactStore,canonical_json_bytes
from trading_workspace_v2.contracts import DatasetManifest,DatasetSource,ResearchResult,EngineResearchResult,OOSResearchResult
from trading_workspace_v2.research_engine import engine_code_sha256
from trading_workspace_v2.retained import compute_metrics_v2
from trading_workspace_v2.store import PostgresStore

OUT = F / 'evidence/rust-native-20261017/research-execution'
PG = Path(os.environ.get('TW_COMMAND_TEST_PG_BIN','D:/ANNAM/TradingWorkspace/planning/mt5-tradingview-backtester/research/foundation-validation/20260921T115933Z-315e8ddd/pg-dist/pgsql/bin'))
def result(closes,starting=100000.):
    ledger=[]
    for index,(previous,current) in enumerate(zip(closes,closes[1:]),1):
        net=round((float(current)-float(previous))*100.,8)
        ledger.append(dict(trade_id=f'fixture-{index}',net_pnl=net,gross_pnl=net,fees=0.,planned_risk_budget=100.))
    metrics=compute_metrics_v2(ledger,starting)
    return ResearchResult(job_id='fixture',workspace_id='tenant-a',dataset_id='dataset-fixture',dataset_sha256='hash',strategy_version='close-delta-v1',metrics_schema_version=metrics['metric_schema_version'],metrics=metrics,trade_count=len(ledger),created_at_utc='2026-10-17T00:00:00.000001Z').model_dump(mode='json')
def oracle():
    rng=random.Random(17062026)
    inputs=[('up',[1.,2.]),('flat',[1.,1.]),('signed-zero',[1.,math.nextafter(1.,0.)]),('mixed',[1.1,1.1001,1.0999,1.1]),('round-half',[0.,0.00000000005,0.,-0.00000000005,0.]),('decimal',[.1,.2,.3,.4,.1])]
    for i in range(80):
        start=rng.uniform(.1,2000);closes=[start]
        for _ in range(rng.randrange(2,180)):closes.append(closes[-1]+rng.uniform(-.03,.03))
        inputs.append((f'random-{i}',closes))
    cases=[]
    for name,closes in inputs:
        expected=result(closes)
        cases.append(dict(name=name,closes=closes,starting_balance=100000.,expected=expected,sha256=hashlib.sha256(canonical_json_bytes(expected)).hexdigest()))
    OUT.mkdir(parents=True,exist_ok=True)
    path=OUT/'python-oracle.json';path.write_text(json.dumps(dict(cases=cases)),encoding='utf-8');return path

def engine_fixtures(artifact,store,scientific_oracle=None):
    engine_hash=engine_code_sha256();cases=[]
    reference=json.loads((F/'evidence/rust-native-20261017/runtime/reference/oracle.json').read_text(encoding='utf-8'))
    oos=json.loads((F/'evidence/rust-native-20261017/runtime/oos-execution/oracle.json').read_text(encoding='utf-8'))
    # An OOS computation can account for failed trials, but the persisted worker
    # rejects an oversized source range before computing any trial.
    sources=[('reference',c) for c in reference if 'canonical' in c['expected']][:3]+[('oos',c) for c in oos if 'canonical' in c['expected'] and len(c['rows'])<=c['protocol']['budget']['max_bars']][:2]
    if scientific_oracle:
        sources += [('nautilus',c) for c in json.loads(scientific_oracle.read_text(encoding='utf-8'))]
        native_oos=copy.deepcopy(next(c for c in oos if 'canonical' in c['expected'] and len(c['rows'])<=c['protocol']['budget']['max_bars']))
        from trading_workspace_v2 import research
        native_oos['protocol']['engine']=copy.deepcopy(sources[-1][1]['protocol']['engine'])
        native_oos['protocol']['budget'].update(max_memory_mb=512,max_runtime_ms=60000)
        native_oos['protocol']['validation']=research._canonical_oos_request(native_oos['protocol']['playbook']['rules'],dict(train_bars=30,oos_bars=25,max_folds=1),{'lookback':[2],'quantity':[.1]},1)
        sources.append(('nautilus-oos',native_oos))
    for index,(kind,source) in enumerate(sources):
        protocol=copy.deepcopy(source['protocol']);rows=source['rows'];dataset=f'dataset-engine-{index}';job=f'engine-{index}'
        relative,sha=artifact.write_dataset('tenant-a',dataset,rows)
        source_info=protocol['dataset']['source'] if kind!='nautilus' else dict(source_id='native-scientific-fixture',provider='synthetic',instrument_mapping={'ORACLE':'ORACLE'},license_use='owned synthetic fixture',retrieved_at_utc='now',export_settings='offline native oracle')
        timeframe=protocol['dataset']['timeframe_seconds']
        manifest=DatasetManifest(dataset_id=dataset,workspace_id='tenant-a',source=DatasetSource(**source_info),instrument_id=protocol['dataset']['instrument_spec']['instrument_id'],instrument_spec=protocol['dataset']['instrument_spec'],timeframe='H1' if timeframe==3600 else 'M1',timeframe_seconds=timeframe,row_count=len(rows),first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=relative,artifact_sha256=sha,quality={'disposition':'pass'},created_at_utc='now')
        store.put_dataset(manifest);snapshot=manifest.model_dump(mode='json');protocol['dataset']={key:snapshot.get(key) for key in ['dataset_id','artifact_sha256','normalized_sha256','instrument_spec','timeframe_seconds','transform_version','quality','holdout_policy','source']};protocol['engine']['code_sha256']=engine_hash
        digest=hashlib.sha256(canonical_json_bytes(protocol)).hexdigest();common=dict(job_id=job,workspace_id='tenant-a',dataset_id=dataset,dataset_sha256=sha,protocol_sha256=digest,protocol=protocol,playbook_id=protocol['playbook']['record_id'],playbook_revision=protocol['playbook']['revision'],engine_code_sha256=engine_hash,created_at_utc='2026-10-17T00:00:00.000001Z')
        if kind=='nautilus':
            from trading_workspace_v2.nautilus_worker import normalize_native_result
            computed=normalize_native_result(source['expected']['value']['execution'],protocol)
        elif kind=='nautilus-oos':
            from rust_oos_execution_oracle import run as run_oos
            from trading_workspace_v2.nautilus_worker import execute_native_process,normalize_native_result
            def run_native(source_rows,source_protocol):
                return normalize_native_result(execute_native_process(source_rows,source_protocol,continue_check=lambda:True,deadline=time.perf_counter()+60),source_protocol)
            computed=run_oos(rows,protocol,snapshot,run_engine=run_native)
        else:computed=json.loads(source['expected']['canonical'])
        if kind in ('reference','nautilus'):
            expected=EngineResearchResult(**common,split=protocol['split'],**computed).model_dump(mode='json');expected['observed_range']['elapsed_ms']=0.
        else:
            validation=computed['validation'];expected=OOSResearchResult(**common,selection=validation['selection'],walk_forward=validation['walk_forward'],sweep=validation['sweep'],trials=computed['trials'],outcome_summary=computed['outcome_summary'],source_range=dict(protocol['range'],bar_count=len(rows),elapsed_ms=0.)).model_dump(mode='json')
        cases.append(dict(job_id=job,manifest=snapshot,protocol=protocol,protocol_sha256=digest,expected=expected))
    return cases
def main():
    global OUT
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=OUT)
    parser.add_argument('--scientific-oracle',type=Path);parser.add_argument('--scientific-capability',type=Path)
    parser.add_argument('--release',action='store_true')
    args=parser.parse_args();OUT=args.output.resolve()
    paths=[*sorted((F/'api-rust/src/research_execution').rglob('*.rs')),
           *sorted((F/'api-rust/src/research_jobs').rglob('*.rs')),
           F/'api-rust/src/research_execution.rs',F/'api-rust/src/artifact_data.rs',
           F/'trading_workspace_v2/nautilus_worker.py',Path(__file__).resolve()]
    def fingerprints():
        return {str(p.relative_to(F)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    source_hashes=fingerprints()
    path=oracle();env=dict(os.environ,TW_RUST_RESEARCH_EXECUTION_ORACLE=str(path))
    if args.scientific_capability:env['TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY']=str(args.scientific_capability.resolve())
    env.pop('TW_V2_DATABASE_URL',None)
    pure_code=None
    if os.environ.get('TW_RUST_EXECUTION_PG_ONLY')!='1':
        with (OUT/'pure.log').open('w',encoding='utf-8') as log:
            pure=subprocess.run(['cargo','test','--locked',*(['--release'] if args.release else []),'--manifest-path',str(F/'api-rust/Cargo.toml'),'--lib','research_execution::tests::python_baseline_oracle','--','--ignored','--nocapture'],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
        pure_code=pure.returncode
        if pure_code:
            (OUT/'receipt.json').write_text(json.dumps(dict(passed=False,phase='pure',pure_exit_code=pure_code)),encoding='utf-8')
            print((OUT/'pure.log').read_text(encoding='utf-8')[-12000:]);return pure_code
    with tempfile.TemporaryDirectory(prefix='tw-native-research-') as temp:
        root=Path(temp);data=root/'pgdata';artifacts=root/'artifacts';artifacts.mkdir()
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        # PostgreSQL server inherits standard handles from pg_ctl on Windows;
        # captured PIPEs would keep communicate() waiting after pg_ctl exits.
        def pg(name,*args):subprocess.run([str(PG/name),*args],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        pg('initdb.exe','-D',str(data),'-A','trust','-U','rust_execution_fixture','--encoding=UTF8','--locale=C')
        started=False
        try:
            pg('pg_ctl.exe','-D',str(data),'-l',str(root/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port} -c max_connections=30 -c shared_buffers=32MB','-w','start');started=True
            pg('createdb.exe','-h','127.0.0.1','-p',str(port),'-U','rust_execution_fixture','rust_execution_fixture')
            dsn=f'host=127.0.0.1 port={port} user=rust_execution_fixture dbname=rust_execution_fixture'
            store=PostgresStore(dsn);store.initialize();store.ensure_workspace('tenant-a');store.ensure_workspace('tenant-b')
            closes=[1.1,1.1001,1.0999,1.1,1.101,1.102]
            rows=[dict(timestamp=60*(i+1),open=value,high=value+.001,low=value-.001,close=value,volume=1.) for i,value in enumerate(closes)]
            artifact=ArtifactStore(artifacts);relative,sha=artifact.write_dataset('tenant-a','dataset-fixture',rows)
            manifest=DatasetManifest(dataset_id='dataset-fixture',workspace_id='tenant-a',source=DatasetSource(source_id='fixture',provider='fixture',instrument_mapping={'fixture':'fixture'},license_use='owned synthetic fixture',retrieved_at_utc='now',export_settings='synthetic'),instrument_id='fixture',timeframe='M1',timeframe_seconds=60,row_count=len(rows),first_timestamp=60,last_timestamp=360,artifact_path=relative,artifact_sha256=sha,quality={'disposition':'pass'},created_at_utc='now')
            store.put_dataset(manifest)
            fixture=dict(manifest=manifest.model_dump(mode='json'),expected=result(closes),engine_cases=engine_fixtures(artifact,store,args.scientific_oracle));fixture['expected']['dataset_sha256']=sha;store.close()
            pgoracle=OUT/'pg-oracle.json';pgoracle.write_text(json.dumps(fixture),encoding='utf-8')
            env.update(TW_V2_DATABASE_URL=dsn,TW_V2_ARTIFACT_ROOT=str(artifacts),TW_V2_LOCAL_WORKSPACES='tenant-a,tenant-b',TW_RUST_EXECUTION_DISPOSABLE='1',TW_RUST_EXECUTION_PG_ORACLE=str(pgoracle))
            with (OUT/'postgres.log').open('w',encoding='utf-8') as log:
                run=subprocess.run(['cargo','test','--locked',*(['--release'] if args.release else []),'--manifest-path',str(F/'api-rust/Cargo.toml'),'--lib','research_execution::tests::postgres_execution_fences','--','--ignored','--nocapture'],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
            source_unchanged=source_hashes==fingerprints()
            receipt={'schema':'rust-research-execution-acceptance-v1','passed':run.returncode==0 and pure_code in (None,0) and source_unchanged,'source_unchanged':source_unchanged,'disposable':True,'python_oracle_cases':86,'engine_cases':len(fixture['engine_cases']),'scientific_cases':sum(c['protocol']['engine']['backend']=='nautilus' for c in fixture['engine_cases']),'pure_exit_code':pure_code,'postgres_exit_code':run.returncode,'owner_runtime_touched':False,'source_hashes':source_hashes}
            (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
            print(json.dumps(receipt))
            if run.returncode:print((OUT/'postgres.log').read_text(encoding='utf-8')[-10000:])
            return run.returncode or (0 if source_unchanged else 1)
        finally:
            if started:pg('pg_ctl.exe','-D',str(data),'-m','fast','-w','stop')
if __name__=='__main__':raise SystemExit(main())
