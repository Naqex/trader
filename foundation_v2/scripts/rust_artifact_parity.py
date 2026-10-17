"""Generate isolated Python oracle fixtures and run the Rust immutable reader parity suite."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.replay_chart_history import chart_period
from trading_workspace_v2.tick_history import TickHistoryStore, SCHEMA as TICK_SCHEMA
import pyarrow as pa
import pyarrow.parquet as pq


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--test-executable", type=Path, help="Use an already compiled isolated reader test binary")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rust-artifact-parity-") as temporary:
        root = Path(temporary)
        store = ArtifactStore(root)
        base = 1706745300  # UTC Jan 31 -> Feb, plus an explicit two-day market gap.
        rows = [dict(timestamp=base + i * 60 + (172800 if i >= 5000 else 0),
                     open=100 + i / 10000, high=101 + i / 10000,
                     low=99 + i / 10000, close=100.5 + i / 10000,
                     tick_volume=i % 13, spread=None if i % 7 == 0 else i % 4,
                     source="fixture") for i in range(12013)]
        path, sha = store.write_dataset_iter("fixture", "canonical", rows, batch_size=257)
        indices = [(0, 0), (0, 1), (256, 259), (12000, 12013), (0, len(rows))]
        ranges = [(base, base, 0), (base + 254 * 60, base + 260 * 60, 6),
                  (rows[5000]["timestamp"]-1, rows[5000]["timestamp"]+1, 1)]
        timings = [dict(index=i, at_or_before=cutoff) for i, cutoff in
                   [(0, None), (12012, None), (258, base-1), (5000, rows[5000]["timestamp"]-1), (5000, rows[5000]["timestamp"])]]
        charts = []
        for resolution in ["1", "5", "60", "1D", "1W", "1M"]:
            period = chart_period(resolution, 60)
            for cursor, count, to in [(0, 10, None), (256, 2, None), (5005, 20, None), (12012, 3, rows[6000]["timestamp"])]:
                charts.append(dict(cursor=cursor, resolution=resolution, count=count, to=to,
                    expected=store.read_dataset_chart_window(path, sha, cursor_index=cursor, period=period, to_utc=to, count_back=count)))
        manifest = dict(root=str(root), path=path, sha=sha, base=base,
            indices=[dict(start=a,end=b,expected=store.read_dataset_indices(path,sha,start_index=a,end_index=b)) for a,b in indices],
            ranges=[dict(start=a,end=b,max=m,expected=store.read_dataset_range(path,sha,from_utc=a,to_utc=b,max_bars=m)) for a,b,m in ranges],
            queries=timings, timings=store.read_dataset_replay_timings(path,sha,queries=timings), charts=charts,
            find=[dict(canonical=12012,timestamp=t,expected=store.find_dataset_cursor(path,sha,canonical_cursor=12012,timestamp=t))
                  for t in [base,base+1,rows[5000]["timestamp"]-1,rows[-1]["timestamp"]]])
        tick_rows = [dict(time_msc=base*1000+i*3, bid=100+i/10000, ask=100.01+i/10000,
                         last=0.0, volume=2**63+i, flags=6,volume_real=0.0,sequence=i) for i in range(301)]
        object_dir = root / "fixture/ticks/objects"
        object_dir.mkdir(parents=True)
        tick_file = object_dir / "staging.parquet"
        pq.write_table(pa.Table.from_pylist(tick_rows, schema=TICK_SCHEMA),tick_file,row_group_size=31,compression="zstd")
        tick_sha = hashlib.sha256(tick_file.read_bytes()).hexdigest()
        tick_file.rename(object_dir/f"{tick_sha}.parquet")
        canonical = lambda value: json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
        tick_manifest = dict(workspace_id="fixture", metadata={"unicode":"Việt Nam", "tiny":1e-08},
            available_intervals=[[base*1000,base*1000+1000]], partitions=[dict(row_count=len(tick_rows),
                requested_from_msc=base*1000,requested_to_msc=base*1000+1000,path=f"objects/{tick_sha}.parquet",sha256=tick_sha)])
        snapshot = "ticks-"+hashlib.sha256(canonical(tick_manifest)).hexdigest()
        tick_manifest["snapshot_id"] = snapshot
        (root/"fixture/ticks/manifests").mkdir()
        (root/f"fixture/ticks/manifests/{snapshot}.json").write_bytes(canonical(tick_manifest))
        (root/"fixture/ticks/latest").mkdir()
        (root/"fixture/ticks/latest/EURUSD.json").write_bytes(canonical({"snapshot_id":snapshot}))
        tick_store = TickHistoryStore(root)
        manifest["tick"] = dict(snapshot=snapshot, expected_manifest=tick_store.load_manifest("fixture",snapshot),
            start=base*1000+10,end=base*1000+700,
            expected=list(tick_store.iter_ticks("fixture",snapshot,base*1000+10,base*1000+700)))
        fixture = root / "oracle.json"
        fixture.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
        samples = []
        for _ in range(8):
            begin = time.perf_counter_ns()
            store.read_dataset_chart_window(path,sha,cursor_index=12012,period=60,to_utc=None,count_back=20)
            samples.append((time.perf_counter_ns()-begin)/1e6)
        env = dict(os.environ, TW_RUST_ARTIFACT_ORACLE=str(fixture))
        command = ([str(args.test_executable.resolve()), "--include-ignored", "--nocapture"] if args.test_executable else
                   ["cargo", "test", "--test", "rust_artifact_parity", "--", "--include-ignored", "--nocapture"])
        result = subprocess.run(command, cwd=Path(__file__).resolve().parents[1] / "api-rust", env=env, capture_output=True, text=True)
        writer_verified = False
        if result.returncode == 0:
            written = json.loads((root/"rust-writes.json").read_bytes())
            rust_file = root/written["path"]
            assert hashlib.sha256(rust_file.read_bytes()).hexdigest() == written["sha"]
            written_rows = pq.read_table(rust_file).to_pylist()
            assert len(written_rows) == 50003
            for index in [0,1,49999,50000,50002]:
                assert written_rows[index] == dict(timestamp=base+(index//2)*60,open=100.0,high=101.0,low=99.0,close=100.5,volume=float(index))
            assert (root/written["raw_path"]).read_bytes() == b"timestamp,open\r\n1,2\r\n"
            assert hashlib.sha256((root/written["raw_path"]).read_bytes()).hexdigest() == written["raw_sha"]
            writer_verified = True
        (args.output / "parity.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        receipt = dict(schema_version="rust-artifact-parity-v1", rows=len(rows), row_group_size=257,
                       file_bytes=(root/path).stat().st_size, fixture_sha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),
                       python_warm_chart_ms=samples, rust_exit_code=result.returncode,
                       python_verified_rust_parquet_and_raw_writer=writer_verified,
                       command=command, scope="isolated canonical artifact fixture; no owner session mutation")
        (args.output / "receipt.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
        print(result.stdout)
        if result.returncode:
            print(result.stderr)
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
