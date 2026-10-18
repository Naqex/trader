"""Exercise the actual Windows restart wrapper with disposable PostgreSQL and ports."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

import psycopg

from run_api_platform import process_identity
from rust_runtime_lifecycle_acceptance import PG_DEFAULT, port

V2 = Path(__file__).resolve().parents[1]
WRAPPER = V2.parent / "scripts/restart_offline_api.ps1"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path, default=PG_DEFAULT)
    parser.add_argument("--bin-dir", type=Path, default=V2 / "api-rust/target/native-candidate/release")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    shell = shutil.which("powershell.exe")
    assert shell, "Windows PowerShell is required"
    binary = args.bin_dir.resolve()
    paths = [WRAPPER, V2 / "scripts/run_api_platform.py", Path(__file__).resolve(),
             *(binary / name for name in ("trading-workspace-api.exe", "rust_runtime_admin.exe", "rust_research_worker.exe"))]
    def fingerprints():
        return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    initial = fingerprints()
    checks = []
    receipt = {"schema": "native-restart-wrapper-acceptance-v1", "passed": False,
               "disposable": True, "owner_runtime_touched": False, "checks": checks}
    def record(name, **detail):
        checks.append(dict(name=name, passed=True, **detail))
        print(json.dumps(checks[-1]), flush=True)
    try:
        with tempfile.TemporaryDirectory(prefix="native restart fixture ") as folder:
            root = Path(folder)
            data, artifacts, manifest = root / "pgdata", root / "artifacts", root / "native/owner.json"
            artifacts.mkdir()
            pgport, apiport = port(), port()
            database = "native_restart_fixture"
            dsn = f"host=127.0.0.1 port={pgport} user=fixture dbname={database}"
            env = {key: value for key, value in os.environ.items() if not key.startswith("TW_V2_")}
            env["TW_V2_DATABASE_URL"] = dsn
            # Explicit full/compact CLI must override an inherited storage choice.
            env["TW_V2_REPLAY_STORAGE_PROFILE"] = "compact"
            common = ["-Port", str(apiport), "-DatabaseName", database, "-ArtifactRoot", str(artifacts),
                      "-ManifestPath", str(manifest), "-BinaryDirectory", str(binary), "-DownloadEngine", "none"]
            def wrapper(label, actions=(), profile="native", storage="compact", success=True, options=None):
                command = [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(WRAPPER),
                           "-RuntimeProfile", profile, "-ReplayStorageProfile", storage, *(common if options is None else options), *actions]
                # Windows descendants can retain inherited pipe handles after the
                # wrapper exits. Files let us wait only for the wrapper process.
                with (output / f"{label}.out.log").open("w", encoding="utf-8") as stdout, \
                     (output / f"{label}.err.log").open("w", encoding="utf-8") as stderr:
                    result = subprocess.run(command, env=env, cwd=V2, stdout=stdout, stderr=stderr,
                                            timeout=115, creationflags=flags)
                assert (result.returncode == 0) == success, f"{label}: inspect retained logs"
                record(label, returncode=result.returncode)
                return result
            def state():
                return json.loads(manifest.read_text(encoding="utf-8"))
            def alive(value):
                assert all(process_identity(entry["pid"]) == entry for entry in value["processes"].values())
            def stop(profile, storage):
                if not manifest.is_file() or state().get("stopped"):
                    return
                value = state()
                command = [sys.executable, "-B", str(V2 / "scripts/run_api_platform.py"),
                           "--runtime-profile", profile, "--replay-storage-profile", storage,
                           "--port", str(apiport), "--database-name", database, "--artifact-root", str(artifacts),
                           "--manifest", str(manifest), "--download-engine", "none", "--rust-binary",
                           str(binary / "trading-workspace-api.exe"), "--rust-research-binary",
                           str(binary / "rust_research_worker.exe"), "--rust-admin-binary",
                           str(binary / "rust_runtime_admin.exe"), "--stop"]
                result = subprocess.run(command, env=env, cwd=V2, capture_output=True, text=True, timeout=65, creationflags=flags)
                (output / f"stop-{profile}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
                assert result.returncode == 0, "fixture owned shutdown failed"
                assert all(process_identity(entry["pid"]) != entry for entry in value["processes"].values())
            subprocess.run([str(args.pg_bin / "initdb.exe"), "-D", str(data), "-A", "trust", "-U", "fixture",
                            "--encoding=UTF8", "--locale=C"], check=True, capture_output=True, creationflags=flags)
            profile, storage = "native", "compact"
            with (output / "postgres.log").open("w", encoding="utf-8") as pglog:
                pg = subprocess.Popen([str(args.pg_bin / "postgres.exe"), "-D", str(data), "-h", "127.0.0.1", "-p", str(pgport)],
                                      stdout=pglog, stderr=pglog, creationflags=flags)
                try:
                    for _ in range(100):
                        try:
                            with psycopg.connect(f"host=127.0.0.1 port={pgport} user=fixture dbname=postgres", autocommit=True, connect_timeout=1) as conn:
                                conn.execute(f"CREATE DATABASE {database}")
                            break
                        except psycopg.OperationalError:
                            assert pg.poll() is None
                            time.sleep(.1)
                    else:
                        raise AssertionError("fixture PostgreSQL startup timeout")
                    wrapper("pending-check-refused", ("-CheckOnly",), success=False)
                    wrapper("migration-backup-gate", ("-ApplyMigration",), success=False)
                    assert not manifest.exists()
                    with psycopg.connect(dsn) as conn:
                        assert conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[0] == 0
                    wrapper("native-migration-start", ("-ApplyMigration", "-BackupConfirmed"))
                    first = state()
                    assert first["ready"] and first["runtime_profile"] == "native" and first["replay_storage_profile"] == "compact"
                    assert set(first["processes"]) == {"supervisor", "research", "api"}
                    alive(first)
                    with urlopen(f"http://127.0.0.1:{apiport}/health/ready", timeout=3) as response:
                        assert json.load(response)["command_worker"] == "not_required"
                    wrapper("other-profile-refused", ("-CheckOnly",), profile="compatibility", storage="full", success=False)
                    alive(first)
                    checkpoint = artifacts / "qdm/fixture/job.json"
                    checkpoint.parent.mkdir(parents=True)
                    checkpoint.write_text('{"status":"running"}', encoding="utf-8")
                    wrapper("active-download-refused", success=False)
                    alive(first)
                    checkpoint.unlink()
                    stale = json.loads(json.dumps(first))
                    stale["processes"]["api"]["created"] += 1
                    manifest.write_text(json.dumps(stale), encoding="utf-8")
                    try:
                        wrapper("stale-creation-refused", success=False)
                        alive(first)
                        assert not Path(first["stop_file"]).exists()
                    finally:
                        manifest.write_text(json.dumps(first), encoding="utf-8")
                    wrapper("native-restart")
                    second = state()
                    assert second["run_id"] != first["run_id"] and second["ready"]
                    assert all(process_identity(entry["pid"]) != entry for entry in first["processes"].values())
                    alive(second)
                    foreign_port = port()
                    fixture = "import socket,sys,time;s=socket.socket();s.bind(('127.0.0.1',int(sys.argv[1])));s.listen();print('ready',flush=True);time.sleep(120)"
                    foreign = subprocess.Popen([sys.executable, "-c", fixture, str(foreign_port)], stdout=subprocess.PIPE, creationflags=flags)
                    try:
                        assert foreign.stdout.readline().strip() == b"ready"
                        foreign_identity = process_identity(foreign.pid)
                        foreign_options = list(common)
                        foreign_options[1] = str(foreign_port)
                        foreign_options[foreign_options.index("-ManifestPath") + 1] = str(root / "foreign/owner.json")
                        wrapper("foreign-listener-refused", success=False, options=foreign_options)
                        assert process_identity(foreign.pid) == foreign_identity
                        alive(second)
                    finally:
                        foreign.kill()
                        foreign.wait(timeout=5)
                        foreign.stdout.close()
                    (output / "native-ready-manifest.json").write_text(json.dumps(second, indent=2), encoding="utf-8")
                    stop(profile, storage)
                    profile, storage = "compatibility", "full"
                    wrapper("compatibility-start", profile=profile, storage=storage)
                    compatibility = state()
                    assert compatibility["runtime_profile"] == profile and compatibility["replay_storage_profile"] == "full"
                    assert set(compatibility["processes"]) == {"supervisor", "domain", "research", "api"}
                    alive(compatibility)
                    stop(profile, storage)
                    record("owned-drains-complete")
                finally:
                    try:
                        stop(profile, storage)
                    finally:
                        if manifest.parent.exists():
                            for path in manifest.parent.glob("*.log"):
                                shutil.copyfile(path, output / path.name)
                        subprocess.run([str(args.pg_bin / "pg_ctl.exe"), "-D", str(data), "-m", "fast", "stop"], capture_output=True, timeout=20, creationflags=flags)
                        pg.wait(timeout=20)
        unchanged = initial == fingerprints()
        receipt.update(passed=unchanged, source_and_binaries_unchanged=unchanged, fingerprints=initial)
        assert receipt["source_and_binaries_unchanged"]
    finally:
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
