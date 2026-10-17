"""Native research/schema tests against an owned disposable PostgreSQL cluster only."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

FOUNDATION = Path(__file__).resolve().parents[1]
PG_BIN = Path(os.environ.get("TW_COMMAND_TEST_PG_BIN", "D:/ANNAM/TradingWorkspace/planning/mt5-tradingview-backtester/research/foundation-validation/20260921T115933Z-315e8ddd/pg-dist/pgsql/bin"))


def main():
    if not (PG_BIN / "initdb.exe").is_file():
        raise SystemExit("disposable PostgreSQL binary unavailable")
    with tempfile.TemporaryDirectory(prefix="tw-rust-runtime-pg-") as temporary:
        root = Path(temporary)
        data = root / "data"
        artifacts = root / "artifacts"
        artifacts.mkdir()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        def pg(name, *args):
            subprocess.run([str(PG_BIN / name), *args], check=True, stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL, timeout=60,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

        pg("initdb.exe", "-D", str(data), "-A", "trust", "-U", "rust_runtime_fixture", "--encoding=UTF8", "--locale=C")
        started = False
        try:
            pg("pg_ctl.exe", "-D", str(data), "-l", str(root / "postgres.log"), "-o",
               f"-h 127.0.0.1 -p {port} -c max_connections=30 -c shared_buffers=32MB", "-w", "start")
            started = True
            pg("createdb.exe", "-h", "127.0.0.1", "-p", str(port), "-U", "rust_runtime_fixture", "rust_runtime_fixture")
            env = dict(os.environ)
            env.update(TW_RUST_RUNTIME_TEST_DSN=f"host=127.0.0.1 port={port} user=rust_runtime_fixture dbname=rust_runtime_fixture",
                       TW_RUST_RUNTIME_DISPOSABLE="1", TW_RUST_RUNTIME_TEST_ARTIFACTS=str(artifacts))
            # No inherited application DSN can select a database for these tests.
            env.pop("TW_V2_DATABASE_URL", None)
            if env.get("TW_RUST_ENGINE_PG_ORACLE"):
                from rust_engine_admission_parity import refresh_postgres_oracle
                refresh_postgres_oracle(env["TW_RUST_RUNTIME_TEST_DSN"], env["TW_RUST_ENGINE_PG_ORACLE"])
            completed = subprocess.run(["cargo", "test", "--locked", "--manifest-path", str(FOUNDATION / "api-rust/Cargo.toml"),
                                        "--lib", os.environ.get("TW_RUST_RUNTIME_TEST_FILTER", "research_jobs::tests::postgres_admission_cancel_and_schema"), "--", "--ignored", "--nocapture"],
                                       env=env, check=False, timeout=900)
            print(json.dumps({"test": "native-research-schema-parity", "disposable": True, "exit_code": completed.returncode}))
            return completed.returncode
        finally:
            if started:
                pg("pg_ctl.exe", "-D", str(data), "-m", "fast", "-w", "stop")
                if (data / "postmaster.pid").exists():
                    raise RuntimeError("owned disposable PostgreSQL did not stop")


if __name__ == "__main__":
    raise SystemExit(main())
