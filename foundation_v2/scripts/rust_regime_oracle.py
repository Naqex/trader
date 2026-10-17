"""Regime partition/metrics oracle; synthetic rows only, no data/provider access."""
from copy import deepcopy
import json, os, subprocess, sys
from pathlib import Path
from types import SimpleNamespace

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]
from trading_workspace_v2.research import _materialize_regime_partition
from trading_workspace_v2.research_oos import build_regime_metrics

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
rows = [dict(timestamp=i*60, regime='trend' if i//3 % 2 else 'range', regime_known_at=max(0, (i-1)*60)) for i in range(20)]
protocol = dict(range=dict(from_utc=0, to_utc=1200), regime_partition=dict(schema='regime-partition-request-v1', regime_field='regime', known_at_field='regime_known_at', max_regimes=8, max_segments=10000))
manifest = dict(timeframe_seconds=60, holdout_policy={'mode':'none'})
cases = []

def partition_case(name, change=lambda r,p,m: None):
    r,p,m = deepcopy(rows),deepcopy(protocol),deepcopy(manifest)
    change(r,p,m)
    try: expected=dict(value=_materialize_regime_partition(p,r,SimpleNamespace(**m)))
    except (ValueError,TypeError,KeyError) as exc: expected=dict(error=str(exc))
    cases.append(dict(name=name,kind='partition',rows=r,protocol=p,manifest=m,expected=expected))

partition_case('basic')
partition_case('no regime',lambda r,p,m:p.pop('regime_partition'))
partition_case('null request',lambda r,p,m:p.update(regime_partition=None))
partition_case('missing known-at field',lambda r,p,m:r[2].pop('regime_known_at'))
partition_case('missing regime field',lambda r,p,m:r[2].pop('regime'))
for key, values in [('max_regimes',[0,1,2,64,65,True]),('max_segments',[0,1,7,100000,100001,False]),('regime_field',['regime','regime_known_at','bad field','1field','_'*65]),('schema',['bad',None])]:
    for value in values: partition_case(f'{key}={value}',lambda r,p,m,k=key,v=value:p['regime_partition'].update({k:v}))
partition_case('unknown request field',lambda r,p,m:p['regime_partition'].update(extra=1))
for key,values in [('timestamp',[-1,False,0,1,60,1200]),('regime_known_at',[-1,False,None,121,1200]),('regime',['','bad label','é','x'*65,'z-1._'])]:
    for value in values: partition_case(f'row {key}={value}',lambda r,p,m,k=key,v=value:r[2].update({k:v}))
partition_case('empty',lambda r,p,m:r.clear())
partition_case('gap',lambda r,p,m:[row.update(timestamp=row['timestamp']+60) for row in r[10:]])
for boundary in [0,1199,1200,1201]:
    partition_case(f'holdout {boundary}',lambda r,p,m,v=boundary:m.update(holdout_policy=dict(mode='metadata_only',from_utc=v)))

partition = _materialize_regime_partition(protocol,rows,SimpleNamespace(**manifest))
ledger = [dict(trade_id=str(i),open_time_utc=i*120,close_time_utc=i*120+180,net_pnl=i-2.5,gross_pnl=i-2,fees=.5,planned_risk_budget=10) for i in range(8)]
def metrics_case(name,change=lambda p,l:None):
    p,l=deepcopy(partition),deepcopy(ledger)
    change(p,l)
    try:expected=dict(value=build_regime_metrics(p,l,10000))
    except (ValueError,TypeError,KeyError) as exc:expected=dict(error=str(exc))
    cases.append(dict(name=name,kind='metrics',partition=p,ledger=l,balance=10000,expected=expected))
metrics_case('entry regime and cross-segment accounting')
metrics_case('empty ledger',lambda p,l:l.clear())
for field,values in [('open_time_utc',[-1,False,None,1200]),('close_time_utc',[-1,False,None,1201])]:
    for value in values:metrics_case(f'ledger {field}={value}',lambda p,l,k=field,v=value:l[0].update({k:v}))
metrics_case('nonobject trade',lambda p,l:l.__setitem__(0,None))
metrics_case('nonobject segment',lambda p,l:p['segments'].__setitem__(0,None))
metrics_case('disjoint segments',lambda p,l:p['segments'][1].update(from_utc=181))
metrics_case('cutoff before partition',lambda p,l:p.update(cutoff_timestamp=1199))
metrics_case('implicit cutoff',lambda p,l:p.pop('cutoff_timestamp'))
metrics_case('empty segments',lambda p,l:p.update(segments=[]))
metrics_case('boolean cutoff',lambda p,l:p.update(cutoff_timestamp=True))
fixture=output/'oracle.json'
fixture.write_text(json.dumps(cases,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
result=subprocess.run(['cargo','test','--locked','--manifest-path',str(V2/'api-rust/Cargo.toml'),'--lib','research_execution::oos_runner::tests::python_regime_oracle','--','--include-ignored','--nocapture'],env={**os.environ,'TW_REGIME_ORACLE':str(fixture.resolve())},capture_output=True,text=True,encoding='utf-8')
(output/'test.log').write_text(result.stdout+result.stderr,encoding='utf-8')
receipt=dict(cases=len(cases),passed=result.returncode==0)
(output/'receipt.json').write_text(json.dumps(receipt),encoding='utf-8')
print(json.dumps(receipt))
if result.returncode:print((result.stdout+result.stderr)[-6000:])
raise SystemExit(result.returncode)
