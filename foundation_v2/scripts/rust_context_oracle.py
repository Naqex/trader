"""Export deterministic Python projections for the native context port (no services)."""
from pathlib import Path
import sys,json,itertools,random
from copy import deepcopy
V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2/'tests')]
from test_analytics_experiments import exposure, week_exposure
from test_replay_analytics import record
from trading_workspace_v2.analytics_experiments import build_replay_experiments
from trading_workspace_v2.journal_context import build_journal_context
from trading_workspace_v2.analytics_read_model import analytics_csv,build_analytics_view
from trading_workspace_v2.replay_analytics import build_replay_analytics_view

def main():
    cases=[]
    for side,ambiguous,gap in itertools.product(('BUY','SELL'),(False,True),(False,True)):
        r,bars=exposure(side=side,ambiguous=ambiguous,gap=gap)
        for conf in ({},{'target_r':1},{'target_r':50},{'stop_multiplier':.5},{'stop_distance_ticks':1},{'stop_distance_ticks':1000000,'target_r':100}):
            for f in ({},{'side':side},{'side':'SELL' if side=='BUY' else 'BUY'},{'outcome':'win'}):
                cases.append(dict(kind='experiments',record=r,bars=bars,config=conf,filters=f,sha='d'*64,expected=build_replay_experiments(r,bars,dataset_sha256='d'*64,filters=f,**conf)))
    r,bars=exposure()
    for mode in ('future','missing','entry','cost','version','currency','hash','zero','max'):
        rr,bb=deepcopy(r),deepcopy(bars);sha='d'*64;config={}
        if mode=='future':bb.append({'timestamp':9999999999,'open':'not read'})
        elif mode=='missing':bb=bb[:2]
        elif mode=='entry':bb[1]['open']=1.1002
        elif mode=='cost':rr['payload']['execution']['cost_model']['commission_per_side_account']='2'
        elif mode=='version':rr['payload']['execution']['cost_model']['version']='different'
        elif mode=='currency':rr['payload']['execution']['cost_model']['account_ccy']='EUR'
        elif mode=='hash':sha='foreign'
        elif mode=='zero':config={'target_r':0}
        elif mode=='max':config={'stop_multiplier':101}
        try:expected=build_replay_experiments(rr,bb,dataset_sha256=sha,**config);error=False
        except (TypeError,ValueError,KeyError):expected=None;error=True
        cases.append(dict(kind='experiments',record=rr,bars=bb,config=config,sha=sha,error=error,expected=expected))
    cases.append(dict(kind='experiments',record=record(),bars=[],config={},sha='d'*64,expected=build_replay_experiments(record(),[],dataset_sha256='d'*64)))
    for options in ({},{'side':'SELL'},{'negative':True},{'boundary':True}):
        r,bars=week_exposure(**options)
        cases.append(dict(kind='experiments',record=r,bars=bars,config={},sha='d'*64,expected=build_replay_experiments(r,bars,dataset_sha256='d'*64)))
    rng=random.Random(1729)
    for i in range(60):
        records=[]
        for n in range(rng.randint(0,30)):
            records.append({'payload':{'source':{'session_id':rng.choice(['s','other',None]),'replay_session_id':rng.choice(['s','other',None]),'trade_id':rng.choice(['a','b','c','',None,22]),'id':rng.choice(['a','d','',None,False])},'tags':[rng.choice(['alpha','beta','gamma',22,None]) for _ in range(5)],'note':rng.choice(['','  ','text',None,True,False,42,0]),'notes':rng.choice(['','fallback',None])}})
        cases.append(dict(kind='journal',records=records,expected=build_journal_context(records,'tenant-a','s')))
    csvs=[]
    sources=json.loads((V2/'api-rust/src/analytics/oracle_cases.json').read_text(encoding='utf-8'))
    for case in sources['cases']:
        if case['kind'] not in ('replay','analytics'):continue
        source=sources['inputs'][case['input_ref']]
        try:view=(build_replay_analytics_view if case['kind']=='replay' else build_analytics_view)(source,case.get('filters'))
        except (TypeError,ValueError,KeyError):continue
        csvs.append(dict(kind=case['kind'],source=source,filters=case.get('filters'),expected=analytics_csv(view)))
    (V2/'api-rust/tests/rust_context/csv_oracle.json').write_text(json.dumps(csvs,separators=(',',':')),encoding='utf-8')
    dest=V2/'api-rust/tests/rust_context/oracle.json';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(cases,separators=(',',':')),encoding='utf-8');print(json.dumps({'cases':len(cases),'path':str(dest)}))
if __name__=='__main__':main()
