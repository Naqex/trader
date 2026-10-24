"""Native report activity clocks against disposable PostgreSQL and synthetic BARs.

All database/artifact writes stay in a unique fixture directory on E:. This never
reads an owner DSN, sends broker orders, or starts an owner terminal.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from urllib.parse import urlencode

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2 / "scripts"), str(V2 / "tests")]
from rust_replay_storage_acceptance import Probe, PG
from test_replay_execution_core import initial_state
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.store import PostgresStore


def query(path, **values):
    return path + "?" + urlencode(values)


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def recorded(payload, event, portfolio=False):
    sidecar = payload["activity_recording"]
    assert sidecar["schema_version"] == "replay-activity-recording-v1"
    proofs = sidecar["portfolio"] if portfolio else sidecar["assets"][event["dataset_id"]]
    proof = proofs[str(event["sequence"])]
    canonical = {key: value for key, value in event.items()
                 if key not in {"replay_session_id", "branch_id"}}
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True,
        ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    assert proof["event_sha256"] == digest
    stamp = sidecar["batches"][proof["batch_index"]]["recorded_at_utc"]
    assert instant(stamp).utcoffset() == timedelta(0)
    return stamp


def source_hashes():
    paths = [Path(__file__), V2 / "api-rust/examples/rust_replay_service_probe.rs",
             V2 / "api-rust/src/replay_activity_recording.rs", V2 / "api-rust/src/replay_service.rs",
             V2 / "api-rust/src/analytics.rs", V2 / "api-rust/src/analytics/activity.rs",
             V2 / "api-rust/src/analytics/routes.rs", V2 / "api-rust/src/analytics/trades.rs"]
    return {str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    executable = args.probe.resolve(strict=True)
    output = args.output.resolve()
    assert output.drive.lower() == "e:", "Acceptance outputs and fixtures must stay on E:"
    output.mkdir(parents=True, exist_ok=True)
    receipt = {"status": "FAIL", "checks": [], "profiles": {},
        "scope": "native Routers, disposable PG, synthetic old-market BARs; no owner DB/provider/broker",
        "probe_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "source_sha256": source_hashes(),
        "limitations": ["Router/stdio acceptance does not verify browser paint or live broker execution.",
            "Legacy fixture deliberately has no recording proof; no historical recovery is attempted."]}
    probes = {}
    store = None
    with tempfile.TemporaryDirectory(prefix="activity-fixture-", dir=output) as temporary:
        work = Path(temporary)
        artifacts = ArtifactStore(work / "artifacts")
        data = work / "pg"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        def pg(command, *values):
            subprocess.run([str(PG / (command + ".exe")), *values], check=True, timeout=45,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW)

        pg("initdb", "-D", str(data), "-U", "fixture", "-A", "trust", "--locale=C", "--encoding=UTF8")
        pg("pg_ctl", "-D", str(data), "-l", str(work / "pg.log"), "-o",
           f"-h 127.0.0.1 -p {port} -c shared_buffers=32MB", "-w", "start")
        try:
            dsn = f"host=127.0.0.1 port={port} user=fixture dbname=postgres connect_timeout=5"
            store = PostgresStore(dsn)
            store.initialize()
            store.ensure_workspace("tenant-a")
            store.ensure_workspace("tenant-b")
            state = initial_state()
            rows = [{"timestamp": 1767225600 + index * 60, "open": 1.1 + index * .0001,
                "high": 1.1004 + index * .0001, "low": 1.0998 + index * .0001,
                "close": 1.1001 + index * .0001, "volume": 100}
                for index in range(30)]
            for suffix, symbol in [("a", "EURUSD"), ("b", "GBPUSD")]:
                dataset = "dataset-activity-" + suffix
                path, sha = artifacts.write_dataset("tenant-a", dataset, rows)
                spec = {**state.instrument_spec, "instrument_id": symbol,
                        "base_ccy": "EUR" if suffix == "a" else "GBP"}
                store.put_dataset(DatasetManifest(dataset_id=dataset, workspace_id="tenant-a",
                    source=DatasetSource(source_id="activity-fixture", provider="synthetic",
                        instrument_mapping={symbol: symbol}, license_use="fixture",
                        retrieved_at_utc="2026-01-01T00:00:00Z", export_settings="activity-acceptance"),
                    instrument_id=symbol, timeframe="M1", timeframe_seconds=60, instrument_spec=spec,
                    row_count=len(rows), first_timestamp=rows[0]["timestamp"], last_timestamp=rows[-1]["timestamp"],
                    artifact_path=path, artifact_sha256=sha, created_at_utc="2026-01-01T00:00:00Z"))
            environment = {key: value for key, value in os.environ.items() if not key.startswith("TW_V2_")}
            environment.update({"TW_V2_DATABASE_URL": dsn, "TW_V2_ARTIFACT_ROOT": str(artifacts.root),
                "TW_V2_RUNTIME_PROFILE": "native", "TW_V2_RUST_BIND": "127.0.0.1:0",
                "TW_V2_LOCAL_WORKSPACES": "tenant-a,tenant-b",
                "TW_V2_OPENAPI_PATH": str(V2 / "contracts/openapi.json")})
            for profile in ("full", "compact"):
                probes[profile] = Probe(executable, {**environment, "TW_V2_REPLAY_STORAGE_PROFILE": profile},
                    output / f"probe-{profile}.log")
            initialization = {"instrument_spec": state.instrument_spec, "cost_model": state.cost_model,
                "spread_price": "0.0002", "timeframe_seconds": 60, "starting_balance": "100000"}
            for profile, probe in probes.items():
                begin = datetime.now(timezone.utc) - timedelta(seconds=1)
                session = probe.call("POST", "/api/v2/replay/sessions", {"dataset_id": "dataset-activity-a",
                    "name": "Activity " + profile, "starting_balance": "100000"}, 201)["body"]
                path = "/api/v2/replay/sessions/" + session["record_id"]

                def mutate(suffix, body, *, method="POST", status=200, wire=False, key=None):
                    nonlocal session
                    endpoint = path + suffix + ("?response_view=mutation-v1" if wire else "")
                    result = probe.call(method, endpoint,
                        {"expected_revision": session["revision"], **body}, status, key=key)["body"]
                    session = probe.call("GET", path)["body"]
                    return result

                mutate("/execution", initialization)
                mutate("/orders/market", {"operation_id": "activity-open", "side": "BUY", "quantity": "0.10"}, wire=True)
                mutate("/step", {"steps": 2})
                execution = session["payload"]["execution"]
                fill = next(event for event in execution["ledger"] if event["kind"] == "market_fill")
                fill_stamp = recorded(session["payload"], fill)
                preclose = probe.call("GET", query(path + "/analytics", time_basis="activity", timezone="Asia/Ho_Chi_Minh"))["body"]
                assert preclose["metrics"]["closed_trade_count"] == 0
                assert any(point["equity"] == float(execution["equity"])
                    for point in preclose["equity_curve"]["points"])
                assert any(point["equity"] != point["balance"] for point in preclose["equity_curve"]["points"])
                position = execution["position"]["position_id"]
                mutate("/orders/close", {"operation_id": "activity-partial", "target_id": position, "quantity": "0.05"}, wire=True)
                mutate("/step", {"steps": 1})
                close_body = {"expected_revision": session["revision"], "operation_id": "activity-close", "target_id": position}
                close_endpoint = path + "/orders/close?response_view=mutation-v1"
                first = probe.call("POST", close_endpoint, close_body, key="activity-close-" + profile)["body"]
                repeated = probe.call("POST", close_endpoint, close_body, key="activity-close-" + profile)["body"]
                assert first == repeated
                session = probe.call("GET", path)["body"]
                execution = session["payload"]["execution"]
                closes = [event for event in execution["ledger"] if event["kind"] == "manual_close"]
                assert len(closes) == 2
                close_stamps = {event["sequence"]: recorded(session["payload"], event) for event in closes}
                end = datetime.now(timezone.utc) + timedelta(seconds=1)
                assert all(begin <= instant(stamp) <= end for stamp in [fill_stamp, *close_stamps.values()])
                assert max(event["virtual_time_utc"] for event in closes) < begin.timestamp() - 86400
                before_metadata = copy.deepcopy(session["payload"]["activity_recording"])
                mutate("", {"name": "Renamed activity " + profile}, method="PATCH")
                assert session["payload"]["activity_recording"] == before_metadata
                analytics = probe.call("GET", query(path + "/analytics", time_basis="activity", timezone="Asia/Ho_Chi_Minh"))["body"]
                assert analytics["scope"]["time_basis"] == "activity"
                assert analytics["metrics"]["closed_trade_count"] == 2
                for trade in analytics["ledger"]:
                    assert trade["report_time_utc"] == close_stamps[trade["close_event_sequence"]]
                    assert trade["close_recorded_at_utc"] == trade["report_time_utc"]
                    assert trade["close_time_utc"] < begin.timestamp() - 86400
                current_month = instant(close_stamps[closes[-1]["sequence"]]).astimezone(timezone(timedelta(hours=7))).strftime("%Y-%m")
                date_query = {"time_basis": "activity", "timezone": "Asia/Ho_Chi_Minh",
                    "from_close_utc": begin.isoformat(), "to_close_utc": end.isoformat()}
                filtered = probe.call("GET", query(path + "/analytics", **date_query))["body"]
                assert filtered["metrics"]["closed_trade_count"] == 2
                market = probe.call("GET", query(path + "/analytics", **{**date_query, "time_basis": "market"}))["body"]
                assert market["metrics"]["closed_trade_count"] == 0
                dashboard = probe.call("GET", query("/api/v2/overview", session_id=session["record_id"], **date_query))["body"]["performance"]
                assert dashboard["metrics"]["closed_trade_count"] == 2
                assert dashboard["months"][0]["month"] == current_month
                unpaged = probe.call("GET", query("/api/v2/replay/trades", session_id=session["record_id"], **date_query))["body"]
                paged = probe.call("GET", query("/api/v2/replay/trades", session_id=session["record_id"], page=1, page_size=10, **date_query))["body"]
                assert paged["pagination"]["returned_count"] == 2
                assert {row["trade_id"] for row in paged["ledger"]} == {row["trade_id"] for row in unpaged["ledger"]}
                dates = sorted(instant(stamp).astimezone(timezone(timedelta(hours=7))).date().isoformat() for stamp in close_stamps.values())
                assert paged["facets"]["date_range"] == {"from": dates[0], "to": dates[-1]}
                summaries = probe.call("GET", query("/api/v2/dashboard/sessions", time_basis="activity", timezone="Asia/Ho_Chi_Minh", page_size=25))["body"]
                detail = next(item["detail"] for item in summaries["items"] if item["record_id"] == session["record_id"])
                assert detail["periods"]["months"][0]["label"] == current_month
                market_view = probe.call("GET", query(path + "/analytics", time_basis="market", timezone="Asia/Ho_Chi_Minh"))["body"]
                assert market_view["scope"]["time_basis"] == "market"
                assert market_view["metrics"]["closed_trade_count"] == 2
                assert market_view["equity_curve"]["time_basis"] == "market"
                assert all(instant(point["time_utc"]).timestamp() < begin.timestamp() - 86400
                    for point in market_view["equity_curve"]["points"])
                market_summaries = probe.call("GET", query("/api/v2/dashboard/sessions", time_basis="market", timezone="Asia/Ho_Chi_Minh", page_size=25))["body"]
                market_detail = next(item["detail"] for item in market_summaries["items"] if item["record_id"] == session["record_id"])
                assert market_detail["periods"]["time_basis"] == "market"
                performance_months = market_detail["periods"]["performance"]["months"]
                expected_month = datetime.fromtimestamp(closes[-1]["virtual_time_utc"], timezone.utc).astimezone(timezone(timedelta(hours=7))).strftime("%Y-%m")
                assert performance_months[0]["label"] == expected_month != current_month
                assert sum(row["count"] for row in performance_months) == 2
                assert abs(sum(row["profit"] + row["loss"] for row in performance_months) - analytics["metrics"]["net_pnl"]) < 1e-7
                assert market_detail["equity_curve"]["points"] == market_view["equity_curve"]["points"]
                assert detail["scope"]["recording_coverage"]["known_close_count"] == 2
                assert detail["equity_curve"]["points"] == analytics["equity_curve"]["points"]
                child = probe.call("POST", path + "/branch", {"expected_revision": session["revision"],
                    "cursor_index": session["payload"]["cursor_index"]}, 201)["body"]
                child_analytics = probe.call("GET", query("/api/v2/replay/sessions/" + child["record_id"] + "/analytics", time_basis="activity"))["body"]
                assert [row["report_time_utc"] for row in child_analytics["ledger"]] == [row["report_time_utc"] for row in analytics["ledger"]]
                for event in child["payload"]["execution"]["ledger"]:
                    if event["kind"] in {"market_fill", "manual_close"}:
                        assert recorded(child["payload"], event) in [fill_stamp, *close_stamps.values()]
                # Seed one explicitly legacy record into this fixture through the
                # existing store. Engine state is valid; recording evidence is absent.
                legacy = copy.deepcopy(session["payload"])
                legacy.pop("activity_recording", None)
                legacy.pop("entry_recording", None)
                legacy["name"] = "Legacy no clocks " + profile
                legacy_record = store.create_record("tenant-a", "replay", {
                    "dataset_id": legacy["dataset_id"], "cursor_index": 0})
                legacy["execution"]["replay_session_id"] = legacy_record["record_id"]
                for event in legacy["execution"]["ledger"]:
                    event["replay_session_id"] = legacy_record["record_id"]
                legacy_record = store.update_record("tenant-a", "replay", legacy_record["record_id"], 1, legacy)
                legacy_path = "/api/v2/replay/sessions/" + legacy_record["record_id"] + "/analytics"
                unknown = probe.call("GET", query(legacy_path, time_basis="activity"))["body"]
                assert unknown["metrics"]["closed_trade_count"] == 2
                assert all(row["report_time_utc"] is None for row in unknown["ledger"])
                assert unknown["scope"]["recording_coverage"]["unknown_close_count"] == 2
                assert unknown["equity_curve"]["points"] == [] and unknown["equity_curve"]["partial"]
                unknown_filtered = probe.call("GET", query(legacy_path, **date_query))["body"]
                assert unknown_filtered["metrics"]["closed_trade_count"] == 0
                receipt["profiles"][profile] = {"session_id": session["record_id"], "child_id": child["record_id"],
                    "fill_recorded_at_utc": fill_stamp, "close_recorded_at_utc": list(close_stamps.values()),
                    "market_close_times": [event["virtual_time_utc"] for event in closes],
                    "local_month": current_month, "equity_points": len(analytics["equity_curve"]["points"])}
                receipt["checks"].append(profile + ": full/compact append roundtrip, fill/partial-close proofs, floating Equity, real report clocks, timezone, date filters, cached summary/dashboard/paged parity, retries, metadata, fork inheritance, unknown legacy")
                session = probe.call("POST", "/api/v2/replay/sessions", {
                    "dataset_id": "dataset-activity-a", "dataset_ids": ["dataset-activity-a", "dataset-activity-b"],
                    "name": "Portfolio activity " + profile, "starting_balance": "100000"}, 201)["body"]
                path = "/api/v2/replay/sessions/" + session["record_id"]
                mutate("/execution", initialization)
                mutate("/orders/market", {"operation_id": "portfolio-a-open", "side": "BUY", "quantity": "0.10"})
                mutate("/step", {"steps": 2})
                mutate("/asset", {"dataset_id": "dataset-activity-b"})
                mutate("/execution", {**initialization, "instrument_spec": {
                    **state.instrument_spec, "instrument_id": "GBPUSD", "base_ccy": "GBP"}})
                mutate("/orders/market", {"operation_id": "portfolio-b-open", "side": "BUY", "quantity": "0.10"})
                mutate("/step", {"steps": 1})
                account = session["payload"]["portfolio_execution"]
                portfolio_view = probe.call("GET", query(path + "/analytics", time_basis="activity"))["body"]
                account_equity = float(account["equity"])
                raw_asset_sum = sum(float(asset["execution"]["equity"])
                    for asset in session["payload"]["asset_states"].values())
                assert account_equity != raw_asset_sum
                assert portfolio_view["equity_curve"]["points"][-1]["equity"] == account_equity
                assert portfolio_view["equity_curve"]["partial"] is False
                assert portfolio_view["equity_curve"]["unknown_event_count"] == 0
                for point in portfolio_view["equity_curve"]["points"]:
                    event = next(event for event in account["ledger"] if event["sequence"] == point["sequence"])
                    assert point["time_utc"] == recorded(session["payload"], event, portfolio=True)
                mutate("/orders/close", {"operation_id": "portfolio-b-close",
                    "target_id": session["payload"]["execution"]["position"]["position_id"]})
                mutate("/asset", {"dataset_id": "dataset-activity-a"})
                mutate("/orders/close", {"operation_id": "portfolio-a-close",
                    "target_id": session["payload"]["execution"]["position"]["position_id"]})
                portfolio_closed = probe.call("GET", query(path + "/analytics", time_basis="activity"))["body"]
                assert portfolio_closed["metrics"]["closed_trade_count"] == 2
                assert portfolio_closed["equity_curve"]["partial"] is False
                for trade in portfolio_closed["ledger"]:
                    local = session["payload"]["asset_states"][trade["dataset_id"]]["execution"]
                    event = next(event for event in local["ledger"] if event["sequence"] == trade["asset_close_event_sequence"])
                    assert trade["report_time_utc"] == recorded(session["payload"], event)
                receipt["profiles"][profile]["portfolio"] = {"session_id": session["record_id"],
                    "account_equity_before_close": account_equity, "raw_asset_equity_sum": raw_asset_sum,
                    "equity_partial": portfolio_closed["equity_curve"]["partial"],
                    "equity_points": len(portfolio_closed["equity_curve"]["points"])}
                receipt["checks"].append(profile + ": multiasset close clocks use local events; true Equity uses canonical portfolio ledger, never raw asset sum")
            receipt["status"] = "PASS"
        except BaseException as error:
            receipt["error"] = repr(error)
            raise
        finally:
            for probe in probes.values():
                probe.close()
            if store is not None:
                store.close()
            pg("pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop")
            (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json"), "checks": receipt["checks"]}))


if __name__ == "__main__":
    main()
