"""Disposable native step-v1/full-wire/storage differential acceptance.

Reuse the storage probe and fixture contracts; never connect to an owner runtime.
Measurements are serial Router diagnostics, not browser latency or capacity tests.
"""
from __future__ import annotations

import argparse
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from uuid import uuid4

from rust_replay_storage_acceptance import (
    ArtifactStore, DatasetManifest, DatasetSource, PG, PostgresStore, Probe, V2,
    initial_state, norm, reconcile, source_hashes as storage_source_hashes,
)

PROFILES = ("oracle", "full", "compact")


def source_hashes():
    return {**storage_source_hashes(),
            str(Path(__file__).relative_to(V2)): hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def reconcile_step(before, delta):
    assert delta["schema_version"] == "replay-step-v1"
    for field in ("workspace_id", "record_id", "dataset_id", "dataset_sha256"):
        expected = "tenant-a" if field == "workspace_id" else (
            before["payload"]["dataset_id"] if field == "dataset_id" else before[field])
        assert delta[field] == expected, (field, delta[field], expected)
    assert delta["branch_id"] == before["payload"]["branch_id"]
    assert delta["base_revision"] == before["revision"]
    assert delta["revision"] == before["revision"] + 1
    old_cursor = before["payload"]["cursor_index"]
    new_cursor = delta["cursor_index"]
    assert delta["base_cursor_index"] == old_cursor
    assert delta["base_cutoff_timestamp"] == before["cutoff_timestamp"]
    assert delta["view_cursor_index"] == delta["canonical_cursor_index"] == new_cursor
    assert not delta["historical_view"] and old_cursor <= new_cursor
    old_execution = before["payload"].get("execution")
    old_ledger = (old_execution or {}).get("ledger", [])
    assert delta["base_event_sequence"] == len(old_ledger)
    rows, events = delta["appended_rows"], delta["appended_events"]
    assert len(rows) == new_cursor - old_cursor <= 1000
    assert len(events) <= 3000
    assert [event["sequence"] for event in events] == list(
        range(len(old_ledger) + 1, delta["execution_event_sequence"] + 1))
    assert all(old_cursor < event["cursor_index"] <= new_cursor for event in events)
    assert all(row["timestamp"] > before["cutoff_timestamp"] for row in rows)
    assert all(left["timestamp"] < right["timestamp"] for left, right in zip(rows, rows[1:]))
    assert delta["cutoff_timestamp"] == (rows[-1]["timestamp"] if rows else before["cutoff_timestamp"])
    result = copy.deepcopy(before)
    result["payload"].update(delta["payload_patch"])
    head = result["payload"].get("execution")
    if head is None:
        assert old_execution is None and not events and delta["execution_event_sequence"] == 0
        assert delta["execution_view_status"] == "not_initialized"
        # Stored uninitialized records omit this optional field; the wire patch
        # uses explicit null. Preserve the canonical preexisting record shape.
    else:
        assert "ledger" not in head and delta["execution_view_status"] == "current"
        assert head["event_sequence"] == delta["execution_event_sequence"]
        head["ledger"] = old_ledger + events
    result["visible_rows"] = (before["visible_rows"] + rows)[-2000:]
    for field in ("revision", "updated_at_utc", "cutoff_timestamp", "visible_row_start",
                  "visible_row_count", "total_row_count", "view_cursor_index",
                  "canonical_cursor_index", "historical_view", "has_future_rows",
                  "execution_view_status", "session_kind", "prop_session_id", "prop_attempt_id"):
        if field in delta:
            result[field] = delta[field]
    assert result["visible_row_count"] == len(result["visible_rows"])
    assert result["visible_row_start"] == max(0, new_cursor - 1999)
    assert result["payload"]["cursor_index"] == new_cursor
    return result


@contextmanager
def fixture(executable, output, row_count):
    """Own every process, database and artifact path within this temporary root."""
    probes, store = {}, None
    with tempfile.TemporaryDirectory(prefix="rust-replay-step-") as temporary:
        work = Path(temporary)
        data = work / "pg"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        def pg(command, *values):
            subprocess.run([str(PG / (command + ".exe")), *values], check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW)
        pg("initdb", "-D", str(data), "-U", "fixture", "-A", "trust", "--locale=C", "--encoding=UTF8")
        pg("pg_ctl", "-D", str(data), "-l", str(work / "pg.log"), "-o",
           f"-h 127.0.0.1 -p {port} -c shared_buffers=32MB", "-w", "start")
        try:
            dsn = f"host=127.0.0.1 port={port} user=fixture dbname=postgres"
            store = PostgresStore(dsn)
            store.initialize()
            for workspace in ("tenant-a", "tenant-b"):
                store.ensure_workspace(workspace)
            artifacts = ArtifactStore(work / "artifacts")
            spec = initial_state().instrument_spec
            rows_by_dataset, hashes = {}, {}
            for dataset, count, gap in (("dataset-step", row_count, False), ("dataset-gap", 40, True)):
                rows = [{"timestamp": 1767225600 + index * 60 + (600 if gap and index >= 5 else 0),
                         "open": 1.1, "high": 1.1004, "low": 1.0998,
                         "close": 1.1, "volume": 100} for index in range(count)]
                path, sha = artifacts.write_dataset("tenant-a", dataset, rows)
                store.put_dataset(DatasetManifest(dataset_id=dataset, workspace_id="tenant-a",
                    source=DatasetSource(source_id="step-fixture", provider="synthetic",
                        instrument_mapping={"EURUSD": "EURUSD"}, license_use="fixture",
                        retrieved_at_utc="2026-01-01T00:00:00Z", export_settings="owned-step"),
                    instrument_id="EURUSD", timeframe="M1", timeframe_seconds=60, instrument_spec=spec,
                    row_count=len(rows), first_timestamp=rows[0]["timestamp"], last_timestamp=rows[-1]["timestamp"],
                    artifact_path=path, artifact_sha256=sha, created_at_utc="2026-01-01T00:00:00Z"))
                rows_by_dataset[dataset], hashes[dataset] = rows, sha
            environment = {key: value for key, value in os.environ.items() if not key.startswith("TW_V2_")}
            environment.update({"TW_V2_DATABASE_URL": dsn, "TW_V2_ARTIFACT_ROOT": str(artifacts.root),
                "TW_V2_RUNTIME_PROFILE": "native", "TW_V2_RUST_BIND": "127.0.0.1:0",
                "TW_V2_LOCAL_WORKSPACES": "tenant-a,tenant-b", "TW_V2_REPLAY_TIMINGS": "1",
                "TW_V2_OPENAPI_PATH": str(V2 / "contracts/openapi.json")})
            generations = dict.fromkeys(PROFILES, 0)
            def restart(profile):
                if profile in probes:
                    probes[profile].close()
                generations[profile] += 1
                probes[profile] = Probe(executable,
                    {**environment, "TW_V2_REPLAY_STORAGE_PROFILE": "compact" if profile == "compact" else "full"},
                    output / f"probe-{profile}-{generations[profile]}.log")
            for profile in PROFILES:
                restart(profile)
            yield store, probes, rows_by_dataset, hashes, restart
        finally:
            for probe in probes.values():
                probe.close()
            if store:
                store.close()
            pg("pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop")


class Acceptance:
    def __init__(self, store, probes, output, receipt):
        self.store, self.probes, self.output, self.receipt = store, probes, output, receipt

    def check(self, label):
        self.receipt["checks"].append(label)

    def compare(self, label, left, right):
        if norm(left) != norm(right):
            (self.output / "mismatch.json").write_text(json.dumps(
                {"case": label, "left": left, "right": right}, indent=2), encoding="utf-8")
            raise AssertionError("step differential mismatch: " + label)

    @staticmethod
    def base(value):
        return "/api/v2/replay/sessions/" + value["record_id"]

    def twins(self, name, **options):
        values = {profile: self.probes[profile].call("POST", "/api/v2/replay/sessions",
            {"dataset_id": "dataset-step", "starting_balance": "100000", "name": name, **options}, 201)["body"]
            for profile in PROFILES}
        self.parity("create " + name, values)
        return values

    def parity(self, label, values):
        for profile in ("full", "compact"):
            self.compare(label + " " + profile, values["oracle"], values[profile])

    def get(self, values, query=""):
        after = {profile: self.probes[profile].call("GET", self.base(value) + query)["body"]
                 for profile, value in values.items()}
        self.parity("full GET " + query, after)
        return after

    def signature(self, value):
        with self.store.connect() as conn:
            current = conn.execute("SELECT current_revision FROM workspace_records WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s", (value["record_id"],)).fetchone()
            return [current["current_revision"], *[
                conn.execute(f"SELECT count(*) AS n FROM {table} WHERE workspace_id='tenant-a' AND record_id=%s", (value["record_id"],)).fetchone()["n"]
                for table in ("workspace_record_revisions", "replay_execution_revisions", "replay_execution_events", "replay_execution_operations")]]

    def mutate(self, values, tail, body, *, step_wire=True, order=PROFILES, sample=None, status=200, key=None):
        after = {}
        for profile in order:
            before = values[profile]
            data = body(profile, before) if callable(body) else body
            data = {"expected_revision": before["revision"], **data}
            view = ("step-v1" if tail == "/step" else "mutation-v1") if profile != "oracle" and step_wire else None
            path = self.base(before) + tail + ("?response_view=" + view if view else "")
            signature = self.signature(before) if status != 200 else None
            response = self.probes[profile].call("POST", path, data, status=status,
                key=(key + "-" + profile) if key else None)
            persisted = self.probes[profile].call("GET", self.base(before))["body"]
            if status != 200:
                assert signature == self.signature(before), "failed step mutated persistent state"
                self.compare("failed request state", before, persisted)
                after[profile] = persisted
            elif view:
                after[profile] = reconcile_step(before, response["body"]) if tail == "/step" else reconcile(before, response["body"])
                self.compare("reconciled response versus exact GET " + profile, after[profile], persisted)
            else:
                wire = {field: value for field, value in response["body"].items() if field != "execution_events"}
                self.compare("full wire versus GET " + profile, wire, persisted)
                after[profile] = persisted
            if sample is not None and profile != "oracle":
                self.receipt["samples"].append({**sample, "profile": profile, "order": list(order),
                    "base_events": (before["payload"].get("execution") or {}).get("event_sequence", 0),
                    "base_revision": before["revision"], "base_cursor": before["payload"]["cursor_index"],
                    **{field: response[field] for field in ("router_elapsed_us", "stdio_elapsed_ns", "response_bytes", "phases")}})
        self.parity(tail, after)
        return after

    def selector_evidence(self, large_prefixes, init, dataset_sha):
        from test_ps02_replay_prop_connection import prop_state
        if not large_prefixes:
            self.receipt["prop_selector_evidence_skipped"] = "No500/5000 stage selected in this development run"
            return
        next_sql = "SELECT sequence FROM replay_execution_events WHERE workspace_id=$1 AND record_id=$2 AND dataset_id=$3 AND sequence>$4 AND sequence<=$5 AND event_json->>'kind' IN ('price_mark','manual_close','order_cancel') ORDER BY sequence LIMIT 1"
        requested_sql = "SELECT e.sequence,e.event_json,e.prefix_sha256,p.sequence AS previous_sequence,p.event_json AS previous_event,p.prefix_sha256 AS previous_sha256 FROM replay_execution_events e LEFT JOIN replay_execution_events p ON p.workspace_id=e.workspace_id AND p.record_id=e.record_id AND p.dataset_id=e.dataset_id AND p.sequence=e.sequence-1 WHERE e.workspace_id=$1 AND e.record_id=$2 AND e.dataset_id=$3 AND e.sequence=$4 AND e.sequence<=$5 AND e.event_json->>'kind' IN ('price_mark','manual_close','order_cancel')"
        source = (V2 / "api-rust/src/replay_storage.rs").read_text(encoding="utf-8")
        assert next_sql in source and requested_sql in source, "selector evidence drifted from actual helper SQL"
        def explain(conn, sql, params):
            for index in range(1, 6):
                sql = sql.replace("$" + str(index), "%s")
            raw = conn.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql, params).fetchone()["QUERY PLAN"]
            if isinstance(raw, str):
                raw = json.loads(raw)
            def nodes(plan):
                yield plan
                for child in plan.get("Plans", []):
                    yield from nodes(child)
            selected = list(nodes(raw[0]["Plan"]))
            assert not any(node["Node Type"] == "Seq Scan" and node.get("Relation Name") == "replay_execution_events"
                           for node in selected), "selector scanned event history sequentially"
            return {"plan": raw, "indexes": sorted({node["Index Name"] for node in selected if "Index Name" in node}),
                    "nodes": [{key: node[key] for key in ("Node Type", "Relation Name", "Index Name", "Actual Rows", "Actual Loops",
                        "Rows Removed by Filter", "Shared Hit Blocks", "Shared Read Blocks") if key in node} for node in selected]}
        for stage, values in large_prefixes.items():
            value = values["compact"]
            head = value["payload"]["execution"]
            cutoff = head["event_sequence"]
            acknowledged, requested = cutoff - 2, cutoff - 1
            mark = head["ledger"][acknowledged - 1]
            assert mark["sequence"] == acknowledged and mark["kind"] == "price_mark"
            session, attempt, phase, resume = prop_state(session_id=uuid4().hex,
                attempt_id=uuid4().hex, dataset_sha256=dataset_sha)
            attempt = attempt.model_copy(update={"cost_version": init["cost_model"]["version"],
                "virtual_cutoff_utc": datetime.fromtimestamp(head["ledger"][-1]["virtual_time_utc"] + 3600, tz=timezone.utc)})
            phase = phase.model_copy(update={"virtual_time_utc": datetime.fromtimestamp(mark["virtual_time_utc"], tz=timezone.utc),
                                           "last_event_sequence": 1})
            resume.update({"cursor": {"bar_index": mark["cursor_index"],
                "timestamp_utc": datetime.fromtimestamp(mark["virtual_time_utc"], tz=timezone.utc).isoformat().replace("+00:00", "Z")},
                "replay_binding": {**{key: head[key] for key in ("replay_session_id", "branch_id", "dataset_id", "dataset_sha256")},
                                   "last_replay_event_sequence": acknowledged}})
            self.store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
            # A real persisted Prop binding changes the view's derived identity.
            # Refresh only this expected view; retain the canonical financial head.
            refreshed = self.probes["compact"].call("GET", self.base(value))["body"]
            self.compare("Prop seed preserves execution", value["payload"]["execution"], refreshed["payload"]["execution"])
            value = refreshed
            evidence = {"stage_steps": stage, "actual_prefix_events": cutoff, "acknowledged_sequence": acknowledged,
                "requested_sequence": requested,
                "binding_fixture": "Persisted coherent acknowledged resume from the real canonical old mark; prior historical API feeds/receipts are deliberately not claimed."}
            with self.store.connect() as conn:
                conn.execute("ANALYZE replay_execution_events")
                params = ("tenant-a", value["record_id"], head["dataset_id"], acknowledged, cutoff)
                evidence["next_eligible"] = explain(conn, next_sql, params)
                params = ("tenant-a", value["record_id"], head["dataset_id"], requested, cutoff)
                evidence["requested_and_predecessor"] = explain(conn, requested_sql, params)
                conn.commit()
            assert evidence["next_eligible"]["plan"][0]["Plan"]["Actual Rows"] == 1
            assert evidence["requested_and_predecessor"]["plan"][0]["Plan"]["Actual Rows"] == 1
            self.receipt.setdefault("prop_selector_evidence", []).append(evidence)
            path = self.base(value) + f"/prop/sessions/{session.session_id}/attempts/{attempt.attempt_id}/feed"
            body = {"replay_event_sequence": requested, "expected_prop_revision": 1, "prop_event_sequence": 2}
            if stage == max(large_prefixes):
                # Prior storage acceptance covers all tables/statements. Here an
                # actual old mark is targeted, then only the selected bounded
                # neighborhood/certificate is bypassed in this owned fixture.
                for sql in ("UPDATE replay_execution_events SET event_json=event_json WHERE workspace_id='tenant-a' AND record_id=%s AND sequence=1",
                            "DELETE FROM replay_execution_events WHERE workspace_id='tenant-a' AND record_id=%s AND sequence=1"):
                    try:
                        with self.store.connect() as conn:
                            conn.execute(sql, (value["record_id"],))
                            conn.commit()
                    except Exception as error:
                        assert "prefix rows are immutable" in str(error), str(error)
                    else:
                        raise AssertionError("old canonical mark mutation unexpectedly succeeded")
                def replace(table, column, replacement, sequence=None):
                    assert (table, column) in {("replay_execution_events", "event_json"),
                                               ("replay_execution_revisions", "validator_version")}
                    key = "sequence" if sequence is not None else "revision"
                    key_value = sequence if sequence is not None else value["revision"]
                    with self.store.connect() as conn:
                        directory = Path(conn.execute("SHOW data_directory").fetchone()["data_directory"]).resolve()
                        assert directory.parent.name.startswith("rust-replay-step-")
                        assert directory.is_relative_to(Path(tempfile.gettempdir()).resolve())
                        prior = conn.execute(f"SELECT {column} FROM {table} WHERE workspace_id='tenant-a' AND record_id=%s AND {key}=%s", (value["record_id"], key_value)).fetchone()[column]
                        conn.execute(f"ALTER TABLE {table} DISABLE TRIGGER USER")
                        encoded = json.dumps(replacement) if column == "event_json" else replacement
                        cast = "::jsonb" if column == "event_json" else ""
                        conn.execute(f"UPDATE {table} SET {column}=%s{cast} WHERE workspace_id='tenant-a' AND record_id=%s AND {key}=%s", (encoded, value["record_id"], key_value))
                        conn.execute(f"ALTER TABLE {table} ENABLE TRIGGER USER")
                        conn.commit()
                    return prior
                corruptions = [
                    ("selected", "replay_execution_events", "event_json", requested,
                     {**head["ledger"][requested - 1], "branch_id": "corrupt-selected"}),
                    ("predecessor", "replay_execution_events", "event_json", requested - 1,
                     {**head["ledger"][requested - 2], "branch_id": "corrupt-predecessor"}),
                    ("certificate", "replay_execution_revisions", "validator_version", None, "unknown-validator"),
                ]
                for label, table, column, sequence, replacement in corruptions:
                    signature = self.signature(value)
                    prior = replace(table, column, replacement, sequence)
                    try:
                        self.probes["compact"].call("POST", path, body, status=503)
                        self.probes["compact"].call("GET", self.base(value), status=503)
                        assert self.signature(value) == signature
                        with self.store.connect() as conn:
                            current = conn.execute("SELECT current_revision FROM prop_attempts WHERE workspace_id='tenant-a' AND session_id=%s AND attempt_id=%s", (session.session_id, attempt.attempt_id)).fetchone()
                        assert current["current_revision"] == 1
                    finally:
                        replace(table, column, prior, sequence)
                    self.compare("restored selector " + label, value,
                        self.probes["compact"].call("GET", self.base(value))["body"])
            self.probes["compact"].call("POST", path, {**body, "replay_event_sequence": cutoff}, status=422)
            result = self.probes["compact"].call("POST", path, body)["body"]
            assert result["replay_event"]["sequence"] == requested
            assert result["resume_state"]["replay_binding"]["last_replay_event_sequence"] == requested
            retry = self.probes["compact"].call("POST", path, body)["body"]
            self.compare("large-prefix feed retry", result, {**retry, "duplicate": False})
            assert retry["duplicate"] is True
        self.check("near-tail Prop selectors at stages" + str(sorted(large_prefixes)) + " use naturally planned indexes; requested/predecessor/certificate corruption fails hot/cold and restores exactly")

    def feed_cases(self, init, dataset_sha, large_prefixes):
        from test_ps02_replay_prop_connection import prop_state
        values = self.mutate(self.twins("indexed Prop lifecycle"), "/execution", init)
        values = self.mutate(values, "/step", {"steps": 10})
        quick = {"operation_id": "prop-open", "side": "SELL", "quantity": "0.01",
                 "stop_loss": None, "take_profit": None, "execution_timing": "current_quote"}
        values = self.mutate(values, "/orders/quick", quick)
        values = self.mutate(values, "/step", {"steps": 3})
        values = self.mutate(values, "/orders/close", lambda p, v: {
            "operation_id": "prop-close", "target_id": v["payload"]["execution"]["position"]["position_id"]})
        values = self.mutate(values, "/orders/market", {**quick, "operation_id": "prop-pending", "execution_timing": "next_bar"})
        values = self.mutate(values, "/orders/close", {"operation_id": "prop-cancel", "target_id": "prop-pending"})
        bound = {}
        for profile in PROFILES:
            session, attempt, phase, resume = prop_state(session_id=uuid4().hex,
                attempt_id=uuid4().hex, dataset_sha256=dataset_sha)
            attempt = attempt.model_copy(update={"cost_version": init["cost_model"]["version"]})
            self.store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
            marks = [event for event in values[profile]["payload"]["execution"]["ledger"]
                     if event["kind"] in ("price_mark", "manual_close", "order_cancel")]
            assert {"manual_close", "order_cancel"}.issubset({event["kind"] for event in marks})
            path = self.base(values[profile]) + f"/prop/sessions/{session.session_id}/attempts/{attempt.attempt_id}/feed"
            self.probes[profile].call("POST", path, {"replay_event_sequence": marks[1]["sequence"],
                "expected_prop_revision": 1, "prop_event_sequence": 1}, status=422)
            previous = None
            first = None
            for index, event in enumerate(marks):
                body = {"replay_event_sequence": event["sequence"],
                        "expected_prop_revision": previous["attempt"]["revision"] if previous else 1,
                        "prop_event_sequence": previous["phase"]["last_event_sequence"] + 1 if previous else 1}
                result = self.probes[profile].call("POST", path, body)["body"]
                assert result["replay_event"] == event
                assert result["resume_state"]["replay_binding"]["last_replay_event_sequence"] == event["sequence"]
                if index == 0:
                    first = (body, result)
                previous = result
            retry = self.probes[profile].call("POST", path, first[0])["body"]
            assert retry["duplicate"] is True
            self.compare("old feed receipt after backlog", first[1], {**retry, "duplicate": False})
            bound[profile] = (path, previous)
        for field in ("phase", "objectives"):
            self.parity("Prop backlog " + field, {profile: item[1][field] for profile, item in bound.items()})
        other = self.mutate(self.twins("wrong Prop lineage"), "/execution", init)
        other = self.mutate(other, "/step", {"steps": 1})
        for profile in PROFILES:
            old_path, current = bound[profile]
            path = old_path.replace(self.base(values[profile]), self.base(other[profile]))
            event = other[profile]["payload"]["execution"]["ledger"][0]
            self.probes[profile].call("POST", path, {"replay_event_sequence": event["sequence"],
                "expected_prop_revision": current["attempt"]["revision"],
                "prop_event_sequence": current["phase"]["last_event_sequence"] + 1}, status=422)
        self.check("Prop indexed backlog, no skipping, old exact domain retry, wrong lineage, manual close and cancel parity")
        self.selector_evidence(large_prefixes, init, dataset_sha)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stages", default="0,500,5000")
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--skip-prop", action="store_true", help="Explicitly omit indexed Prop acceptance until integrated")
    args = parser.parse_args()
    stages = [int(value) for value in args.stages.split(",")]
    assert stages == sorted(set(stages)) and 0 <= stages[0] <= stages[-1] <= 10000
    assert 1 <= args.samples <= 20
    executable, output = args.probe.resolve(strict=True), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    receipt = {"status": "FAIL", "checks": [], "samples": [], "source_sha256": source_hashes(),
        "probe_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(), "prop_skipped": args.skip_prop,
        "scope": "owned disposable PostgreSQL/Router; full storage/full wire oracle versus step-v1 full and compact storage twins",
        "limitations": ["Synthetic BAR fixture and serial Router timing exclude TCP/browser paint.",
            "Cold import labeled separately from warmed incremental requests.",
            "Small samples are diagnostic; sample p95 is not a capacity or stable tail verdict."]}
    try:
        with fixture(executable, output, max(6200, stages[-1] + 100)) as (store, probes, rows, hashes, restart):
            a = Acceptance(store, probes, output, receipt)
            init = {"instrument_spec": initial_state().instrument_spec, "cost_model": initial_state().cost_model,
                    "spread_price": "0.0002", "timeframe_seconds": 60, "starting_balance": "100000"}
            values = a.twins("null execution rolling window")
            for count in (1, 10, 1000, 1000, 1000):
                values = a.mutate(values, "/step", {"steps": count})
            assert values["compact"]["payload"].get("execution") is None
            assert values["compact"]["visible_row_count"] == 2000
            a.check("null execution steps1/10/1000 and rolling2000 row reconciliation versus full GET/full wire")
            values = a.mutate(a.twins("initialized rolling window"), "/execution", init)
            for count in (1, 10, 1000, 1000):
                values = a.mutate(values, "/step", {"steps": count})
            assert values["compact"]["payload"]["execution"]["event_sequence"] == 2011
            a.check("initialized contiguous events and rolling2000 step parity")
            gaps = a.mutate(a.twins("gap interval", dataset_id="dataset-gap"), "/execution", init)
            gaps = a.mutate(gaps, "/step", {"steps": 1, "replay_interval_seconds": 900})
            assert gaps["compact"]["payload"]["cursor_index"] > 1
            a.check("timestamp interval crosses gap using canonical dataset rows")
            period = a.twins("completed period", dataset_id="dataset-gap",
                start_timestamp=rows["dataset-gap"][1]["timestamp"], end_timestamp=rows["dataset-gap"][8]["timestamp"])
            period = a.mutate(a.mutate(period, "/execution", init), "/step", {"steps": 1000})
            assert period["compact"]["payload"]["status"] == "completed"
            a.mutate(period, "/step", {"steps": 1}, status=422)
            terminal = a.twins("legacy end no-op", dataset_id="dataset-gap", start_index=39)
            terminal = a.mutate(terminal, "/step", {"steps": 1})
            assert terminal["compact"]["payload"]["cursor_index"] == 39
            terminal = a.mutate(terminal, "/execution", init)
            terminal = a.mutate(terminal, "/step", {"steps": 1})
            assert terminal["compact"]["payload"]["execution"]["event_sequence"] == 0
            a.check("end-period clipping and atomic completed rejection; legacy zero-row end preserves cutoff")
            queued = a.mutate(a.twins("queued protective"), "/execution", init)
            order = {"operation_id": "queued-protective", "side": "BUY", "quantity": "0.01",
                     "stop_loss": "1.09", "take_profit": "1.1002", "execution_timing": "next_bar"}
            queued = a.mutate(queued, "/orders/market", order)
            queued = a.mutate(queued, "/step", {"steps": 1})
            kinds = [event["kind"] for event in queued["compact"]["payload"]["execution"]["ledger"]]
            assert "market_fill" in kinds and "protective_fill" in kinds and kinds[-1] == "price_mark", kinds
            margin = a.mutate(a.twins("rejected research margin", starting_balance="100"), "/execution",
                {**init, "starting_balance": "100", "research_margin": {"version": "fixed-starting-balance-leverage-v1", "leverage": "1"}})
            margin = a.mutate(margin, "/orders/market", {**order, "operation_id": "margin-reject", "stop_loss": None, "take_profit": None})
            margin = a.mutate(margin, "/step", {"steps": 1})
            events = margin["compact"]["payload"]["execution"]["ledger"]
            assert any(event["kind"] == "order_rejected" and event["details"]["reason"] == "insufficient_research_margin" for event in events), events
            assert not margin["compact"]["payload"]["execution"]["position"]
            a.check("queued market fill/protective fill and v2 insufficient research margin rejection events")
            before = copy.deepcopy(values)
            values = a.mutate(values, "/step", {"steps": 10}, key="exact-step")
            for profile in PROFILES:
                path = a.base(before[profile]) + "/step" + ("?response_view=step-v1" if profile != "oracle" else "")
                body = {"expected_revision": before[profile]["revision"], "steps": 10}
                first = probes[profile].call("POST", path, body, key="exact-step-" + profile)
                retry = probes[profile].call("POST", path, body, key="exact-step-" + profile)
                assert first["response_sha256"] == retry["response_sha256"]
                signature = a.signature(values[profile])
                probes[profile].call("POST", path, {**body, "steps": 1}, status=409, key="exact-step-" + profile)
                probes[profile].call("POST", path, body, status=409, key="stale-step-" + profile)
                probes[profile].call("POST", path, body, status=404, workspace="tenant-b")
                assert signature == a.signature(values[profile])
            a.check("step exact-byte wire retry, idempotency mismatch, stale revision and tenant denial remain atomic")
            a.mutate(values, "/step", {"steps": 0}, status=422)
            a.mutate(values, "/step", {"steps": 1001}, status=422)
            for profile in PROFILES:
                signature = a.signature(values[profile])
                probes[profile].call("POST", a.base(values[profile]) + "/step?response_view=unknown",
                    {"expected_revision": values[profile]["revision"], "steps": 1}, status=422)
                assert signature == a.signature(values[profile])
            a.check("invalid step bounds and unsupported response view fail without persistent side effects")
            a.get(values, "?cursor_index=1000")
            for profile in PROFILES:
                restart(profile)
            values = a.get(values)
            a.check("historical checkpoint and fresh-process full reload match step reconciliation")
            large_prefixes = {}
            for stage in stages:
                measured = a.mutate(a.twins("benchmark " + str(stage)), "/execution", init, step_wire=False)
                remaining = stage
                while remaining:
                    count = min(1000, remaining)
                    measured = a.mutate(measured, "/step", {"steps": count}, step_wire=False)
                    remaining -= count
                assert measured["compact"]["payload"]["execution"]["event_sequence"] == stage
                with store.connect() as conn:
                    prior = conn.execute("SELECT storage_format FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s AND revision=%s", (measured["compact"]["record_id"], measured["compact"]["revision"])).fetchone()
                assert prior["storage_format"] == "full_snapshot", "cold import fixture was already compact"
                measured = a.mutate(measured, "/step", {"steps": 1},
                    sample={"stage_steps": stage, "cold_import": True, "warmup": True}, order=("compact", "full", "oracle"))
                for index in range(args.samples):
                    order = ("full", "compact", "oracle") if index % 2 == 0 else ("compact", "full", "oracle")
                    measured = a.mutate(measured, "/step", {"steps": 1}, order=order,
                        sample={"stage_steps": stage, "cold_import": False, "warmup": False})
                with store.connect() as conn:
                    row = conn.execute("SELECT storage_format FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s AND revision=%s", (measured["compact"]["record_id"], measured["compact"]["revision"])).fetchone()
                assert row["storage_format"] == "replay-execution-v1"
                if stage in (500, 5000):
                    large_prefixes[stage] = measured
            a.check("alternating full/compact step-v1 at bounded ledger prefixes; cold import separated")
            if not args.skip_prop:
                a.feed_cases(init, hashes["dataset-step"], large_prefixes)
            assert source_hashes() == receipt["source_sha256"], "source changed during acceptance"
            assert hashlib.sha256(executable.read_bytes()).hexdigest() == receipt["probe_sha256"], "binary changed during acceptance"
            assert all(sample["phases"] for sample in receipt["samples"]), "missing replay timing instrumentation"
            receipt["summary"] = []
            for stage in stages:
                for profile in ("full", "compact"):
                    samples = [sample for sample in receipt["samples"] if sample["stage_steps"] == stage
                               and sample["profile"] == profile and not sample["warmup"]]
                    values_ms = sorted(sample["router_elapsed_us"] / 1000 for sample in samples)
                    receipt["summary"].append({"stage_steps": stage, "profile": profile, "samples": len(samples),
                        "p50_ms": values_ms[math.ceil(len(values_ms) * .5) - 1],
                        "sample_p95_ms": values_ms[math.ceil(len(values_ms) * .95) - 1],
                        "response_bytes": [sample["response_bytes"] for sample in samples]})
            receipt["status"] = "PASS"
    except Exception as error:
        receipt["error"] = repr(error)
        raise
    finally:
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "checks": len(receipt["checks"]), "samples": len(receipt["samples"])}))


if __name__ == "__main__":
    main()
