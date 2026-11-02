"""Registered two-week H4 integration probe on QDM cache exports; offline only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from trading_workspace_v2.forex_h4 import (
    H4, HOUR, H4Builder, FixedH4Candidate, hourly_quotes, inspect_qdm, read_qdm_ticks, size_for_stop,
)
from trading_workspace_v2.forex_financing import FinancingTerms, apply_forex_financing
from trading_workspace_v2.forex_pilot_risk import (
    ForexPilotSnapshot, _stop_at_fill, advance_forex_pilot, initialize_forex_pilot,
    queue_forex_pilot_exit, queue_forex_pilot_order,
)
from trading_workspace_v2.replay_tick_execution import initialize_tick_execution

EXPECTED = {
    'warmup': ('807a05c1e777350f1151674a4c9a1a2288fd11d3f0b1f9fb939509b49d2d83e8', '20211220', '20211231'),
    'development': ('ce49cd3af5f41396b3b831c8e0ea83e2dd9c8e4f5790962052a5b1f4d4fbaf66', '20220103', '20220114'),
}
START = int(datetime(2022, 1, 3, tzinfo=timezone.utc).timestamp()) * 1000
END = int(datetime(2022, 1, 15, tzinfo=timezone.utc).timestamp()) * 1000
SCENARIOS = [('reference', Decimal('0'), Decimal('10')),
             ('cost-stress', Decimal('0.00002'), Decimal('20'))]


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding='utf-8')
    temporary.replace(path)


def financing_calendar(rate):
    current = datetime(2022, 1, 3, 22, tzinfo=timezone.utc)
    while int(current.timestamp()) * 1000 < END:
        if current.weekday() < 5:
            yield FinancingTerms(event_id='declared-' + current.date().isoformat(),
                scheduled_time_msc=int(current.timestamp()) * 1000, known_at_msc=START,
                debit_buy_usd_per_lot=rate, debit_sell_usd_per_lot=rate,
                multiplier=3 if current.weekday() == 2 else 1,
                source='FOREX-PROP-PILOT-20261102.md section 9; hypothetical calendar',
                qualification='declared_scenario')
        current += timedelta(days=1)


def initial_state(name, slippage, data_hash):
    return initialize_forex_pilot(initialize_tick_execution(
        replay_session_id='h4-' + name, branch_id='main', dataset_id='qdm-eurusd-development-20220103-14',
        dataset_sha256=data_hash, tick_snapshot_id='qdm-eurusd-development-20220103-14',
        tick_snapshot_sha256=data_hash, spread_price='0', timeframe_seconds=HOUR,
        starting_balance='10000', cursor_index=0,
        instrument_spec=dict(instrument_id='EURUSD', asset_class='fx', base_ccy='EUR', quote_ccy='USD',
            account_ccy='USD', tick_size='0.00001', pip_size='0.0001', contract_size='100000',
            quantity_min='0.01', quantity_step='0.01', effective_from_utc='2022-01-03T00:00:00Z'),
        cost_model=dict(version='h4-declared-' + name, spread_basis='bid_ask_embedded',
            commission_per_side_account='0', commission_per_side_per_quantity_account='2.50',
            minimum_fee_account='0', slippage_price_per_side=str(slippage), financing_account='0',
            quote_to_account_rate='1', account_ccy='USD', rounding_decimals=2),
        research_margin=dict(version='fixed-starting-balance-leverage-v1', leverage='30')),
        start_time_msc=START)


def reconcile(state, slippage):
    money = lambda v: v.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    realized = financing = Decimal(0)
    for event in state.execution.ledger:
        d = event['details']
        if event['kind'] == 'protective_fill':
            p = d['closed_position']
            quantity = Decimal(p['quantity'])
            direction = 1 if p['side'] == 'BUY' else -1
            gross = (Decimal(d['fill_price']) - Decimal(p['entry_fill'])) * quantity * 100000 * direction
            expected = money(gross - 5 * quantity - 2 * slippage * quantity * 100000)
            if Decimal(d['net_pnl']) != expected:
                raise ValueError('independent closed-trade accounting differs')
            realized += expected
        elif event['kind'] == 'financing':
            terms = d['financing_terms']
            p = d['open_position']
            expected = money(Decimal(terms['debit_buy_usd_per_lot' if p['side'] == 'BUY'
                else 'debit_sell_usd_per_lot']) * Decimal(p['quantity']) * terms['multiplier']) if p else Decimal(0)
            if Decimal(d['debit_account']) != expected:
                raise ValueError('independent financing differs')
            financing += expected
    if state.execution.balance != Decimal('10000') + realized - financing:
        raise ValueError('balance does not reconcile with realized trades and cash events')
    return dict(realized_trade_net_usd=str(realized), financing_debit_usd=str(financing),
                balance_delta_usd=str(realized - financing), independent_accounting='passed')


def run_scenario(path, warmup, name, slippage, debit, output, progress):
    state = initial_state(name, slippage, EXPECTED['development'][0])
    strategy, builder = FixedH4Candidate(), H4Builder()
    for candle in warmup:
        strategy.observe(candle)
    calendar = iter(financing_calendar(debit))
    upcoming = next(calendar, None)
    decisions = []
    for hour, quotes in hourly_quotes(read_qdm_ticks(path, sha256=EXPECTED['development'][0],
                                                     first_day='20220103', last_day='20220114')):
        def post_due(boundary, state):
            nonlocal upcoming
            while upcoming is not None and upcoming.scheduled_time_msc <= boundary:
                state = apply_forex_financing(state, upcoming)
                upcoming = next(calendar, None)
            return state
        state = post_due(hour.timestamp * 1000, state)
        state = advance_forex_pilot(state, ticks=quotes, bar=vars(hour),
                                    cursor_index=state.execution.cursor_index + 1)
        state = post_due((hour.timestamp + HOUR) * 1000, state)
        candle = builder.add(hour)
        if candle:
            position = state.execution.position
            signal, distance = strategy.observe(candle, side=position.side if position else None)
            if signal and state.risk.exit_pending is None and state.execution.pending_market_order is None:
                decision = dict(time_msc=(candle.timestamp + H4) * 1000, signal=signal,
                                stop_distance=str(distance), status='queued')
                operation = f'h4-{candle.timestamp}-{signal}'
                if signal == 'EXIT':
                    state = queue_forex_pilot_exit(state, operation_id=operation)
                elif state.risk.daily_stopped or state.risk.overall_stopped or state.risk.close_pending:
                    decision['status'] = 'skipped_risk_halt'
                else:
                    quantity = size_for_stop(distance, slippage=slippage)
                    decision['quantity'] = str(quantity) if quantity else None
                    if quantity is None:
                        decision['status'] = 'skipped_minimum_lot'
                    else:
                        reference = state.execution.last_ask if signal == 'BUY' else state.execution.last_bid
                        stop = _stop_at_fill(signal, reference, distance, Decimal('0.00001'))
                        state = queue_forex_pilot_order(state, operation_id=operation, side=signal,
                            quantity=quantity, stop_loss=stop, stop_distance=distance, take_profit=None)
                decisions.append(decision)
        progress(name, hour.timestamp + HOUR, state)
        if state.execution.cursor_index % 24 == 0:
            write_json(output / (name + '-checkpoint.json'), state.model_dump(mode='json'))
    builder.finish()
    state = ForexPilotSnapshot.model_validate_json(state.model_dump_json())
    accounting = reconcile(state, slippage)
    write_json(output / (name + '-checkpoint.json'), state.model_dump(mode='json'))
    write_json(output / (name + '-decisions.json'), decisions)
    return dict(scenario=name, **accounting, balance_usd=str(state.execution.balance),
        equity_usd=str(state.execution.equity), open_position=state.execution.position.model_dump(mode='json')
            if state.execution.position else None,
        pending_entry=state.execution.pending_market_order is not None,
        observed_ticks=state.risk.observed_ticks,
        minimum_observed_equity_usd=str(state.risk.minimum_observed_equity),
        entry_fills=sum(e['kind'] == 'market_fill' for e in state.execution.ledger),
        closed_trades=sum(e['kind'] == 'protective_fill' for e in state.execution.ledger),
        signals=len(decisions), risk_stops=[s.model_dump(mode='json') for s in state.risk.stops],
        risk_rejections=[r.model_dump(mode='json') for r in state.risk.rejections],
        broker_spec_verified=False, strategy_pass=False, prop_pass=False,
        intrabar_equity_coverage='insufficient', terminal_close_forced=False,
        snapshot_restart='passed', excluded_h4=builder.excluded)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    receipt = dict(pid=os.getpid(), stage='manifest', updated_at_utc=datetime.now(timezone.utc).isoformat())
    def progress(stage, boundary=None, state=None):
        receipt.update(stage=stage, boundary_utc=boundary,
            updated_at_utc=datetime.now(timezone.utc).isoformat())
        if state:
            receipt.update(observed_ticks=state.risk.observed_ticks,
                           cursor_index=state.execution.cursor_index)
        write_json(args.output_dir / 'receipt.json', receipt)
        print(json.dumps(receipt), flush=True)
    progress('manifest')
    try:
        paths = {name: args.input_dir / name / 'EURUSD_TICK_TW-TICK-No Session.csv' for name in EXPECTED}
        source_files = [Path(__file__), *[V2 / 'trading_workspace_v2' / name for name in
            ('forex_h4.py', 'forex_pilot_risk.py', 'forex_financing.py', 'replay_execution.py',
             'replay_tick_execution.py', 'semantics/data_contracts.py', 'semantics/data_costs.py')]]
        manifest = dict(schema='forex-h4-development-v1', purpose='integration_probe_not_qualification',
            candidate='eurusd-h4-donchian20-10-atr14-r025-v1', contract='FOREX-PROP-PILOT-20261102.md section 9',
            created_at_utc=datetime.now(timezone.utc).isoformat(),
            source_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=V2, text=True).strip(),
            source_files={str(p.relative_to(V2)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files},
            inputs={n: dict(path=str(paths[n]), sha256=v[0], first_day=v[1], last_day=v[2]) for n, v in EXPECTED.items()},
            scenarios=[dict(name=n, commission_usd_per_lot_per_side='2.50', slippage=str(s),
                            hypothetical_financing_usd_per_lot=str(f)) for n, s, f in SCENARIOS],
            financing_calendar=[t.model_dump(mode='json') for t in financing_calendar(Decimal('10'))],
            validation_holdout_read=False, broker_connected=False, price_basis='midpoint',
            risk_usd=[25, 100, 500], broker_spec_verified=False)
        write_json(args.output_dir / 'manifest.json', manifest)
        quality = {}
        for name, (digest, first, last) in EXPECTED.items():
            progress('validate_' + name)
            quality[name], bars = inspect_qdm(paths[name], sha256=digest, first_day=first, last_day=last)
            if name == 'warmup':
                warmup = bars
        write_json(args.output_dir / 'quality.json', quality)
        if len(warmup) < 21:
            raise ValueError('insufficient H4 warmup')
        results = []
        for name, slippage, debit in SCENARIOS:
            results.append(run_scenario(paths['development'], warmup, name, slippage, debit,
                                        args.output_dir, progress))
            write_json(args.output_dir / 'results.json', results)
        progress('completed_declared_scenarios')
    except Exception as error:
        receipt.update(error_type=type(error).__name__, error=str(error))
        progress('failed')
        raise


if __name__ == '__main__':
    main()
