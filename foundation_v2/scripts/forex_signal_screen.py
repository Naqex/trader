"""Cheap causal flat-state probes on verified H4 caches, never portfolio PnL."""
import argparse
from datetime import datetime,timezone
from decimal import Decimal
import hashlib,json,sys,time
from pathlib import Path

V2=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(V2))
from forex_h4_pilot import ALL_STUDY_CANDIDATES, input_contract, study_candidate
from trading_workspace_v2.forex_h4 import H4,size_for_stop
from trading_workspace_v2.forex_qdm_inspection import load_inspection

SCREEN_SOURCE_FILES=('scripts/forex_signal_screen.py','scripts/forex_h4_pilot.py',
    'trading_workspace_v2/forex_h4.py','trading_workspace_v2/forex_h4_candidates.py',
    'trading_workspace_v2/forex_prop_candidates.py','trading_workspace_v2/forex_discovery_candidates.py',
    'trading_workspace_v2/forex_qdm_inspection.py')


def probe(candidate,warmup,bars):
    strategy=study_candidate(candidate)
    for candle in warmup:strategy.observe(candle)
    opportunities=[]
    for candle in bars:
        signal,distance=strategy.observe(candle)
        if signal not in ('BUY','SELL'):continue
        sizes={name:size_for_stop(distance,slippage=slip) for name,slip in
               [('reference',Decimal(0)),('cost-stress',Decimal('.00002'))]}
        opportunities.append(dict(decision_time_msc=(candle.timestamp+H4)*1000,side=signal,
            stop_distance=str(distance),quantity={key:str(value) if value is not None else None for key,value in sizes.items()}))
    sizeable=sum(row['quantity']['cost-stress'] is not None for row in opportunities)
    reason=('no_entry_opportunities_in_window' if not opportunities else
            'needs_lot_cost_review' if not sizeable else 'eligible_for_tick_review')
    return dict(candidate=candidate,reason=reason,flat_entry_opportunities=len(opportunities),
        sizeable_cost_stress_opportunities=sizeable,buys=sum(row['side']=='BUY' for row in opportunities),
        sells=sum(row['side']=='SELL' for row in opportunities),opportunities=opportunities,
        portfolio_simulated=False,promotion_authorized=False,
        interpretation='flat_probes_not_executed_signals_trades_returns_or_prop_fit')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest',type=Path,required=True)
    parser.add_argument('--inspection-cache-dir',type=Path,required=True)
    parser.add_argument('--protocol',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--candidate',choices=ALL_STUDY_CANDIDATES,action='append',required=True)
    args=parser.parse_args(argv)
    if len(set(args.candidate))!=len(args.candidate):raise ValueError('duplicate screen candidates')
    # Create exclusively before reading inputs: a second writer cannot replace evidence.
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as stream:
        began=time.perf_counter()
        protocol_hash=hashlib.sha256(args.protocol.read_bytes()).hexdigest()
        inputs=input_contract(args.input_manifest.parent,args.input_manifest,research_candidate=args.candidate[0])
        reports={};candles={}
        for role,item in inputs.items():
            reports[role],candles[role]=load_inspection(Path(item['path']),cache_dir=args.inspection_cache_dir,
                **{key:item[key] for key in ('sha256','first_day','last_day')})
        if len(candles['warmup'])<81:raise ValueError('insufficient screen warmup')
        load_seconds=time.perf_counter()-began
        rows=[probe(candidate,candles['warmup'],candles['development']) for candidate in args.candidate]
        payload=dict(schema='forex-h4-flat-feasibility-screen-v1',created_at_utc=datetime.now(timezone.utc).isoformat(),
            protocol_sha256=protocol_hash,inputs=inputs,quality=reports,rows=rows,
            load_seconds=load_seconds,probe_seconds=time.perf_counter()-began-load_seconds,
            source_files={name:hashlib.sha256((V2/name).read_bytes()).hexdigest() for name in SCREEN_SOURCE_FILES},
            portfolio_simulated=False,broker_calls=0,model_calls=0,clean_oos=False,promotion_authorized=False)
        json.dump(payload,stream,indent=2)
    print(json.dumps(dict(output=str(args.output),rows=len(rows),load_seconds=load_seconds,
        probe_seconds=payload['probe_seconds'],portfolio_simulated=False)))


if __name__=='__main__':main()
