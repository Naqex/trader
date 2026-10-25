"""Open table exposure stays separate from realized reports and cursor history."""
from copy import deepcopy
import json

import pytest

from test_replay_analytics import record, closed_trade_record
from test_replay_execution_core import initial_state
from test_dashboard_read_model import fork
from trading_workspace_v2.analytics_read_model import AnalyticsValidationError
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from trading_workspace_v2.replay_analytics import build_replay_analytics_view, build_open_trade_rows, filter_open_trade_rows
from trading_workspace_v2.replay_execution import queue_market_order, advance_replay_execution, close_replay_order
from trading_workspace_v2.replay_read_projection import ReplayReadProjectionService
from trading_workspace_v2.trades_page import build_trades_page


def opened_record():
    queued = queue_market_order(initial_state(), operation_id='open-1', side='BUY', quantity='0.10',
                                stop_loss='1.0900', take_profit='1.1200')
    return record(advance_replay_execution(queued, cursor_index=1,
        bar={'timestamp': 1700000000, 'open': 1.1000, 'high': 1.1030, 'low': 1.0990, 'close': 1.1020}).snapshot)


class Store:
    def __init__(self, records):
        self.records = records
        self.full_reads = 0
    def list_record_heads(self, workspace, kind):
        return [{'record_id': r['record_id'], 'revision': r['revision']} for r in self.records] if kind == 'replay' else []
    def records_at_heads(self, workspace, kind, heads, **kwargs):
        if kind != 'replay':
            return []
        if not kwargs.get('metadata_only'):
            self.full_reads += 1
        return deepcopy(self.records)
    def list_replay_activity(self, workspace):
        return []


def test_open_row_does_not_invent_realized_pnl_fees_or_exit():
    source = opened_record()
    before = deepcopy(source)
    financial = build_replay_analytics_view(source)
    row, = build_open_trade_rows(source)
    assert row['status'] == 'open'
    assert row['quantity'] == .1 and row['price_open'] == 1.1001
    assert row['stop_loss'] == '1.0900' and row['take_profit'] == '1.1200'
    assert row['open_event_sequence'] == 1 and row['open_cursor_index'] == 1
    for key in ('net_pnl', 'gross_pnl', 'fees', 'realized_r', 'price_close', 'close_time_utc', 'report_time_utc'):
        assert row[key] is None
    assert row['table_time_utc'] == 1700000000
    assert build_open_trade_rows(source, activity_basis=True)[0]['table_time_utc'] is None
    assert financial['ledger'] == [] and financial['metrics']['closed_trade_count'] == 0
    assert build_replay_analytics_view(source) == financial
    assert source == before


def test_proven_entry_recording_controls_activity_time_and_type_without_backfill():
    source = opened_record()
    source['payload']['entry_recording'] = {'schema_version': 'replay-entry-recording-v1', 'datasets': {
        'dataset-fixture': {'replay-pos-1': {'source_operation_id': 'open-1', 'open_event_sequence': 1,
            'recorded_at_utc': '2026-10-25T10:30:00Z', 'entry_type': 'market'}}}}
    row, = build_open_trade_rows(source, activity_basis=True)
    assert row['table_time_utc'] == row['recorded_at_utc'] == '2026-10-25T10:30:00Z'
    assert row['entry_type'] == 'market'
    assert filter_open_trade_rows([row], {'from_close_utc': '2026-10-25T10:30:00Z', 'to_close_utc': '2026-10-25T10:30:00Z'}) == [row]
    assert filter_open_trade_rows([row], {'outcome': 'breakeven'}) == []
    assert filter_open_trade_rows([row], {'side': 'sell'}) == []
    source['payload']['entry_recording']['datasets']['dataset-fixture']['replay-pos-1']['open_event_sequence'] = 9
    assert build_open_trade_rows(source, activity_basis=True)[0]['recorded_at_utc'] is None


def test_open_status_filter_count_and_sort_cover_whole_scope_before_page():
    store = Store([opened_record(), fork(closed_trade_record(), 'closed-session', parent=False)])
    service = ReplayReadProjectionService(store)
    unpaged = service.trades('tenant-a')
    assert len(unpaged['ledger']) == unpaged['metrics']['closed_trade_count'] == 1
    paged = service.trades('tenant-a', page=99, page_size=1, extra_filters='{"statuses":["open"]}', sort_key='status')
    assert paged['pagination']['filtered_count'] == 1 and paged['pagination']['page'] == 1
    assert paged['ledger'][0]['status'] == 'open'
    assert service.trades('tenant-a', page=1, page_size=1)['pagination']['filtered_count'] == 2
    assert service.trades('tenant-a', page=1, extra_filters='{"outcomes":["breakeven"]}')['ledger'] == []
    assert service.trades('tenant-a', page=1, extra_filters='{"statuses":["closed"]}')['pagination']['filtered_count'] == 1
    assert service.trades('tenant-a', page=1, side='sell')['pagination']['filtered_count'] == 0
    assert service.trades('tenant-a', page=1, from_close_utc='2026-01-01T00:00:00Z')['pagination']['filtered_count'] == 0
    assert service.trades('tenant-a')['metrics'] == unpaged['metrics']


def test_open_filter_facets_keep_entry_date_and_unknown_is_not_zero():
    source = opened_record()
    row, = build_open_trade_rows(source)
    financial = build_dashboard_performance([source], 'tenant-a', include_ledger=True)
    table = {**financial, 'ledger': [row]}
    page = build_trades_page(table, [], page=1, page_size=10, sort_key='return_pct', sort_direction='asc',
                             extra_filters=json.dumps({'statuses': ['open'], 'outcomes': ['unknown'], 'years': ['2023']}))
    assert page['pagination']['filtered_count'] == 1
    assert page['facets']['years'] == ['2023']
    assert page['facets']['date_range'] == {'from': '2023-11-14', 'to': '2023-11-14'}
    assert build_trades_page(table, [], page=1, page_size=10, sort_key='report_time_utc', sort_direction='desc')['ledger'][0]['report_time_utc'] is None


def test_historical_row_uses_supplied_checkpoint_and_disappears_after_close():
    from trading_workspace_v2.replay_execution import ReplayExecutionSnapshot
    opened = opened_record()
    snapshot = ReplayExecutionSnapshot.model_validate(opened['payload']['execution'])
    closed = close_replay_order(snapshot, target_id=snapshot.position.position_id,
        operation_id='close-1', mid_close='1.1020', virtual_time_utc=snapshot.ledger[-1]['virtual_time_utc'])
    head = record(closed)
    service = ReplayReadProjectionService(Store([head]))
    historical = {**opened, 'historical_view': True, 'canonical_cursor_index': head['payload']['cursor_index']}
    assert len(service.analytics(historical)['open_rows']) == 1
    assert service.analytics(head)['open_rows'] == []
    assert service.analytics(head)['metrics']['closed_trade_count'] == 1
    assert service.analytics(historical)['metrics']['closed_trade_count'] == 0


def test_forked_open_exposure_is_per_session_while_closed_dedup_stays_unchanged():
    source = opened_record()
    records = [source, fork(source, 'open-branch')]
    paged = ReplayReadProjectionService(Store(records)).trades('tenant-a', page=1)
    assert paged['pagination']['filtered_count'] == 2
    assert {row['session_id'] for row in paged['ledger']} == {'replay-fixture', 'open-branch'}
    assert paged['scope']['open_positions'] == 'per_selected_session_snapshot'
    closed = closed_trade_record()
    service = ReplayReadProjectionService(Store([closed, fork(closed, 'closed-branch')]))
    assert service.trades('tenant-a', page=1)['pagination']['filtered_count'] == 1
    assert service.trades('tenant-a')['scope']['duplicate_trade_count'] == 1


def test_partial_close_keeps_realized_slice_and_projects_only_remaining_exposure():
    from trading_workspace_v2.replay_execution import ReplayExecutionSnapshot
    source = opened_record()
    snapshot = ReplayExecutionSnapshot.model_validate(source['payload']['execution'])
    partial = close_replay_order(snapshot, target_id=snapshot.position.position_id,
        operation_id='partial-1', mid_close='1.1020', virtual_time_utc=snapshot.ledger[-1]['virtual_time_utc'], quantity='.04')
    source = record(partial)
    row, = build_open_trade_rows(source)
    assert row['quantity'] == .06 and row['net_pnl'] is None
    financial = build_replay_analytics_view(source)
    assert len(financial['ledger']) == 1 and financial['ledger'][0]['quantity'] == .04
    assert financial['ledger'][0]['trade_id'] != row['trade_id']
    page = ReplayReadProjectionService(Store([source])).trades('tenant-a', page=1)
    assert page['pagination']['filtered_count'] == 2
    assert len({r['trade_id'] for r in page['ledger']}) == 2
    assert build_replay_analytics_view(source)['metrics'] == financial['metrics']


def test_portfolio_opens_keep_dataset_identity_and_never_invent_active_chart_cursor():
    from test_replay_portfolio import PortfolioStore, initialize, queue, switch, step
    from trading_workspace_v2.replay import ReplayService
    store = PortfolioStore(); service = ReplayService(store, store)
    source = service.create('tenant-a', 'a', dataset_ids=['a', 'b'], starting_balance='10000')
    source = queue(service, initialize(service, source), 'a')
    source = queue(service, initialize(service, switch(service, source, 'b')), 'b')
    source = step(service, source)
    source = service.analytics_record('tenant-a', source['record_id'])
    rows = build_open_trade_rows(source)
    assert len(rows) == 2
    assert {r['dataset_id'] for r in rows} == {'a', 'b'}
    assert all(r['trade_id'].startswith(r['dataset_id'] + ':') for r in rows)
    inactive = next(r for r in rows if r['dataset_id'] != source['payload']['dataset_id'])
    assert inactive['open_cursor_index'] is None and inactive['open_event_sequence'] is None
    assert inactive['asset_open_cursor_index'] is not None and inactive['asset_open_event_sequence'] is not None
    assert build_replay_analytics_view(source)['metrics']['closed_trade_count'] == 0


def test_invalid_source_does_not_gain_an_open_row_and_open_cache_reuses_record_heads():
    source = opened_record()
    bad = deepcopy(source); bad['payload']['execution']['balance'] = '999'
    with pytest.raises(ValueError):
        build_open_trade_rows(bad)
    service = ReplayReadProjectionService(Store([bad]))
    page = service.trades('tenant-a', page=1)
    assert page['status'] == 'partial' and page['ledger'] == []
    assert page['pagination']['filtered_count'] is None
    store = Store([source]); service = ReplayReadProjectionService(store)
    service.trades('tenant-a', page=1)
    reads = store.full_reads
    service.trades('tenant-a', page=1, sort_key='net_pnl', sort_direction='asc')
    assert store.full_reads == reads
