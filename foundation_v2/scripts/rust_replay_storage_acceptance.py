"""Owned PostgreSQL differential acceptance for native bounded replay storage.

Two native Routers share a disposable database, but mutate distinct equivalent
sessions. No revision/event rows are deleted to reset a measurement. The full
snapshot profile is the domain oracle; both profiles use the same wire view.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import time
from uuid import uuid4

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2.parent), str(V2), str(V2 / "tests")]
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.store import PostgresStore
from test_replay_execution_core import initial_state
from rust_replay_service_acceptance import PG, norm


def source_hashes():
    paths = sorted((V2 / "api-rust/src").rglob("*.rs"))
    paths += sorted((V2 / "migrations").glob("*.sql"))
    paths += [Path(__file__), V2 / "api-rust/examples/rust_replay_mutation_probe.rs",
              V2 / "api-rust/Cargo.toml", V2 / "api-rust/Cargo.lock",
              V2 / "scripts/rust_replay_service_acceptance.py",
              V2 / "tests/test_replay_execution_core.py",
              V2 / "tests/test_ps02_replay_prop_connection.py"]
    return {str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


class Probe:
    def __init__(self, executable, environment, log_path):
        self.log_path = log_path
        self.log = log_path.open("w", encoding="utf-8")
        self.offset = 0
        self.process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=self.log, text=True, encoding="utf-8",
            env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
        self.lines = queue.Queue()
        def read():
            try:
                for line in self.process.stdout:
                    self.lines.put(line)
            finally:
                self.lines.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def call(self, method, path, body=None, status=200, key=None, workspace="tenant-a"):
        item = {"method": method, "path": path, "workspace": workspace}
        if body is not None:
            item["body"] = body
        if key:
            item["key"] = key
        start = time.perf_counter_ns()
        self.process.stdin.write(json.dumps(item) + "\n")
        self.process.stdin.flush()
        try:
            line = self.lines.get(timeout=60)
        except queue.Empty as error:
            raise AssertionError("probe request exceeded 60 seconds: " + path) from error
        assert line is not None, self.log_path.read_text(encoding="utf-8")[-6000:]
        result = json.loads(line)
        result["stdio_elapsed_ns"] = time.perf_counter_ns() - start
        assert result["status"] == status, (method, path, result)
        with self.log_path.open(encoding="utf-8") as log:
            log.seek(self.offset)
            entries = log.readlines()
            self.offset = log.tell()
        result["phases"] = []
        for entry in entries:
            try:
                fields = json.loads(entry).get("fields", {})
                if fields.get("message") == "native_replay_phases":
                    result["phases"] = json.loads(fields["phases"])
            except (ValueError, KeyError):
                pass
        return result

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        self.log.close()


def reconcile(before, delta):
    assert delta["schema_version"] == "replay-mutation-v1"
    assert delta["workspace_id"] == "tenant-a"
    assert delta["record_id"] == before["record_id"]
    assert delta["dataset_sha256"] == before["dataset_sha256"]
    assert delta["base_revision"] == before["revision"]
    previous = before["payload"].get("execution") or {}
    ledger = previous.get("ledger", [])
    assert delta["base_event_sequence"] == previous.get("event_sequence", 0) == len(ledger)
    head = delta["payload_patch"]["execution"]
    assert "ledger" not in head
    events = delta["appended_events"]
    assert len(events) <= 16
    assert [event["sequence"] for event in events] == list(
        range(len(ledger) + 1, head["event_sequence"] + 1))
    assert delta["execution_event_sequence"] == head["event_sequence"]
    result = copy.deepcopy(before)
    result["payload"].update(delta["payload_patch"])
    result["payload"]["execution"] = {**head, "ledger": ledger + events}
    for field in ("revision", "updated_at_utc", "execution_view_status", "historical_view",
                  "has_future_rows", "session_kind", "prop_session_id", "prop_attempt_id"):
        if field in delta:
            result[field] = delta[field]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stages", default="0,500,5000")
    parser.add_argument("--samples", type=int, default=5)
    args = parser.parse_args()
    stages = [int(value) for value in args.stages.split(",")]
    assert stages == sorted(set(stages)) and 0 <= stages[0] <= stages[-1] <= 10000
    assert 1 <= args.samples <= 20
    executable = args.probe.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    receipt = {"status": "FAIL", "checks": [], "samples": [], "storage": [], "activity_samples": [],
        "source_sha256": source_hashes(),
        "probe_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "scope": "owned disposable PG, synthetic BARs, equivalent twin sessions; full native engine/storage oracle versus opt-in compact storage",
        "limitations": ["Router excludes TCP/browser paint; stdio includes JSON IPC.",
            "Small alternating serial diagnostic, not stable tail, capacity or long soak.",
            "Cold full hydration intentionally validates the complete ledger.",
            "Administrator corruption tests bypass fixture triggers explicitly; immutable-prefix trust is not database-superuser tamper resistance."]}
    probes = {}
    store = None
    with tempfile.TemporaryDirectory(prefix="rust-replay-storage-") as temporary:
        work = Path(temporary)
        data = work / "pg"
        artifacts = ArtifactStore(work / "artifacts")
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
            store.ensure_workspace("tenant-a")
            store.ensure_workspace("tenant-b")
            spec = initial_state().instrument_spec
            init = {"instrument_spec": spec, "cost_model": initial_state().cost_model,
                "spread_price": "0.0002", "timeframe_seconds": 60, "starting_balance": "100000"}
            rows = [{"timestamp": 1767225600 + index * 60, "open": 1.1, "high": 1.1002,
                     "low": 1.0998, "close": 1.1, "volume": 100}
                    for index in range(max(30, stages[-1] + 30))]
            artifact_path, dataset_sha = artifacts.write_dataset("tenant-a", "dataset-storage", rows)
            store.put_dataset(DatasetManifest(dataset_id="dataset-storage", workspace_id="tenant-a",
                source=DatasetSource(source_id="storage-fixture", provider="synthetic",
                    instrument_mapping={"EURUSD": "EURUSD"}, license_use="fixture",
                    retrieved_at_utc="2026-01-01T00:00:00Z", export_settings="owned-storage"),
                instrument_id="EURUSD", timeframe="M1", timeframe_seconds=60, instrument_spec=spec,
                row_count=len(rows), first_timestamp=rows[0]["timestamp"], last_timestamp=rows[-1]["timestamp"],
                artifact_path=artifact_path, artifact_sha256=dataset_sha,
                created_at_utc="2026-01-01T00:00:00Z"))
            environment = {key: value for key, value in os.environ.items() if not key.startswith("TW_V2_")}
            environment.update({"TW_V2_DATABASE_URL": dsn, "TW_V2_ARTIFACT_ROOT": str(artifacts.root),
                "TW_V2_RUNTIME_PROFILE": "native", "TW_V2_RUST_BIND": "127.0.0.1:0",
                "TW_V2_LOCAL_WORKSPACES": "tenant-a,tenant-b", "TW_V2_REPLAY_TIMINGS": "1",
                "TW_V2_OPENAPI_PATH": str(V2 / "contracts/openapi.json")})
            generations = {"full": 0, "compact": 0}
            def start_probe(profile):
                generations[profile] += 1
                probes[profile] = Probe(executable,
                    {**environment, "TW_V2_REPLAY_STORAGE_PROFILE": "compact" if profile == "compact" else "full"},
                    output / f"probe-{profile}-{generations[profile]}.log")
            for profile in generations:
                start_probe(profile)
            def check(label):
                receipt["checks"].append(label)
            def compare(label, left, right):
                if norm(left) != norm(right):
                    (output / "mismatch.json").write_text(json.dumps(
                        {"case": label, "full": left, "compact": right}, indent=2), encoding="utf-8")
                    raise AssertionError("full/compact mismatch: " + label)
            def base(value):
                return "/api/v2/replay/sessions/" + value["record_id"]
            def twins(name):
                pair = {profile: probes[profile].call("POST", "/api/v2/replay/sessions",
                    {"dataset_id": "dataset-storage", "starting_balance": "100000", "name": name}, 201)["body"]
                    for profile in ("full", "compact")}
                compare("create " + name, pair["full"], pair["compact"])
                return pair
            def get(pair):
                values = {profile: probes[profile].call("GET", base(pair[profile]))["body"]
                          for profile in ("full", "compact")}
                compare("cold/full hydration", values["full"], values["compact"])
                return values
            def storage_signature(value):
                with store.connect() as conn:
                    signature = {}
                    for table in ("workspace_record_revisions", "replay_execution_revisions",
                                  "replay_execution_events", "replay_execution_operations"):
                        signature[table] = conn.execute(f"SELECT count(*) AS count FROM {table} WHERE workspace_id='tenant-a' AND record_id=%s", (value["record_id"],)).fetchone()["count"]
                    return signature
            def financial_storage(value):
                with store.connect() as conn:
                    row = conn.execute("SELECT r.current_revision,r.updated_at_utc,v.storage_format,v.payload_json,v.deleted FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id='tenant-a' AND r.kind='replay' AND r.record_id=%s", (value["record_id"],)).fetchone()
                return {"head": dict(row) if row else None, "rows": storage_signature(value)}
            def activity_body():
                end = datetime.now(timezone.utc) - timedelta(seconds=3)
                return {"event_id": str(uuid4()), "started_at_utc": (end - timedelta(seconds=4)).isoformat(),
                        "ended_at_utc": end.isoformat()}
            def activity(value, body, *, profile="compact", status=200, key=None,
                         workspace="tenant-a", label=None):
                before = financial_storage(value)
                result = probes[profile].call("POST", base(value) + "/activity", body,
                    status=status, key=key, workspace=workspace)
                assert financial_storage(value) == before, "activity changed financial revision/head/history"
                if label:
                    receipt["activity_samples"].append({"label": label, "profile": profile,
                        "status": status, "router_elapsed_us": result["router_elapsed_us"],
                        "response_bytes": result["response_bytes"], "phases": result["phases"]})
                return result
            def mutate(pair, tail, bodies, *, wire=True, order=("full", "compact"), sample=None, status=200):
                after = {}
                for profile in order:
                    before = pair[profile]
                    body = bodies(profile, before) if callable(bodies) else bodies
                    previous_storage = storage_signature(before) if status != 200 else None
                    response = probes[profile].call("POST", base(before) + tail +
                        ("?response_view=mutation-v1" if wire else ""),
                        {"expected_revision": before["revision"], **body}, status=status)
                    if status != 200:
                        after[profile] = probes[profile].call("GET", base(before))["body"]
                        compare("invalid mutation atomic rollback", before, after[profile])
                        assert previous_storage == storage_signature(before), "failed mutation appended persistent replay rows"
                        continue
                    persisted = probes[profile].call("GET", base(before))["body"]
                    if wire:
                        after[profile] = reconcile(before, response["body"])
                        compare("delta versus persisted full " + tail, after[profile], persisted)
                    else:
                        # Step responses attach this request's emitted events;
                        # they are not part of the canonical stored replay view.
                        response_view = {key: value for key, value in response["body"].items()
                                         if key != "execution_events"}
                        compare("full response versus persisted full " + tail, response_view, persisted)
                        after[profile] = persisted
                    if sample is not None:
                        receipt["samples"].append({**sample, "profile": profile,
                            "order": list(order), "router_elapsed_us": response["router_elapsed_us"],
                            "stdio_elapsed_ns": response["stdio_elapsed_ns"],
                            "response_bytes": response["response_bytes"], "phases": response["phases"]})
                compare(tail, after["full"], after["compact"])
                return after
            order = {"operation_id": "first-quick", "side": "SELL", "quantity": "0.12",
                     "stop_loss": None, "take_profit": None, "execution_timing": "current_quote"}
            quick = {**init, **order}
            pair = twins("storage correctness")
            original = copy.deepcopy(pair)
            pair = mutate(pair, "/orders/quick", quick)
            assert pair["compact"]["revision"] == original["compact"]["revision"] + 2
            assert pair["compact"]["payload"]["execution"]["pending_market_order"] is None
            check("first quick executes immediately and persists two revisions; compact/full hydration parity")
            for profile in ("full", "compact"):
                path = base(original[profile]) + "/orders/quick?response_view=mutation-v1"
                body = {"expected_revision": original[profile]["revision"], **quick,
                        "operation_id": "stale-operation"}
                first = probes[profile].call("POST", path, body, 409, key="stale-" + profile)
                retry = probes[profile].call("POST", path, body, 409, key="stale-" + profile)
                assert first["response_sha256"] == retry["response_sha256"]
                probes[profile].call("GET", base(pair[profile]), status=404, workspace="tenant-b")
            check("stale exact-byte error retry and cross-workspace denial")
            protect = lambda profile, value: {"operation_id": "protect-first",
                "target_id": value["payload"]["execution"]["position"]["position_id"],
                "stop_loss": "1.12", "take_profit": "1.09"}
            before = copy.deepcopy(pair)
            pair = mutate(pair, "/orders/protection", protect)
            for profile in ("full", "compact"):
                body = {"expected_revision": before[profile]["revision"], **protect(profile, before[profile])}
                # This intentionally creates a receipt after the existing domain operation;
                # only exact API-receipt retries can succeed, duplicate domain IDs cannot.
                probes[profile].call("POST", base(before[profile]) + "/orders/protection?response_view=mutation-v1",
                    body, status=409, key="past-protection-" + profile)
            check("protection parity and stale duplicate cannot append a second event")
            pair = mutate(pair, "/orders/protection", lambda p, v: {
                **protect(p, v), "operation_id": "invalid-protection", "stop_loss": "1.0"}, status=422)
            check("invalid direction rolls back head, events and operation reservation")
            pair = mutate(pair, "/step", {"steps": 3}, wire=False)
            for profile in ("full", "compact"):
                historical = probes[profile].call("GET", base(pair[profile]) + "?cursor_index=1")["body"]
                if profile == "full":
                    expected_history = historical
                else:
                    compare("historical hydration", expected_history, historical)
            check("cold-path step and exact historical cutoff hydration")
            pair = mutate(pair, "/orders/protection", lambda p, v: {
                **protect(p, v), "operation_id": "after-full-step"})
            check("full write then hot write imports the current exact revision")
            pair = mutate(pair, "/orders/close", lambda p, v: {"operation_id": "close-first",
                "target_id": v["payload"]["execution"]["position"]["position_id"]})
            check("close parity")
            pending = twins("zero event reservation")
            pending = mutate(pending, "/execution", init)
            prior = copy.deepcopy(pending)
            pending = mutate(pending, "/orders/market", {**order, "operation_id": "reserved-queue",
                "execution_timing": "next_bar"})
            for profile in pending:
                assert pending[profile]["revision"] == prior[profile]["revision"] + 1
                assert pending[profile]["payload"]["execution"]["event_sequence"] == prior[profile]["payload"]["execution"]["event_sequence"]
                probes[profile].call("POST", base(pending[profile]) + "/orders/market?response_view=mutation-v1",
                    {"expected_revision": pending[profile]["revision"], **order,
                     "operation_id": "reserved-queue", "execution_timing": "next_bar"}, 422)
            with store.connect() as conn:
                reserved = conn.execute("SELECT first_revision,first_event_sequence FROM replay_execution_operations WHERE workspace_id='tenant-a' AND record_id=%s AND operation_id='reserved-queue'", (pending["compact"]["record_id"],)).fetchone()
            assert reserved and reserved["first_revision"] == pending["compact"]["revision"]
            assert reserved["first_event_sequence"] == 0
            check("queued zero-event revision reserves operation ID in indexed storage")
            pending = mutate(pending, "/step", {"steps": 1}, wire=False)
            pending = mutate(pending, "/orders/close", lambda p, v: {"operation_id": "close-queued",
                "target_id": v["payload"]["execution"]["position"]["position_id"]})
            pending = mutate(pending, "/orders/market", {**order, "operation_id": "reserved-queue",
                "execution_timing": "next_bar"}, status=422)
            check("queued next-bar fill parity after zero-event head")
            # Restart only our stdio children; owner API and UI are never touched.
            for profile in tuple(probes):
                probes[profile].close()
                start_probe(profile)
            pair = get(pair)
            pending = get(pending)
            check("fresh-process full hydration matches canonical engine state")
            for profile in ("full", "compact"):
                value = probes[profile].call("GET", base(pair[profile]) + "/metadata")["body"]
                if profile == "full":
                    metadata = value
                else:
                    compare("metadata reader", metadata, value)
                analytics = probes[profile].call("GET", base(pair[profile]) + "/analytics")["body"]
                if profile == "full":
                    expected_analytics = analytics
                else:
                    compare("analytics reader", expected_analytics, analytics)
            check("metadata and analytics readers hydrate compact revisions")
            # A fresh single-mark replay avoids skipping causal Prop feed events.
            from test_ps02_replay_prop_connection import prop_state
            prop_pair = twins("compact Prop reader")
            prop_pair = mutate(prop_pair, "/execution", init)
            prop_pair = mutate(prop_pair, "/step", {"steps": 1}, wire=False)
            prop_pair = mutate(prop_pair, "/orders/quick", {**quick, "operation_id": "prop-open"})
            fed = {}
            for profile in ("full", "compact"):
                session, attempt, phase, resume = prop_state(session_id=uuid4().hex,
                    attempt_id=uuid4().hex, dataset_sha256=dataset_sha)
                attempt = attempt.model_copy(update={"cost_version": init["cost_model"]["version"]})
                store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
                mark = next(event for event in prop_pair[profile]["payload"]["execution"]["ledger"]
                            if event["kind"] == "price_mark")
                feedpath = base(prop_pair[profile]) + f"/prop/sessions/{session.session_id}/attempts/{attempt.attempt_id}/feed"
                feedbody = {"replay_event_sequence": mark["sequence"],
                            "expected_prop_revision": 1, "prop_event_sequence": 1}
                fed[profile] = probes[profile].call("POST", feedpath, feedbody)["body"]
                retry = probes[profile].call("POST", feedpath, feedbody)["body"]
                assert retry["duplicate"] is True
                compare("Prop exact native feed retry", fed[profile], {**retry, "duplicate": False})
            # The operation ID includes lineage IDs by design; compare financial
            # phase/resume semantics, leaving identity hashes scoped to each twin.
            for field in ("phase", "resume_state", "objectives"):
                values = {profile: copy.deepcopy(fed[profile][field]) for profile in ("full", "compact")}
                if field == "resume_state":
                    for profile in values:
                        lifecycle = values[profile]["prop_lifecycle"]
                        assert lifecycle["last_operation_id"] == fed[profile]["prop_event"]["operation_id"]
                        lifecycle["last_operation_id"] = "<lineage-derived-prop-operation>"
                compare("Prop reader " + field, values["full"], values["compact"])
            check("Prop feed reads a compact prefix and preserves financial phase, resume and retry semantics")
            # Branch from a cutoff before this parent-future operation. Child must
            # inherit only IDs in its selected prefix and may reuse the future ID.
            future = mutate(pair, "/orders/quick", {**quick, "operation_id": "parent-future-id"})
            children = {}
            for profile in ("full", "compact"):
                children[profile] = probes[profile].call("POST", base(future[profile]) + "/branch",
                    {"expected_revision": future[profile]["revision"], "cursor_index": 1}, 201)["body"]
            compare("historical branch prefix", children["full"], children["compact"])
            # Close inherited exposure before reusing the excluded future ID.
            if children["compact"]["payload"]["execution"]["position"] is not None:
                children = mutate(children, "/orders/close", lambda p, v: {
                    "operation_id": "child-close", "target_id": v["payload"]["execution"]["position"]["position_id"]})
            children = mutate(children, "/orders/quick", {**quick, "operation_id": "parent-future-id"})
            check("historical branch excludes parent future operation IDs")
            # Successful receipt retry is captured on a fresh operation, including
            # exact response bytes even after a newer revision has committed.
            receipt_pair = twins("successful receipt")
            for profile in ("full", "compact"):
                before = receipt_pair[profile]
                body = {"expected_revision": before["revision"], **quick}
                path = base(before) + "/orders/quick?response_view=mutation-v1"
                first = probes[profile].call("POST", path, body, key="success-" + profile)
                after = probes[profile].call("GET", base(before))["body"]
                probes[profile].call("POST", base(before) + "/orders/protection?response_view=mutation-v1",
                    {"expected_revision": after["revision"], **protect(profile, after)})
                retry = probes[profile].call("POST", path, body, key="success-" + profile)
                assert first["response_sha256"] == retry["response_sha256"]
                assert first["command_id"] == retry["command_id"]
                with store.connect() as conn:
                    saved = conn.execute("SELECT result_text FROM api_commands WHERE command_id=%s", (first["command_id"],)).fetchone()["result_text"]
                assert hashlib.sha256(saved.encode()).hexdigest() == first["response_sha256"]
            check("successful exact-wire receipt remains stable after later writes")

            # Deletion retains every historical revision and its dataset pin.
            deletion = twins("delete compact history")
            deletion = mutate(deletion, "/orders/quick", quick)
            with store.connect() as conn:
                sidecars_before = conn.execute("SELECT count(*) AS count FROM replay_execution_revisions WHERE workspace_id='tenant-a' AND record_id=%s", (deletion["compact"]["record_id"],)).fetchone()["count"]
            for profile in ("full", "compact"):
                prior_activity_body = activity_body()
                prior_activity = activity(deletion[profile], prior_activity_body, profile=profile,
                    key="activity-before-delete-" + profile)
                renamed = probes[profile].call("PATCH", base(deletion[profile]),
                    {"expected_revision": deletion[profile]["revision"], "name": "deleted metadata"})["body"]
                assert renamed["payload"]["name"] == "deleted metadata"
                probes[profile].call("POST", base(renamed) + "/delete",
                    {"expected_revision": renamed["revision"], "confirmation_name": "wrong"}, 422)
                probes[profile].call("POST", base(renamed) + "/delete",
                    {"expected_revision": renamed["revision"], "confirmation_name": "deleted metadata"})
                probes[profile].call("GET", base(renamed), status=404)
                with store.connect() as conn:
                    intervals_before = conn.execute("SELECT count(*) AS count FROM replay_activity_intervals WHERE workspace_id='tenant-a' AND session_id=%s", (renamed["record_id"],)).fetchone()["count"]
                denied = activity(renamed, activity_body(), profile=profile, status=404,
                    key="activity-new-after-delete-" + profile)
                assert denied["body"]["detail"] == "replay_not_found"
                old_receipt = activity(renamed, prior_activity_body, profile=profile,
                    key="activity-before-delete-" + profile)
                assert old_receipt["response_sha256"] == prior_activity["response_sha256"]
                with store.connect() as conn:
                    intervals_after = conn.execute("SELECT count(*) AS count FROM replay_activity_intervals WHERE workspace_id='tenant-a' AND session_id=%s", (renamed["record_id"],)).fetchone()["count"]
                assert intervals_after == intervals_before
            with store.connect() as conn:
                sidecars_after = conn.execute("SELECT count(*) AS count FROM replay_execution_revisions WHERE workspace_id='tenant-a' AND record_id=%s", (deletion["compact"]["record_id"],)).fetchone()["count"]
                historical = conn.execute("SELECT count(*) AS count FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s AND storage_format='replay-execution-v1'", (deletion["compact"]["record_id"],)).fetchone()["count"]
            assert sidecars_after == sidecars_before and historical > 0
            pin = probes["compact"].call("DELETE", "/api/v2/data/datasets/dataset-storage", status=409)["body"]
            assert pin["detail"] == "dataset_in_use"
            check("metadata/delete hydrate compact records; historical certificates survive and dataset pins deny deletion")
            check("deleted replay rejects NEW activity keys; previously committed exact receipt remains replayable without new intervals")

            for stage in stages:
                measured = twins("storage-stage-" + str(stage))
                measured = mutate(measured, "/execution", init)
                remaining = stage
                while remaining:
                    steps = min(1000, remaining)
                    measured = mutate(measured, "/step", {"steps": steps}, wire=False)
                    remaining -= steps
                measured = mutate(measured, "/orders/quick", {**quick, "operation_id": "stage-open"})
                for index in range(args.samples + 1):
                    measured = mutate(measured, "/orders/protection", lambda p, v: {
                        **protect(p, v), "operation_id": "measure-" + str(index),
                        "stop_loss": "1.12" if index % 2 else "1.13"},
                        order=("compact", "full") if index % 2 else ("full", "compact"),
                        sample={"stage_steps": stage, "base_events": measured["compact"]["payload"]["execution"]["event_sequence"],
                                "sample": index, "warmup": index == 0})
                with store.connect() as conn:
                    for profile in ("full", "compact"):
                        value = measured[profile]
                        row = conn.execute("SELECT storage_format,octet_length(payload_json::text) AS payload_bytes,payload_json FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s AND revision=%s", (value["record_id"], value["revision"])).fetchone()
                        events = conn.execute("SELECT count(*) AS count FROM replay_execution_events WHERE workspace_id='tenant-a' AND record_id=%s", (value["record_id"],)).fetchone()["count"]
                        certificate = conn.execute("SELECT octet_length(prefix_json::text) AS bytes FROM replay_execution_revisions WHERE workspace_id='tenant-a' AND record_id=%s AND revision=%s", (value["record_id"], value["revision"])).fetchone()
                        receipt["storage"].append({"stage_steps": stage, "profile": profile,
                            "storage_format": row["storage_format"], "persisted_payload_bytes": row["payload_bytes"],
                            "certificate_bytes": certificate["bytes"] if certificate else 0,
                            "hydrated_bytes": len(json.dumps(value).encode()), "persisted_events": events})
                        if profile == "compact":
                            assert row["storage_format"] == "replay-execution-v1"
                            assert "ledger" not in row["payload_json"]["execution"]
                            assert events == value["payload"]["execution"]["event_sequence"]
                        else:
                            assert row["storage_format"] == "full_snapshot"
                            assert len(row["payload_json"]["execution"]["ledger"]) == value["payload"]["execution"]["event_sequence"]
            check("alternating equivalent workloads preserve financial state without deleting immutable history")
            compact_sizes = [item["persisted_payload_bytes"] for item in receipt["storage"] if item["profile"] == "compact"]
            assert max(compact_sizes) < 20000 and max(compact_sizes) - min(compact_sizes) < 2000
            certificate_sizes = [item["certificate_bytes"] for item in receipt["storage"] if item["profile"] == "compact"]
            assert 0 < min(certificate_sizes) <= max(certificate_sizes) < 20000
            assert max(certificate_sizes) - min(certificate_sizes) < 5000
            check("persisted compact heads remain bounded while hydrated histories grow")

            # Heartbeat admission must depend only on the scoped current revision,
            # never decode/validate a large financial ledger behind the head lock.
            shared_activity = activity_body()
            for profile in ("full", "compact"):
                value = measured[profile]
                initial_financial = financial_storage(value)
                first = activity(value, shared_activity, profile=profile,
                    key="large-activity-first-" + profile, label="large-current-first")
                assert first["body"]["duplicate"] is False
                assert first["body"]["accepted_seconds"] == 4
                retry = activity(value, shared_activity, profile=profile,
                    key="large-activity-first-" + profile, label="large-current-exact-receipt")
                assert retry["response_sha256"] == first["response_sha256"]
                duplicate = activity(value, shared_activity, profile=profile,
                    key="large-activity-new-key-" + profile, label="large-current-domain-duplicate")
                assert duplicate["body"]["duplicate"] is True
                conflict = activity(value, {**shared_activity,
                    "started_at_utc": (datetime.fromisoformat(shared_activity["started_at_utc"]) - timedelta(seconds=1)).isoformat()},
                    profile=profile, status=409, key="large-activity-conflict-" + profile)
                assert conflict["body"]["detail"] == "activity_event_id_conflict"
                invalid_activity = activity_body()
                invalid_activity["ended_at_utc"] = invalid_activity["started_at_utc"]
                activity(value, invalid_activity,
                    profile=profile, status=422, key="large-activity-invalid-" + profile)
                activity(value, activity_body(), profile=profile, status=404, workspace="tenant-b",
                    key="large-activity-tenant-" + profile)
                activity({"record_id": uuid4().hex}, activity_body(), profile=profile, status=404,
                    key="large-activity-missing-" + profile)
                assert financial_storage(value) == initial_financial
                with store.connect() as conn:
                    intervals = conn.execute("SELECT count(*) AS count FROM replay_activity_intervals WHERE workspace_id='tenant-a' AND session_id=%s", (value["record_id"],)).fetchone()["count"]
                assert intervals == 1
            check("large full/compact activity preserves financial head; receipt/domain duplicates, conflicting dates, invalid/tenant/missing requests obey existing contract")

            # A fixture-only broken current-revision pointer must fail closed.
            # Restore that pointer exactly; no immutable history is removed.
            for profile in ("full", "compact"):
                value = measured[profile]
                initial_financial = financial_storage(value)
                with store.connect() as conn:
                    actual = Path(conn.execute("SHOW data_directory").fetchone()["data_directory"])
                    assert actual.resolve() == data.resolve()
                    conn.execute("UPDATE workspace_records SET current_revision=%s WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s", (value["revision"] + 1, value["record_id"]))
                    conn.commit()
                try:
                    denied = activity(value, activity_body(), profile=profile, status=503,
                        key="activity-missing-revision-" + profile)
                    assert denied["body"]["detail"] == "replay_revision_missing"
                finally:
                    with store.connect() as conn:
                        conn.execute("UPDATE workspace_records SET current_revision=%s WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s", (value["revision"], value["record_id"]))
                        conn.commit()
                assert financial_storage(value) == initial_financial
            check("activity fails closed when a present replay head references a missing current revision")

            # SQL-level append-only protection, including no-op UPDATE/DELETE.
            for table in ("replay_execution_events", "replay_execution_operations", "replay_execution_revisions"):
                for statement in (f"UPDATE {table} SET workspace_id=workspace_id WHERE false",
                                  f"DELETE FROM {table} WHERE false", f"TRUNCATE {table}"):
                    try:
                        with store.connect() as conn:
                            actual = Path(conn.execute("SHOW data_directory").fetchone()["data_directory"])
                            assert actual.resolve() == data.resolve()
                            conn.execute(statement)
                            conn.commit()
                    except Exception as error:
                        assert "prefix rows are immutable" in str(error), str(error)
                    else:
                        raise AssertionError("immutable statement succeeded: " + statement)
            check("events, operation reservations and revision certificates reject UPDATE/DELETE/TRUNCATE")

            # Modify only an owned fixture certificate; committed rows are restored
            # exactly afterward, with triggers re-enabled in the same transaction.
            victim = measured["compact"]
            def replace_certificate(column, replacement):
                assert column in {"validator_version", "prefix_json"}
                with store.connect() as conn:
                    actual = Path(conn.execute("SHOW data_directory").fetchone()["data_directory"])
                    assert actual.resolve() == data.resolve()
                    row = conn.execute(f"SELECT {column} FROM replay_execution_revisions WHERE workspace_id='tenant-a' AND record_id=%s AND revision=%s", (victim["record_id"], victim["revision"])).fetchone()
                    conn.execute("ALTER TABLE replay_execution_revisions DISABLE TRIGGER USER")
                    if column == "prefix_json":
                        conn.execute(f"UPDATE replay_execution_revisions SET {column}=%s::jsonb WHERE workspace_id='tenant-a' AND record_id=%s AND revision=%s", (json.dumps(replacement), victim["record_id"], victim["revision"]))
                    else:
                        conn.execute(f"UPDATE replay_execution_revisions SET {column}=%s WHERE workspace_id='tenant-a' AND record_id=%s AND revision=%s", (replacement, victim["record_id"], victim["revision"]))
                    conn.execute("ALTER TABLE replay_execution_revisions ENABLE TRIGGER USER")
                    conn.commit()
                return row[column]
            for column, replacement in (("validator_version", "unknown-validator"), ("prefix_json", {"corrupt": True})):
                original_certificate = replace_certificate(column, replacement)
                try:
                    independent = activity(victim, activity_body(),
                        key="activity-corrupt-certificate-" + column)
                    assert independent["body"]["duplicate"] is False
                    probes["compact"].call("POST", base(victim) + "/orders/protection?response_view=mutation-v1",
                        {"expected_revision": victim["revision"], **protect("compact", victim),
                         "operation_id": "corrupt-" + column}, status=503)
                finally:
                    replace_certificate(column, original_certificate)
                compare("corrupt certificate rollback", victim, probes["compact"].call("GET", base(victim))["body"])
            check("unknown validator and corrupt restored context fail closed without a committed mutation")
            check("activity is independent of a corrupt financial certificate while financial writes remain fail closed")
            # Cold readers must validate the persisted full stream, even though
            # hot transitions trust its immutable prefix. Corrupt an old event,
            # never the head, and restore it exactly after the denial.
            with store.connect() as conn:
                event = conn.execute("SELECT sequence,event_json FROM replay_execution_events WHERE workspace_id='tenant-a' AND record_id=%s ORDER BY sequence LIMIT 1", (victim["record_id"],)).fetchone()
            assert event is not None
            def set_event(value):
                with store.connect() as conn:
                    actual = Path(conn.execute("SHOW data_directory").fetchone()["data_directory"])
                    assert actual.resolve() == data.resolve()
                    conn.execute("ALTER TABLE replay_execution_events DISABLE TRIGGER USER")
                    conn.execute("UPDATE replay_execution_events SET event_json=%s::jsonb WHERE workspace_id='tenant-a' AND record_id=%s AND sequence=%s", (json.dumps(value), victim["record_id"], event["sequence"]))
                    conn.execute("ALTER TABLE replay_execution_events ENABLE TRIGGER USER")
                    conn.commit()
            set_event({**event["event_json"], "balance": "123456789"})
            try:
                probes["compact"].call("GET", base(victim), status=503)
            finally:
                set_event(event["event_json"])
            compare("restored event stream", victim, probes["compact"].call("GET", base(victim))["body"])
            check("cold hydration detects unread-prefix event corruption and exact fixture restoration preserves state")
            assert source_hashes() == receipt["source_sha256"], "source changed during acceptance"
            assert hashlib.sha256(executable.read_bytes()).hexdigest() == receipt["probe_sha256"], "probe changed during acceptance"
            assert all(sample["phases"] for sample in receipt["samples"]), "missing timing instrumentation"
            summary = []
            for stage in stages:
                for profile in ("full", "compact"):
                    samples = [item for item in receipt["samples"] if item["stage_steps"] == stage
                               and item["profile"] == profile and not item["warmup"]]
                    values = sorted(item["router_elapsed_us"] / 1000 for item in samples)
                    summary.append({"stage_steps": stage, "profile": profile, "samples": len(values),
                        "p50_ms": values[math.ceil(len(values) * .5) - 1],
                        "sample_p95_ms": values[math.ceil(len(values) * .95) - 1],
                        "response_bytes": [item["response_bytes"] for item in samples]})
            receipt["summary"] = summary
            receipt["status"] = "PASS"
        except Exception as error:
            receipt["error"] = repr(error)
            raise
        finally:
            for probe in probes.values():
                probe.close()
            if store:
                store.close()
            pg("pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop")
            (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "checks": len(receipt["checks"]),
                      "samples": len(receipt["samples"])}))


if __name__ == "__main__":
    main()
