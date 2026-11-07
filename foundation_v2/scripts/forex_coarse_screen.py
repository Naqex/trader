"""Approximate H1 PnL triage, never tick/prop qualification or broker execution."""
import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import sys
import time

V2=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(V2))
from forex_h4_pilot import (ALL_STUDY_CANDIDATES,H4_STUDY_CANDIDATES,STUDY_CANDIDATES,
    study_candidate,initial_state,financing_calendar,input_contract,observed_account_spec,write_json)
from trading_workspace_v2.forex_intraday_candidates import INTRADAY_CANDIDATES
from trading_workspace_v2.forex_ml_candidate import ML_CANDIDATES, MLH1Candidate
from trading_workspace_v2.forex_h4_candidates import METAL_CANDIDATES,METAL_BASELINE
from trading_workspace_v2.research_market import MetalStudyMarket,metal_candidate,size_for_market_stop
from trading_workspace_v2.execution_semantics import protective_exit_for_bar
from trading_workspace_v2.forex_coarse_input import CoarseHour,load_coarse_hours,prepare_coarse_hours
from trading_workspace_v2.forex_h4 import CandleState,H4,HOUR,H4Builder,TICK,size_for_stop
from trading_workspace_v2.forex_pilot_risk import _stop_at_fill
from trading_workspace_v2.replay_execution import ReplayOpenPosition
from trading_workspace_v2.retained import CostModel,InstrumentSpec,calculate_round_trip_cost
from trading_workspace_v2.forex_study_registration import load_registration,validate_registration


def h4_from_hours(hours):
    builder=H4Builder();bars=[]
    for hour in hours:
        bar=builder.add(hour.mid.candle())
        if bar is not None:bars.append(bar)
    builder.finish()
    return bars,list(builder.excluded)


def simulate_coarse(candidate,warmup,hours,*,start,end,data_sha256,name,slippage,buy_debit,sell_debit,
                    model_pack=None,market_spec=None,input_basis='observed_bidask'):
    began=time.perf_counter();cpu=time.process_time()
    if candidate not in (*ALL_STUDY_CANDIDATES,*ML_CANDIDATES,*METAL_CANDIDATES):raise ValueError('unsupported coarse candidate')
    if (candidate in ML_CANDIDATES)!=(model_pack is not None):raise ValueError('explicit ML pack required only for ML candidates')
    if (candidate in METAL_CANDIDATES)!=(market_spec is not None):raise ValueError('explicit matching metal market required')
    if market_spec is not None:
        market_spec=MetalStudyMarket.model_validate(market_spec)
        if input_basis!='bid_ohlc_declared_ask':raise ValueError('metal indicative source basis required')
    elif input_basis!='observed_bidask':raise ValueError('legacy quote source basis changed')
    if (type(start) is not int or type(end) is not int or start>=end
            or start%(HOUR*1000) or end%(HOUR*1000)):
        raise ValueError('invalid coarse evaluation boundaries')
    if any(not x.is_finite() for x in (slippage,buy_debit,sell_debit)) or slippage<0:
        raise ValueError('invalid coarse costs')
    period=HOUR if candidate in (*INTRADAY_CANDIDATES,*ML_CANDIDATES) else H4
    warmup=[CandleState(**vars(bar)).candle() for bar in warmup]
    if (len(warmup)<(100 if period==HOUR else 81) or any(b.timestamp<=a.timestamp for a,b in zip(warmup,warmup[1:]))
            or any(bar.timestamp%period or (bar.timestamp+period)*1000>start for bar in warmup)):
        raise ValueError('invalid coarse warmup')
    hours=[CoarseHour.model_validate(h) for h in hours]
    if (not hours or any(not start<=h.first_time_msc<=h.last_time_msc<end for h in hours)
            or any(b.mid.timestamp<=a.mid.timestamp or b.first_time_msc<a.last_time_msc
                for a,b in zip(hours,hours[1:]))):
        raise ValueError('coarse hours outside ordered evaluation window')
    base=(market_spec.execution(name,slippage,data_sha256,start) if market_spec else
          initial_state(name,slippage,data_sha256,start=start).execution)
    model=CostModel.from_mapping(base.cost_model);instrument=InstrumentSpec.from_mapping(base.instrument_spec)
    strategy=(metal_candidate(candidate) if market_spec else MLH1Candidate(candidate,model_pack)
              if model_pack is not None else study_candidate(candidate))
    for candle in warmup:strategy.observe(candle)
    builder=H4Builder();position=None;pending=None;balance=base.starting_balance
    finance_total=Decimal(0);position_finance=Decimal(0);position_entry_msc=None;counter=0;rejections=0
    trades=[];decisions=[];fees=[]
    calendar=iter(financing_calendar(buy_debit,sell_rate=sell_debit,start=start,end=end))
    upcoming=next(calendar,None)
    def post_due(boundary):
        nonlocal upcoming,balance,finance_total,position_finance
        while upcoming is not None and upcoming.scheduled_time_msc<boundary:
            if position is not None:
                rate=upcoming.debit_buy_usd_per_lot if position.side=='BUY' else upcoming.debit_sell_usd_per_lot
                debit=(rate*position.quantity*upcoming.multiplier).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
                balance-=debit;finance_total+=debit;position_finance+=debit
                fees.append(dict(event_id=upcoming.event_id,debit_usd=str(debit),position_id=position.position_id))
            upcoming=next(calendar,None)
    def price_net(pos,bid,ask):
        return calculate_round_trip_cost(model,pos.side,pos.quantity,instrument.contract_size,
            pos.entry_bid,pos.entry_ask,bid,ask)
    def close(hour,price,reason,*,at_open):
        nonlocal position,balance,position_finance,position_entry_msc
        # Only the closeable side enters PnL. The opposite side is modeled as
        # equal, not claimed to be an observed quote at an unknown stop instant.
        costs=price_net(position,price,price);value=Decimal(str(costs['net_account']))
        balance+=value
        trades.append(dict(position_id=position.position_id,side=position.side,quantity=str(position.quantity),
            entry_time_msc=position_entry_msc,
            exit_time_msc=hour.first_time_msc if at_open else None,
            exit_interval_msc=[hour.first_time_msc,hour.first_time_msc] if at_open else [hour.first_time_msc,hour.last_time_msc],
            reason=reason,entry_fill=str(position.entry_fill),exit_fill=str(price),
            price_net_usd=str(value),timed_financing_usd=str(position_finance),
            net_usd=str(value-position_finance),costs=costs,
            exit_price_basis=('modeled_M1_open_declared_Ask_not_observed_quote' if market_spec else
                'observed_open_closeable_side') if at_open else 'modeled_stop_level_not_first_crossing_tick'))
        position=None;position_finance=Decimal(0);position_entry_msc=None
    for index,hour in enumerate(hours,1):
        post_due(hour.mid.timestamp*1000+1)  # Fee at the boundary precedes its first quote.
        first_bid,first_ask=hour.bid[0],hour.ask[0]
        if position is not None:
            opening=first_bid if position.side=='BUY' else first_ask
            gap=protective_exit_for_bar(side=position.side,
                bar=dict(open=opening,high=opening,low=opening,close=opening),
                stop_loss=position.stop_loss,take_profit=None,spread_price=0,tick_size=instrument.tick_size,allow_open_gap=True)
            if gap:close(hour,gap['exit_price'],gap['reason'],at_open=True)
        action,pending=pending,None
        if action is not None:
            if hour.first_time_msc<action['time_msc']:raise ValueError('coarse fill before decision')
            if action['signal']=='EXIT':
                if position is not None:
                    close(hour,first_bid if position.side=='BUY' else first_ask,'strategy_exit',at_open=True)
            else:
                if position is not None:raise ValueError('coarse pending entry conflicts with position')
                quantity=Decimal(action['quantity']);side=action['signal']
                entry=first_ask if side=='BUY' else first_bid
                required=entry*quantity*instrument.contract_size*model.quote_to_account_rate/base.research_margin.leverage
                if required>base.starting_balance:rejections+=1
                else:
                    counter+=1;position_entry_msc=hour.first_time_msc
                    position=ReplayOpenPosition(position_id=f'coarse-{counter}',source_operation_id=f'coarse-entry-{counter}',
                        side=side,quantity=quantity,entry_bid=first_bid,entry_ask=first_ask,entry_fill=entry,
                        stop_loss=_stop_at_fill(side,entry,Decimal(action['stop_distance']),instrument.tick_size),take_profit=None,
                        opened_cursor_index=index,opened_time_utc=hour.first_time_msc//1000)
        if position is not None:
            side_prices=hour.bid if position.side=='BUY' else hour.ask
            protection=protective_exit_for_bar(side=position.side,
                bar=dict(zip(('open','high','low','close'),side_prices)),stop_loss=position.stop_loss,
                take_profit=None,spread_price=0,tick_size=instrument.tick_size,allow_open_gap=True)
            if protection:
                close(hour,protection['exit_price'],protection['reason'],at_open=protection['at_open'])
        complete_h4=builder.add(hour.mid.candle())
        candle=hour.mid.candle() if period==HOUR else complete_h4
        if candle is not None:
            kwargs=dict(side=position.side if position else None)
            if candidate not in (STUDY_CANDIDATES[0],METAL_BASELINE):kwargs['position_id']=position.position_id if position else None
            if model_pack is not None:kwargs['spread']=hour.ask[3]-hour.bid[3]
            signal,distance=strategy.observe(candle,**kwargs)
            if signal:
                decision=dict(time_msc=(candle.timestamp+period)*1000,signal=signal,
                    stop_distance=str(distance),status='queued')
                if signal in ('BUY','SELL'):
                    quantity=(size_for_market_stop(distance,instrument=instrument,model=model) if market_spec
                              else size_for_stop(distance,slippage=slippage))
                    if quantity is not None and quantity>50:raise ValueError('coarse quantity exceeds account maximum')
                    decision['quantity']=str(quantity) if quantity else None
                    if quantity is None:decision['status']='skipped_minimum_lot'
                decisions.append(decision)
                if decision['status']=='queued':pending=decision
    post_due(end)
    builder.finish()
    floating=(Decimal(str(price_net(position,hours[-1].bid[3],hours[-1].ask[3])['net_account']))
        if position is not None else Decimal(0))
    expected=base.starting_balance+sum((Decimal(t['price_net_usd']) for t in trades),Decimal(0))-finance_total
    if balance!=expected:raise ValueError('coarse cash does not reconcile')
    result=dict(schema='forex-coarse-pnl-v1',candidate=candidate,scenario=name,
        net_equity_usd=str(balance+floating-base.starting_balance),balance_usd=str(balance),floating_usd=str(floating),
        entry_fills=counter,closed_trades=len(trades),open_position=position.model_dump(mode='json') if position else None,
        pending_entry=bool(pending and pending['signal']!='EXIT'),pending_action=pending,
        margin_rejections=rejections,financing_debit_usd=str(finance_total),open_position_financing_usd=str(position_finance),
        consumed_hours=len(hours),source_ticks=sum(h.ticks for h in hours),excluded_h4=builder.excluded,
        trades=trades,decisions=decisions,financing_events=fees,
        wall_seconds=time.perf_counter()-began,cpu_seconds=time.process_time()-cpu,
        input_sha256=data_sha256,execution_basis='H1_side_extrema_and_first_observed_quotes',
        stop_fill_basis='level_or_hour_open_not_first_crossing_tick',
        internal_risk_and_prop='not_evaluated',intrabar_drawdown='not_evaluated',
        qualification='approximate_triage_only_tick_review_required',
        automatic_rejection_authorized=False,promotion_authorized=False,broker_calls=0,model_calls=0)
    if market_spec:
        result.update(research_market=market_spec.model_dump(mode='json'),input_basis=input_basis,
            source_m1_rows=result.pop('source_ticks'),source_ticks=None,
            execution_basis='M1_Bid_to_H1_declared_Ask_model_not_observed_bidask',
            skipped_minimum_lot=sum(d['status']=='skipped_minimum_lot' for d in decisions),
            broker_spec_verified=False)
    return result


def coarse_source_pins():
    files=[Path(__file__),V2/'scripts/forex_h4_pilot.py',*[V2/'trading_workspace_v2'/name for name in (
        'forex_coarse_input.py','forex_h4.py','forex_h4_candidates.py','forex_prop_candidates.py',
        'forex_discovery_candidates.py','forex_intraday_candidates.py','forex_ml_candidate.py','research_market.py','forex_pilot_risk.py',
        'forex_financing.py','forex_qdm_inspection.py','forex_study_registration.py','execution_semantics.py',
        'semantics/data_costs.py','semantics/data_contracts.py','replay_execution.py','replay_tick_execution.py')]]
    return {str(p.relative_to(V2)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest',type=Path,required=True)
    parser.add_argument('--cache-dir',type=Path,required=True)
    parser.add_argument('--protocol',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--candidate',action='append',choices=ALL_STUDY_CANDIDATES)
    parser.add_argument('--study-registration',type=Path)
    parser.add_argument('--study-registration-sha256')
    args=parser.parse_args(argv)
    if bool(args.study_registration) != bool(args.study_registration_sha256):
        parser.error('study registration requires both path and SHA256')
    args.output_dir.mkdir(parents=True,exist_ok=False)
    start_time=time.perf_counter();prepared={};proofs={};phase='manifest'
    def progress(event):
        event.update(updated_at_utc=datetime.now(timezone.utc).isoformat())
        write_json(args.output_dir/'progress.json',event)
        print(json.dumps(event),flush=True)
    try:
        progress(dict(stage=phase,status='validating_scope'))
        raw=json.loads(args.input_manifest.read_bytes())
        protocol_hash=hashlib.sha256(args.protocol.read_bytes()).hexdigest()
        source_pins=coarse_source_pins()
        registration=(load_registration(args.study_registration,args.study_registration_sha256)
                      if args.study_registration else None)
        selected=args.candidate or (list(registration['candidates']) if registration else list(H4_STUDY_CANDIDATES))
        if not selected or len(selected)!=len(set(selected)):raise ValueError('empty or duplicate coarse candidates')
        scenarios=[('reference',Decimal(0),Decimal('9.3'),Decimal('-.31')),
                   ('cost-stress',Decimal('.00002'),Decimal(20),Decimal(20))]
        if registration:
            if registration.get('prop_profile') is not None:
                raise ValueError('coarse screen does not evaluate registered prop lifecycle')
            inputs=input_contract(args.input_manifest.parent,args.input_manifest,
                research_candidate=selected[0],registration=registration)
            if inputs['development']['last_day']>'20241231':
                raise ValueError('coarse historical screen excludes 2025+ holdout')
            account=registration['account_spec']
            observed=observed_account_spec(Path(account['path']),account['sha256'])
            scenarios[0]=('reference',Decimal(0),Decimal(observed['debit_buy_usd_per_lot']),
                          Decimal(observed['debit_sell_usd_per_lot']))
            # The whitelist module cannot pin its own content registration hash.
            bound={k:v for k,v in source_pins.items() if k!='trading_workspace_v2/forex_study_registration.py'}
            if registration.get('coarse_source_files')!=bound:
                raise ValueError('coarse numerical sources differ from registration')
            (args.output_dir/'study-registration.json').write_bytes(args.study_registration.read_bytes())
        else:
            inputs={role:raw[role] for role in ('warmup','development')}
            expected={'warmup':('20211201','20211231','63b63be980254b572bbc3ec2d7e1d68726ffeb510d0202f29c0c975670e1a640'),
                'development':('20220103','20220331','dfe850eff9150032b865f82949f758fe422b9798fb9f55f7077c48cd63f8a2de')}
            if raw.get('schema')!='forex-h4-inputs-v1' or any(
                    any(inputs[role][k]!=v for k,v in zip(('first_day','last_day','sha256'),values))
                    for role,values in expected.items()):
                raise ValueError('coarse pilot permits only frozen consumed Q1 inputs without registration')
        start=int(datetime.strptime(inputs['development']['first_day'],'%Y%m%d').replace(tzinfo=timezone.utc).timestamp())*1000
        end=int((datetime.strptime(inputs['development']['last_day'],'%Y%m%d').replace(tzinfo=timezone.utc)+timedelta(days=1)).timestamp())*1000
        if registration:
            declared=[dict(name=name,commission_usd_per_lot_per_side='2.50',slippage=str(slip),
                financing_calendar=[t.model_dump(mode='json') for t in financing_calendar(buy,sell_rate=sell,start=start,end=end)])
                for name,slip,buy,sell in scenarios]
            for candidate in selected:
                validate_registration(registration,inputs,candidate,protocol_sha256=protocol_hash,
                    source_files=source_pins,account_spec_sha256=account['sha256'],scenarios=declared)
        deadline=registration.get('preparation_deadline_seconds',300) if registration else 300
        if type(deadline) is not int or not 1<=deadline<=1800:raise ValueError('invalid preparation deadline')
        for role,item in inputs.items():
            phase='load_'+role
            progress(dict(stage=phase,status='preparing' if args.prepare_only else 'loading'))
            kwargs={k:item[k] for k in ('sha256','first_day','last_day')}
            fn=prepare_coarse_hours if args.prepare_only else load_coarse_hours
            extra=dict(on_progress=progress,deadline_seconds=max(.1,deadline-(time.perf_counter()-start_time))) if args.prepare_only else {}
            prepared[role],proofs[role]=fn(Path(item['path']),cache_dir=args.cache_dir,**kwargs,**extra)
        if args.prepare_only:
            result=dict(status='prepared',inputs=raw,proofs=proofs,wall_seconds=time.perf_counter()-start_time)
        else:
            warmup,_=h4_from_hours(prepared['warmup']);rows=[];phase='coarse_compute'
            for candidate in selected:
                candidate_warmup=([h.mid.candle() for h in prepared['warmup']]
                    if candidate in INTRADAY_CANDIDATES else warmup)
                for name,slip,buy,sell in scenarios:
                    row=simulate_coarse(candidate,candidate_warmup,prepared['development'],start=start,end=end,
                        data_sha256=inputs['development']['sha256'],name=name,slippage=slip,
                        buy_debit=buy,sell_debit=sell)
                    rows.append(row);progress(dict(stage=phase,candidate=candidate,scenario=name,
                        completed_rows=len(rows),wall_seconds=row['wall_seconds']))
            result=dict(schema='forex-coarse-screen-report-v1',status='completed_triage_only',
                rows=rows,inputs=raw,proofs=proofs,wall_seconds=time.perf_counter()-start_time,
                promotion_authorized=False,automatic_rejection_authorized=False)
        if coarse_source_pins()!=source_pins:raise ValueError('coarse source changed during run')
        result.update(protocol_sha256=protocol_hash,source_files=source_pins,broker_calls=0,model_calls=0)
        if registration:
            result.update(study_registration=dict(study_id=registration['study_id'],sha256=args.study_registration_sha256),
                clean_oos=False,data_role=registration['data_role'],prop_lifecycle='not_evaluated')
        write_json(args.output_dir/'result.json',result)
        progress(dict(stage='completed',status=result['status'],wall_seconds=time.perf_counter()-start_time))
    except Exception as error:
        failure=dict(stage='failed',status='failed',error_type=type(error).__name__,failed_phase=phase)
        write_json(args.output_dir/'failure.json',failure)
        progress(failure)
        raise


if __name__=='__main__':main()
