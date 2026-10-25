"""Ordered sorting applies to the full filtered ledger before pagination."""
import json
from pathlib import Path

import pytest

from test_trades_page import ids, page, row
from test_replay_read_projection import MemoryStore
from trading_workspace_v2.analytics_read_model import AnalyticsValidationError
from trading_workspace_v2.replay_read_projection import ReplayReadProjectionService
from trading_workspace_v2.trades_page import build_trades_page


SORTS = [{'key': 'symbol', 'direction': 'asc'}, {'key': 'net_pnl', 'direction': 'desc'},
         {'key': 'quantity', 'direction': 'asc'}]


def test_shared_native_oracle_includes_exact_snapshot_and_response_parity():
    fixture = json.loads((Path(__file__).resolve().parents[1] / 'api-rust/src/analytics/trade_multisort_oracle.json').read_text(encoding='utf-8'))
    for case in fixture['cases']:
        assert build_trades_page(fixture['report'], [], **case['args']) == case['expected']


def fixture_rows():
    return [row(0, symbol='B', net_pnl=4, quantity=1),
            row(1, symbol='A', net_pnl=3, quantity=2),
            row(2, symbol='A', net_pnl=3, quantity=1),
            row(3, symbol='A', net_pnl=5, quantity=None),
            row(4, symbol='A', net_pnl=3, quantity=1),
            row(5, symbol='A', net_pnl=3, quantity=None)]


def test_three_sorts_span_pages_keep_null_last_and_stable_ties():
    rows = fixture_rows()
    pages = [page(rows, page=index, page_size=2, sort=json.dumps(SORTS)) for index in (1, 2, 3)]
    assert [item for result in pages for item in ids(result)] == [f'trade-{i:03}' for i in (3, 2, 4, 1, 5, 0)]
    assert len({p['snapshot_key'] for p in pages}) == 1
    assert pages[0]['sorts'] == SORTS and pages[0]['sort'] == SORTS[0]
    desc = [*SORTS[:2], {'key': 'quantity', 'direction': 'desc'}]
    assert ids(page(rows, sort=json.dumps(desc))) == [f'trade-{i:03}' for i in (3, 1, 2, 4, 5, 0)]


def test_clear_and_remove_key_restore_order_and_change_snapshot():
    rows = fixture_rows()
    full = page(rows, sort=json.dumps(SORTS))
    removed = page(rows, sort=json.dumps(SORTS[:1]))
    cleared = page(rows, sort='[]')
    assert ids(cleared) == [r['trade_id'] for r in rows]
    assert cleared['sort'] is None and cleared['sorts'] == []
    assert ids(removed) == [f'trade-{i:03}' for i in (1, 2, 3, 4, 5, 0)]
    assert len({p['snapshot_key'] for p in (full, removed, cleared, page(rows, sort=json.dumps(SORTS[::-1])))}) == 4
    assert 'sorts' not in page(rows)
    assert page(rows)['sort'] == {'key': 'close_time_utc', 'direction': 'desc'}
    assert ids(page(rows, sort='[]', sort_key='invalid', sort_direction='invalid')) == ids(cleared)


@pytest.mark.parametrize('raw', ['null', '{}', '', '[null]', '[{"key":"missing","direction":"asc"}]',
    '[{"key":"symbol","direction":"up"}]', '[{"key":"symbol","direction":"asc","extra":1}]',
    '[{"key":"symbol"}]', json.dumps([SORTS[0], SORTS[0]]), json.dumps([SORTS[0]] * 23)])
def test_invalid_multisort_rejected(raw):
    with pytest.raises(AnalyticsValidationError, match='trade_page_parameters_invalid'):
        page(fixture_rows(), sort=raw)


def test_cached_order_identity_tracks_sort_and_reuses_pages():
    store = MemoryStore()
    service = ReplayReadProjectionService(store)
    asc = '[{"key":"net_pnl","direction":"asc"}]'
    desc = '[{"key":"net_pnl","direction":"desc"}]'
    first = service.trades('tenant-a', page=1, page_size=1, sort=asc)
    reads = len(store.reads)
    second = service.trades('tenant-a', page=2, page_size=1, sort=asc)
    assert len(store.reads) == reads
    assert ids(first) != ids(second) and first['snapshot_key'] == second['snapshot_key']
    reverse = service.trades('tenant-a', page=1, page_size=1, sort=desc)
    clear = service.trades('tenant-a', page=1, page_size=1, sort='[]')
    assert ids(reverse) == ids(second)
    assert len({r['snapshot_key'] for r in (first, reverse, clear)}) == 3
    assert service.trades('tenant-a', page=1, page_size=1, sort=asc) == first
