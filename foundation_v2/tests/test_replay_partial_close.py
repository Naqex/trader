from copy import deepcopy
from decimal import Decimal

import pytest

from foundation_v2.tests.test_replay_execution_core import initial_state
from foundation_v2.tests.test_replay_tick_execution import initial, tick, bar
from trading_workspace_v2.replay_execution import (
    ReplayExecutionSnapshotV2, advance_replay_execution, close_replay_order,
    parse_replay_execution_snapshot, queue_market_order, reconstruct_replay_execution_checkpoint,
)
from trading_workspace_v2.replay_immediate_execution import fill_current_quote
from trading_workspace_v2.replay_tick_execution import advance_tick_execution, close_tick_order
from trading_workspace_v2.replay_analytics import build_replay_analytics_view


def opened(side, mode):
    snapshot = initial_state()
    now = 60
    if mode == 'bar-v2':
        snapshot = ReplayExecutionSnapshotV2.model_validate({**snapshot.model_dump(),
            'schema_version': 'replay-execution-v2', 'research_margin': {
                'version': 'fixed-starting-balance-leverage-v1', 'leverage': '100'}})
    elif mode == 'tick':
        snapshot = advance_tick_execution(initial(), ticks=[tick('1.101', '1.1012')],
            bar=bar(), cursor_index=1).snapshot
        now = 1060
    queued = queue_market_order(snapshot, operation_id='open', side=side, quantity='.1',
        stop_loss=None, take_profit=None)
    return fill_current_quote(queued, mid_close='1.101', virtual_time_utc=now), now


def analytics(snapshot):
    return build_replay_analytics_view({'record_id': snapshot.replay_session_id, 'workspace_id': 'tenant-a',
        'revision': 1, 'payload': {'dataset_id': snapshot.dataset_id, 'branch_id': snapshot.branch_id,
            'cursor_index': snapshot.cursor_index, 'execution': snapshot.model_dump(mode='json')}})


@pytest.mark.parametrize('side', ['BUY', 'SELL'])
@pytest.mark.parametrize('mode', ['bar-v1', 'bar-v2', 'tick'])
def test_partial_close_preserves_remaining_position_cost_basis_and_analytics(side, mode):
    start, now = opened(side, mode)
    close = close_tick_order if mode == 'tick' else close_replay_order
    args = dict(target_id=start.position.position_id, mid_close='1.101', virtual_time_utc=now)
    whole = close(start, operation_id='whole', **args)
    first = close(start, quantity='.04', operation_id='partial-1', **args)
    assert first.position.quantity == Decimal('.06')
    assert first.position.original_quantity == Decimal('.1')
    assert first.position.realized_pnl == first.balance - start.balance
    assert first.ledger[-1]['details']['previous_position'] == start.position.model_dump(mode='json')
    assert first.ledger[-1]['open_positions'] == 1
    assert first.balance + first.floating_pl == whole.balance
    assert parse_replay_execution_snapshot(first.model_dump(mode='json')) == first
    assert reconstruct_replay_execution_checkpoint(first, cursor_index=first.cursor_index,
        event_sequence=first.event_sequence).position == first.position
    assert analytics(first)['ledger'][0]['quantity'] == .04
    second = close(first, quantity='.03', operation_id='partial-2', **args)
    assert second.position.quantity == Decimal('.03')
    assert second.position.realized_pnl == second.balance - start.balance
    final = close(second, operation_id='remaining', **args)
    assert final.position is None and final.floating_pl == 0
    assert final.balance == whole.balance
    assert parse_replay_execution_snapshot(final.model_dump(mode='json')) == final
    rows = analytics(final)['ledger']
    assert [row['quantity'] for row in rows] == [.04, .03, .03]
    assert len({row['trade_id'] for row in rows}) == 3
    assert all(row['source_position_id'] == start.position.position_id for row in rows)
    assert sum(Decimal(str(row['net_pnl'])) for row in rows) == final.balance - start.balance


@pytest.mark.parametrize('quantity', ['0', '-.01', '.101', '.11', '.005'])
def test_partial_close_rejects_invalid_close_quantity_without_changing_snapshot(quantity):
    start, now = opened('BUY', 'bar-v1')
    before = start.model_dump(mode='json')
    with pytest.raises(ValueError):
        close_replay_order(start, target_id=start.position.position_id, operation_id='invalid',
            quantity=quantity, mid_close='1.101', virtual_time_utc=now)
    assert start.model_dump(mode='json') == before


def test_partial_close_rejects_below_minimum_residual_and_tampered_checkpoint():
    start, now = opened('BUY', 'bar-v1')
    instrument = {**start.instrument_spec, 'quantity_min': '.03'}
    start = start.model_copy(update={'instrument_spec': instrument})
    args = dict(target_id=start.position.position_id, mid_close='1.101', virtual_time_utc=now)
    with pytest.raises(ValueError, match='minimum'):
        close_replay_order(start, quantity='.08', operation_id='dust', **args)
    partial = close_replay_order(start, quantity='.04', operation_id='valid', **args)
    for field, value in [('quantity', '.05'), ('original_quantity', '.2'), ('realized_pnl', '999')]:
        tampered = deepcopy(partial.model_dump(mode='json'))
        tampered['ledger'][-1]['details']['open_position'][field] = value
        with pytest.raises(ValueError):
            parse_replay_execution_snapshot(tampered)


@pytest.mark.parametrize('field,value', [('original_quantity', '.2'), ('realized_pnl', '0')])
def test_opening_fill_cannot_forge_partial_cost_basis(field, value):
    start, _ = opened('BUY', 'bar-v1')
    raw = start.model_dump(mode='json')
    for event in raw['ledger']:
        event['details']['open_position'][field] = value
    with pytest.raises(ValueError, match='opening fill cannot'):
        parse_replay_execution_snapshot(raw)


def test_partial_close_allocates_legacy_minimum_fee_and_financing_once():
    start, now = opened('SELL', 'bar-v1')
    costs = {**start.cost_model, 'minimum_fee_account': '5', 'financing_account': '3'}
    start = start.model_copy(update={'cost_model': costs})
    args = dict(target_id=start.position.position_id, mid_close='1.101', virtual_time_utc=now)
    full = close_replay_order(start, operation_id='full', **args)
    partial = close_replay_order(start, operation_id='partial', quantity='.04', **args)
    final = close_replay_order(partial, operation_id='rest', **args)
    assert final.balance == full.balance
    cost_rows = [event['details']['cost_breakdown'] for event in final.ledger if event['kind'] == 'manual_close']
    assert sum(Decimal(str(row['commission_account'])) for row in cost_rows) == 5
    assert sum(Decimal(str(row['financing_account'])) for row in cost_rows) == 3


def test_protective_exit_after_partial_uses_residual_quantity_and_allocated_costs():
    start, now = opened('BUY', 'bar-v1')
    start = start.model_copy(update={'position': start.position.model_copy(update={'take_profit': Decimal('1.102')})})
    start.ledger[-1]['details']['open_position']['take_profit'] = '1.102'
    start.ledger[-2]['details']['open_position']['take_profit'] = '1.102'
    partial = close_replay_order(start, target_id=start.position.position_id, operation_id='partial',
        quantity='.04', mid_close='1.101', virtual_time_utc=now)
    final = advance_replay_execution(partial, bar={'timestamp': 60, 'open': 1.101,
        'high': 1.103, 'low': 1.1005, 'close': 1.1025}, cursor_index=1).snapshot
    assert final.position is None
    rows = analytics(final)['ledger']
    assert [row['quantity'] for row in rows] == [.04, .06]
    assert rows[-1]['exit_reason'] == 'take_profit'
