"""Frozen, isolated XAUUSD M1 indicative study using the shared coarse kernel."""
import argparse
from datetime import datetime,timezone
from decimal import Decimal
import hashlib,json
from pathlib import Path
import shutil,sys,time

V2=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(V2))
from forex_coarse_screen import simulate_coarse,coarse_source_pins,h4_from_hours
from forex_h4_pilot import write_json
from trading_workspace_v2.forex_h4_candidates import METAL_CANDIDATES
from trading_workspace_v2.research_market import MetalStudyMarket
from trading_workspace_v2.research_metal_input import aggregate_bid_m1,indicative_hours
from trading_workspace_v2.forex_study_registration import runtime_binding

RAW_SHA='834d4678f8e2a45914119854d5fe7d3ec45a1281c81d4952830fc76a65f636fb'
COSTS={'reference':dict(spread='0.5',slippage='0.1',buy_debit='20',sell_debit='20'),
       'cost-stress':dict(spread='1',slippage='0.2',buy_debit='40',sell_debit='40')}


def source_pins():
    pins=coarse_source_pins()
    for name in ('scripts/metal_coarse_screen.py','trading_workspace_v2/research_metal_input.py'):
        pins[name]=hashlib.sha256((V2/name).read_bytes()).hexdigest()
    return pins


def run(args):
    args.output_dir.mkdir(parents=True,exist_ok=False)
    began=time.perf_counter();cpu=time.process_time()
    def progress(stage,**more):
        if stage!='failed' and time.perf_counter()-began>600:raise TimeoutError('bounded metal screening deadline600s')
        value=dict(stage=stage,wall_seconds=time.perf_counter()-began,cpu_seconds=time.process_time()-cpu,
            updated_at_utc=datetime.now(timezone.utc).isoformat(),**more)
        write_json(args.output_dir/'progress.json',value);print(json.dumps(value),flush=True)
    try:
        config=json.loads(args.config.read_bytes());pins=source_pins()
        if (config['schema']!='metal-discovery8-v1' or config['input_sha256']!=RAW_SHA
                or config['source_files']!=pins or config['runtime']!=runtime_binding()
                or config['candidates']!=list(METAL_CANDIDATES) or config['costs']!=COSTS
                or config['years']!=[2021,2022,2023,2024]
                or hashlib.sha256(Path(config['protocol_path']).read_bytes()).hexdigest()!=config['protocol_sha256']):
            raise ValueError('metal frozen study/source/runtime scope mismatch')
        market=MetalStudyMarket.model_validate(config['market_spec'])
        if market.model_dump(mode='json')!=MetalStudyMarket().model_dump(mode='json'):
            raise ValueError('metal frozen geometry mismatch')
        write_json(args.output_dir/'manifest.json',config)
        shutil.copy2(config['protocol_path'],args.output_dir/'protocol.md')
        for name,sha in pins.items():
            target=args.output_dir/'source-snapshot'/name;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(V2/name,target)
            if hashlib.sha256(target.read_bytes()).hexdigest()!=sha:raise ValueError('source changed during snapshot')
        progress('aggregate_M1_Bid_once')
        raw,quality=aggregate_bid_m1(config['input_path'],RAW_SHA,on_progress=lambda count:progress('aggregate_M1_Bid_once',source_rows=count))
        write_json(args.output_dir/'quality.json',quality)
        rows=[]
        for name,cost in COSTS.items():
            progress('declare_spread_model',scenario=name)
            modeled=indicative_hours(raw,Decimal(cost['spread']))
            for year in config['years']:
                start=int(datetime(year,1,1,tzinfo=timezone.utc).timestamp())*1000
                end=int(datetime(year+1,1,1,tzinfo=timezone.utc).timestamp())*1000
                warmstart=int(datetime(year-1,11,1,tzinfo=timezone.utc).timestamp())*1000
                warm=[h for h in modeled if warmstart<=h.first_time_msc<start]
                hours=[h for h in modeled if start<=h.first_time_msc<end]
                warmup,_=h4_from_hours(warm)
                for candidate in METAL_CANDIDATES:
                    progress('indicative_H1_compute',year=year,candidate=candidate,scenario=name,completed_rows=len(rows))
                    row=simulate_coarse(candidate,warmup,hours,start=start,end=end,data_sha256=RAW_SHA,
                        name=name,slippage=Decimal(cost['slippage']),buy_debit=Decimal(cost['buy_debit']),
                        sell_debit=Decimal(cost['sell_debit']),market_spec=market,input_basis='bid_ohlc_declared_ask')
                    row.update(year=year,starting_balance_usd='10000',quote_spread_usd_per_oz=cost['spread'],
                        time_basis=quality['timestamp_basis'])
                    rows.append(row)
                    write_json(args.output_dir/(str(year)+'-'+candidate+'-'+name+'.json'),row)
        if source_pins()!=pins:raise ValueError('metal source drift during study')
        result=dict(schema='metal-discovery8-results-v1',status='completed_indicative_triage_only',
            rows=rows,quality=quality,source_files=pins,protocol_sha256=config['protocol_sha256'],
            wall_seconds=time.perf_counter()-began,cpu_seconds=time.process_time()-cpu,
            native_tick_risk_and_prop='unsupported_not_evaluated',price_basis='observed_M1_Bid_plus_declared_Ask',
            automatic_rejection_authorized=False,promotion_authorized=False,clean_oos=False,broker_calls=0,llm_calls=0)
        write_json(args.output_dir/'result.json',result);progress('completed_indicative_triage_only',rows=len(rows))
    except BaseException as error:
        write_json(args.output_dir/'failure.json',dict(stage='failed',type=type(error).__name__,message=str(error)))
        progress('failed',type=type(error).__name__)
        raise


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True)
    run(p.parse_args())
