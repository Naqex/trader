import sys, json, copy
from pathlib import Path
v2 = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(v2), str(v2 / 'tests'), str(v2.parent)]
from test_replay_read_projection import MemoryStore
from test_replay_analytics import two_trade_record, closed_trade_record, record
from trading_workspace_v2.replay_read_projection import ReplayReadProjectionService
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.trades_page import build_trades_page

a = two_trade_record()
for event in a['payload']['execution']['ledger']:
    if event['sequence'] >= 4:
        event['virtual_time_utc'] = 1731536060
b = copy.deepcopy(closed_trade_record())
b['record_id'] = 'other-session'
b['payload']['dataset_id'] = 'other-dataset'
b['payload']['execution']['instrument_spec']['instrument_id'] = 'XAUUSD'
store = MemoryStore([a,b])
svc = ReplayReadProjectionService(store)
full = svc.trades('tenant-a', session_ids=[a['record_id']], page=1)
narrow = svc.trades('tenant-a', session_ids=[a['record_id']], page=1, from_close_utc='2024-01-01T00:00:00Z')
assert full['pagination']['filtered_count'] == 2
assert narrow['pagination']['filtered_count'] == 1
assert full['facets'] == narrow['facets']
assert full['facets']['years'] == ['2023','2024']
assert full['facets']['assets'] == ['EURUSD']
assert svc.trades('tenant-a', session_ids=[], page=1)['facets']['assets'] == []
report = build_dashboard_performance([a,b], 'tenant-a', session_ids=[a['record_id']], include_ledger=True)
page = build_trades_page(report, [], page=1, page_size=10, sort_key='close_time_utc', sort_direction='desc')
assert page['facets']['assets'] == ['EURUSD']
catalog = {'items':[{'record_id':r['record_id'],'revision':r['revision'],'name':'Review '+r['record_id'],'instrument_id':'EURUSD' if r is a else 'XAUUSD','dataset_id':r['payload']['dataset_id'],'dataset_available':True,'archived':False,'cursor_index':r['payload']['cursor_index']} for r in [a,b]]}
out = {'full':full, 'empty':svc.trades('tenant-a',session_ids=[],page=1), 'catalog':catalog, 'analytics':build_replay_analytics_view(a), 'record':a}
(Path(__file__).parent/'fixtures.json').write_text(json.dumps(out),encoding='utf-8')
print(json.dumps({'result':'PASS','cases':['scoped assets exclude unselected metadata','empty selection facets zero','base date filter keeps full selected date/year facets','filtered rows remain one; full rows two'],'date_range':narrow['facets']['date_range']}))
