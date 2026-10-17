"""Rare admin-only legacy Parquet byte codec; no database, provider or domain mutation."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    foundation=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('legacy_codec_limits',foundation/'engine_runtime/limits.py');limits=importlib.util.module_from_spec(spec);spec.loader.exec_module(limits)
    limits.constrain_process(512)
    import pyarrow as pa
    import pyarrow.parquet as pq
    if pa.__version__!='21.0.0':raise RuntimeError('legacy codec version differs')
    # Preserve the historical Python writer's field order, inference, batching,
    # metadata and compression. Rust validates the final pinned digest.
    with args.output.open('xb') as output:
        writer=None
        try:
            def batches():
                batch=[]
                with args.input.open(encoding='utf-8') as handle:
                    for line in handle:
                        if len(line)>4096:raise ValueError('legacy codec row exceeds budget')
                        row=json.loads(line)
                        batch.append({'timestamp':int(row['timestamp']),**{key:float(row[key]) for key in ('open','high','low','close','volume')}})
                        if len(batch)==50_000:yield batch;batch=[]
                if batch:yield batch
            for batch in batches():
                table=pa.Table.from_pylist(batch)
                if writer is None:writer=pq.ParquetWriter(output,table.schema,compression='zstd')
                elif table.schema!=writer.schema:table=table.cast(writer.schema)
                writer.write_table(table)
        finally:
            if writer is not None:writer.close()
        output.flush();os.fsync(output.fileno())
if __name__=='__main__':main()
