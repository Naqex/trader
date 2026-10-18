"""Quiesced synthetic backup -> separate restore -> full replay compatibility.

Never accepts an external DSN or artifact root. Every process/database belongs to
the temporary cluster created here; the original source is retained unchanged.
"""
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
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2.parent), str(V2), str(V2 / 'tests')]
import psycopg
from psycopg.rows import dict_row
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.artifact_backup import create_backup_bundle, restore_backup_files
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from test_replay_execution_core import initial_state
from test_ps02_replay_prop_connection import prop_state
from rust_replay_service_acceptance import PG, norm


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bin-dir', type=Path, required=True)
    parser.add_argument('--exercise-marker-fallback', action='store_true')
    args = parser.parse_args()
    out, binary = args.output.resolve(), args.bin_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    receipt = {'status': 'FAIL', 'checks': [], 'scope': 'owned synthetic cluster and restored target only',
               'exercise_marker_fallback': args.exercise_marker_fallback,
               'limitations': ['Same-schema compatibility only; frozen older binaries cannot read the new schema.',
                               'Short recovery rehearsal, not a production cutover or long-duration soak.']}
    def hashes():
        paths = [*sorted((V2 / 'api-rust/src').rglob('*.rs')), *sorted((V2 / 'migrations').glob('*.sql')),
                 *sorted((V2 / 'trading_workspace_v2').rglob('*.py')), Path(__file__), V2 / 'scripts/run_api_platform.py']
        return {str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    receipt['source_sha256'] = hashes()
    executables = [binary / 'trading-workspace-api.exe', binary / 'rust_runtime_admin.exe',
                   binary / 'examples/rust_replay_mutation_probe.exe']
    receipt['binary_sha256'] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in executables}
    children, handles = [], []
    def check(name, **details):
        receipt['checks'].append({'name': name, **details})
        print(name, flush=True)
    def run(command, env=None, success=True, label='command', timeout=60):
        # pg_ctl starts a Windows shell which inherits handles. Pipes can keep
        # communicate() waiting for the database lifetime after pg_ctl exits.
        stdout, stderr = out / (label + '.out.log'), out / (label + '.err.log')
        with stdout.open('w', encoding='utf-8') as output, stderr.open('w', encoding='utf-8') as errors:
            result = subprocess.run([str(value) for value in command], env=env, cwd=V2,
                                    stdout=output, stderr=errors, timeout=timeout, creationflags=flags)
        result.stdout, result.stderr = stdout.read_text(encoding='utf-8'), stderr.read_text(encoding='utf-8')
        assert (result.returncode == 0) == success, (label, result.stderr[-3000:])
        return result
    with tempfile.TemporaryDirectory(prefix='rust-storage-rollback-') as temporary:
        work = Path(temporary)
        data, artifact_root = work / 'pg', work / 'artifacts'
        pgport = port()
        source, target = 'rs_source_' + uuid4().hex, 'rs_restore_' + uuid4().hex
        def dsn(database): return f'host=127.0.0.1 port={pgport} user=fixture dbname={database}'
        def connect(database): return psycopg.connect(dsn(database), row_factory=dict_row, connect_timeout=5)
        clean = {key: value for key, value in os.environ.items() if not key.startswith('TW_V2_')}
        def environment(database, root, profile='native'):
            return {**clean, 'TW_V2_DATABASE_URL': dsn(database), 'TW_V2_ARTIFACT_ROOT': str(root),
                    'TW_V2_RUNTIME_PROFILE': profile, 'TW_V2_REPLAY_STORAGE_PROFILE': 'compact',
                    'TW_V2_DOWNLOAD_ENGINE': 'none', 'TW_V2_LOCAL_WORKSPACES': 'tenant-a',
                    'TW_V2_LOCAL_IDENTITY': 'local-owner', 'TW_V2_RUST_BIND': '127.0.0.1:0',
                    'TW_V2_OPENAPI_PATH': str(V2 / 'contracts/openapi.json'),
                    'PYTHONPATH': os.pathsep.join([str(V2), str(V2.parent)])}
        def start_probe(env, label):
            log = (out / (label + '.log')).open('w', encoding='utf-8'); handles.append(log)
            child = subprocess.Popen([str(executables[2])], env=env, cwd=V2, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8', creationflags=flags)
            children.append(child)
            return child
        def stop_probe(child):
            child.stdin.close()
            assert child.wait(timeout=20) == 0
        def stop_supervisor():
            try:
                if args.exercise_marker_fallback:
                    raise RuntimeError('injected guarded-stop rejection in owned fixture')
                run([*launch, '--stop'], rejected, label='compatibility-stop')
            except Exception:
                # Only the manifest generated inside this private fixture may
                # supply a fallback marker. Let the supervisor reap its children.
                owned = json.loads(shutdown_manifest.read_text(encoding='utf-8'))
                run_id = owned.get('run_id', '')
                assert len(run_id) == 32 and all(c in '0123456789abcdef' for c in run_id)
                marker = work / f'platform-{run_id}.stop'
                assert owned['project'] == str(V2.parent.resolve()) and owned['port'] == apiport
                assert owned['stop_file'] == str(marker.resolve())
                marker.write_text('stop\n', encoding='ascii')
            return supervisor.wait(timeout=55)
        def request(child, method, path, body=None, status=200, key=None):
            item = {'method': method, 'path': path, 'workspace': 'tenant-a'}
            if body is not None: item['body'] = body
            if key: item['key'] = key
            child.stdin.write(json.dumps(item) + '\n'); child.stdin.flush()
            line = child.stdout.readline()
            assert line, 'probe exited; inspect retained logs'
            result = json.loads(line)
            assert result['status'] == status, result
            return result
        def snapshot(database):
            with connect(database) as conn:
                revisions = conn.execute("SELECT * FROM workspace_record_revisions ORDER BY workspace_id,kind,record_id,revision").fetchall()
                heads = conn.execute("SELECT * FROM workspace_records ORDER BY workspace_id,kind,record_id").fetchall()
                commands = conn.execute("SELECT * FROM api_commands ORDER BY command_id").fetchall()
                extra = {}
                for table in ['replay_execution_revisions', 'replay_execution_events', 'replay_execution_operations',
                              'prop_sessions', 'prop_session_revisions', 'prop_attempts', 'prop_attempt_revisions', 'prop_mutation_receipts']:
                    extra[table] = sorted(conn.execute('SELECT * FROM ' + table).fetchall(), key=lambda row: json.dumps(row, sort_keys=True, default=str))
            return {'revisions': revisions, 'heads': heads, 'commands': commands, 'extra': extra}
        def digest(value): return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()
        run([PG / 'initdb.exe', '-D', data, '-U', 'fixture', '-A', 'trust', '--locale=C', '--encoding=UTF8'], label='initdb')
        run([PG / 'pg_ctl.exe', '-D', data, '-l', work / 'pg.log', '-o', f'-h 127.0.0.1 -p {pgport}', '-w', 'start'], label='postgres-start')
        supervisor = None
        try:
            with psycopg.connect(dsn('postgres'), autocommit=True, connect_timeout=5) as conn:
                conn.execute('CREATE DATABASE ' + source)
                conn.execute('CREATE DATABASE ' + target)
            store = PostgresStore(dsn(source)); store.initialize(); store.ensure_workspace('tenant-a')
            artifacts = ArtifactStore(artifact_root)
            rows = [{'timestamp': 1767225600 + i * 60, 'open': 1.1, 'high': 1.1002,
                     'low': 1.0998, 'close': 1.1, 'volume': 100} for i in range(40)]
            path, sha = artifacts.write_dataset('tenant-a', 'restore-bars', rows)
            spec = initial_state().instrument_spec
            store.put_dataset(DatasetManifest(dataset_id='restore-bars', workspace_id='tenant-a',
                source=DatasetSource(source_id='storage-restore', provider='synthetic', instrument_mapping={'EURUSD': 'EURUSD'},
                    license_use='fixture', retrieved_at_utc='2026-01-01T00:00:00Z', export_settings='owned'),
                instrument_id='EURUSD', timeframe='M1', timeframe_seconds=60, instrument_spec=spec,
                row_count=len(rows), first_timestamp=rows[0]['timestamp'], last_timestamp=rows[-1]['timestamp'],
                artifact_path=path, artifact_sha256=sha, created_at_utc='2026-01-01T00:00:00Z'))
            init = {'instrument_spec': spec, 'cost_model': initial_state().cost_model,
                    'spread_price': '0.0002', 'timeframe_seconds': 60, 'starting_balance': '100000'}
            order = {'operation_id': 'restore-sell', 'side': 'SELL', 'quantity': '0.12',
                     'stop_loss': None, 'take_profit': None, 'execution_timing': 'current_quote'}
            env = environment(source, artifact_root)
            probe = start_probe(env, 'source-probe')
            value = request(probe, 'POST', '/api/v2/replay/sessions', {'dataset_id': 'restore-bars', 'name': 'restore-main'}, 201)['body']
            base = '/api/v2/replay/sessions/' + value['record_id']
            request(probe, 'POST', base + '/orders/quick?response_view=mutation-v1', {'expected_revision': value['revision'], **init, **order}, key='restore-quick')
            value = request(probe, 'GET', base)['body']
            position = value['payload']['execution']['position']['position_id']
            request(probe, 'POST', base + '/orders/protection?response_view=mutation-v1', {'expected_revision': value['revision'],
                'operation_id': 'restore-protect', 'target_id': position, 'stop_loss': '1.12', 'take_profit': '1.09'}, key='restore-protect')
            value = request(probe, 'GET', base)['body']
            value = request(probe, 'POST', base + '/step', {'expected_revision': value['revision'], 'steps': 2})['body']
            request(probe, 'POST', base + '/orders/protection?response_view=mutation-v1', {'expected_revision': value['revision'],
                'operation_id': 'restore-after-step', 'target_id': position, 'stop_loss': '1.12', 'take_profit': '1.09'})
            value = request(probe, 'GET', base)['body']
            branch = request(probe, 'POST', base + '/branch', {'expected_revision': value['revision'], 'cursor_index': 0}, 201)['body']
            prop_replay = request(probe, 'POST', '/api/v2/replay/sessions', {'dataset_id': 'restore-bars', 'name': 'restore-prop'}, 201)['body']
            propbase = '/api/v2/replay/sessions/' + prop_replay['record_id']
            request(probe, 'POST', propbase + '/execution?response_view=mutation-v1', {'expected_revision': prop_replay['revision'], **init})
            prop_replay = request(probe, 'GET', propbase)['body']
            request(probe, 'POST', propbase + '/orders/quick?response_view=mutation-v1', {'expected_revision': prop_replay['revision'], **order, 'operation_id': 'restore-prop-sell'})
            prop_replay = request(probe, 'GET', propbase)['body']
            psid, aid = 'restore-prop-' + uuid4().hex, 'restore-attempt-' + uuid4().hex
            session, attempt, phase, resume = prop_state(session_id=psid, attempt_id=aid, dataset_sha256=sha)
            attempt = attempt.model_copy(update={'cost_version': init['cost_model']['version']})
            store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
            feedpath = propbase + f'/prop/sessions/{psid}/attempts/{aid}/feed'
            fed = request(probe, 'POST', feedpath, {'replay_event_sequence': prop_replay['payload']['execution']['event_sequence'],
                'expected_prop_revision': attempt.revision, 'prop_event_sequence': phase.last_event_sequence + 1})['body']
            deleted = request(probe, 'POST', '/api/v2/replay/sessions', {'dataset_id': 'restore-bars', 'name': 'restore-deleted'}, 201)['body']
            deadpath = '/api/v2/replay/sessions/' + deleted['record_id']
            request(probe, 'POST', deadpath + '/orders/quick?response_view=mutation-v1', {'expected_revision': deleted['revision'], **init, **order})
            deleted = request(probe, 'GET', deadpath)['body']
            request(probe, 'POST', deadpath + '/delete', {'expected_revision': deleted['revision'], 'confirmation_name': 'restore-deleted'})
            expected = {url: request(probe, 'GET', url)['body'] for url in [base, base + '?cursor_index=0', '/api/v2/replay/sessions/' + branch['record_id']]}
            stop_probe(probe)
            store.close()
            before = snapshot(source)
            compact_before = [row for row in before['revisions'] if row['storage_format'] != 'full_snapshot']
            assert compact_before and any(row['record_id'] == deleted['record_id'] for row in compact_before)
            dump = work / 'source.dump'
            run([PG / 'pg_dump.exe', '-h', '127.0.0.1', '-p', pgport, '-U', 'fixture', '-Fc', '-f', dump, source], label='backup-dump')
            bundle = work / 'backup'
            manifest = create_backup_bundle(artifact_root, dump, bundle,
                artifact_references={str(p.relative_to(artifact_root)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                                     for p in artifact_root.rglob('*') if p.is_file()}, snapshot_id=source, mutations_quiesced=True)
            restored = work / 'restored-files'
            checked_dump = restore_backup_files(bundle, restored)
            run([PG / 'pg_restore.exe', '-h', '127.0.0.1', '-p', pgport, '-U', 'fixture', '-d', target, '--no-owner', checked_dump], label='restore-dump')
            target_root = restored / 'artifacts'; tenv = environment(target, target_root)
            assert digest(snapshot(target)) == digest(before)
            check('quiesced DB+artifact bundle restores byte-equivalent revisions and receipts to distinct target', files=len(manifest['files']))
            rejected = environment(target, target_root, 'compatibility')
            run([executables[0]], rejected, False, 'compact-direct-compatibility-rejected')
            run([executables[1], 'materialize-replay', '--backup-confirmed'], tenv, False, 'missing-target-rejected')
            run([executables[1], 'materialize-replay', '--restored-target', source, '--backup-confirmed'], tenv, False, 'wrong-target-rejected')
            check('direct compatibility startup and missing/mismatched restore target fail closed')
            # Corrupt only a restored revision payload. The transaction must not
            # materialize earlier valid rows before noticing the bad later row.
            badrow = compact_before[-1]
            with connect(target) as conn:
                conn.execute("UPDATE workspace_record_revisions SET payload_json=jsonb_set(payload_json,'{execution,balance}','\"9\"'::jsonb) WHERE workspace_id=%s AND kind=%s AND record_id=%s AND revision=%s",
                             (badrow['workspace_id'], badrow['kind'], badrow['record_id'], badrow['revision']))
            corrupted = snapshot(target)
            run([executables[1], 'materialize-replay', '--restored-target', target, '--backup-confirmed'], tenv, False, 'corrupt-materialization-rejected')
            assert digest(snapshot(target)) == digest(corrupted)
            with connect(target) as conn:
                conn.execute('UPDATE workspace_record_revisions SET payload_json=%s WHERE workspace_id=%s AND kind=%s AND record_id=%s AND revision=%s',
                             (psycopg.types.json.Jsonb(badrow['payload_json']), badrow['workspace_id'], badrow['kind'], badrow['record_id'], badrow['revision']))
            check('corrupt restored payload rejects materialization atomically without partial conversion')
            result = run([executables[1], 'materialize-replay', '--restored-target', target, '--backup-confirmed'], tenv, label='materialize')
            materialized = json.loads(result.stdout)
            after = snapshot(target)
            assert all(row['storage_format'] == 'full_snapshot' for row in after['revisions'])
            assert after['heads'] == before['heads'] and after['commands'] == before['commands']
            assert after['extra'] == before['extra']
            for left, right in zip(before['revisions'], after['revisions'], strict=True):
                assert {k: v for k, v in left.items() if k not in ('payload_json', 'storage_format')} == {k: v for k, v in right.items() if k not in ('payload_json', 'storage_format')}
                if left['storage_format'] == 'full_snapshot': assert left == right
                snapshot_execution = right['payload_json'].get('execution')
                if snapshot_execution: assert len(snapshot_execution['ledger']) == snapshot_execution['event_sequence']
            check('all current historical branch deleted revisions materialized retaining identities timestamps heads and receipt bytes', **materialized)
            apiport = port(); shutdown_manifest = work / 'compatibility-owner.json'
            launch = [sys.executable, '-X', 'utf8', str(V2 / 'scripts/run_api_platform.py'), '--runtime-profile', 'compatibility',
                      '--download-engine', 'none', '--port', str(apiport), '--database-name', target,
                      '--artifact-root', str(target_root), '--manifest', str(shutdown_manifest), '--rust-binary', str(executables[0])]
            log = (out / 'compatibility-supervisor.log').open('w', encoding='utf-8'); handles.append(log)
            supervisor = subprocess.Popen(launch, env=rejected, cwd=V2, stdout=log, stderr=log, creationflags=flags); children.append(supervisor)
            deadline = time.monotonic() + 50
            while time.monotonic() < deadline:
                assert supervisor.poll() is None, 'compatibility exited; inspect log'
                if shutdown_manifest.is_file() and json.loads(shutdown_manifest.read_text()).get('ready'): break
                time.sleep(.1)
            else: raise AssertionError('compatibility readiness timeout')
            def http(method, path, body=None):
                headers = {'x-workspace-id': 'tenant-a', 'content-type': 'application/json'}
                req = Request(f'http://127.0.0.1:{apiport}' + path, method=method,
                              headers=headers, data=None if body is None else json.dumps(body).encode())
                try: response = urlopen(req, timeout=10)
                except HTTPError as error: response = error
                with response:
                    value = json.load(response)
                    assert response.status in (200, 201), value
                    return value
            for url, value in expected.items(): assert norm(http('GET', url)) == norm(value)
            for url in ['/api/v2/replay/sessions', '/api/v2/overview', '/api/v2/replay/trades', '/api/v2/dashboard/sessions']:
                http('GET', url)
            value = http('GET', base)
            value = http('POST', base + '/orders/protection', {'expected_revision': value['revision'], 'operation_id': 'compat-protection',
                        'target_id': position, 'stop_loss': '1.13', 'take_profit': '1.08'})
            value = http('POST', base + '/orders/close', {'expected_revision': value['revision'], 'operation_id': 'compat-close', 'target_id': position})
            value = http('POST', base + '/orders/market', {'expected_revision': value['revision'], **order, 'operation_id': 'compat-queue', 'execution_timing': 'next_bar'})
            value = http('POST', base + '/step', {'expected_revision': value['revision'], 'steps': 1})
            position2 = value['payload']['execution']['position']['position_id']
            value = http('POST', base + '/orders/close', {'expected_revision': value['revision'], 'operation_id': 'compat-close2', 'target_id': position2})
            value = http('POST', base + '/orders/market', {'expected_revision': value['revision'], **order, 'operation_id': 'compat-current'})
            http('POST', base + '/branch', {'expected_revision': value['revision'], 'cursor_index': 0})
            prop_replay = http('GET', propbase)
            prop_replay = http('POST', propbase + '/step', {'expected_revision': prop_replay['revision'], 'steps': 1})
            fed = http('POST', feedpath, {'replay_event_sequence': prop_replay['payload']['execution']['event_sequence'],
                'expected_prop_revision': fed['attempt']['revision'], 'prop_event_sequence': fed['phase']['last_event_sequence'] + 1})
            check('same-schema supervised compatibility HTTP reads analytics history queue step current quote protection close branch work')
            assert stop_supervisor() == 0
            supervisor = None
            probe = start_probe(tenv, 'return-native')
            current = request(probe, 'GET', base)['body']
            assert norm(current) == norm(value)
            request(probe, 'POST', base + '/orders/protection?response_view=mutation-v1', {'expected_revision': current['revision'],
                    'operation_id': 'native-after-compat', 'target_id': current['payload']['execution']['position']['position_id'],
                    'stop_loss': '1.14', 'take_profit': '1.07'})
            final = request(probe, 'GET', base)['body']
            assert final['payload']['execution']['event_sequence'] == current['payload']['execution']['event_sequence'] + 1
            assert final['payload']['execution']['ledger'][-1]['details']['operation_id'] == 'native-after-compat'
            prop_replay = request(probe, 'GET', propbase)['body']
            prop_replay = request(probe, 'POST', propbase + '/step', {'expected_revision': prop_replay['revision'], 'steps': 1})['body']
            returned_feed = request(probe, 'POST', feedpath, {'replay_event_sequence': prop_replay['payload']['execution']['event_sequence'],
                'expected_prop_revision': fed['attempt']['revision'], 'prop_event_sequence': fed['phase']['last_event_sequence'] + 1})['body']
            assert returned_feed['attempt']['revision'] == fed['attempt']['revision'] + 1
            stop_probe(probe)
            assert digest(snapshot(source)) == digest(before)
            assert hashes() == receipt['source_sha256']
            assert all(hashlib.sha256(path.read_bytes()).hexdigest() == receipt['binary_sha256'][path.name] for path in executables)
            check('native reimports compatibility-written full head, continues Prop feed, and leaves source DB/sidecars/Prop/receipts unchanged')
            receipt['status'] = 'PASS'
        except Exception as error:
            receipt['error'] = repr(error)
            raise
        finally:
            if supervisor is not None and supervisor.poll() is None:
                try: stop_supervisor()
                except Exception as error: receipt['cleanup_error'] = repr(error)
            for child in reversed(children):
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=15)
                    except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=10)
            for handle in handles: handle.close()
            run([PG / 'pg_ctl.exe', '-D', data, '-m', 'fast', '-w', 'stop'], label='postgres-stop')
            (out / 'receipt.json').write_text(json.dumps(receipt, indent=2, default=str), encoding='utf-8')


if __name__ == '__main__':
    main()
