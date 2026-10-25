from pathlib import Path
from decimal import Decimal
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import json,os,urllib.parse,urllib.request
root=Path(os.environ.get('AUDIT_OUTPUT','E:/BACKUP-TRADINGWORKSPACE/trade-data-audit-20261025'))
def read(path,params=None):
    if params:path+='?'+urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8010'+path,headers={'X-Workspace-Id':'tenant-a'}),timeout=30) as r:return json.load(r)
def page(**extra):
    return read('/api/v2/replay/trades',dict(page=1,page_size=100,time_basis='activity',timezone='UTC',sort_key='report_time_utc',sort_direction='desc',**extra))
def instant(value):
    if value is None:return None
    if isinstance(value,(int,float)):return float(value)/(1000 if abs(value)>=1e11 else 1)
    return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
data=page()
raw={sid:read('/api/v2/replay/sessions/'+sid) for sid in data['scope']['session_ids']}
labels=read('/api/v2/trade-labels')
assert labels['items']==[], 'This real-data receipt expects the observed empty label catalog'
for sid,value in raw.items():(root/(sid+'.json')).write_text(json.dumps(value,indent=2),encoding='utf-8')
checks=[]
for row in data['ledger']:
    record=raw[row['session_id']];p=record['payload'];dataset=row.get('dataset_id') or p['dataset_id']
    state=(p['asset_states'][dataset] if p.get('asset_states') else {'execution':p['execution']})['execution']
    seq=row.get('asset_close_event_sequence') or row['close_event_sequence']
    event=next(e for e in state['ledger'] if e['sequence']==seq);d=event['details']
    entry=next(e for e in state['ledger'] if e['kind']=='market_fill' and e['details']['position_id']==d['position_id'] and e['details']['operation_id']==d['operation_id'])
    # These persisted legacy sessions predate both recording-proof schemas.
    assert not p.get('entry_recording') and not p.get('activity_recording')
    assert row.get('recorded_at_utc') is None and row.get('report_time_utc') is None
    assert row.get('close_recorded_at_utc') is None
    entry_details=entry['details']
    entry_type=entry_details.get('entry_order',{}).get('order_type') or entry_details.get('open_position',{}).get('entry_order_type') or ('market' if entry_details.get('execution_timing')=='current_quote' else None)
    assert row.get('entry_type')==entry_type
    assert row['tags']==[] and not row.get('has_notes')
    fields={'price_open':entry['details']['fill_price'],'price_close':d['fill_price'],'net_pnl':d['net_pnl'],'open_time_utc':entry['virtual_time_utc'],'close_time_utc':event['virtual_time_utc'],'symbol':state['instrument_spec']['instrument_id'],'side':entry['details']['side'],'session_name':p.get('name') or record['record_id'],'account_currency':state['instrument_spec']['account_ccy'],'starting_balance':p.get('starting_balance') or state['starting_balance']}
    cost=d.get('cost_breakdown')
    if cost:
        fields['gross_pnl']=cost['gross_account'];fields['fees']=Decimal(str(cost['gross_account']))-Decimal(str(cost['net_account']))
        assert Decimal(str(row['gross_pnl']))-Decimal(str(row['fees']))==Decimal(str(row['net_pnl']))
    else:fields.update(gross_pnl=None,fees=None)
    for k in ['stop_loss','take_profit']:fields[k]=d.get('closed_position',{}).get(k)
    fields['quantity']=d.get('quantity') or d.get('closed_position',{}).get('quantity') or entry['details']['quantity']
    for key,expected in fields.items():
        actual=row.get(key)
        if expected is None:assert actual is None,(key,actual)
        elif key in ['symbol','side','session_name','account_currency']:assert actual==expected,(key,actual,expected)
        elif key.endswith('_time_utc'):assert instant(actual)==instant(expected),(key,actual,expected)
        else:assert Decimal(str(actual))==Decimal(str(expected)),(key,actual,expected)
    assert row['planned_risk_budget'] is None and row['realized_r'] is None
    assert row['source_provenance']['revision']==record['revision']
    # Legacy rows lacking recording proofs must not borrow a virtual timestamp.
    if row['report_time_utc'] is None:assert row.get('close_recorded_at_utc') is None
    checks.append({'session_id':row['session_id'],'trade_id':row['trade_id'],'fields':len(fields),'gross':row.get('gross_pnl'),'fees':row.get('fees'),'net':row['net_pnl']})
ident=lambda r:(r['session_id'],r['trade_id'])
baseline={ident(r) for r in data['ledger']}
numeric={'net_pnl','return_pct','realized_r','price_open','quantity','stop_loss','take_profit','price_close','gross_pnl','fees'}
sorts=['session_id','status','source','recorded_at_utc','open_time_utc','symbol','side','entry_type','net_pnl','return_pct','realized_r','tags','price_open','quantity','stop_loss','take_profit','report_time_utc','close_time_utc','price_close','gross_pnl','fees']
def sort_value(r,key):
    if key=='session_id':return r.get('session_name') or r['session_id']
    if key=='status':return 'Closed'
    if key=='source':return 'Replay'
    if key=='tags':return ', '.join(r.get('tags',[]))
    if key=='return_pct':return Decimal(str(r['net_pnl']))/Decimal(str(r['starting_balance']))*100 if r.get('starting_balance',0)>0 else None
    value=r.get(key)
    return instant(value) if key.endswith('_time_utc') or key=='recorded_at_utc' else Decimal(str(value)) if key in numeric and value is not None else value
for key in sorts:
    for direction in ['asc','desc']:
        result=read('/api/v2/replay/trades',dict(page=1,page_size=100,time_basis='activity',timezone='UTC',sort_key=key,sort_direction=direction))
        assert {ident(r) for r in result['ledger']}==baseline
        values=[sort_value(r,key) for r in result['ledger']];known=[v for v in values if v is not None]
        assert known==sorted(known,reverse=direction=='desc'),(key,direction,values)
        assert values==known+[None]*(len(values)-len(known)),(key,'unknown ordering')
pagination=[]
for size in [5,10,100]:
    rows=[]
    for index in range(1,max(1,(len(baseline)+size-1)//size)+1):
        result=read('/api/v2/replay/trades',dict(page=index,page_size=size,time_basis='activity',timezone='UTC'))
        rows+=result['ledger']
    assert len(rows)==len(baseline) and {ident(r) for r in rows}==baseline
    pagination.append(size)
filter_cases=[('sides',['buy'],lambda r:r['side'].lower()=='buy'),('outcomes',['loss'],lambda r:r['net_pnl']<0),('types',['market'],lambda r:r.get('entry_type')=='market'),('assets',['EUR/USD'],lambda r:r['symbol']=='EUR/USD')]
for key,values,predicate in filter_cases:
    result=page(extra_filters=json.dumps({key:values,'timezone':'UTC'}))
    assert {ident(r) for r in result['ledger']}=={ident(r) for r in data['ledger'] if predicate(r)},key
report={'status':'PASS','scope':'read-only persisted sources to API','rows':len(checks),'sessions':len(raw),'row_checks':checks,'sort_cases':len(sorts)*2,'page_sizes':pagination,'filter_cases':len(filter_cases),'gross_known':sum(r['gross_pnl'] is not None for r in data['ledger']),'protection_known':sum(r.get(k) is not None for r in data['ledger'] for k in ['stop_loss','take_profit'])}
(root/'api-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
(root/'after-page.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='row_checks'}))
