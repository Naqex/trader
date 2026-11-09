"""Crash and restore a synthetic Demo ledger in an owned PostgreSQL cluster.

No owner DSN, SDK, terminal, network provider or broker credentials are used.
The existing Rust grant fixture creates the data; existing backup helpers restore
it. This is not an unattended-duration or whole-machine recovery qualification.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
import psycopg
from psycopg import sql
from trading_workspace_v2.artifact_backup import create_backup_bundle, restore_backup_files
from trading_workspace_v2.artifacts import sha256_file
from scripts.local_owner_access import private_directory, require_local_tree


def table_digests(dsn):
    with psycopg.connect(dsn, connect_timeout=5) as db:
        db.execute('SET TRANSACTION READ ONLY')
        names = [r[0] for r in db.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")]
        result = {}
        for name in names:
            rows = db.execute(sql.SQL('SELECT row_to_json(t)::text FROM {} t '
                'ORDER BY row_to_json(t)::text').format(sql.Identifier(name))).fetchall()
            result[name] = {'rows': len(rows), 'sha256': hashlib.sha256(
                ''.join(r[0] + '\n' for r in rows).encode()).hexdigest()}
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    output = args.output_dir.absolute()
    require_local_tree(output)
    for name in ('initdb', 'pg_ctl', 'pg_dump', 'pg_restore', 'createdb'):
        if not (args.pg_bin / (name + '.exe')).is_file():
            raise ValueError('Windows PostgreSQL tools required: ' + name)
    output.mkdir(exist_ok=False)
    private_directory(output)
    receipt = {'schema': 'demo-recovery-rehearsal-v1', 'status': 'running',
        'started_at_utc': datetime.now(timezone.utc).isoformat(),
        'owner_runtime_touched': False, 'broker_commands': 0,
        'unattended_duration_acceptance': False, 'checks': {}}
    started_at = time.monotonic()
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'TW_'))}
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

    def run(command, label, *, child_env=env, timeout=180):
        with (output / (label + '.log')).open('ab') as log:
            result = subprocess.run(command, env=child_env, cwd=V2, stdout=log,
                stderr=log, timeout=timeout, creationflags=flags)
        if result.returncode:
            raise RuntimeError('fixture subprocess failed: ' + label)

    def pg(name, arguments, label):
        run([str(args.pg_bin / (name + '.exe')), *arguments], label)

    def native(test, dsn, label):
        native_env = dict(env, TW_RUST_RUNTIME_TEST_DSN=dsn, TW_RUST_RUNTIME_DISPOSABLE='1')
        run(['cargo', 'test', '--locked', '--manifest-path', str(V2 / 'api-rust/Cargo.toml'),
            '--lib', 'automation_grants::tests::' + test, '--', '--exact', '--ignored', '--nocapture'],
            label, child_env=native_env, timeout=900)
        if 'test result: ok. 1 passed;' not in (output / (label + '.log')).read_text(errors='replace'):
            raise RuntimeError('expected native fixture did not run: ' + label)

    try:
        with tempfile.TemporaryDirectory(prefix='owned-demo-recovery-', dir=output) as folder:
            root = Path(folder).resolve()
            if not root.is_relative_to(output.resolve()):
                raise ValueError('fixture root escaped output directory')
            data = root / 'pgdata'
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            # The reused grant fixture requires this exact disposable identity.
            user, database = 'rust_runtime_fixture', 'rust_runtime_fixture'
            common = ['-h', '127.0.0.1', '-p', str(port), '-U', user]
            dsn = f'host=127.0.0.1 port={port} user={user} dbname={database}'
            pg('initdb', ['-D', str(data), '-A', 'trust', '-U', user,
                '--encoding=UTF8', '--locale=C'], 'initdb')

            def start():
                pg('pg_ctl', ['-D', str(data), '-l', str(output / 'postgres.log'), '-o',
                    f'-h 127.0.0.1 -p {port} -c max_connections=30 -c shared_buffers=32MB',
                    '-w', 'start'], 'start')

            try:
                start()
                pg('createdb', [*common, database], 'createdb')
                native('postgres_grant_lifecycle_reservations_settlement_and_revocation', dsn, 'seed-native')
                before = table_digests(dsn)
                for table in ('automation_grants', 'automation_grant_requests', 'mt5_demo_requests'):
                    if before[table]['rows'] == 0:
                        raise RuntimeError('empty recovery fixture: ' + table)
                # No application/worker is running; the synthetic DB and files
                # are quiesced together, unlike an uncoordinated live directory copy.
                artifacts = root / 'artifacts'
                artifacts.mkdir()
                artifact = artifacts / 'system-fixture.json'
                artifact.write_text('{"purpose":"recovery_fixture","broker_access":false}\n')
                dump = root / 'metadata.dump'
                pg('pg_dump', [*common, '-Fc', '--file', str(dump), database], 'dump')
                bundle = output / 'bundle'
                create_backup_bundle(artifacts, dump, bundle,
                    artifact_references={artifact.name: sha256_file(artifact)},
                    snapshot_id='demo-recovery-fixture', mutations_quiesced=True)
                pg('pg_ctl', ['-D', str(data), '-m', 'immediate', '-w', 'stop'], 'crash')
                start()
                if table_digests(dsn) != before:
                    raise RuntimeError('committed ledger differs after crash recovery')
                receipt['checks']['committed_rows_survive_immediate_stop'] = True
                native('postgres_recovered_grants_remain_fenced', dsn, 'after-crash-native')
                receipt['checks']['revoked_expired_grants_denied_after_crash'] = True
                restore_start = time.monotonic()
                restored_dump = restore_backup_files(bundle, root / 'restored-files')
                restored_db = 'demo_recovery_restored'
                pg('createdb', [*common, restored_db], 'create-restored')
                pg('pg_restore', [*common, '--single-transaction', '--exit-on-error',
                    '--no-owner', '--no-privileges', '-d', restored_db, str(restored_dump)], 'restore')
                restored_dsn = f'host=127.0.0.1 port={port} user={user} dbname={restored_db}'
                if table_digests(restored_dsn) != before:
                    raise RuntimeError('restored ledger differs from quiesced backup')
                receipt['checks']['all_table_counts_and_hashes_restored'] = True
                receipt['restore_fixture_seconds'] = round(time.monotonic() - restore_start, 3)
                native('postgres_recovered_grants_remain_fenced', restored_dsn, 'after-restore-native')
                receipt['checks']['revoked_expired_grants_denied_after_restore'] = True
                receipt['tables'] = before
            finally:
                if (data / 'postmaster.pid').exists():
                    pg('pg_ctl', ['-D', str(data), '-m', 'fast', '-w', 'stop'], 'cleanup')
                if (data / 'postmaster.pid').exists():
                    raise RuntimeError('owned fixture PostgreSQL still running')
                receipt['checks']['owned_cluster_stopped'] = True
        receipt['status'] = 'passed'
        return 0
    except Exception as exc:
        receipt.update(status='failed', error_type=type(exc).__name__)
        raise
    finally:
        receipt['elapsed_seconds'] = round(time.monotonic() - started_at, 3)
        receipt['finished_at_utc'] = datetime.now(timezone.utc).isoformat()
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({k: receipt[k] for k in ('status', 'checks', 'elapsed_seconds', 'broker_commands')}))


if __name__ == '__main__':
    raise SystemExit(main())
