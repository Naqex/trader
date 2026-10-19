from copy import deepcopy
from decimal import Decimal

import pytest
from pydantic import ValidationError

from foundation_v2.tests.test_replay_execution_core import initial_state
from foundation_v2.tests.test_replay_tick_execution import initial, bar, tick
from foundation_v2.tests.test_ps02_replay_prop_connection import (
    BASE_TIME, FakeStore, FakeArtifacts, instrument_mapping, cost_mapping,
)
from trading_workspace_v2.contracts import ReplayMarketOrderRequest, ReplayProtectionRequest, ReplayCloseOrderRequest
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.replay_execution import (
    advance_replay_execution, queue_market_order, change_replay_protection, close_replay_order,
    parse_replay_execution_snapshot, reconstruct_replay_execution_checkpoint,
)
from trading_workspace_v2.replay_tick_execution import advance_tick_execution, change_tick_protection, close_tick_order


@pytest.mark.parametrize('side', ['BUY', 'SELL'])
@pytest.mark.parametrize('legs', ['none', 'stop', 'target', 'both'])
def test_optional_legs_fill_and_survive_roundtrip_for_bars_and_ticks(side, legs):
    stop = ('1.09' if side == 'BUY' else '1.12') if legs in {'stop', 'both'} else None
    target = ('1.12' if side == 'BUY' else '1.09') if legs in {'target', 'both'} else None
    for snapshot in (initial_state(), initial()):
        queued = queue_market_order(snapshot, operation_id='open', side=side, quantity='.1', stop_loss=stop, take_profit=target)
        if snapshot.schema_version == 'replay-execution-tick-v1':
            opened = advance_tick_execution(queued, ticks=[tick()], bar=bar(), cursor_index=1).snapshot
        else:
            opened = advance_replay_execution(queued, bar={'timestamp': 60, 'open': 1.1, 'high': 1.105, 'low': 1.099, 'close': 1.102}, cursor_index=1).snapshot
        assert opened.position.stop_loss == (Decimal(stop) if stop else None)
        assert opened.position.take_profit == (Decimal(target) if target else None)
        assert parse_replay_execution_snapshot(opened.model_dump(mode='json')) == opened


@pytest.mark.parametrize('side', ['BUY', 'SELL'])
@pytest.mark.parametrize('tick_mode', [False, True])
def test_independent_add_remove_and_manual_close_preserve_costs_and_history(side, tick_mode):
    queued = queue_market_order(initial() if tick_mode else initial_state(), operation_id='open', side=side,
        quantity='.1', stop_loss=None, take_profit=None)
    if tick_mode:
        opened = advance_tick_execution(queued, ticks=[tick(), tick('1.101', '1.1012', offset=1)], bar=bar(), cursor_index=1).snapshot
    else:
        opened = advance_replay_execution(queued, bar={'timestamp': 60, 'open': 1.1, 'high': 1.105, 'low': 1.099, 'close': 1.102}, cursor_index=1).snapshot
    time = opened.ledger[-1]['virtual_time_utc']
    amend = change_tick_protection if tick_mode else change_replay_protection
    close = close_tick_order if tick_mode else close_replay_order
    changed = amend(opened, target_id=opened.position.position_id, operation_id='add-stop',
        stop_loss='1.1005' if side == 'BUY' else '1.11', take_profit=None, mid_close='1.102', virtual_time_utc=time)
    assert changed.position is not None  # Never retro-fill the prior candle/tick.
    assert changed.equity == opened.equity
    removed = amend(changed, target_id=opened.position.position_id, operation_id='remove-stop',
        stop_loss=None, take_profit=None, mid_close='1.102', virtual_time_utc=time)
    assert removed.position.stop_loss is None
    closed = close(removed, target_id=opened.position.position_id, operation_id='close', mid_close='1.102', virtual_time_utc=time)
    assert closed.balance == opened.equity
    assert closed.floating_pl == 0 and closed.position is None
    assert closed.ledger[-1]['kind'] == 'manual_close'
    assert parse_replay_execution_snapshot(closed.model_dump(mode='json')) == closed
    assert reconstruct_replay_execution_checkpoint(closed, cursor_index=1, event_sequence=opened.event_sequence).position == opened.position
    tampered = deepcopy(closed.model_dump(mode='json'))
    tampered['ledger'][-1]['details']['fill_price'] = '9'
    with pytest.raises(ValueError): parse_replay_execution_snapshot(tampered)
    with pytest.raises(ValueError): close(closed, target_id=opened.position.position_id, operation_id='close-again', mid_close='1.102', virtual_time_utc=time)


def test_cancel_is_free_and_order_and_command_identifiers_cannot_be_reused():
    queued = queue_market_order(initial_state(), operation_id='open', side='BUY', quantity='.1', stop_loss=None, take_profit=None)
    closed = close_replay_order(queued, target_id='open', operation_id='cancel', mid_close='1.1', virtual_time_utc=60)
    assert closed.balance == queued.balance and closed.position is None and closed.pending_market_order is None
    assert closed.ledger[-1]['kind'] == 'order_cancel'
    assert parse_replay_execution_snapshot(closed.model_dump(mode='json')) == closed
    for operation in ('open', 'cancel'):
        with pytest.raises(ValueError, match='consumed'):
            queue_market_order(closed, operation_id=operation, side='BUY', quantity='.1', stop_loss=None, take_profit=None)


def test_contract_nullable_amendments_are_explicit_and_no_client_close_price():
    base = dict(expected_revision=1, operation_id='open')
    assert ReplayMarketOrderRequest(**base, side='BUY', quantity='.1').stop_loss is None
    assert ReplayProtectionRequest(**base, target_id='p', stop_loss=None, take_profit=None).take_profit is None
    with pytest.raises(ValidationError): ReplayProtectionRequest(**base, target_id='p', stop_loss=None)
    with pytest.raises(ValidationError): ReplayMarketOrderRequest(**base, side='BUY', quantity='.1', stop_loss=0)
    with pytest.raises(ValidationError): ReplayCloseOrderRequest(**base, target_id='p', price='1.1')


def test_partial_targets_contract_and_compatibility_rejection(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from trading_workspace_v2 import api
    from trading_workspace_v2.auth import LocalWorkspaceAuthorization

    targets = [dict(target_id='tp1', price='1.12', quantity='.02'),
               dict(target_id='tp2', price='1.13', quantity='.02')]
    base = dict(expected_revision=1, operation_id='partial', side='BUY', quantity='.04')
    assert ReplayMarketOrderRequest(**base, take_profits=targets).take_profits[0].quantity == Decimal('.02')
    for invalid in ([{**targets[0], 'quantity': 0}], targets * 5):
        with pytest.raises(ValidationError): ReplayMarketOrderRequest(**base, take_profits=invalid)
    store = FakeStore([])
    monkeypatch.setattr(store, 'initialize', lambda: None, raising=False)
    monkeypatch.setattr(api, 'PostgresStore', lambda _: store)
    app = api.create_app(dsn='synthetic-unused', artifact_root=tmp_path, learn_roots={},
                         authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a']))
    before = deepcopy(store.records)
    with TestClient(app, base_url='http://127.0.0.1:8039', client=('127.0.0.1', 50000)) as client:
        for route, body in [('market', base), ('quick', base), ('protection',
                dict(expected_revision=1, operation_id='partial', target_id='p', stop_loss=None, take_profit='1.12'))]:
            response = client.post(f'/api/v2/replay/sessions/missing/orders/{route}',
                headers={'X-Workspace-Id': 'tenant-a'}, json={**body, 'take_profits': targets})
            assert response.status_code == 422
            assert response.json()['detail'] == 'partial take profit requires the native replay runtime'
            assert store.records == before


def test_service_close_at_dataset_end_revision_tenant_analytics_and_checkpoint():
    rows = [{'timestamp': BASE_TIME + n * 60, 'open': 1.1, 'high': 1.105, 'low': 1.099, 'close': 1.102, 'volume': 10} for n in range(3)]
    service = ReplayService(FakeStore(rows), FakeArtifacts(rows))
    created = service.create('tenant-a', 'dataset-1', 0); sid = created['record_id']
    initialized = service.initialize_execution('tenant-a', sid, created['revision'], instrument_spec=instrument_mapping(),
        cost_model=cost_mapping(), spread_price='.0002', timeframe_seconds=60, starting_balance='100000')
    queued = service.queue_market_order('tenant-a', sid, initialized['revision'], operation_id='open', side='BUY', quantity='.1', stop_loss=None, take_profit=None)
    final = service.step('tenant-a', sid, queued['revision'], 2)
    target = final['payload']['execution']['position']['position_id']
    args = dict(target_id=target, operation_id='close')
    with pytest.raises(LookupError): service.close_order('other', sid, final['revision'], **args)
    with pytest.raises(RuntimeError): service.close_order('tenant-a', sid, queued['revision'], **args)
    closed = service.close_order('tenant-a', sid, final['revision'], **args)
    assert closed['payload']['execution']['balance'] == final['payload']['execution']['equity']
    analytics = build_replay_analytics_view(closed)
    assert analytics['ledger'][0]['exit_reason'] == 'manual_close'
    assert service.view('tenant-a', sid, cursor_index=1)['payload']['execution']['position'] is not None


def test_prop_consumes_manual_close_in_order_and_retries_exactly():
    from foundation_v2.tests.test_ps02_replay_prop_connection import ReplayPropConnectionTests
    fixture = ReplayPropConnectionTests(); fixture.setUp()
    sid, opened = fixture.build_open_replay()
    closed = fixture.service.close_order('tenant-a', sid, opened['revision'],
        target_id=opened['payload']['execution']['position']['position_id'], operation_id='close')
    with pytest.raises(ValueError, match='in order'):
        fixture.service.feed_prop_lifecycle('tenant-a', sid, prop_session_id='prop-session', prop_attempt_id='attempt-1',
            replay_event_sequence=3, expected_prop_revision=1, prop_event_sequence=1)
    first = fixture.service.feed_prop_lifecycle('tenant-a', sid, prop_session_id='prop-session', prop_attempt_id='attempt-1',
        replay_event_sequence=2, expected_prop_revision=1, prop_event_sequence=1)
    params = dict(prop_session_id='prop-session', prop_attempt_id='attempt-1', replay_event_sequence=3,
        expected_prop_revision=first['attempt']['revision'], prop_event_sequence=2)
    fed = fixture.service.feed_prop_lifecycle('tenant-a', sid, **params)
    assert fed['phase']['balance'] == closed['payload']['execution']['balance']
    assert fed['phase']['open_positions'] == 0
    assert fixture.service.feed_prop_lifecycle('tenant-a', sid, **params)['duplicate']

@pytest.mark.parametrize('side', ['BUY', 'SELL'])
@pytest.mark.parametrize('leg', ['stop', 'target'])
@pytest.mark.parametrize('tick_mode', [False, True])
def test_single_protection_leg_actually_exits(side, leg, tick_mode):
    rising = (side == 'BUY') == (leg == 'target')
    level = '1.104' if rising else '1.096'
    queued = queue_market_order(initial() if tick_mode else initial_state(), operation_id='single', side=side,
        quantity='.1', stop_loss=level if leg == 'stop' else None, take_profit=level if leg == 'target' else None)
    if tick_mode:
        hit = tick('1.105', '1.1052', offset=1) if rising else tick('1.095', '1.0952', offset=1)
        closed = advance_tick_execution(queued, ticks=[tick(), hit], bar=bar(), cursor_index=1).snapshot
    else:
        row = {'timestamp': 60, 'open': 1.1, 'high': 1.105 if rising else 1.101, 'low': 1.099 if rising else 1.095, 'close': 1.102 if rising else 1.098}
        closed = advance_replay_execution(queued, bar=row, cursor_index=1).snapshot
    assert closed.position is None
    fill = next(raw for raw in closed.ledger if raw['kind'] == 'protective_fill')
    assert fill['details']['reason'] == ('stop_loss' if leg == 'stop' else 'take_profit')
    assert parse_replay_execution_snapshot(closed.model_dump(mode='json')) == closed


def test_close_rejects_new_mid_and_tampered_tick_provenance_and_can_fork():
    from trading_workspace_v2.replay_execution import fork_replay_execution_checkpoint
    queued = queue_market_order(initial_state(), operation_id='open', side='BUY', quantity='.1', stop_loss=None, take_profit=None)
    opened = advance_replay_execution(queued, bar={'timestamp': 60, 'open': 1.1, 'high': 1.105, 'low': 1.099, 'close': 1.102}, cursor_index=1).snapshot
    with pytest.raises(ValueError, match='canonical checkpoint mid'):
        close_replay_order(opened, target_id=opened.position.position_id, operation_id='close', mid_close='9', virtual_time_utc=120)
    closed = close_replay_order(opened, target_id=opened.position.position_id, operation_id='close', mid_close='1.102', virtual_time_utc=120)
    forked = fork_replay_execution_checkpoint(closed, replay_session_id='fork', branch_id='fork-branch')
    assert parse_replay_execution_snapshot(forked.model_dump(mode='json')).position is None
    queued_tick = queue_market_order(initial(), operation_id='open', side='BUY', quantity='.1', stop_loss=None, take_profit=None)
    opened_tick = advance_tick_execution(queued_tick, ticks=[tick()], bar=bar(), cursor_index=1).snapshot
    closed_tick = close_tick_order(opened_tick, target_id=opened_tick.position.position_id, operation_id='close', mid_close='1.101', virtual_time_utc=1060)
    raw = closed_tick.model_dump(mode='json')
    raw['ledger'][-1]['details']['time_msc'] += 1
    with pytest.raises(ValueError, match='canonical broker quote'):
        parse_replay_execution_snapshot(raw)
