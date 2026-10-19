"""Serial, read-only full/history-v1 comparison on the same local replay cutoffs.

Run once after restart for a labeled cold cache sample. No broker or replay writes.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import time
import urllib.request

from rust_replay_history_acceptance import query, reconcile


def summary(values):
    return {"n": len(values), "median_ms": statistics.median(values),
        "sample_p95_ms": sorted(values)[max(0, math.ceil(len(values) * .95) - 1)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", required=True)
    parser.add_argument("--cursor", type=int, required=True)
    parser.add_argument("--workspace", default="tenant-a")
    parser.add_argument("--api", default="http://127.0.0.1:8010")
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert 2 <= args.samples <= 20 and args.cursor >= 0
    assert args.api.startswith("http://127.0.0.1:")
    base_path = args.api + "/api/v2/replay/sessions/" + args.session
    def read(suffix):
        started = time.perf_counter()
        request = urllib.request.Request(base_path + suffix, headers={"X-Workspace-Id": args.workspace})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
        value = json.loads(raw)
        return value, {"ms": (time.perf_counter() - started) * 1000, "bytes": len(raw)}
    before, initial = read("?cursor_index=" + str(args.cursor))
    samples = []
    revision = before["revision"]
    for index in range(args.samples):
        full_query = "?cursor_index=" + str(before["view_cursor_index"]) + "&advance_interval_seconds=60"
        results = {}
        order = ("delta", "full") if index % 2 == 0 else ("full", "delta")
        for kind in order:
            results[kind] = read(query(before) if kind == "delta" else full_query)
        delta, full = results["delta"][0], results["full"][0]
        merged = reconcile(before, delta)
        assert merged == full, "full/delta output mismatch"
        assert merged["revision"] == revision, "session changed during measurement"
        samples.append({"cursor": merged["view_cursor_index"], "cache": "cold_candidate" if index == 0 else "warm",
            "order": list(order), "full": results["full"][1], "delta": results["delta"][1], "exact_parity": True})
        print(json.dumps(samples[-1]), flush=True)
        before = merged
    warm = samples[1:]
    receipt = {"scope": "serial readonly local HTTP + JSON decode, same revision/cutoffs; alternating order; no capacity claim",
        "session_id": args.session, "revision": revision, "canonical_cursor": before["canonical_cursor_index"],
        "initial_full": initial, "samples": samples,
        "warm_full": summary([v["full"]["ms"] for v in warm]), "warm_delta": summary([v["delta"]["ms"] for v in warm]),
        "final_payload_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"full": receipt["warm_full"], "delta": receipt["warm_delta"]}))

if __name__ == "__main__":
    main()
