"""Create and destroy an owned PostgreSQL fixture for native session preset CRUD."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time

API = Path(__file__).resolve().parents[1]
V2 = API.parent
sys.path[:0] = [str(V2), str(V2.parent)]
import psycopg
from trading_workspace_v2.store import PostgresStore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pg-bin', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sources = [API / 'src/session_presets.rs', API / 'tests/session_presets_pg.rs', Path(__file__),
               API / 'src/lib.rs', API / 'src/commands.rs', API / 'src/rust_runtime.rs',
               API / 'src/native_mutation.rs', API / 'src/session_trading_options.rs',
               V2 / 'migrations/0007_session_presets.sql']
    fingerprints = {str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    with tempfile.TemporaryDirectory(prefix='session-presets-fixture-') as directory:
        runtime = Path(directory)
        data = runtime / 'pgdata'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        subprocess.run([str(args.pg_bin / 'initdb.exe'), '-D', str(data), '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8'], check=True, capture_output=True, creationflags=flags)
        with (runtime / 'postgres.log').open('w') as log:
            process = subprocess.Popen([str(args.pg_bin / 'postgres.exe'), '-D', str(data), '-h', '127.0.0.1', '-p', str(port)], stdout=log, stderr=log, creationflags=flags)
            try:
                dsn = f'host=127.0.0.1 port={port} user=postgres dbname=postgres'
                for _ in range(100):
                    try:
                        with psycopg.connect(dsn, autocommit=True) as conn:
                            conn.execute('CREATE DATABASE rust_session_presets_crud')
                        break
                    except psycopg.OperationalError:
                        if process.poll() is not None:
                            raise RuntimeError('fixture PostgreSQL exited')
                        time.sleep(.1)
                else:
                    raise RuntimeError('fixture PostgreSQL startup timed out')
                dsn = f'host=127.0.0.1 port={port} user=postgres dbname=rust_session_presets_crud'
                store = PostgresStore(dsn)
                store.initialize()
                store.close()
                (runtime / 'artifacts').mkdir()
                env = {key: value for key, value in os.environ.items() if not key.startswith('TW_V2_')}
                env.update(TW_V2_DATABASE_URL=dsn, TW_V2_ARTIFACT_ROOT=str(runtime / 'artifacts'),
                           TW_V2_LOCAL_IDENTITY='local-owner', TW_V2_LOCAL_WORKSPACES='tenant-a,tenant-b',
                           TW_V2_RUNTIME_PROFILE='native', TW_V2_RUST_REQUESTS_PER_MINUTE='1000')
                result = subprocess.run(['cargo', 'test', '--locked', '--test', 'session_presets_pg', '--', '--ignored', '--nocapture'], cwd=API, env=env, text=True, capture_output=True, creationflags=flags)
                unchanged = fingerprints == {str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps({'passed': result.returncode == 0 and unchanged,
                    'scope': 'owned disposable PostgreSQL; real native Router, auth, idempotency and concurrent revision/count admission',
                    'owner_runtime_touched': False, 'source_unchanged': unchanged, 'source_sha256': fingerprints,
                    'stdout': result.stdout, 'stderr': result.stderr}, indent=2), encoding='utf-8')
                print(json.dumps({'passed': result.returncode == 0 and unchanged, 'output': str(args.output)}))
                return result.returncode if result.returncode else (0 if unchanged else 1)
            finally:
                subprocess.run([str(args.pg_bin / 'pg_ctl.exe'), '-D', str(data), '-m', 'fast', 'stop'], capture_output=True, timeout=20, creationflags=flags)
                process.wait(timeout=20)


if __name__ == '__main__':
    sys.exit(main())
