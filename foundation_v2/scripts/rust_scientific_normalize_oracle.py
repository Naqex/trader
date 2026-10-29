"""Compare Rust monetary normalization with retained Python and offline engine fills."""
from copy import deepcopy
from decimal import Decimal
import argparse,hashlib,json,os,subprocess,sys,time
from pathlib import Path

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2.parent)]
from trading_workspace_v2.nautilus_worker import normalize_native_result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--real-engine',action='store_true')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    reference=json.loads((V2/'api-rust/tests/fixtures/research_execution/reference.json').read_text(encoding='utf-8'))
    cases=[]
    def add(name,native,protocol,rows=None):
        try:expected=dict(value=normalize_native_result(native,protocol))
        except (ValueError,TypeError,KeyError) as error:expected=dict(error=str(error))
        item=dict(name=name,native=deepcopy(native),protocol=deepcopy(protocol),expected=expected)
        if rows is not None and 'value' in expected:
            from trading_workspace_v2.research_validation import validate_engine_result
            artifact=deepcopy(expected['value'])
            artifact.update(artifact_schema_version='research-engine-result-v1',protocol=protocol,protocol_sha256=hashlib.sha256((json.dumps(protocol,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest(),playbook_id=protocol['playbook']['record_id'],playbook_revision=protocol['playbook']['revision'],dataset_sha256=protocol['dataset']['artifact_sha256'],engine_code_sha256=protocol['engine']['code_sha256'],split=protocol['split'])
            item.update(artifact=artifact,rows=rows)
            try:validate_engine_result(artifact,rows=rows);item['source_oracle']=dict(accepted=True)
            except ValueError as error:item['source_oracle']=dict(accepted=False,error=str(error))
        cases.append(item)
    for index,case in enumerate(reference):
        if 'canonical' not in case['expected']:continue
        result=json.loads(case['expected']['canonical']);protocol=deepcopy(case['protocol'])
        protocol['engine'].update(backend='nautilus',native_version='1.231.0',adapter_version='nautilus-breakout-v1',runtime_identity=dict(python='3.12.10',pyarrow='25.0.1',nautilus_trader='1.231.0'))
        protocol['budget'].setdefault('max_memory_mb',512)
        units=Decimal(str(protocol['playbook']['rules']['quantity']))*Decimal(str(protocol['dataset']['instrument_spec']['contract_size']))
        fills=[]
        for i,trade in enumerate(result['ledger']):
            opened=dict(role='entry',side=trade['side'],units=str(units),price=str(trade['price_open']),signal_time_utc=trade['signal_time_utc'],timestamp_ns=trade['open_time_utc']*10**9+1,client_order_id=f'entry-{i}',native_trade_id=f'fill-entry-{i}',order_type='MARKET',order_list_id=f'bracket-{i}')
            closed=dict(role='exit',side='SELL' if trade['side']=='BUY' else 'BUY',units=str(units),price=str(trade['price_close']),signal_time_utc=trade['signal_time_utc'],timestamp_ns=trade['close_time_utc']*10**9,client_order_id=f'exit-{i}',native_trade_id=f'fill-exit-{i}',order_type='MARKET',order_list_id=f'bracket-{i}')
            if protocol['playbook']['rules'].get('exit_mode')=='protective':
                opened.update({k:trade[k] for k in ['protective_stop_price','protective_take_profit_price','research_margin_required_account']})
                closed.update(exit_reason=trade['exit_reason'],close_time_utc=trade['close_time_utc'])
                reason=trade['exit_reason']
                closed['order_type']='STOP_MARKET' if reason.startswith('stop_loss') else 'LIMIT' if reason.startswith('take_profit') else 'MARKET'
                closed['timestamp_ns']+=1 if reason.endswith('_gap') else 0 if reason=='horizon' else -1
            fills.extend([opened,closed])
        native=dict(native_version='1.231.0',adapter_version='nautilus-breakout-v1',runtime_identity=protocol['engine']['runtime_identity'],fills=fills,signals=result['signals'],observed_range=result['observed_range'],quote_model='bid_ask_embedded',isolation=dict(worker_owned_job_object=True,active_process_limit=1,process_memory_limit_mb=protocol['budget']['max_memory_mb']))
        add(f'synthetic fill normalization {index}',native,protocol,rows=case['rows'])
    valid_count=len(cases)
    first=next(c for c in cases if c['native']['fills'])
    for key in ['native_version','adapter_version','runtime_identity']:
        native=deepcopy(first['native']);native[key]='changed';add(f'changed {key}',native,first['protocol'])
    native=deepcopy(first['native']);native['fills'].pop();add('odd fill count',native,first['protocol'])
    native=deepcopy(first['native']);native['fills'][0]['role']='exit';add('lifecycle role',native,first['protocol'])
    native=deepcopy(first['native']);native['fills'][1]['side']=native['fills'][0]['side'];add('lifecycle side',native,first['protocol'])
    native=deepcopy(first['native']);native['fills'][0]['units']='0.001';add('wrong units',native,first['protocol'])
    real_count=0
    if args.real_engine:
        from foundation_v2.tests import test_u5_engine_oracle as oracle
        from trading_workspace_v2.nautilus_worker import execute_native_process,adapter_hash,runtime_identity
        for direction,values in [('long',[(9.8,9.95,9.7,9.9),(9.9,10.1,9.85,10),(10,10.25,9.95,10.2),(10.03,10.3,10,10.21)]),('short',[(10.2,10.3,10,10.1),(10.1,10.2,9.9,10),(10,10.05,9.7,9.8),(10.17,10.2,9.8,9.93)])]:
            rows=[oracle.bar(i*3600,*row) for i,row in enumerate(values)]
            protocol=oracle.protocol_for(rows,direction=direction)
            protocol['dataset']['artifact_sha256']=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
            protocol['split']='train'
            protocol['engine'].update(backend='nautilus',native_version='1.231.0',adapter_version='nautilus-breakout-v1',adapter_sha256=adapter_hash(),runtime_identity=runtime_identity())
            protocol['budget']['max_memory_mb']=512
            native=execute_native_process(rows,protocol,continue_check=lambda:True,deadline=time.perf_counter()+15)
            add(f'actual offline Nautilus {direction}',native,protocol,rows=rows);real_count+=1
    fixture=args.output/'oracle.json';fixture.write_text(json.dumps(cases,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    result=subprocess.run(['cargo','test','--locked','--manifest-path',str(V2/'api-rust/Cargo.toml'),'--lib','research_execution::scientific_normalize::tests','--','--ignored','--nocapture'],env={**os.environ,'TW_SCIENTIFIC_NORMALIZE_ORACLE':str(fixture.resolve())},capture_output=True,text=True,encoding='utf-8')
    (args.output/'test.log').write_text(result.stdout+result.stderr,encoding='utf-8')
    receipt=dict(passed=result.returncode==0,synthetic_valid_cases=valid_count,actual_offline_engine_cases=real_count,total_cases=len(cases),source_oracle_cases=sum('source_oracle' in c for c in cases),source_oracle_accepted=sum(c.get('source_oracle',{}).get('accepted',False) for c in cases),scope='normalization and independent source/native-evidence validation only; Rust scientific orchestration and persisted publication not established')
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
    if result.returncode:print((result.stdout+result.stderr)[-8000:])
    raise SystemExit(result.returncode)

if __name__=='__main__':main()
