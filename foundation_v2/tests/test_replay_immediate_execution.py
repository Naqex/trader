from copy import deepcopy
from decimal import Decimal

import pytest

from foundation_v2.tests.test_replay_execution_core import initial_state
from foundation_v2.tests.test_replay_tick_execution import initial, tick, bar
from foundation_v2.tests.test_ps02_replay_prop_connection import BASE_TIME, FakeStore, FakeArtifacts, instrument_mapping, cost_mapping
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_execution import (
    ReplayExecutionSnapshotV2, advance_replay_execution, queue_market_order,
    parse_replay_execution_snapshot, reconstruct_replay_execution_checkpoint, fork_replay_execution_checkpoint,
    close_replay_order,
)
from trading_workspace_v2.replay_tick_execution import advance_tick_execution
from trading_workspace_v2.replay_immediate_execution import fill_current_quote


@pytest.mark.parametrize('side', ['BUY', 'SELL'])
@pytest.mark.parametrize('mode', ['bar-v1', 'bar-v2', 'tick'])
def test_immediate_fill_at_same_cutoff_roundtrip_checkpoint_fork_and_future_protection(side, mode):
    snapshot = initial_state()
    if mode == 'bar-v2':
        snapshot = ReplayExecutionSnapshotV2.model_validate({**snapshot.model_dump(), 'schema_version': 'replay-execution-v2',
            'research_margin': {'version': 'fixed-starting-balance-leverage-v1', 'leverage': '100'}})
    if mode == 'tick':
        snapshot = advance_tick_execution(initial(), ticks=[tick('1.101', '1.1012')], bar=bar(), cursor_index=1).snapshot
        now = 1060
    else:
        now = 60
    # These protections are inside the preceding candle's range. They cannot
    # retroactively close a position that did not exist during that candle.
    stop, target = ('1.1000', '1.1020') if side == 'BUY' else ('1.1020', '1.1000')
    staged = queue_market_order(snapshot, operation_id='now', side=side, quantity='.1', stop_loss=stop, take_profit=target)
    filled = fill_current_quote(staged, mid_close='1.101', virtual_time_utc=now)
    assert filled.cursor_index == snapshot.cursor_index and filled.pending_market_order is None
    assert filled.position.opened_time_utc == now
    assert filled.position.entry_fill == (Decimal('1.1012') if mode == 'tick' and side == 'BUY'
        else Decimal('1.101') if mode == 'tick' else Decimal('1.1011') if side == 'BUY' else Decimal('1.1009'))
    assert filled.floating_pl < 0 and filled.balance == snapshot.balance
    assert [raw['kind'] for raw in filled.ledger[-2:]] == ['market_fill', 'price_mark']
    assert parse_replay_execution_snapshot(filled.model_dump(mode='json')) == filled
    assert reconstruct_replay_execution_checkpoint(filled, cursor_index=filled.cursor_index, event_sequence=filled.event_sequence).position == filled.position
    forked = fork_replay_execution_checkpoint(filled, replay_session_id='new', branch_id='new-branch')
    assert parse_replay_execution_snapshot(forked.model_dump(mode='json')).position is not None
    bad = deepcopy(filled.model_dump(mode='json'))
    bad['ledger'][-2]['details']['fill_price'] = '9'
    with pytest.raises(ValueError): parse_replay_execution_snapshot(bad)
    bad_mark = deepcopy(filled.model_dump(mode='json'))
    bad_mark['ledger'][-1]['details']['open_position']['entry_fill'] = '9'
    with pytest.raises(ValueError, match='immediate fill checkpoint'):
        parse_replay_execution_snapshot(bad_mark)
    if mode != 'tick':
        hit = advance_replay_execution(filled, bar={'timestamp': 60, 'open': 1.101, 'high': 1.103, 'low': 1.1005, 'close': 1.1025}, cursor_index=1).snapshot
        assert hit.position is None
    else:
        bad = deepcopy(filled.model_dump(mode='json'))
        bad['ledger'][-2]['details']['time_msc'] += 1
        with pytest.raises(ValueError, match='canonical broker quote'): parse_replay_execution_snapshot(bad)


def test_immediate_service_does_not_read_future_price_and_legacy_queue_is_preserved():
    rows = [{'timestamp': BASE_TIME + n*60, 'open': 1.1, 'high': 1.2, 'low': 1.0, 'close': 1.1, 'volume': 10} for n in range(3)]
    rows[1].update(open=8, high=9, low=7, close=8)
    service = ReplayService(FakeStore(rows), FakeArtifacts(rows))
    created = service.create('tenant-a', 'dataset-1', 0)
    sid = created['record_id']
    args = dict(instrument_spec=instrument_mapping(), cost_model=cost_mapping(), spread_price='.0002', timeframe_seconds=60, starting_balance='100000')
    filled = service.quick_market_order('tenant-a', sid, created['revision'], operation_id='now', side='SELL', quantity='.1',
        stop_loss=None, take_profit=None, execution_timing='current_quote', **args)
    assert filled['payload']['cursor_index'] == 0
    assert Decimal(filled['payload']['execution']['position']['entry_fill']) == Decimal('1.0999')
    assert filled['payload']['execution']['pending_market_order'] is None
    with pytest.raises(RuntimeError):
        service.queue_market_order('tenant-a', sid, created['revision'], operation_id='stale', side='BUY', quantity='.1', stop_loss=None, take_profit=None, execution_timing='current_quote')
    old = service.create('tenant-a', 'dataset-1', 0)
    queued = service.quick_market_order('tenant-a', old['record_id'], old['revision'], operation_id='later', side='BUY', quantity='.1', stop_loss=None, take_profit=None, **args)
    assert queued['payload']['execution']['pending_market_order'] is not None


def test_immediate_margin_rejection_has_checkpoint_without_position():
    snapshot = advance_tick_execution(initial(balance='100', leverage='1'), ticks=[tick()], bar=bar(), cursor_index=1).snapshot
    staged = queue_market_order(snapshot, operation_id='no-margin', side='SELL', quantity='1', stop_loss=None, take_profit=None)
    rejected = fill_current_quote(staged, mid_close='1.101', virtual_time_utc=1060)
    assert rejected.position is None and rejected.pending_market_order is None
    assert rejected.balance == 100 and rejected.floating_pl == 0
    assert rejected.ledger[-2]['kind'] == 'order_rejected'
    assert parse_replay_execution_snapshot(rejected.model_dump(mode='json')) == rejected


def test_same_cutoff_reopen_cannot_upgrade_intrabar_equity_coverage():
    staged = queue_market_order(initial_state(), operation_id='open', side='BUY', quantity='.1', stop_loss=None, take_profit=None)
    opened = fill_current_quote(staged, mid_close='1.101', virtual_time_utc=60)
    advanced = advance_replay_execution(opened, bar={'timestamp': 60, 'open': 1.101,
        'high': 1.103, 'low': 1.1005, 'close': 1.102}, cursor_index=1).snapshot
    assert advanced.ledger[-1]['details']['intrabar_equity_coverage'] == 'insufficient'
    closed = close_replay_order(advanced, target_id=advanced.position.position_id,
        operation_id='close', mid_close='1.102', virtual_time_utc=120)
    staged = queue_market_order(closed, operation_id='reopen', side='SELL', quantity='.1', stop_loss=None, take_profit=None)
    reopened = fill_current_quote(staged, mid_close='1.102', virtual_time_utc=120)
    assert reopened.ledger[-1]['details']['intrabar_equity_coverage'] == 'insufficient'
    assert parse_replay_execution_snapshot(reopened.model_dump(mode='json')) == reopened


def test_immediate_fill_exposure_and_costs_feed_prop_once():
    from foundation_v2.tests.test_ps02_replay_prop_connection import ReplayPropConnectionTests
    fixture = ReplayPropConnectionTests()
    fixture.setUp()
    created = fixture.service.create('tenant-a', 'dataset-1', 0)
    sid = created['record_id']
    filled = fixture.service.quick_market_order('tenant-a', sid, created['revision'], operation_id='now',
        side='SELL', quantity='.1', stop_loss=None, take_profit=None, execution_timing='current_quote',
        instrument_spec=instrument_mapping(), cost_model=cost_mapping(), spread_price='.0002',
        timeframe_seconds=60, starting_balance='100000')
    args = dict(prop_session_id='prop-session', prop_attempt_id='attempt-1',
        replay_event_sequence=filled['payload']['execution']['event_sequence'],
        expected_prop_revision=1, prop_event_sequence=1)
    fed = fixture.service.feed_prop_lifecycle('tenant-a', sid, **args)
    assert fed['phase']['open_positions'] == 1
    assert Decimal(fed['phase']['equity']) == Decimal('99996')
    assert fed['resume_state']['replay_binding']['last_replay_event_sequence'] == 2
    assert fixture.service.feed_prop_lifecycle('tenant-a', sid, **args)['duplicate'] is True
