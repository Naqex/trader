"""Registered H4 development scenarios on pinned QDM cache exports; offline only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from trading_workspace_v2.forex_h4 import (
    H4, HOUR, H4Builder, FixedH4Candidate, hourly_quotes, inspect_qdm, read_qdm_ticks, size_for_stop,
)
from trading_workspace_v2.forex_financing import FinancingTerms, apply_forex_financing
from trading_workspace_v2.forex_h4_candidates import CANDIDATES, STUDY_CANDIDATES, ResearchH4Candidate
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
    # Windows readers without FILE_SHARE_DELETE briefly block atomic replacement.
    for attempt in range(21):
        try:
            temporary.replace(path)
            return
        except PermissionError as error:
            if getattr(error, 'winerror', None) not in (5, 32) or attempt == 20:
                raise
            time.sleep(0.05)


def input_contract(input_dir, manifest_path=None, *, research_candidate=None):
    if research_candidate is not None and research_candidate not in STUDY_CANDIDATES:
        raise ValueError('unregistered research candidate')
    if research_candidate is not None and manifest_path is None:
        raise ValueError('research candidate requires its pinned input manifest')
    if manifest_path is None:
        return {n: dict(path=str(input_dir / n / 'EURUSD_TICK_TW-TICK-No Session.csv'),
                       sha256=v[0], first_day=v[1], last_day=v[2]) for n, v in EXPECTED.items()}
    raw = json.loads(manifest_path.read_text(encoding='utf-8'))
    if raw.get('schema') != 'forex-h4-inputs-v1':
        raise ValueError('unsupported input manifest schema')
    inputs = {n: raw[n] for n in EXPECTED}
    for item in inputs.values():
        if not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            raise ValueError('input manifest requires a SHA256 pin')
        for key in ('first_day', 'last_day'):
            if not re.fullmatch('[0-9]{8}', item[key]):
                raise ValueError('input dates must use YYYYMMDD')
            datetime.strptime(item[key], '%Y%m%d')
        if item['first_day'] > item['last_day'] or not Path(item['path']).is_absolute():
            raise ValueError('input manifest requires ordered dates and absolute paths')
    # This runner implements the registered development contract, not arbitrary holdout access.
    if (inputs['warmup']['last_day'] >= inputs['development']['first_day']
            or inputs['development']['first_day'] != '20220103'
            or inputs['development']['last_day'] not in {'20220114', '20220331'}
            or (research_candidate is None and tuple(inputs['warmup'][k] for k in
                ('sha256', 'first_day', 'last_day')) != EXPECTED['warmup'])
            or (research_candidate is not None and (inputs['warmup']['first_day'], inputs['warmup']['last_day'])
                != ('20211201', '20211231'))):
        raise ValueError('input window differs from registered development contract')
    return inputs


def observed_account_spec(path, digest):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('account spec hash mismatch')
    raw = json.loads(data)
    if (raw.get('schema') != 'ftmo-current-mt5-spec-v1'
            or raw.get('qualification') != 'current_observation_not_historical_2022'
            or raw.get('historical_spec_verified') is not False
            or raw.get('commission_account_specific_verified') is not False):
        raise ValueError('unsupported or misqualified account spec')
    captured = datetime.fromisoformat(raw['captured_at_utc'])
    if captured.tzinfo is None:
        raise ValueError('account capture requires a timezone')
    account, instrument = raw['account'], raw['instrument']
    # Fixed candidate/core assumptions must match; do not silently discard other account terms.
    for actual, expected in ((account, dict(currency='USD', currency_digits=2, leverage=30,
            server='FTMO-Demo', trade_mode=0, margin_mode=2, margin_so_mode=0,
            margin_so_call=100, margin_so_so=50)),
            (instrument, dict(name='EURUSD', currency_base='EUR', currency_profit='USD',
            currency_margin='EUR', trade_calc_mode=0, trade_contract_size=100000,
            point=0.00001, trade_tick_size=0.00001, trade_tick_value=1,
            trade_tick_value_profit=1, trade_tick_value_loss=1, digits=5,
            volume_min=0.01, volume_step=0.01, volume_max=50, volume_limit=0,
            trade_stops_level=0, trade_freeze_level=0, margin_initial=0,
            margin_maintenance=0, swap_mode=1, swap_rollover3days=3))):
        for key, value in expected.items():
            if actual.get(key) != value:
                raise ValueError('unsupported account spec field: ' + key)
    rates = []
    for side in ('long', 'short'):
        points = Decimal(str(instrument['swap_' + side]))
        if not points.is_finite():
            raise ValueError('swap points must be finite')
        rates.append(-points * Decimal(str(instrument['point']))
                     * Decimal(str(instrument['trade_contract_size'])))
    return dict(path=str(path), sha256=digest, captured_at_utc=raw['captured_at_utc'],
        instrument_spec_verified_at_capture=True, commission_account_specific_verified=False,
        historical_spec_verified=False, qualification=raw['qualification'],
        debit_buy_usd_per_lot=str(rates[0]), debit_sell_usd_per_lot=str(rates[1]),
        research_margin='fixed_leverage_not_server_stop_out',
        financing_timing='declared_2022_counterfactual_not_historical_known_at')


def financing_calendar(rate, *, sell_rate=None, start=START, end=END):
    current = datetime.fromtimestamp(start / 1000, timezone.utc).replace(hour=22)
    while int(current.timestamp()) * 1000 < end:
        if current.weekday() < 5:
            yield FinancingTerms(event_id='declared-' + current.date().isoformat(),
                scheduled_time_msc=int(current.timestamp()) * 1000, known_at_msc=start,
                debit_buy_usd_per_lot=rate, debit_sell_usd_per_lot=rate if sell_rate is None else sell_rate,
                multiplier=3 if current.weekday() == 2 else 1,
                source='FOREX-PROP-PILOT-20261102.md sections 9-10; counterfactual calendar/rates',
                qualification='declared_scenario')
        current += timedelta(days=1)


def initial_state(name, slippage, data_hash, *, start=START, dataset='qdm-eurusd-development-20220103-14'):
    return initialize_forex_pilot(initialize_tick_execution(
        replay_session_id='h4-' + name, branch_id='main', dataset_id=dataset,
        dataset_sha256=data_hash, tick_snapshot_id=dataset,
        tick_snapshot_sha256=data_hash, spread_price='0', timeframe_seconds=HOUR,
        starting_balance='10000', cursor_index=0,
        instrument_spec=dict(instrument_id='EURUSD', asset_class='fx', base_ccy='EUR', quote_ccy='USD',
            account_ccy='USD', tick_size='0.00001', pip_size='0.0001', contract_size='100000',
            quantity_min='0.01', quantity_step='0.01',
            effective_from_utc=datetime.fromtimestamp(start / 1000, timezone.utc).isoformat()),
        cost_model=dict(version='h4-declared-' + name, spread_basis='bid_ask_embedded',
            commission_per_side_account='0', commission_per_side_per_quantity_account='2.50',
            minimum_fee_account='0', slippage_price_per_side=str(slippage), financing_account='0',
            quote_to_account_rate='1', account_ccy='USD', rounding_decimals=2),
        research_margin=dict(version='fixed-starting-balance-leverage-v1', leverage='30')),
        start_time_msc=start)


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


def run_scenario(path, warmup, name, slippage, debit, output, progress, *, development=None, sell_debit=None,
                 research_candidate=None):
    if research_candidate is not None and research_candidate not in STUDY_CANDIDATES:
        raise ValueError('unregistered research candidate')
    digest, first, last = EXPECTED['development'] if development is None else tuple(
        development[k] for k in ('sha256', 'first_day', 'last_day'))
    start = int(datetime.strptime(first, '%Y%m%d').replace(tzinfo=timezone.utc).timestamp()) * 1000
    end = int((datetime.strptime(last, '%Y%m%d').replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp()) * 1000
    state = initial_state(name, slippage, digest, start=start, dataset=f'qdm-eurusd-development-{first}-{last}')
    strategy = ResearchH4Candidate(research_candidate) if research_candidate in CANDIDATES else FixedH4Candidate()
    builder = H4Builder()
    for candle in warmup:
        strategy.observe(candle)
    calendar = iter(financing_calendar(debit, sell_rate=sell_debit, start=start, end=end))
    upcoming = next(calendar, None)
    decisions = []
    for hour, quotes in hourly_quotes(read_qdm_ticks(path, sha256=digest, first_day=first, last_day=last)):
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
            position_args = dict(side=position.side if position else None)
            if research_candidate in CANDIDATES:
                position_args['position_id'] = position.position_id if position else None
            signal, distance = strategy.observe(candle, **position_args)
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
                    if quantity is not None and quantity > Decimal('50'):
                        raise ValueError('candidate quantity exceeds supported account maximum')
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
    candidate_evidence = {}
    if research_candidate is not None:
        candidate_state = strategy.export_state()
        restored = type(strategy).from_state(type(candidate_state).model_validate_json(candidate_state.model_dump_json()))
        if restored.export_state() != candidate_state:
            raise ValueError('research candidate state does not roundtrip')
        write_json(output / (name + '-candidate.json'), dict(candidate=research_candidate,
            state=candidate_state.model_dump(mode='json'), builder=builder.export_state().model_dump(mode='json'),
            cursor_index=state.execution.cursor_index, cli_resume_supported=False))
        candidate_evidence = dict(candidate=research_candidate, candidate_state_roundtrip='passed')
    return dict(scenario=name, **candidate_evidence, **accounting, balance_usd=str(state.execution.balance),
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


def main(argv=None, on_progress=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--input-manifest', type=Path)
    parser.add_argument('--account-spec', type=Path)
    parser.add_argument('--account-spec-sha256')
    parser.add_argument('--candidate', choices=STUDY_CANDIDATES,
                        help='Registered research comparator; omission preserves the fixed Donchian pilot')
    parser.add_argument('--research-protocol', type=Path)
    args = parser.parse_args(argv)
    if bool(args.account_spec) != bool(args.account_spec_sha256):
        parser.error('--account-spec and --account-spec-sha256 must be supplied together')
    if bool(args.candidate) != bool(args.research_protocol):
        parser.error('--candidate and --research-protocol must be supplied together')
    inputs = input_contract(args.input_dir, args.input_manifest, research_candidate=args.candidate)
    account = observed_account_spec(args.account_spec, args.account_spec_sha256) if args.account_spec else None
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
        if on_progress is not None and stage != 'failed':
            on_progress(stage)
    progress('manifest')
    try:
        paths = {name: Path(item['path']) for name, item in inputs.items()}
        scenarios = [dict(name=n, slippage=s,
            buy=Decimal(account['debit_buy_usd_per_lot']) if account and n == 'reference' else f,
            sell=Decimal(account['debit_sell_usd_per_lot']) if account and n == 'reference' else f)
            for n, s, f in SCENARIOS]
        first, last = (inputs['development'][k] for k in ('first_day', 'last_day'))
        start = int(datetime.strptime(first, '%Y%m%d').replace(tzinfo=timezone.utc).timestamp()) * 1000
        end = int((datetime.strptime(last, '%Y%m%d').replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp()) * 1000
        source_files = [Path(__file__), *[V2 / 'trading_workspace_v2' / name for name in
            ('forex_h4.py', 'forex_pilot_risk.py', 'forex_financing.py', 'replay_execution.py',
             'replay_tick_execution.py', 'semantics/data_contracts.py', 'semantics/data_costs.py',
             'forex_h4_candidates.py')]]
        manifest = dict(schema='forex-h4-development-v1', purpose='integration_probe_not_qualification',
            candidate=args.candidate or 'eurusd-h4-donchian20-10-atr14-r025-v1',
            contract='PROP-STRATEGY-ROUND1-20261105.md sections 4-6' if args.candidate else 'FOREX-PROP-PILOT-20261102.md sections 9-10',
            created_at_utc=datetime.now(timezone.utc).isoformat(),
            source_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=V2, text=True).strip(),
            source_files={str(p.relative_to(V2)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files},
            inputs=inputs, observed_account_spec=account,
            scenarios=[dict(name=s['name'], commission_usd_per_lot_per_side='2.50', slippage=str(s['slippage']),
                financing_calendar=[t.model_dump(mode='json') for t in financing_calendar(s['buy'],
                    sell_rate=s['sell'], start=start, end=end)]) for s in scenarios],
            validation_holdout_read=False, broker_connected=False, price_basis='midpoint',
            risk_usd=[25, 100, 500], broker_spec_verified=False)
        if args.candidate:
            manifest.update(purpose='registered_development_not_qualification',
                research_protocol=dict(path=str(args.research_protocol.resolve()),
                    sha256=hashlib.sha256(args.research_protocol.read_bytes()).hexdigest()))
        write_json(args.output_dir / 'manifest.json', manifest)
        quality = {}
        for name, item in inputs.items():
            progress('validate_' + name)
            quality[name], bars = inspect_qdm(paths[name], **{k: item[k] for k in ('sha256', 'first_day', 'last_day')})
            if name == 'warmup':
                warmup = bars
        write_json(args.output_dir / 'quality.json', quality)
        if len(warmup) < (81 if args.candidate else 21):
            raise ValueError('insufficient H4 warmup')
        results = []
        for scenario in scenarios:
            results.append(run_scenario(paths['development'], warmup, scenario['name'], scenario['slippage'],
                scenario['buy'], args.output_dir, progress,
                development=inputs['development'], sell_debit=scenario['sell'], research_candidate=args.candidate))
            write_json(args.output_dir / 'results.json', results)
        progress('completed_declared_scenarios')
    except Exception as error:
        receipt.update(error_type=type(error).__name__, error=str(error))
        progress('failed')
        raise


if __name__ == '__main__':
    main()
