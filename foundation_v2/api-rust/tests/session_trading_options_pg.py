"""Run session cost HTTP tests in an owned temporary PostgreSQL cluster only."""
from pathlib import Path
import argparse
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
    with tempfile.TemporaryDirectory(prefix='session-cost-fixture-') as directory:
        runtime = Path(directory)
        data = runtime / 'pgdata'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        subprocess.run([str(args.pg_bin / 'initdb.exe'), '-D', str(data), '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8'], check=True, capture_output=True)
        with (runtime / 'postgres.log').open('w') as log:
            process = subprocess.Popen([str(args.pg_bin / 'postgres.exe'), '-D', str(data), '-h', '127.0.0.1', '-p', str(port)], stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                dsn = f'host=127.0.0.1 port={port} user=postgres dbname=postgres'
                for _ in range(100):
                    try:
                        with psycopg.connect(dsn, autocommit=True) as conn:
                            conn.execute('CREATE DATABASE rust_metadata_session_costs')
                        break
                    except psycopg.OperationalError:
                        if process.poll() is not None:
                            raise RuntimeError('fixture PostgreSQL exited')
                        time.sleep(.1)
                else:
                    raise RuntimeError('fixture PostgreSQL startup timed out')
                dsn = f'host=127.0.0.1 port={port} user=postgres dbname=rust_metadata_session_costs'
                PostgresStore(dsn).initialize()
                (runtime / 'artifacts').mkdir()
                env = {**os.environ, 'TW_V2_DATABASE_URL': dsn, 'TW_V2_ARTIFACT_ROOT': str(runtime / 'artifacts'), 'TW_V2_LOCAL_IDENTITY': 'local-owner', 'TW_V2_LOCAL_WORKSPACES': 'tenant-a,tenant-b', 'TW_V2_RUNTIME_PROFILE': 'native', 'TW_V2_REPLAY_STORAGE_PROFILE': 'compact'}
                result = subprocess.run(['cargo', 'test', '--locked', '--test', 'session_trading_options_pg', '--', '--ignored', '--nocapture'], cwd=API, env=env, text=True, capture_output=True)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps({'passed': result.returncode == 0, 'scope': 'disposable PostgreSQL, native compact production routes', 'stdout': result.stdout, 'stderr': result.stderr}, indent=2), encoding='utf-8')
                print(json.dumps({'passed': result.returncode == 0, 'output': str(args.output)}))
                return result.returncode
            finally:
                subprocess.run([str(args.pg_bin / 'pg_ctl.exe'), '-D', str(data), '-m', 'fast', 'stop'], capture_output=True, timeout=20)
                process.wait(timeout=20)


if __name__ == '__main__':
    sys.exit(main())
