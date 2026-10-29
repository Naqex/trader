"""Persisted native engine admission vs Python, in disposable PostgreSQL only."""
from __future__ import annotations

import hashlib
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

FOUNDATION = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(FOUNDATION), str(FOUNDATION.parent)]
from trading_workspace_v2.contracts import CreateEngineResearchJob, DatasetManifest
from trading_workspace_v2 import research
from trading_workspace_v2.research_engine import engine_code_sha256
from rust_runtime_adapter_bootstrap import inspect_adapter


class OracleStore:
    def get_dataset(self, *_):
        return self.manifest

    def get_record_revision(self, *_):
        return {"deleted": False, "payload": self.payload}

    def create_engine_job(self, workspace, dataset, balance, protocol, sha):
        return {"protocol": protocol, "protocol_sha256": sha}


def pin_native_dependencies(expected, descriptor):
    """The native v2 protocol adds installation identity to the Python oracle.

    Financial/domain admission stays compared against Python. Only this additive
    identity field comes from the independently inspected installed file trees.
    """
    protocol = expected['protocol']
    if protocol['engine']['backend'] == 'nautilus':
        protocol['engine']['dependency_sha256'] = descriptor['dependency_sha256']
    canonical = json.dumps(protocol, sort_keys=True, separators=(",", ":")) + "\n"
    expected.update(canonical=canonical, protocol_sha256=hashlib.sha256(canonical.encode()).hexdigest())


def refresh_postgres_oracle(dsn, fixture_path):
    """The real Python store decodes JSONB, including its numeric spelling."""
    import psycopg
    from psycopg.types.json import Jsonb
    path = Path(fixture_path)
    fixture = json.loads(path.read_text(encoding="utf-8"))
    descriptor = json.loads(Path(os.environ["TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY"]).read_text(encoding="utf-8"))
    with psycopg.connect(dsn) as connection:
        for item in fixture["cases"]:
            case = item["input"]
            manifest, payload = connection.execute("SELECT %s::jsonb,%s::jsonb", (Jsonb(case["manifest"]), Jsonb(case["payload"]))).fetchone()
            store = OracleStore()
            store.manifest = DatasetManifest.model_validate(manifest)
            store.payload = payload
            request = CreateEngineResearchJob.model_validate(case["body"])
            with patch.object(research, "runtime_ready", return_value=True), \
                 patch.object(research, "runtime_identity", return_value=descriptor["runtime_identity"]):
                try:
                    expected = research.ResearchService(store, None).create_engine_job(workspace_id="tenant-a", request=request,
                        walk_forward=request.walk_forward, parameter_space=request.parameter_space, max_trials=request.max_trials)
                    pin_native_dependencies(expected, descriptor)
                except PermissionError as error:
                    expected = {"error": str(error), "status": 403}
                except ValueError as error:
                    expected = {"error": str(error), "status": 422}
            item["expected"] = expected
    path.write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=FOUNDATION / "evidence/rust-native-20261017/runtime/engine-pg")
    args=parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source = FOUNDATION / "api-rust/tests/fixtures/research_execution/engine.json"
    corpus = json.loads(source.read_text(encoding="utf-8"))
    descriptor = inspect_adapter()
    code_hash = engine_code_sha256()
    cases = []
    for item in corpus:
        case = item["input"]
        store = OracleStore()
        store.manifest = DatasetManifest.model_validate(case["manifest"])
        store.payload = case["payload"]
        request = CreateEngineResearchJob.model_validate(case["body"])
        service = research.ResearchService(store, None)
        # The installed runtime is probed once above. Admission itself does no
        # Python process launch, matching the Rust descriptor contract.
        with patch.object(research, "runtime_ready", return_value=True), \
             patch.object(research, "runtime_identity", return_value=descriptor["runtime_identity"]):
            try:
                expected = service.create_engine_job(workspace_id="tenant-a", request=request,
                    walk_forward=request.walk_forward, parameter_space=request.parameter_space,
                    max_trials=request.max_trials)
                canonical = json.dumps(expected["protocol"], sort_keys=True, separators=(",", ":")) + "\n"
                assert hashlib.sha256(canonical.encode()).hexdigest() == expected["protocol_sha256"]
                pin_native_dependencies(expected, descriptor)
            except PermissionError as error:
                expected = {"error": str(error), "status": 403}
            except ValueError as error:
                expected = {"error": str(error), "status": 422}
        cases.append({"input": case, "expected": expected})
    fixture = {"engine_code_sha256": code_hash, "cases": cases}
    (output / "oracle.json").write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="tw-engine-capability-") as directory:
        capability = Path(directory) / "scientific-adapter-capability.json"
        capability.write_text(json.dumps(descriptor), encoding="utf-8")
        env = dict(os.environ, TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY=str(capability),
                   TW_RUST_RUNTIME_TEST_FILTER="research_jobs::tests::postgres_engine_admission_differential",
                   TW_RUST_ENGINE_PG_ORACLE=str(output / "oracle.json"))
        completed = subprocess.run([sys.executable, str(FOUNDATION / "scripts/rust_runtime_parity.py")],
                                   env=env, text=True, encoding="utf-8", capture_output=True, timeout=900)
    (output / "test.log").write_text(completed.stdout + completed.stderr, encoding="utf-8")
    receipt = {"disposable": True, "cases": len(cases), "successful": sum("protocol" in c["expected"] for c in cases),
               "rejected": sum("error" in c["expected"] for c in cases), "exit_code": completed.returncode,
               "native_protocol_extension":{"engine.dependency_sha256":descriptor['dependency_sha256']}}
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt))
    if completed.returncode:
        print((completed.stdout + completed.stderr)[-6000:])
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
