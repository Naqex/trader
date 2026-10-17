"""Pure reference compute differential, synthetic OHLC only."""
from pathlib import Path
import copy,json,random,subprocess,sys
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];V2=ROOT/'foundation_v2';sys.path[:0]=[str(ROOT),str(V2)]
from trading_workspace_v2.research_engine import execute_breakout
from trading_workspace_v2 import research_engine
OUT=V2/'evidence/rust-native-20261017/runtime/reference';OUT.mkdir(parents=True,exist_ok=True)
base=json.loads((V2/'evidence/rust-native-20261017/runtime/engine-integrated/oracle.json').read_text(encoding='utf-8'))[0]['expected']['ok']
base['range']={'from_utc':1000,'to_utc':1000+120*60};base['budget']['max_runtime_ms']=30000;base['playbook']['rules'].update(quantity=0.1,planned_stop_distance_price=0.001)
cases=[]
def add(protocol,rows):
    with patch.object(research_engine,'verify_engine_code',return_value=None):
        try:
            result=execute_breakout(rows,protocol)
            expected={'canonical':json.dumps(result,sort_keys=True,separators=(',',':'))+'\n'}
        except Exception as exc: expected={'error':str(exc)}
    cases.append({'protocol':copy.deepcopy(protocol),'rows':copy.deepcopy(rows),'expected':expected})
for seed in range(200):
    rng=random.Random(seed);rows=[];price=1.1
    for index in range(120):
        opening=round(price+rng.uniform(-.0002,.0002),5);close=round(opening+rng.uniform(-.001,.001),5)
        rows.append({'timestamp':1000+index*60,'open':opening,'high':round(max(opening,close)+rng.uniform(0,.0003),5),'low':round(min(opening,close)-rng.uniform(0,.0003),5),'close':close,'volume':10});price=close
    protocol=copy.deepcopy(base);protocol['playbook']['rules'].update(lookback=rng.randint(1,8),hold_bars=rng.randint(1,8),direction=rng.choice(['both','long','short']))
    protocol['parameters']['spread_price']=rng.choice([0,.0001,.00001]);protocol['parameters']['cost_model'].update(commission_per_side_account=str(rng.choice([0,.3,.555])),slippage_price_per_side=str(rng.choice([0,.00001])),financing_account=str(rng.choice([-.1,0,.1])))
    if seed%2:
        protocol['playbook']['rules'].update(exit_mode='protective',stop_loss_distance_price=.001,take_profit_distance_price=.002)
        protocol['parameters']['research_margin']={'version':'fixed-starting-balance-leverage-v1','leverage':rng.choice([1,10,100,1000])}
    add(protocol,rows)
    if seed<10:
        bad=copy.deepcopy(protocol);bad['budget']['max_bars']=10;add(bad,rows)
        badrows=copy.deepcopy(rows);badrows[10]['timestamp']=badrows[9]['timestamp'];add(protocol,badrows)
        badrows=copy.deepcopy(rows);badrows[10]['high']=0;add(protocol,badrows)
(OUT/'oracle.json').write_text(json.dumps(cases,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
completed=subprocess.run(['cargo','test','--locked','--manifest-path',str(V2/'api-rust/Cargo.toml'),'--lib','research_execution::reference::tests::python_execution_oracle','--','--nocapture'],capture_output=True,text=True,encoding='utf-8')
(OUT/'test.log').write_text(completed.stdout+completed.stderr,encoding='utf-8');receipt={'cases':len(cases),'exit_code':completed.returncode};(OUT/'receipt.json').write_text(json.dumps(receipt),encoding='utf-8');print(json.dumps(receipt))
if completed.returncode:print((completed.stdout+completed.stderr)[-10000:])
raise SystemExit(completed.returncode)
