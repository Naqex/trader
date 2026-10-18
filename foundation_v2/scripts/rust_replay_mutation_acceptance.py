"""Full/compact replay parity and alternating measurements on an owned disposable PG."""
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

V2 = Path(__file__).resolve().parents[1]
ROOT = V2.parent
sys.path[:0] = [str(ROOT), str(V2), str(V2 / 'tests')]
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from test_replay_execution_core import initial_state
from rust_replay_service_acceptance import PG, norm


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--probe', type=Path, required=True)
    parser.add_argument('--stages', default='0,500,5000')
    parser.add_argument('--samples', type=int, default=5)
    args = parser.parse_args()
    stages = [int(value) for value in args.stages.split(',')]
    assert stages == sorted(set(stages)) and 0 <= stages[0] <= stages[-1] <= 10000
    assert 1 <= args.samples <= 20
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    def hashes():
        sources = sorted((V2 / 'api-rust/src').rglob('*.rs')) + [
            Path(__file__), V2 / 'api-rust/examples/rust_replay_mutation_probe.rs']
        return {str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    source_hashes = hashes()
    receipt = {'status': 'FAIL', 'checks': [], 'samples': [], 'source_sha256': source_hashes,
               'probe_sha256': hashlib.sha256(args.probe.read_bytes()).hexdigest(),
               'scope': 'owned disposable PostgreSQL, synthetic bars, same-state native replay Router full versus opt-in mutation-v1; not full native runtime acceptance',
               'limitations': ['Router time excludes TCP/browser paint; outer time includes JSON stdio.',
                               'Small alternating diagnostic samples, not stable tail or capacity evidence.',
                               'Compact response does not make full history validation/persistence constant time.']}
    process = None
    store = None
    with tempfile.TemporaryDirectory(prefix='rust-replay-mutation-') as temporary:
        work = Path(temporary)
        data = work / 'pg'
        artifacts = ArtifactStore(work / 'artifacts')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        def pg(command, *values):
            subprocess.run([str(PG / (command + '.exe')), *values], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        pg('initdb', '-D', str(data), '-U', 'fixture', '-A', 'trust', '--locale=C', '--encoding=UTF8')
        pg('pg_ctl', '-D', str(data), '-l', str(work / 'pg.log'), '-o', f'-h 127.0.0.1 -p {port} -c shared_buffers=32MB', '-w', 'start')
        try:
            dsn = f'host=127.0.0.1 port={port} user=fixture dbname=postgres'
            store = PostgresStore(dsn)
            store.initialize()
            store.ensure_workspace('tenant-a')
            store.ensure_workspace('tenant-b')
            spec = initial_state().instrument_spec
            init = {'instrument_spec': spec, 'cost_model': initial_state().cost_model,
                    'spread_price': '0.0002', 'timeframe_seconds': 60, 'starting_balance': '100000'}
            bars = max(stages[-1] + 5, 20)
            rows = [{'timestamp': 1767225600 + i * 60, 'open': 1.1, 'high': 1.1002,
                     'low': 1.0998, 'close': 1.1, 'volume': 100} for i in range(bars)]
            for dataset in ('dataset-mutation', 'dataset-other'):
                path, sha = artifacts.write_dataset('tenant-a', dataset, rows)
                symbol = 'EURUSD' if dataset == 'dataset-mutation' else 'GBPUSD'
                dataset_spec = {**spec, 'instrument_id': symbol, 'base_ccy': 'EUR' if symbol == 'EURUSD' else 'GBP'}
                store.put_dataset(DatasetManifest(dataset_id=dataset, workspace_id='tenant-a',
                    source=DatasetSource(source_id='synthetic-mutation', provider='synthetic',
                        instrument_mapping={symbol: symbol}, license_use='fixture',
                        retrieved_at_utc='2026-01-01T00:00:00Z', export_settings='owned-mutation'),
                    instrument_id=symbol, timeframe='M1', timeframe_seconds=60, instrument_spec=dataset_spec,
                    row_count=bars, first_timestamp=rows[0]['timestamp'], last_timestamp=rows[-1]['timestamp'],
                    artifact_path=path, artifact_sha256=sha, created_at_utc='2026-01-01T00:00:00Z'))
            log_path = out / 'probe.log'
            log = log_path.open('w', encoding='utf-8')
            clean_env = {key: value for key, value in os.environ.items() if not key.startswith('TW_V2_')}
            env = {**clean_env, 'TW_V2_DATABASE_URL': dsn, 'TW_V2_ARTIFACT_ROOT': str(artifacts.root),
                   'TW_V2_RUNTIME_PROFILE': 'native', 'TW_V2_RUST_BIND': '127.0.0.1:0',
                   'TW_V2_LOCAL_WORKSPACES': 'tenant-a,tenant-b', 'TW_V2_REPLAY_TIMINGS': '1',
                   'TW_V2_OPENAPI_PATH': str(V2 / 'contracts/openapi.json')}
            process = subprocess.Popen([str(args.probe.resolve())], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8', env=env,
                creationflags=subprocess.CREATE_NO_WINDOW)
            log_offset = 0
            def native(method, path, body=None, status=200, key=None, workspace='tenant-a'):
                nonlocal log_offset
                item = {'method': method, 'path': path, 'workspace': workspace}
                if body is not None: item['body'] = body
                if key: item['key'] = key
                start = time.perf_counter_ns()
                process.stdin.write(json.dumps(item) + '\n')
                process.stdin.flush()
                line = process.stdout.readline()
                if not line: raise AssertionError('probe terminated: ' + log_path.read_text(encoding='utf-8')[-4000:])
                result = json.loads(line)
                result['stdio_elapsed_ns'] = time.perf_counter_ns() - start
                assert result['status'] == status, (method, path, result)
                with log_path.open(encoding='utf-8') as reader:
                    reader.seek(log_offset)
                    lines = reader.readlines()
                    log_offset = reader.tell()
                result['phases'] = []
                for entry in lines:
                    try:
                        fields = json.loads(entry).get('fields', {})
                        if fields.get('message') == 'native_replay_phases':
                            result['phases'] = json.loads(fields['phases'])
                    except (ValueError, KeyError): pass
                return result
            def check(label): receipt['checks'].append(label)
            def new_session(**options):
                return native('POST', '/api/v2/replay/sessions',
                    {'dataset_id': 'dataset-mutation', 'starting_balance': '100000', **options}, 201)['body']
            def basepath(value): return '/api/v2/replay/sessions/' + value['record_id']
            def merge(before, delta):
                assert delta['schema_version'] == 'replay-mutation-v1'
                assert delta['workspace_id'] == 'tenant-a'
                for field in ('record_id', 'dataset_sha256'):
                    assert delta[field] == before[field]
                for field in ('dataset_id', 'branch_id'):
                    assert delta[field] == before['payload'][field]
                assert delta['base_revision'] == before['revision']
                prior = before['payload'].get('execution')
                sequence = prior['event_sequence'] if prior else 0
                ledger = prior['ledger'] if prior else []
                assert delta['base_event_sequence'] == sequence == len(ledger)
                assert delta['cursor_index'] == delta['view_cursor_index'] == delta['canonical_cursor_index'] == before['canonical_cursor_index']
                assert delta['cutoff_timestamp'] == before['cutoff_timestamp']
                head = delta['payload_patch']['execution']
                assert 'ledger' not in head and 'visible_rows' not in delta
                assert delta['execution_event_sequence'] == head['event_sequence']
                events = delta['appended_events']
                assert len(events) <= 16
                assert [event['sequence'] for event in events] == list(range(sequence + 1, head['event_sequence'] + 1))
                merged = json.loads(json.dumps(before))
                merged['payload'].update(delta['payload_patch'])
                merged['payload']['execution'] = {**head, 'ledger': ledger + events}
                for field in ('revision', 'updated_at_utc', 'execution_view_status', 'historical_view', 'has_future_rows'):
                    merged[field] = delta[field]
                for field in ('session_kind', 'prop_session_id', 'prop_attempt_id'):
                    if field in delta: merged[field] = delta[field]
                return merged
            def capture(value):
                with store.connect() as conn:
                    row = conn.execute("SELECT current_revision,updated_at_utc FROM workspace_records WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s", (value['record_id'],)).fetchone()
                return dict(row)
            def restore(value, captured, command_ids):
                with store.connect() as conn:
                    actual = Path(conn.execute('SHOW data_directory').fetchone()['data_directory'])
                    assert actual.resolve() == data.resolve(), 'refuse a non-owned database'
                    conn.execute("DELETE FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s AND revision>%s", (value['record_id'], captured['current_revision']))
                    conn.execute("UPDATE workspace_records SET current_revision=%s,updated_at_utc=%s WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s", (captured['current_revision'], captured['updated_at_utc'], value['record_id']))
                    for command_id in command_ids:
                        conn.execute('DELETE FROM api_commands WHERE command_id=%s', (command_id,))
                    conn.commit()
            def pair(before, tail, body, label, reverse=False, measured=None):
                capture_head = capture(before)
                results = {}
                for mode in (('compact', 'full') if reverse else ('full', 'compact')):
                    suffix = '?response_view=mutation-v1' if mode == 'compact' else ''
                    response = native('POST', basepath(before) + tail + suffix,
                                      {'expected_revision': before['revision'], **body}, key=label)
                    after = native('GET', basepath(before))['body']
                    effective = merge(before, response['body']) if mode == 'compact' else response['body']
                    assert norm(effective) == norm(after), (label, mode, 'merged result differs from persisted full state')
                    with store.connect() as conn:
                        saved = conn.execute('SELECT result_text FROM api_commands WHERE command_id=%s', (response['command_id'],)).fetchone()['result_text']
                    assert hashlib.sha256(saved.encode()).hexdigest() == response['response_sha256']
                    results[mode] = (response, after)
                    if measured is not None:
                        receipt['samples'].append({**measured, 'view': mode, 'order': list(results),
                            'router_elapsed_us': response['router_elapsed_us'], 'stdio_elapsed_ns': response['stdio_elapsed_ns'],
                            'response_bytes': response['response_bytes'], 'phases': response['phases']})
                    restore(before, capture_head, [response['command_id']])
                assert norm(results['full'][1]) == norm(results['compact'][1]), label
                check(label)
                return results
            order = {'operation_id': 'quick-sell', 'side': 'SELL', 'quantity': '0.12',
                     'stop_loss': None, 'take_profit': None, 'execution_timing': 'current_quote'}
            with store.connect() as conn:
                before_count = conn.execute("SELECT count(*) AS count FROM workspace_records WHERE workspace_id='tenant-a' AND kind='replay'").fetchone()['count']
            for view in ('unknown', 'mutation-v1'):
                native('POST', '/api/v2/replay/sessions?response_view=' + view,
                       {'dataset_id': 'dataset-mutation', 'starting_balance': '100000'}, status=422)
            with store.connect() as conn:
                after_count = conn.execute("SELECT count(*) AS count FROM workspace_records WHERE workspace_id='tenant-a' AND kind='replay'").fetchone()['count']
            assert after_count == before_count
            check('unsupported create response views rejected without replay side effects')
            fresh = new_session()
            pair(fresh, '/execution', init, 'initialize parity')
            first = pair(fresh, '/orders/quick', {**init, **order}, 'first quick parity')
            assert first['compact'][0]['body']['revision'] == fresh['revision'] + 2
            check('first quick retains two real persisted revisions')
            path = basepath(fresh) + '/orders/quick?response_view=mutation-v1'
            body = {'expected_revision': fresh['revision'], **init, **order}
            response = native('POST', path, body, key='exact-retry')
            retry = native('POST', path, body, key='exact-retry')
            assert response['response_sha256'] == retry['response_sha256'] and response['command_id'] == retry['command_id']
            native('POST', basepath(fresh) + '/orders/quick', body, status=409, key='exact-retry')
            check('exact wire receipt retry and full/compact query fingerprint separation')
            native('POST', path, {**body, 'operation_id': 'stale'}, status=409, key='stale-revision')
            native('GET', basepath(fresh), status=404, workspace='tenant-b')
            check('stale revision and cross-workspace rejected')
            initialized = native('GET', basepath(fresh))['body']
            target = initialized['payload']['execution']['position']['position_id']
            pair(initialized, '/orders/protection', {'operation_id': 'protect', 'target_id': target,
                 'stop_loss': '1.12', 'take_profit': '1.09'}, 'protection parity')
            pair(initialized, '/orders/close', {'operation_id': 'close', 'target_id': target}, 'close parity')
            empty = new_session()
            empty = native('POST', basepath(empty) + '/execution', {'expected_revision': empty['revision'], **init})['body']
            pair(empty, '/orders/market', {**order, 'execution_timing': 'next_bar'}, 'pending market parity')
            rejected = new_session()
            bad_body = {'expected_revision': rejected['revision'], **init, **order, 'stop_loss': '1.0'}
            native('POST', basepath(rejected) + '/orders/quick?response_view=mutation-v1', bad_body, status=422, key='atomic-invalid')
            assert native('GET', basepath(rejected))['body'] == rejected
            native('POST', basepath(rejected) + '/step?response_view=mutation-v1', {'expected_revision': rejected['revision'], 'steps': 1}, status=422)
            native('POST', basepath(rejected) + '/execution?response_view=unknown', {'expected_revision': rejected['revision'], **init}, status=422)
            check('atomic invalid quick rollback and unsupported response views rejected')
            portfolio = new_session(dataset_ids=['dataset-mutation', 'dataset-other'])
            native('POST', basepath(portfolio) + '/execution?response_view=mutation-v1', {'expected_revision': portfolio['revision'], **init}, status=422)
            assert native('GET', basepath(portfolio))['body'] == portfolio
            native('POST', basepath(portfolio) + '/execution', {'expected_revision': portfolio['revision'], **init})
            check('portfolio compact rejected without side effects; default full remains supported')
            for stage in stages:
                current = new_session(name='mutation-stage-' + str(stage))
                current = native('POST', basepath(current) + '/execution', {'expected_revision': current['revision'], **init})['body']
                remaining = stage
                while remaining:
                    steps = min(1000, remaining)
                    current = native('POST', basepath(current) + '/step', {'expected_revision': current['revision'], 'steps': steps})['body']
                    remaining -= steps
                current = native('POST', basepath(current) + '/orders/quick', {'expected_revision': current['revision'], **order})['body']
                target = current['payload']['execution']['position']['position_id']
                operation = {'operation_id': 'scaling-protection', 'target_id': target, 'stop_loss': '1.12', 'take_profit': '1.09'}
                pair(current, '/orders/protection', operation, f'warmup stage {stage}')
                for index in range(args.samples):
                    pair(current, '/orders/protection', operation, f'scaling {stage} sample {index}', reverse=bool(index % 2),
                         measured={'stage_steps': stage, 'base_events': len(current['payload']['execution']['ledger']), 'sample': index})
            assert hashes() == source_hashes, 'source changed during acceptance'
            assert hashlib.sha256(args.probe.read_bytes()).hexdigest() == receipt['probe_sha256'], 'probe changed during acceptance'
            assert receipt['samples'] and all(sample['phases'] for sample in receipt['samples'])
            receipt['status'] = 'PASS'
        except Exception as exc:
            receipt['error'] = repr(exc)
            raise
        finally:
            if process:
                process.terminate()
                process.wait(timeout=10)
            if store: store.close()
            pg('pg_ctl', '-D', str(data), '-m', 'immediate', '-w', 'stop')
            (out / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps({'status': receipt['status'], 'checks': len(receipt['checks']), 'samples': len(receipt['samples'])}))


if __name__ == '__main__':
    main()
