"""Read-only history-v1/full-wire parity using an owned disposable database."""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path
import subprocess
from urllib.parse import urlencode

from rust_replay_step_acceptance import fixture, Acceptance
from rust_replay_storage_acceptance import initial_state, source_hashes


def snapshots(payload):
    values = {"/execution": payload.get("execution"), "/portfolio_execution": payload.get("portfolio_execution")}
    for dataset, asset in (payload.get("asset_states") or {}).items():
        values[f"/asset_states/{dataset.replace('~', '~0').replace('/', '~1')}/execution"] = asset.get("execution")
    return {path: head for path, head in values.items() if head is not None}


def query(before, interval=60, **overrides):
    values = dict(response_view="history-v1", expected_revision=before["revision"],
        cursor_index=before["view_cursor_index"], base_cursor_index=before["view_cursor_index"],
        base_cutoff_timestamp=before["cutoff_timestamp"], advance_interval_seconds=interval,
        base_event_sequences=json.dumps({path: head["event_sequence"] for path, head in snapshots(before["payload"]).items()}))
    values.update(overrides)
    return "?" + urlencode(values)


def reconcile(before, delta):
    assert delta["schema_version"] == "replay-history-v1"
    result = copy.deepcopy(delta)
    previous = snapshots(before["payload"])
    heads = snapshots(result["payload"])
    assert set(previous) == set(heads) == {v["path"] for v in delta["ledger_deltas"]}
    for change in result["ledger_deltas"]:
        head, prior = heads[change["path"]], previous[change["path"]]
        assert "ledger" not in head and change["base_event_sequence"] == len(prior["ledger"])
        head["ledger"] = prior["ledger"] + change["appended_events"]
        assert head["event_sequence"] == len(head["ledger"])
    result["visible_rows"] = (before["visible_rows"] + delta["appended_rows"])[-2000:]
    for field in ("schema_version", "workspace_id", "base_revision", "base_cursor_index", "base_cutoff_timestamp", "ledger_deltas", "appended_rows"):
        del result[field]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    receipt = {"status": "FAIL", "checks": [], "samples": [], "source_sha256": source_hashes()}
    client_cases = []
    try:
        with fixture(args.probe.resolve(strict=True), output, 2200) as (store, probes, rows, hashes, restart):
            a = Acceptance(store, probes, output, receipt)
            init = dict(instrument_spec=initial_state().instrument_spec, cost_model=initial_state().cost_model,
                spread_price="0.0002", timeframe_seconds=60, starting_balance="100000")
            def mutate(profile, current, tail, body):
                return probes[profile].call("POST", a.base(current) + tail,
                    {"expected_revision": current["revision"], **body})["body"]
            def read_pair(profile, before, interval=60, label=""):
                signature = a.signature(before)
                measured = probes[profile].call("GET", a.base(before) + query(before, interval))
                delta = measured["body"]
                assert delta.get("schema_version") == "replay-history-v1", label
                result = reconcile(before, delta)
                full = probes[profile].call("GET", a.base(before) + "?cursor_index=" + str(result["view_cursor_index"]))["body"]
                assert result == full, label
                assert signature == a.signature(before), "read changed durable state"
                client_cases.append(dict(before=before, delta=delta, after=full))
                receipt["samples"].append({"case": label, "profile": profile,
                    **{key: measured[key] for key in ("router_elapsed_us", "response_bytes")}})
                return result
            def create(profile, dataset="dataset-step", **options):
                return probes[profile].call("POST", "/api/v2/replay/sessions",
                    {"dataset_id": dataset, "starting_balance": "100000", **options}, 201)["body"]
            for profile in ("full", "compact"):
                # Include fill, protective exit and same-cursor order checkpoints.
                current = mutate(profile, create(profile), "/execution", init)
                current = mutate(profile, current, "/step", {"steps": 10})
                current = mutate(profile, current, "/orders/market", {"operation_id": "protective", "side": "BUY", "quantity": "0.01",
                    "stop_loss": "1.09", "take_profit": "1.1002", "execution_timing": "next_bar"})
                current = mutate(profile, current, "/step", {"steps": 1000})
                base = probes[profile].call("GET", a.base(current) + "?cursor_index=10")["body"]
                for interval in (60, 60, 900, 3600):
                    base = read_pair(profile, base, interval, f"{profile} financial history interval{interval}")
                # Warm cache must invalidate on metadata/order revision without an event.
                stale = base
                current = mutate(profile, current, "/orders/market", {"operation_id": "pending", "side": "BUY", "quantity": "0.01", "execution_timing": "next_bar"})
                probes[profile].call("GET", a.base(stale) + query(stale), status=409)
                base = probes[profile].call("GET", a.base(current) + "?cursor_index=11")["body"]
                read_pair(profile, base, label="pending head revision invalidation")
                probes[profile].call("GET", a.base(base) + query(base, base_cutoff_timestamp=0), status=409)
                probes[profile].call("GET", a.base(base) + query(base, base_event_sequences="{}"), status=409)
                probes[profile].call("GET", a.base(base) + query(base), workspace="tenant-b", status=404)
                restart(profile)
                read_pair(profile, base, label="cold restart exact same revision")
                # Oversized intervals retain the full path's rejection; canonical
                # reads fall back to the full response without issuing a command.
                large = probes[profile].call("GET", a.base(current) + "?cursor_index=1")["body"]
                probes[profile].call("GET", a.base(large) + query(large, 86400), status=422)
                fallback = probes[profile].call("GET", a.base(current) + query(current))["body"]
                assert "schema_version" not in fallback
                # Uninitialized and gapped interval reads share the same row rules.
                null = mutate(profile, create(profile), "/step", {"steps": 20})
                null_base = probes[profile].call("GET", a.base(null) + "?cursor_index=2")["body"]
                read_pair(profile, null_base, label="null execution")
                gap = mutate(profile, create(profile, "dataset-gap"), "/execution", init)
                gap = mutate(profile, gap, "/step", {"steps": 20})
                gap_base = probes[profile].call("GET", a.base(gap) + "?cursor_index=3")["body"]
                read_pair(profile, gap_base, 900, "interval across timestamp gap")
                receipt["checks"].append(profile + ": exact full-wire financial/cutoff parity, read-only, stale revision/base, tenant, null, gap, restart, oversized rejection and canonical fallback")
            # A second instrument shares synthetic OHLC bytes, not account identity.
            with store.connect() as conn:
                manifest = conn.execute("SELECT manifest_json FROM datasets WHERE workspace_id='tenant-a' AND dataset_id='dataset-gap'").fetchone()["manifest_json"]
                manifest["instrument_id"] = "GBPUSD"
                manifest["instrument_spec"]["instrument_id"] = "GBPUSD"
                conn.execute("UPDATE datasets SET manifest_json=%s::jsonb WHERE workspace_id='tenant-a' AND dataset_id='dataset-gap'", (json.dumps(manifest),))
                conn.commit()
            for profile in ("full", "compact"):
                multi = create(profile, dataset_ids=["dataset-step", "dataset-gap"])
                multi = mutate(profile, multi, "/execution", init)
                multi = mutate(profile, multi, "/asset", {"dataset_id": "dataset-gap"})
                second_init = copy.deepcopy(init)
                second_init["instrument_spec"]["instrument_id"] = "GBPUSD"
                multi = mutate(profile, multi, "/execution", second_init)
                multi = mutate(profile, multi, "/asset", {"dataset_id": "dataset-step"})
                multi = mutate(profile, multi, "/orders/market", {"operation_id": "multi", "side": "BUY", "quantity": "0.01", "execution_timing": "next_bar"})
                multi = mutate(profile, multi, "/step", {"steps": 10})
                before = probes[profile].call("GET", a.base(multi) + "?cursor_index=2")["body"]
                before = read_pair(profile, before, label="multi local+portfolio+active ledgers")
                read_pair(profile, before, 300, "multi gapped clock")
                multi = mutate(profile, multi, "/step", {"steps": 100})
                before = probes[profile].call("GET", a.base(multi) + "?cursor_index=2")["body"]
                assert before["has_future_rows"] is False
                read_pair(profile, before, label="completed multi canonical future flag")
                receipt["checks"].append(profile + ": two initialized assets, gapped clock and exact full payload/portfolio account/ledger parity")
        wire = output / "client-cases.json"
        wire.write_text(json.dumps(client_cases), encoding="utf-8")
        subprocess.run(["node", str(Path(__file__).resolve().parents[1] / "web/verify_replay_history_fixture.mjs"), str(wire)], check=True)
        receipt["checks"].append(f"{len(client_cases)} real server responses merged exactly by production JS")
        receipt["status"] = "PASS"
    finally:
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "checks": receipt["checks"]}))

if __name__ == "__main__":
    main()
