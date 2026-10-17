"""Freeze pure engine admission output from the Python reference; no data/runtime is opened."""
from __future__ import annotations
import copy,json,pathlib,random,subprocess,sys
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
REPORT=ROOT/'foundation_v2/evidence/rust-native-20261017/runtime/engine-integrated'
REPORT.mkdir(parents=True,exist_ok=True)
sys.path[:0]=[str(ROOT),str(ROOT/'foundation_v2')]
import trading_workspace_v2.research as research
from trading_workspace_v2.contracts import CreateEngineResearchJob,DatasetManifest
rules=dict(engine='bar-breakout-v1',lookback=2,hold_bars=3,quantity=1,planned_stop_distance_price=10)
spec=dict(instrument_id='EURUSD',asset_class='fx',base_ccy='EUR',quote_ccy='USD',account_ccy='USD',
          tick_size='0.00001',pip_size='0.0001',contract_size='100000',quantity_min='0.01',quantity_step='0.01',
          effective_from_utc='2026-01-01T00:00:00Z',effective_to_utc='')
cost=dict(version='cost-v1',spread_basis='bid_ask_embedded',account_ccy='USD')
body=dict(dataset_id='dataset-1',playbook_id='playbook-1',playbook_revision=3,starting_balance=10000,
          data_from_utc=1000,data_to_utc=2000,cost_model=cost,engine_backend='reference')
manifest=dict(dataset_id='dataset-1',workspace_id='test',source=dict(source_id='local',provider='fixture',
    instrument_mapping={'EURUSD':'EURUSD'},license_use='fixture only',retrieved_at_utc='2026-01-01',export_settings='fixture'),
    instrument_id='EURUSD',timeframe='M1',row_count=20,first_timestamp=1000,last_timestamp=2140,
    artifact_path='never-opened.parquet',artifact_sha256='a'*64,instrument_spec=spec,timeframe_seconds=60,
    quality={'disposition':'pass'},created_at_utc='2026-01-01T00:00:00Z')
payload=dict(name='Phá đỉnh 📈',status='frozen',execution_capability='engine-supported',rules=rules)
native=dict(adapter_sha256='adapter-fixed-hash',runtime_identity={'python':'3.12.12','pyarrow':'21.0.0','nautilus_trader':'1.231.0'})
base=dict(body=body,manifest=manifest,payload=payload,native=native)
cases=[]
DELETE=object()
def add(changes=None,label=''):
    case=copy.deepcopy(base)
    for path,value in (changes or {}).items():
        target=case
        parts=path.split('/')
        for part in parts[:-1]: target=target[part]
        if value is DELETE: target.pop(parts[-1],None)
        else: target[parts[-1]]=copy.deepcopy(value)
    case['label']=label
    cases.append(case)
add()
add({'body/engine_backend':'nautilus'})
add({'body/engine_backend':'nautilus','native':None})
for key in ['instrument_spec','timeframe_seconds']:
    add({f'manifest/{key}':None})
for value in [{},{'disposition':'fail'},{'disposition':None},{'disposition':True}]: add({'manifest/quality':value})
for value in [None,'draft','frozen ']: add({'payload/status':value})
for value in [None,'manual']: add({'payload/execution_capability':value})
for value in [None,{},dict(rules,lookback=0),dict(rules,quantity=True),dict(rules,engine='wrong')]: add({'payload/rules':value})
for key in ['data_to_utc','data_from_utc']:
    for value in [999,1000,2000,2200,2201]: add({f'body/{key}':value})
for policy in [{},{'mode':'none'},{'mode':'metadata_only'},{'mode':'metadata_only','from_utc':2199},
               {'mode':'metadata_only','from_utc':2200},{'mode':'metadata_only','from_utc':'2200'},
               {'mode':'anything','from_utc':4000}]: add({'manifest/holdout_policy':policy})
for field in spec:
    add({f'manifest/instrument_spec/{field}':DELETE},f'missing instrument {field}')
for field in ['tick_size','pip_size','contract_size','quantity_min','quantity_step']:
    for value in [True,None,0,-1,'NaN','Infinity','nanx','1_._0','١.٥','1e-1000000000']:
        add({f'manifest/instrument_spec/{field}':value},f'instrument {field} {value!r}')
for field in ['version','spread_basis','account_ccy']:
    for value in [None,'','  ',0,True,[],{},['USD']]: add({f'body/cost_model/{field}':value})
for field in ['commission_per_side_account','minimum_fee_account','slippage_price_per_side','financing_account','quote_to_account_rate']:
    for value in [True,None,0,-1,'NaN','Infinity','nanx','1_._0','١.٥','-0','1e-1000000000']:
        add({f'body/cost_model/{field}':value},f'cost {field} {value!r}')
for value in [None,True,'2',2.0,0,-1,8,9,2**100]: add({'body/cost_model/rounding_decimals':value})
add({'body/cost_model/unknown':1})
add({'body/cost_model/account_ccy':'JPY'})
add({'body/cost_model/account_ccy':' usd ','manifest/instrument_spec/account_ccy':' usd '})
add({'body/engine_backend':'nautilus','manifest/instrument_spec/asset_class':'equity'})
add({'body/engine_backend':'nautilus','manifest/instrument_spec/account_ccy':'EUR','body/cost_model/account_ccy':'EUR'})
protective=rules|dict(exit_mode='protective',stop_loss_distance_price=10,take_profit_distance_price=20)
add({'payload/rules':protective})
add({'payload/rules':protective,'body/research_leverage':100})
add({'payload/strategy_spec':{'name':'Có chủ đích','signal':{'x':1e-6,'y':1e20}}})
add({'body/regime_partition':{}})
add({'body/regime_partition':{'regime_field':'volatility','known_at_field':'volatility_known_at','max_regimes':12}})
for index in range(150):
    rng=random.Random(101+index)
    add({'body/starting_balance':rng.uniform(1,10000),'body/seed':rng.randint(-100000,100000),
         'body/spread_price':rng.choice([1e-6,1e-323,0.0,0.0001]),
         'body/research_leverage':rng.choice([None,1,10,1000]),
         'body/engine_backend':rng.choice(['reference','nautilus']),
         'payload/rules/quantity':rng.uniform(0.01,1)*10.0**rng.randint(-10,10)},f'random {index}')
for backend in ['reference','nautilus']:
    for stress in [[],[{'scenario_id':'cost','commission_multiplier':'1.50'}]]:
        add({'body/engine_backend':backend,'body/split':'validation','body/walk_forward':dict(train_bars=5,oos_bars=2,stress_scenarios=stress),
             'body/parameter_space':dict(lookback=[2,3],quantity=[0.1,1e-6]),'body/max_trials':3},'oos')

class Store:
    def get_dataset(self,*args): return self.manifest
    def get_record_revision(self,*args): return {'deleted':False,'payload':self.payload}
    def create_engine_job(self,workspace,dataset,balance,protocol,sha): return protocol

expected=[]
normalized=[]
for case in cases:
    request=CreateEngineResearchJob.model_validate(case['body'])
    dataset=DatasetManifest.model_validate(case['manifest'])
    case['body']=request.model_dump(mode='json')
    case['manifest']=dataset.model_dump(mode='json')
    normalized.append(case)
    store=Store(); store.manifest=dataset; store.payload=case['payload']
    service=research.ResearchService(store,None)
    descriptor=case['native']
    with patch.object(research,'engine_code_sha256',return_value='engine-fixed-hash'), \
         patch.object(research,'runtime_ready',return_value=descriptor is not None), \
         patch.object(research,'adapter_hash',return_value=descriptor['adapter_sha256'] if descriptor else None), \
         patch.object(research,'runtime_identity',return_value=descriptor['runtime_identity'] if descriptor else None):
        try:
            value=service.create_engine_job(workspace_id='test',request=request,walk_forward=request.walk_forward,
                parameter_space=request.parameter_space,max_trials=request.max_trials)
            expected.append({'ok':value,'canonical':json.dumps(value,sort_keys=True,separators=(',',':'))+'\n'})
        except Exception as exc: expected.append({'error':str(exc)})

REPORT.joinpath('oracle.json').write_text(json.dumps([{'input':case,'expected':want} for case,want in zip(normalized,expected)],ensure_ascii=False,separators=(',',':')),encoding='utf-8')
completed=subprocess.run(['cargo','test','--locked','--manifest-path',str(ROOT/'foundation_v2/api-rust/Cargo.toml'),'--lib','research_jobs::engine::tests::python_oracle_differential','--','--nocapture'],text=True,encoding='utf-8',capture_output=True)
REPORT.joinpath('test.log').write_text(completed.stdout+completed.stderr,encoding='utf-8')
receipt={'case_count':len(cases),'successful_requests':sum('ok' in item for item in expected),'rejected_requests':sum('error' in item for item in expected),'exit_code':completed.returncode}
REPORT.joinpath('receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
print(json.dumps(receipt))
if completed.returncode: print((completed.stdout+completed.stderr)[-5000:])
raise SystemExit(completed.returncode)
