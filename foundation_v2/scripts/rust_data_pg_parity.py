"""Native local data workflow + exact legacy codec acceptance in disposable PG."""
from __future__ import annotations
import argparse,json,os,subprocess,sys,tempfile
from pathlib import Path
from copy import deepcopy
V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2.parent)]
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.data_ingest import preview_csv,_parquet_rows
from trading_workspace_v2.contracts import DatasetManifest,utc_now_iso
from rust_legacy_codec_bootstrap import inspect_codec
from rust_data_ingest_parity import fixture_request

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pg-bin',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    base=fixture_request()
    with tempfile.TemporaryDirectory(prefix='rust-legacy-codec-oracle-') as temp:
        root=Path(temp);artifacts=ArtifactStore(root/'artifacts');cases=[]
        counts=[2,50003,420003]
        for count in counts:
            source=root/f'source-{count}.csv';source.write_text('time,open,high,low,close,volume\n'+''.join(f'{i*60},1,2,0,1.23456,{i%17}\n' for i in range(count)),encoding='utf-8')
            metadata=deepcopy(base['source']);metadata['source_id']=f'legacy-{count}'
            preview=preview_csv(source,metadata,base['instrument'],60);dataset=preview['dataset_id']
            raw_path,raw_sha=artifacts.write_raw_source('tenant-a',dataset,source)
            path,sha=artifacts.write_dataset_iter('tenant-a',dataset,_parquet_rows(source))
            manifest=DatasetManifest(dataset_id=dataset,workspace_id='tenant-a',source=metadata,instrument_id='EURUSD',timeframe='60s',row_count=count,first_timestamp=0,last_timestamp=(count-1)*60,artifact_path=path,artifact_sha256=sha,raw_artifact_path=raw_path,raw_sha256=raw_sha,normalized_sha256=preview['normalized_sha256'],instrument_spec=preview['instrument'],timeframe_seconds=60,available_range=preview['available_range'],quality=preview['quality'],holdout_policy=preview['holdout_policy'],transform_version=preview['transform_version'],created_at_utc=utc_now_iso())
            cases.append(dict(manifest=manifest.model_dump(mode='json'),raw_file=str(artifacts.root/raw_path),artifact_file=str(artifacts.root/path)))
        oracle=root/'legacy.json';oracle.write_text(json.dumps(cases),encoding='utf-8')
        capability=root/'legacy-codec-capability.json';capability.write_text(json.dumps(inspect_codec()),encoding='utf-8')
        env={**os.environ,'TW_DATA_LEGACY_ORACLE':str(oracle),'TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY':str(capability)}
        guard=subprocess.run(['cargo','test','--locked','--lib','data_routes::legacy_codec::tests','--','--include-ignored','--nocapture'],cwd=V2/'api-rust',env=env,capture_output=True,text=True)
        (args.output/'guard.json').write_text(json.dumps(dict(passed=guard.returncode==0,stdout=guard.stdout,stderr=guard.stderr),indent=2),encoding='utf-8')
        if guard.returncode:print(guard.stdout);print(guard.stderr);raise SystemExit(guard.returncode)
        result=subprocess.run([sys.executable,str(V2/'api-rust/tests/rust_metadata_parity.py'),'--pg-bin',str(args.pg_bin),'--output',str(args.output/'pg.json'),'--extra-test','rust_data_pg'],env=env,capture_output=True,text=True)
        (args.output/'receipt.json').write_text(json.dumps(dict(passed=result.returncode==0,legacy_rows=counts,raw_bytes=[Path(c['raw_file']).stat().st_size for c in cases],pyarrow='21.0.0',stdout=result.stdout,stderr=result.stderr),indent=2),encoding='utf-8');print(result.stdout);print(result.stderr);raise SystemExit(result.returncode)
if __name__=='__main__':main()
