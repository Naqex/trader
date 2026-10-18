"""Persisted native tick/portfolio journeys against independent Python services.

Only disposable PostgreSQL and generated immutable artifacts are used. Native
creation supplies IDs once; thereafter the oracle maintains its own full state.
"""
from __future__ import annotations

import argparse
import copy
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2.parent), str(V2), str(V2 / 'tests')]
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.store import PostgresStore
from rust_replay_storage_acceptance import PG, Probe
from test_replay_tick_service import (product, capture, default_rows, BASE,
                                     WORKSPACE, INSTRUMENT, COSTS, MARGIN)


def normalized(value):
    if isinstance(value, dict):
        return {k: normalized(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalized(v) for v in value]
    if isinstance(value, str):
        if re.fullmatch(r'\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)', value):
            return value.removesuffix('Z').removesuffix('+00:00') + 'Z'
        try:
            return Decimal(value).normalize()
        except InvalidOperation:
            return value  # IDs and hashes are preserved, not masked.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return Decimal(str(value)).normalize()
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--probe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    def fingerprints():
        paths = [*sorted((V2 / 'api-rust/src').rglob('*.rs')),
                 *sorted((V2 / 'trading_workspace_v2').glob('*.py')),
                 *sorted((V2 / 'migrations').glob('*.sql')), Path(__file__),
                 V2 / 'tests/test_replay_tick_service.py',
                 V2 / 'scripts/rust_replay_storage_acceptance.py',
                 V2 / 'scripts/rust_replay_service_acceptance.py',
                 V2 / 'api-rust/tests/rust_replay_core_differential.rs',
                 V2 / 'api-rust/examples/rust_replay_mutation_probe.rs',
                 V2 / 'api-rust/Cargo.toml', V2 / 'api-rust/Cargo.lock']
        return {str(p.relative_to(V2)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    frozen = fingerprints()
    binary_hash = hashlib.sha256(args.probe.read_bytes()).hexdigest()
    receipt = dict(status='FAIL', cases=[], source_sha256=frozen, probe_sha256=binary_hash,
                   scope='Native Router/PostgreSQL versus independent Python service state; generated tick and two-symbol BAR artifacts',
                   owner_runtime_touched=False, broker=False, disposable=True,
                   limitations=['Serial correctness only; no capacity, latency or browser claim.',
                                'Native creation supplies identical IDs once; oracle state is never reset from native after mutations.',
                                'Only volatile record timestamps and Decimal/UTC spelling are normalized.'])
    probe = store = None
    try:
        with tempfile.TemporaryDirectory(prefix='rust-replay-financial-') as temporary:
            root = Path(temporary)
            data = root / 'pg'
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            def pg(command, *values):
                subprocess.run([str(PG / (command + '.exe')), *map(str, values)], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
            pg('initdb', '-D', data, '-U', 'fixture', '-A', 'trust', '--locale=C', '--encoding=UTF8')
            pg('pg_ctl', '-D', data, '-l', root / 'postgres.log', '-o',
               f'-h 127.0.0.1 -p {port} -c shared_buffers=32MB', '-w', 'start')
            try:
                fixture = product.__wrapped__(root)
                artifacts = fixture.artifacts
                dsn = f'host=127.0.0.1 port={port} user=fixture dbname=postgres'
                store = PostgresStore(dsn)
                store.initialize()
                for workspace in (WORKSPACE, 'tenant-a', 'tenant-b'):
                    store.ensure_workspace(workspace)
                for manifest in fixture.store.datasets.values():
                    store.put_dataset(manifest)
                memory = fixture.store
                oracle = fixture.service
                env = {k: v for k, v in os.environ.items() if not k.startswith('TW_V2_')}
                env.update(TW_V2_DATABASE_URL=dsn, TW_V2_ARTIFACT_ROOT=str(artifacts.root),
                           TW_V2_RUNTIME_PROFILE='native', TW_V2_REPLAY_STORAGE_PROFILE='compact',
                           TW_V2_LOCAL_WORKSPACES=f'{WORKSPACE},tenant-a,tenant-b',
                           TW_V2_OPENAPI_PATH=str(V2 / 'contracts/openapi.json'))
                def restart():
                    nonlocal probe
                    if probe:
                        probe.close()
                    probe = Probe(args.probe.resolve(), env, output / f'probe-{len(receipt["cases"])}.log')
                restart()

                def equal(label, actual, expected):
                    actual = copy.deepcopy(actual)
                    expected = copy.deepcopy(expected)
                    for record in (actual, expected):
                        for field in ('created_at_utc', 'updated_at_utc'):
                            record.pop(field, None)
                    if 'step_view_version' in actual:
                        assert actual.pop('step_view_version') == 'replay-step-v1'
                        assert not actual['payload'].get('asset_states')
                        assert (actual['payload'].get('execution') or {}).get('schema_version') in (None, 'replay-execution-v1', 'replay-execution-v2')
                    if normalized(actual) != normalized(expected):
                        (output / 'mismatch.json').write_text(json.dumps(dict(case=label, native=actual, python=expected), indent=2), encoding='utf-8')
                        raise AssertionError('financial/state parity: ' + label)
                    receipt['cases'].append(label)

                def create(workspace, **body):
                    result = probe.call('POST', '/api/v2/replay/sessions', body, status=201, workspace=workspace)['body']
                    record = store.get_record(workspace, 'replay', result['record_id'])
                    key = (workspace, 'replay', record['record_id'])
                    memory.records[key] = copy.deepcopy(record)
                    memory.revisions[key] = [copy.deepcopy(record)]
                    equal('created base ' + body['name'], result, oracle.view(workspace, record['record_id']))
                    return result

                def action(label, workspace, current, route, method, **body):
                    identity, revision = current['record_id'], current['revision']
                    path = f'/api/v2/replay/sessions/{identity}' + route
                    request = dict(expected_revision=revision, **body)
                    result = probe.call('POST', path, request, key='financial-' + label, workspace=workspace)
                    expected = getattr(oracle, method)(workspace, identity, revision, **body)
                    equal(label, result['body'], expected)
                    duplicate = probe.call('POST', path, request, key='financial-' + label, workspace=workspace)
                    assert duplicate['response_sha256'] == result['response_sha256']
                    return result['body']

                def rejected(label, workspace, current, route, method, **body):
                    path = f'/api/v2/replay/sessions/{current["record_id"]}'
                    before = probe.call('GET', path, workspace=workspace)['body']
                    prior = copy.deepcopy(memory.records)
                    try:
                        getattr(oracle, method)(workspace, current['record_id'], current['revision'], **body)
                    except (ValueError, RuntimeError, LookupError):
                        pass
                    else:
                        raise AssertionError('oracle must reject ' + label)
                    probe.call('POST', path + route, dict(expected_revision=current['revision'], **body), status=422, workspace=workspace)
                    assert memory.records == prior
                    assert probe.call('GET', path, workspace=workspace)['body'] == before
                    receipt['cases'].append(label + ' rejects atomically')

                tick_init = dict(instrument_spec=INSTRUMENT, cost_model=COSTS, spread_price='0',
                                 timeframe_seconds=60, starting_balance='100000', research_margin=MARGIN,
                                 tick_snapshot_id=fixture.tick['snapshot_id'])
                current = create(WORKSPACE, dataset_id=fixture.dataset.dataset_id, name='ticks')
                current = action('tick-init', WORKSPACE, current, '/execution', 'initialize_execution', **tick_init)
                for side, stop, target in [('BUY', '1.0990', '1.1020'), ('SELL', '1.1020', '1.0980')]:
                    current = action('tick-queue-' + side, WORKSPACE, current, '/orders/market', 'queue_market_order',
                                     operation_id='tick-' + side, side=side, quantity='1', stop_loss=stop, take_profit=target)
                    current = action('tick-fill-' + side, WORKSPACE, current, '/step', 'step', steps=1)
                    assert current['payload']['execution']['position'] is None
                assert Decimal(current['payload']['execution']['balance']) == Decimal('100416')
                restart()
                path = f'/api/v2/replay/sessions/{current["record_id"]}'
                equal('tick cold reload', probe.call('GET', path, workspace=WORKSPACE)['body'], oracle.view(WORKSPACE, current['record_id']))
                equal('tick history', probe.call('GET', path + '?cursor_index=1', workspace=WORKSPACE)['body'], oracle.view(WORKSPACE, current['record_id'], cursor_index=1))
                probe.call('GET', path, status=404, workspace='tenant-b')

                manual = create(WORKSPACE, dataset_id=fixture.dataset.dataset_id, name='tick-manual')
                manual = action('tick-manual-init', WORKSPACE, manual, '/execution', 'initialize_execution', **tick_init)
                for side in ('BUY', 'SELL'):
                    manual = action('tick-immediate-' + side, WORKSPACE, manual, '/orders/market', 'queue_market_order',
                                    operation_id='immediate-' + side, side=side, quantity='0.12', stop_loss=None,
                                    take_profit=None, execution_timing='current_quote')
                    target = manual['payload']['execution']['position']['position_id']
                    manual = action('tick-protect-' + side, WORKSPACE, manual, '/orders/protection', 'change_protection',
                                    operation_id='protect-' + side, target_id=target,
                                    stop_loss='1.09' if side == 'BUY' else '1.12', take_profit='1.12' if side == 'BUY' else '1.09')
                    manual = action('tick-close-' + side, WORKSPACE, manual, '/orders/close', 'close_order',
                                    operation_id='close-' + side, target_id=target)
                assert Decimal(manual['payload']['execution']['balance']) == Decimal('99991.20')
                restart()
                path = f'/api/v2/replay/sessions/{manual["record_id"]}'
                equal('tick manual cold reload', probe.call('GET', path, workspace=WORKSPACE)['body'],
                      oracle.view(WORKSPACE, manual['record_id']))

                sparse = capture(fixture, [r for r in default_rows() if not (BASE + 120)*1000 <= r['time_msc'] < (BASE + 180)*1000])
                empty = create(WORKSPACE, dataset_id=fixture.dataset.dataset_id, name='sparse-ticks')
                empty = action('sparse-init', WORKSPACE, empty, '/execution', 'initialize_execution', **{**tick_init, 'tick_snapshot_id': sparse['snapshot_id']})
                rejected('empty tick minute', WORKSPACE, empty, '/step', 'step', steps=2)
                missing = create(WORKSPACE, dataset_id=fixture.dataset.dataset_id, name='missing-tick-pin')
                rejected('unknown tick pin', WORKSPACE, missing, '/execution', 'initialize_execution', **{**tick_init, 'tick_snapshot_id': 'ticks-missing'})

                for suffix, symbol, price in [('a', 'EURUSD', 1.1), ('b', 'GBPUSD', 1.2)]:
                    spec = {**INSTRUMENT, 'instrument_id': symbol, 'base_ccy': symbol[:3]}
                    rows = [dict(timestamp=BASE+i*60, open=price, high=price+.002, low=price-.001, close=price+.001) for i in range(8)]
                    artifact, digest = artifacts.write_dataset('tenant-a', 'portfolio-' + suffix, rows)
                    manifest = DatasetManifest(workspace_id='tenant-a', dataset_id='portfolio-'+suffix,
                        source=DatasetSource(source_id='synthetic', provider='synthetic', instrument_mapping={symbol:symbol}, license_use='generated offline', retrieved_at_utc='2026-01-01T00:00:00Z', export_settings='fixture'),
                        instrument_id=symbol, instrument_spec=spec, timeframe='M1', timeframe_seconds=60,
                        row_count=len(rows), first_timestamp=rows[0]['timestamp'], last_timestamp=rows[-1]['timestamp'],
                        artifact_path=artifact, artifact_sha256=digest, created_at_utc='2026-01-01T00:00:00Z')
                    store.put_dataset(manifest)
                    memory.put_dataset(manifest)
                current = create('tenant-a', dataset_id='portfolio-a', dataset_ids=['portfolio-a','portfolio-b'], starting_balance='10000', name='portfolio')
                targets = {}
                for suffix, side in [('a','BUY'), ('b','SELL')]:
                    if suffix == 'b':
                        current = action('switch-b', 'tenant-a', current, '/asset', 'select_asset', dataset_id='portfolio-b')
                    spec = memory.get_dataset('tenant-a', 'portfolio-'+suffix).instrument_spec
                    current = action('portfolio-init-'+suffix, 'tenant-a', current, '/execution', 'initialize_execution',
                                     instrument_spec=spec, cost_model=COSTS, spread_price='.0002', timeframe_seconds=60, starting_balance='10000')
                    if suffix == 'a':
                        # Position sequence IDs are local to each asset; make the foreign target distinct.
                        current = action('portfolio-prime', 'tenant-a', current, '/step', 'step', steps=1)
                    current = action('portfolio-open-'+suffix, 'tenant-a', current, '/orders/market', 'queue_market_order',
                                     operation_id='portfolio-'+suffix, side=side, quantity='.1', stop_loss=None, take_profit=None, execution_timing='current_quote')
                    targets[suffix] = current['payload']['execution']['position']['position_id']
                assert current['portfolio_account']['open_position_count'] == 2
                assert targets['a'] != targets['b']
                current = action('portfolio-step', 'tenant-a', current, '/step', 'step', steps=1)
                rejected('foreign asset target', 'tenant-a', current, '/orders/close', 'close_order', operation_id='foreign', target_id=targets['a'])
                current = action('switch-a', 'tenant-a', current, '/asset', 'select_asset', dataset_id='portfolio-a')
                current = action('portfolio-set-stop', 'tenant-a', current, '/orders/protection', 'change_protection', operation_id='set-stop', target_id=targets['a'], stop_loss='1.0995', take_profit=None)
                current = action('switch-b-inactive-stop', 'tenant-a', current, '/asset', 'select_asset', dataset_id='portfolio-b')
                current = action('portfolio-inactive-fill', 'tenant-a', current, '/step', 'step', steps=1)
                assert current['payload']['asset_states']['portfolio-a']['execution']['position'] is None
                current = action('portfolio-close', 'tenant-a', current, '/orders/close', 'close_order', operation_id='close-b', target_id=targets['b'])
                assert current['portfolio_account']['open_position_count'] == 0
                restart()
                path = f'/api/v2/replay/sessions/{current["record_id"]}'
                equal('portfolio cold reload', probe.call('GET', path)['body'], oracle.view('tenant-a', current['record_id']))
                for cursor in range(current['payload']['cursor_index']):
                    equal('portfolio history ' + str(cursor),
                          probe.call('GET', path+f'?cursor_index={cursor}')['body'],
                          oracle.view('tenant-a', current['record_id'], cursor_index=cursor))
                equal('portfolio after history', probe.call('GET', path)['body'], oracle.view('tenant-a', current['record_id']))
                probe.call('GET', path, status=404, workspace='tenant-b')
                assert fingerprints() == frozen
                assert hashlib.sha256(args.probe.read_bytes()).hexdigest() == binary_hash
                receipt['source_unchanged'] = receipt['binary_unchanged'] = True
                receipt['status'] = 'PASS'
            finally:
                if probe:
                    probe.close()
                if store:
                    store.close()
                pg('pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop')
                receipt['owned_cleanup'] = True
    except Exception as error:
        receipt['error'] = repr(error)
        raise
    finally:
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(dict(status=receipt['status'], cases=len(receipt['cases']))))


if __name__ == '__main__':
    main()
