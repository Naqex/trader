"""Paired, read-only native reader comparison on one immutable replay revision.

Uses the existing in-process router probe: no listener, provider or replay writes.
TW_V2_DATABASE_URL supplies credentials; only --database selects the local database.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics

from psycopg.conninfo import conninfo_to_dict, make_conninfo
from benchmark_replay_history import summary
from rust_replay_history_acceptance import query, reconcile
from rust_replay_storage_acceptance import Probe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--cursor", type=int, required=True)
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert 2 <= args.samples <= 20 and args.cursor >= args.samples
    root = Path(__file__).resolve().parents[1]
    config = conninfo_to_dict(os.environ["TW_V2_DATABASE_URL"])
    assert config.get("host") in ("127.0.0.1", "localhost", "::1"), "local database required"
    config["dbname"] = args.database
    env = {key: value for key, value in os.environ.items() if not key.startswith("TW_V2_")}
    env.update(TW_V2_DATABASE_URL=make_conninfo(**config), TW_V2_ARTIFACT_ROOT=str(args.artifacts.resolve(strict=True)),
        TW_V2_RUNTIME_PROFILE="native", TW_V2_REPLAY_STORAGE_PROFILE="compact", TW_V2_RUST_BIND="127.0.0.1:0",
        TW_V2_LOCAL_WORKSPACES="tenant-a", TW_V2_OPENAPI_PATH=str(root / "contracts/openapi.json"),
        TW_V2_REPLAY_TIMINGS="1")
    args.output.mkdir(parents=True, exist_ok=True)
    probes, samples = {}, []
    path = "/api/v2/replay/sessions/" + args.session
    def pair(label, suffix, previous=None, reverse=False):
        order = ["candidate", "baseline"] if reverse else ["baseline", "candidate"]
        responses = {kind: probes[kind].call("GET", path + suffix) for kind in order}
        before, after = responses["baseline"]["body"], responses["candidate"]["body"]
        assert before == after, f"reader output mismatch: {label}"
        result = reconcile(previous, after) if previous is not None else after
        item = {"case": label, "order": order, "cursor": result["view_cursor_index"],
            "exact_parity": True, "sha256": hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()}
        for kind in order:
            item[kind] = {"ms": responses[kind]["router_elapsed_us"] / 1000,
                "bytes": responses[kind]["response_bytes"]}
        samples.append(item)
        print(json.dumps(item), flush=True)
        return result
    try:
        for kind in ("baseline", "candidate"):
            probes[kind] = Probe(getattr(args, kind).resolve(strict=True), env, args.output / f"{kind}.log")
        initial = pair("first_full", f"?cursor_index={args.cursor}")
        current = initial
        for index in range(args.samples):
            current = pair("forward", query(current), current, index % 2 == 1)
        for index in range(args.samples):
            pair("rewind_full", f"?cursor_index={args.cursor-index-1}", reverse=index % 2 == 0)
        final = pair("final_full", f"?cursor_index={args.cursor}")
        assert final == initial, "canonical revision or historical content changed"
    finally:
        for probe in probes.values():
            probe.close()
    grouped = {}
    for label in ("forward", "rewind_full"):
        values = [item for item in samples if item["case"] == label]
        grouped[label] = {kind: summary([v[kind]["ms"] for v in values]) for kind in ("baseline", "candidate")}
        grouped[label]["median_paired_latency_ratio"] = statistics.median(v["candidate"]["ms"] / v["baseline"]["ms"] for v in values)
    receipt = {"scope": "serial local router; alternating paired order; cold process first_full separated; warm OS cache; no capacity claim",
        "revision": initial["revision"], "canonical_cursor": initial["canonical_cursor_index"], "samples": samples, "summary": grouped,
        "binaries": {kind: hashlib.sha256(getattr(args, kind).read_bytes()).hexdigest() for kind in ("baseline", "candidate")}}
    (args.output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(grouped))


if __name__ == "__main__":
    main()
