"""Local, no-provider CSV contract oracle; immutable artifact writes use a separate PG workflow."""
from copy import deepcopy
import json, os
from pathlib import Path
import subprocess, sys, tempfile
V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2.parent)]
from trading_workspace_v2.api import CsvDataImportRequest
from trading_workspace_v2.data_ingest import preview_csv

def fixture_request():
    return dict(csv_text='time,open,high,low,close,volume\n0,1,2,0,1.5,3\n60,1.5,2,1,1.7,4\n',source=dict(source_id='local',provider='CSV',instrument_mapping={'EURUSD':'EUR/USD'},license_use='owner fixture',retrieved_at_utc='2026-10-17',export_settings='UTF-8'),instrument=dict(instrument_id='EURUSD',asset_class='forex',base_ccy='eur',quote_ccy='usd',account_ccy='usd',tick_size='0.00001',pip_size='0.0001',contract_size='100000',quantity_min='0.01',quantity_step='0.01',effective_from_utc='2020-01-01'),timeframe_seconds=60)
def main():
    output=Path(sys.argv[1]);output.mkdir(parents=True,exist_ok=True)
    base=fixture_request()
    cases=[]
    def add(name,change,price_only=None,requested_range=None):
        body=deepcopy(base);change(body)
        try:
            request=CsvDataImportRequest.model_validate(body)
        except ValueError:cases.append(dict(name=name,body=body,error='validation'));return
        with tempfile.TemporaryDirectory(prefix='csv-preview-oracle-') as temp:
            path=Path(temp)/'source.csv';path.write_bytes(request.csv_text.encode())
            try:expected=preview_csv(path,request.source,price_only if price_only is not None else request.instrument,request.timeframe_seconds,holdout_policy=request.holdout_policy,requested_range=requested_range)
            except ValueError as e:cases.append(dict(name=name,body=body,error=str(e),price_only=price_only,range=requested_range));return
        cases.append(dict(name=name,body=body,expected=expected,price_only=price_only,range=requested_range))
    add('basic',lambda b:None)
    for value in ['0','60','-1','-0','2024-01-01T00:00:00Z','2024-01-01 00:00:00+07:00','2024-01-01T00:00Z','2024-01-01','2024-01-01 00:00:00','bad','1.5','2024-01-01T00:00:00.123+05:30']:
        add('timestamp '+value,lambda b,v=value:b.update(csv_text=b['csv_text'].replace('\n0,','\n'+v+',')))
    for field in ['open','high','low','close','volume']:
        for value in ['NaN','Infinity','-Infinity','-0.0000','1e-10','1.00000000000000000000000000005','1.0000000000000000000000000005','1.0000000000000000000000000015','bad','', ' 1.2 ']:
            def change(b,f=field,v=value):
                rows=b['csv_text'].splitlines();parts=rows[1].split(',');parts[['time','open','high','low','close','volume'].index(f)]=v;rows[1]=','.join(parts);b['csv_text']='\n'.join(rows)+'\n'
            add(f'{field} {value}',change)
    for text in ['time,open,high,low,close\n','time,open,high,low,close\n0,1,2,0,1\n60,1,2,0,1\n','time,open,high,low,close\n0,1,2,0,1\n0,1,2,0,1\n120,1,2,0,1\n60,1,2,0,1\n','time,open,high,low,close,volume\n0,1,2,0,1\n','time,open,high,low,close,volume\n0,1,2,0,1,2,extra\n','time,open,high,low,close,open\n0,1,2,0,1,1.5\n','\ufefftime,open,high,low,close\n0,1,2,0,1\n',' time,open,high,low,close\n0,1,2,0,1\n']:
        add('CSV '+str(len(cases)),lambda b,t=text:b.update(csv_text=t))
    for policy in [None,{}, {'mode':'none'},{'mode':'metadata_only','from_utc':60},{'mode':'metadata_only','from_utc':'61'},{'mode':'metadata_only','from_utc':61.9},{'mode':'metadata_only','from_utc':True},{'mode':'open'}]:add('holdout '+str(policy),lambda b,p=policy:b.update(holdout_policy=p))
    for field in ['tick_size','pip_size','contract_size','quantity_min','quantity_step']:
        for value in ['1.0000','0','NaN','1e-8',-1]:add('instrument '+field+str(value),lambda b,f=field,v=value:b['instrument'].update({f:v}))
    add('unicode provenance',lambda b:b['source'].update(license_use='Tiếng Việt € 𐀀'))
    for value in [0,False,None,'',True,' 2027-01-01 ']:add('instrument effective_to '+str(value),lambda b,v=value:b['instrument'].update(effective_to_utc=v))
    for value in ['1969-12-31T23:59:59.5Z','2024-01-01T00:00:00+0000','2024-01-01T00:00:00+00','20240101T000000Z']:
        add('ISO expanded '+value,lambda b,v=value:b.update(csv_text=b['csv_text'].replace('\n0,','\n'+v+',')))
    for symbol in ['EURUSD','BTC/USD','BAD symbol','eurusd','-EURUSD','A'*81]:
        for coverage in [None,(0,120),(0,180),(-60,120),(60,120),(0,60),(0,0)]:
            add('provider '+symbol+str(coverage),lambda b:None,price_only=symbol,requested_range=coverage)
    fixture=output/'oracle.json';fixture.write_text(json.dumps(cases,ensure_ascii=False),encoding='utf-8')
    results=[]
    for target in [['--test','rust_data_ingest'],['--lib','data_routes::ingest::streaming_tests::python_ordered_provider_preview']]:
        result=subprocess.run(['cargo','test','--locked',*target,'--','--ignored','--nocapture'],cwd=V2/'api-rust',env={**os.environ,'TW_DATA_PREVIEW_ORACLE':str(fixture.resolve())},capture_output=True,text=True)
        results.append(dict(target=target,passed=result.returncode==0,stdout=result.stdout,stderr=result.stderr))
        print(result.stdout);print(result.stderr)
        if result.returncode:break
    (output/'receipt.json').write_text(json.dumps(dict(passed=all(r['passed'] for r in results),cases=len(cases),results=results),indent=2),encoding='utf-8')
    raise SystemExit(result.returncode)
if __name__=='__main__':main()
