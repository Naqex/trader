"""Synthetic chronological OOS/reference differential without artifacts/providers."""
from pathlib import Path
import copy,json,subprocess,sys
from types import SimpleNamespace
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];V2=ROOT/'foundation_v2';sys.path[:0]=[str(ROOT),str(V2)]
from trading_workspace_v2 import research,research_engine
from trading_workspace_v2.research_oos import summarize_sweep_outcomes
OUT=V2/'evidence/rust-native-20261017/runtime/oos-execution'
reference=json.loads((V2/'api-rust/tests/fixtures/research_execution/reference.json').read_text(encoding='utf-8'))

def run(rows,protocol,manifest,run_engine=None):
    run_engine=run_engine or research_engine.execute_breakout
    validation=research._materialize_oos_validation(protocol,rows,SimpleNamespace(**manifest))
    trials=[];outcomes=[]
    for trial in validation['sweep']['trials']:
        result=dict(trial_id=trial['trial_id'],parameters=trial['parameters'],status='completed',folds=[])
        for fold in validation['walk_forward']['folds']:
            fold_result=dict(fold=fold['fold'],status='completed',stress_scenarios=[])
            for scenario in validation['stress']['scenarios']:
                scenario_result=dict(scenario_id=scenario['scenario_id'],config=copy.deepcopy(scenario),status='completed')
                for segment,split in [('train','train'),('oos','validation')]:
                    planned=fold[segment];slice_rows=rows[planned['start_index']:planned['stop_index']]
                    sliced=copy.deepcopy(protocol);sliced.pop('validation');sliced['split']=split;sliced['range']={k:planned[k] for k in ['from_utc','to_utc']}
                    sliced['playbook']['rules'].update(trial['parameters']);sliced=research._apply_cost_fill_stress(sliced,scenario)
                    try:
                        engine=run_engine(slice_rows,sliced)
                        scenario_result[segment]=dict(status='completed',metrics=engine['metrics'],signals=engine['signals'],trade_count=len(engine['ledger']),observed_range=engine['observed_range'])
                    except research_engine.ResearchEngineValidationError as exc:
                        scenario_result[segment]=dict(status='failed',error=str(exc)[:500]);scenario_result['status']=fold_result['status']=result['status']='failed'
                fold_result['stress_scenarios'].append(scenario_result)
                if scenario['scenario_id']=='base':
                    for key in ['train','oos']:fold_result[key]=copy.deepcopy(scenario_result[key])
            result['folds'].append(fold_result)
        outcomes.append(dict(trial_id=trial['trial_id'],status=result['status']));trials.append(result)
    return dict(validation=validation,trials=trials,terminal_outcomes=outcomes,outcome_summary=summarize_sweep_outcomes(validation['sweep'],outcomes))

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    cases=[]
    with patch.object(research_engine,'verify_engine_code',return_value=None):
        for index in range(60):
            source=reference[index];rows=copy.deepcopy(source['rows']);protocol=copy.deepcopy(source['protocol']);protocol['split']='validation'
            manifest=dict(timeframe_seconds=60,holdout_policy={'mode':'none'})
            walk=dict(train_bars=30,oos_bars=25,max_folds=2,expanding=index%2==0,purge_bars=index%3,embargo_bars=index%2,overlap_bars=0)
            if index%3:walk['stress_scenarios']=[dict(scenario_id='cost',commission_multiplier='1.5',spread_price_multiplier='1.2')]
            protocol['validation']=research._canonical_oos_request(protocol['playbook']['rules'],walk,{'lookback':[1,2],'quantity':[.1,.2]},3)
            try:expected={'canonical':json.dumps(run(rows,protocol,manifest),sort_keys=True,separators=(',',':'))+'\n'}
            except Exception as exc:expected={'error':str(exc)}
            cases.append(dict(rows=rows,protocol=protocol,manifest=manifest,expected=expected))
            if index<10:
                tampered=copy.deepcopy(protocol);tampered['validation']['sweep']['trials'][0]['parameters']['quantity']=99
                cases.append(dict(rows=rows,protocol=tampered,manifest=manifest,expected={'error':'research validation protocol changed after job creation'}))
                blocked=dict(manifest,holdout_policy={'mode':'metadata_only','from_utc':1200})
                cases.append(dict(rows=rows,protocol=protocol,manifest=blocked,expected={'error':'research validation plan cannot be materialized'}))
    (V2/'api-rust/tests/fixtures/research_execution/oos.json').write_text(json.dumps(cases,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    completed=subprocess.run(['cargo','test','--locked','--manifest-path',str(V2/'api-rust/Cargo.toml'),'--lib','research_execution::oos_runner::tests::python_oos_oracle','--','--nocapture'],capture_output=True,text=True,encoding='utf-8')
    (OUT/'test.log').write_text(completed.stdout+completed.stderr,encoding='utf-8');receipt={'cases':len(cases),'exit_code':completed.returncode};(OUT/'receipt.json').write_text(json.dumps(receipt),encoding='utf-8');print(json.dumps(receipt))
    if completed.returncode:print((completed.stdout+completed.stderr)[-7000:])
    raise SystemExit(completed.returncode)

if __name__=='__main__':main()
