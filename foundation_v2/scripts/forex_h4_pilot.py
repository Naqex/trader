"""Registered H4 development scenarios on pinned QDM cache exports; offline only."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
import subprocess
import sys
import time
import traceback
from uuid import uuid4
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
from trading_workspace_v2.forex_prop_candidates import PROP_CANDIDATES, PropH4Candidate
from trading_workspace_v2.forex_pilot_risk import (
    ForexPilotSnapshot, _stop_at_fill, advance_forex_pilot, initialize_forex_pilot,
    queue_forex_pilot_exit, queue_forex_pilot_order,
)
from trading_workspace_v2.replay_tick_execution import initialize_tick_execution
from trading_workspace_v2.forex_study_registration import (
    HISTORICAL_SCHEMA, HISTORICAL_PURPOSE, load_registration, validate_registration, runtime_binding,
)

EXPECTED = {
    'warmup': ('807a05c1e777350f1151674a4c9a1a2288fd11d3f0b1f9fb939509b49d2d83e8', '20211220', '20211231'),
    'development': ('ce49cd3af5f41396b3b831c8e0ea83e2dd9c8e4f5790962052a5b1f4d4fbaf66', '20220103', '20220114'),
}
START = int(datetime(2022, 1, 3, tzinfo=timezone.utc).timestamp()) * 1000
END = int(datetime(2022, 1, 15, tzinfo=timezone.utc).timestamp()) * 1000
SCENARIOS = [('reference', Decimal('0'), Decimal('10')),
             ('cost-stress', Decimal('0.00002'), Decimal('20'))]
ALL_STUDY_CANDIDATES = (*STUDY_CANDIDATES, *PROP_CANDIDATES)


def event_logger(output):
    # One handler per attempt, no root/global logging configuration. Rotation
    # applies only to diagnostic events, never raw ticks/checkpoints/results.
    logger = logging.Logger('forex-study', level=logging.INFO)
    handler = RotatingFileHandler(output / 'events.jsonl', maxBytes=1024*1024,
                                 backupCount=2, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)
    return logger, handler


def failure_details(error, stage):
    # Exception text/locals can contain credentials or provider payloads.
    # Source locations plus the pinned code are sufficient to reproduce here.
    frames = []
    for frame in traceback.extract_tb(error.__traceback__):
        path = Path(frame.filename).resolve()
        frames.append(dict(file=str(path.relative_to(V2)) if path.is_relative_to(V2) else path.name,
                           line=frame.lineno, function=frame.name))
    return dict(error_type=type(error).__name__, failed_stage=stage,
                error_code='forex_study_failed', frames=frames,
                exception_text_omitted=True, locals_recorded=False)


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


def input_contract(input_dir, manifest_path=None, *, research_candidate=None, registration=None):
    if research_candidate is not None and research_candidate not in ALL_STUDY_CANDIDATES:
        raise ValueError('unregistered research candidate')
    if research_candidate is not None and manifest_path is None:
        raise ValueError('research candidate requires its pinned input manifest')
    if registration is not None and (research_candidate is None or manifest_path is None):
        raise ValueError('study registration requires a candidate and input manifest')
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
    if registration is not None:
        validate_registration(registration, inputs, research_candidate)
        return inputs
    # Omission retains the legacy guard, not arbitrary holdout access.
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


def content_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def scenario_binding(manifest):
    # Run IDs/timestamps/Git commits may change without changing these inputs
    # or source bytes. Retain full source pins; never infer numeric equivalence.
    keys = ('schema', 'purpose', 'candidate', 'contract', 'source_files', 'inputs',
            'observed_account_spec', 'scenarios', 'validation_holdout_read',
            'broker_connected', 'price_basis', 'risk_usd', 'research_protocol', 'execution_mode',
            'study_registration', 'data_role', 'prior_exposure', 'clean_oos')
    keys = (*keys, 'runtime')
    if 'horizon_cutoffs' in manifest:
        keys = (*keys, 'horizon_cutoffs')
    return content_hash({key: manifest.get(key) for key in keys})


def scenario_files(manifest, name):
    files = [name+'-checkpoint.json', name+'-decisions.json']
    if manifest.get('research_protocol'):
        files.append(name+'-candidate.json')
    if manifest.get('horizon_cutoffs'):
        files.append(name+'-horizons.json')
    return files


def seal_scenario(output, manifest, result, *, reused=False):
    name = result['scenario']
    if name not in {s['name'] for s in manifest['scenarios']}:
        raise ValueError('cannot seal an undeclared scenario')
    write_json(output/(name+'-completed.json'), dict(schema='forex-completed-scenario-v1',
        run_id=manifest['run_id'], scenario=name, binding_sha256=scenario_binding(manifest),
        result_sha256=content_hash(result),
        reused_from=manifest.get('scenario_reuse_source') if reused else None,
        quality_sha256=hashlib.sha256((output/'quality.json').read_bytes()).hexdigest(),
        artifact_sha256={f: hashlib.sha256((output/f).read_bytes()).hexdigest()
                         for f in scenario_files(manifest, name)}))


def reuse_scenario(source, output, manifest, scenario):
    name = scenario['name']
    seal_path = source/(name+'-completed.json')
    if not seal_path.exists():
        return None
    prior = json.loads((source/'manifest.json').read_text(encoding='utf-8'))
    receipt = json.loads((source/'receipt.json').read_text(encoding='utf-8'))
    supervisor_path = source.parent/'terminal.json'
    supervisor = json.loads(supervisor_path.read_text(encoding='utf-8')) if supervisor_path.is_file() else {}
    if receipt.get('run_id') != prior.get('run_id'):
        raise ValueError('prior attempt receipt identity differs')
    if (receipt.get('stage') not in {'failed', 'completed_declared_scenarios'}
            and supervisor.get('status') not in {'failed', 'cancelled', 'timed_out'}):
        raise ValueError('reconcile and stop the prior attempt before scenario reuse')
    seal = json.loads(seal_path.read_text(encoding='utf-8'))
    if (seal.get('schema') != 'forex-completed-scenario-v1'
            or seal.get('run_id') != prior.get('run_id') or seal.get('scenario') != name
            or seal.get('binding_sha256') != scenario_binding(prior)
            or scenario_binding(prior) != scenario_binding(manifest)
            or set(seal.get('artifact_sha256', {})) != set(scenario_files(manifest, name))):
        raise ValueError('completed scenario bindings differ')
    payloads = {f: (source/f).read_bytes() for f in scenario_files(manifest, name)}
    for filename, data in payloads.items():
        if hashlib.sha256(data).hexdigest() != seal['artifact_sha256'][filename]:
            raise ValueError('completed scenario artifact hash differs')
    if any(hashlib.sha256((directory/'quality.json').read_bytes()).hexdigest() != seal['quality_sha256']
           for directory in (source, output)):
        raise ValueError('completed scenario quality differs')
    matches = [r for r in json.loads((source/'results.json').read_text(encoding='utf-8'))
               if r.get('scenario') == name]
    if len(matches) != 1 or content_hash(matches[0]) != seal['result_sha256']:
        raise ValueError('completed scenario result differs')
    result = matches[0]
    state = ForexPilotSnapshot.model_validate_json(payloads[name+'-checkpoint.json'])
    expected = dict(**reconcile(state, scenario['slippage']),
        balance_usd=str(state.execution.balance), equity_usd=str(state.execution.equity),
        observed_ticks=state.risk.observed_ticks,
        open_position=state.execution.position.model_dump(mode='json') if state.execution.position else None,
        pending_entry=state.execution.pending_market_order is not None,
        entry_fills=sum(e['kind'] == 'market_fill' for e in state.execution.ledger),
        closed_trades=sum(e['kind'] == 'protective_fill' for e in state.execution.ledger))
    quality = json.loads((output/'quality.json').read_text(encoding='utf-8'))
    if (any(result.get(k) != v for k, v in expected.items())
            or state.risk.observed_ticks != quality['development']['ticks']
            or (manifest.get('research_protocol') and
                (result.get('candidate') != manifest['candidate'] or result.get('candidate_state_roundtrip') != 'passed'))
            or result.get('strategy_pass') is not False or result.get('prop_pass') is not False
            or result.get('broker_spec_verified') is not False):
        raise ValueError('completed scenario accounting or scope differs')
    for filename, data in payloads.items():
        write_json(output/filename, json.loads(data))
    return result


def run_scenario(path, warmup, name, slippage, debit, output, progress, *, development=None, sell_debit=None,
                 research_candidate=None, tick_cache_dir=None, horizon_cutoffs=None):
    if research_candidate is not None and research_candidate not in ALL_STUDY_CANDIDATES:
        raise ValueError('unregistered research candidate')
    digest, first, last = EXPECTED['development'] if development is None else tuple(
        development[k] for k in ('sha256', 'first_day', 'last_day'))
    start = int(datetime.strptime(first, '%Y%m%d').replace(tzinfo=timezone.utc).timestamp()) * 1000
    end = int((datetime.strptime(last, '%Y%m%d').replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp()) * 1000
    cutoffs = list(horizon_cutoffs or [])
    if (any(type(t) is not int or not start < t <= end or t % (H4*1000) for t in cutoffs)
            or cutoffs != sorted(set(cutoffs))):
        raise ValueError('horizon cutoffs must increase on closed H4 boundaries inside evaluation')
    state = initial_state(name, slippage, digest, start=start, dataset=f'qdm-eurusd-development-{first}-{last}')
    if research_candidate in PROP_CANDIDATES:
        strategy = PropH4Candidate(research_candidate)
    else:
        strategy = ResearchH4Candidate(research_candidate) if research_candidate in CANDIDATES else FixedH4Candidate()
    builder = H4Builder()
    for candle in warmup:
        strategy.observe(candle)
    calendar = iter(financing_calendar(debit, sell_rate=sell_debit, start=start, end=end))
    upcoming = next(calendar, None)
    decisions = []
    horizons = []
    def capture_horizons(boundary):
        while len(horizons) < len(cutoffs) and cutoffs[len(horizons)] <= boundary:
            cutoff = cutoffs[len(horizons)]
            # Capture before processing the next hour, including any pending
            # decision queued at the prior closed H4. Never close/reset a trade.
            horizons.append(dict(cutoff_msc=cutoff,
                last_observed_tick=state.risk.last_tick.model_dump(mode='json') if state.risk.last_tick else None,
                checkpoint=state.model_dump(mode='json'),
                decisions=list(decisions), builder=builder.export_state().model_dump(mode='json'),
                candidate_state=strategy.export_state().model_dump(mode='json'),
                accounting=reconcile(state, slippage),
                qualification='historical_snapshot_not_full_prop_lifecycle',
                promotion_authorized=False))
            write_json(output/(name+'-horizons.json'), horizons)
    if tick_cache_dir is None:
        ticks = read_qdm_ticks(path, sha256=digest, first_day=first, last_day=last)
    else:
        from trading_workspace_v2.forex_qdm_ticks import read_prepared_ticks
        ticks = read_prepared_ticks(path, cache_dir=tick_cache_dir, sha256=digest, first_day=first, last_day=last)
    for hour, quotes in hourly_quotes(ticks):
        if cutoffs:
            capture_horizons(hour.timestamp*1000)
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
            if research_candidate in (*CANDIDATES, *PROP_CANDIDATES):
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
    if cutoffs:
        capture_horizons(end)
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
    parser.add_argument('--inspection-cache-dir', type=Path,
                        help='Load prepared quality/H4 evidence; original input hashes are still checked')
    parser.add_argument('--tick-cache-dir', type=Path,
                        help='Load lossless prepared development ticks; raw/cache hashes and tick validation remain enabled')
    parser.add_argument('--benchmark-only', action='store_true',
                        help='Run registered current-source parity/performance benchmark; never qualify or promote')
    parser.add_argument('--account-spec', type=Path)
    parser.add_argument('--account-spec-sha256')
    parser.add_argument('--candidate', choices=ALL_STUDY_CANDIDATES,
                        help='Registered research comparator; omission preserves the fixed Donchian pilot')
    parser.add_argument('--research-protocol', type=Path)
    parser.add_argument('--study-registration', type=Path)
    parser.add_argument('--study-registration-sha256')
    parser.add_argument('--preflight-only', action='store_true',
                        help='Validate registered inputs/spec/warmup without simulating trades')
    parser.add_argument('--reuse-scenarios-from', type=Path,
                        help='Read sealed completed scenarios from a stopped attempt; output must still be new')
    args = parser.parse_args(argv)
    if bool(args.account_spec) != bool(args.account_spec_sha256):
        parser.error('--account-spec and --account-spec-sha256 must be supplied together')
    if bool(args.candidate) != bool(args.research_protocol):
        parser.error('--candidate and --research-protocol must be supplied together')
    if bool(args.study_registration) != bool(args.study_registration_sha256):
        parser.error('--study-registration and --study-registration-sha256 must be supplied together')
    if args.study_registration and not (args.candidate and args.account_spec and args.input_manifest):
        parser.error('study registration requires candidate, protocol, account spec and input manifest')
    if args.benchmark_only and not args.study_registration:
        parser.error('benchmark-only requires a registered study')
    if args.preflight_only and args.reuse_scenarios_from:
        parser.error('preflight-only does not resume scenarios')
    args.output_dir.mkdir(parents=True, exist_ok=False)
    logger, handler = event_logger(args.output_dir)
    began = time.monotonic()
    cpu_began = time.process_time()
    last_observed, last_cpu = began, cpu_began
    receipt = dict(pid=os.getpid(), run_id=str(uuid4()), event_sequence=0,
        candidate=args.candidate or 'eurusd-h4-donchian20-10-atr14-r025-v1',
        started_at_utc=datetime.now(timezone.utc).isoformat(), stage='manifest')
    def progress(stage, boundary=None, state=None):
        nonlocal last_observed, last_cpu
        previous_stage = receipt['stage']
        observed, cpu = time.monotonic(), time.process_time()
        for key, amount in (('phase_wall_seconds', observed-last_observed),
                            ('phase_cpu_seconds', cpu-last_cpu)):
            phases = receipt.setdefault(key, {})
            phases[previous_stage] = phases.get(previous_stage, 0)+amount
        last_observed, last_cpu = observed, cpu
        receipt.update(stage=stage, boundary_utc=boundary,
            updated_at_utc=datetime.now(timezone.utc).isoformat(),
            elapsed_seconds=round(observed-began, 3),
            process_cpu_seconds=round(cpu-cpu_began, 6),
            event_sequence=receipt['event_sequence']+1)
        if previous_stage != stage and stage in {name for name, _, _ in SCENARIOS}:
            receipt.pop('observed_ticks', None)
            receipt.pop('cursor_index', None)
        if state:
            receipt.update(observed_ticks=state.risk.observed_ticks,
                           cursor_index=state.execution.cursor_index)
        logger.log(logging.ERROR if stage == 'failed' else logging.INFO,
                   json.dumps(dict(schema='forex-study-event-v1', level='ERROR' if stage == 'failed' else 'INFO',
                                   **receipt)))
        write_json(args.output_dir / 'receipt.json', receipt)
        print(json.dumps(receipt), flush=True)
        if on_progress is not None and stage != 'failed':
            on_progress(stage)
    try:
        progress('manifest')
        registration = None
        if args.study_registration:
            frozen_registration = args.output_dir/'study-registration.json'
            frozen_registration.write_bytes(args.study_registration.read_bytes())
            registration = load_registration(frozen_registration, args.study_registration_sha256)
        inputs = input_contract(args.input_dir, args.input_manifest, research_candidate=args.candidate,
                                registration=registration)
        account = observed_account_spec(args.account_spec, args.account_spec_sha256) if args.account_spec else None
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
             'forex_h4_candidates.py', 'forex_prop_candidates.py', 'forex_study_registration.py')]]
        if args.inspection_cache_dir:
            source_files.append(V2/'trading_workspace_v2/forex_qdm_inspection.py')
        if args.tick_cache_dir:
            for module in ('forex_qdm_ticks.py', 'forex_qdm_inspection.py'):
                if V2/'trading_workspace_v2'/module not in source_files:
                    source_files.append(V2/'trading_workspace_v2'/module)
        protocol_bytes = args.research_protocol.read_bytes() if args.candidate else None
        manifest = dict(schema='forex-h4-development-v1', purpose='integration_probe_not_qualification',
            run_id=receipt['run_id'],
            candidate=args.candidate or 'eurusd-h4-donchian20-10-atr14-r025-v1',
            contract=('PROP-STRATEGY-ROUND2-20261105.md' if args.candidate in PROP_CANDIDATES else
                      'PROP-STRATEGY-ROUND1-20261105.md sections 4-6' if args.candidate else
                      'FOREX-PROP-PILOT-20261102.md sections 9-10'),
            created_at_utc=datetime.now(timezone.utc).isoformat(),
            source_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=V2, text=True).strip(),
            source_files={str(p.relative_to(V2)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files},
            runtime=runtime_binding(),
            inputs=inputs, observed_account_spec=account,
            scenarios=[dict(name=s['name'], commission_usd_per_lot_per_side='2.50', slippage=str(s['slippage']),
                financing_calendar=[t.model_dump(mode='json') for t in financing_calendar(s['buy'],
                    sell_rate=s['sell'], start=start, end=end)]) for s in scenarios],
            validation_holdout_read=False, broker_connected=False, price_basis='midpoint',
            risk_usd=[25, 100, 500], broker_spec_verified=False)
        if args.inspection_cache_dir:
            manifest['inspection_cache'] = dict(directory=str(args.inspection_cache_dir.resolve()),
                                                entries={}, raw_hash_rechecked=True)
        if args.tick_cache_dir:
            from trading_workspace_v2.forex_qdm_ticks import tick_cache_metadata
            data, metadata, payload = tick_cache_metadata(paths['development'], cache_dir=args.tick_cache_dir,
                **{k: inputs['development'][k] for k in ('sha256', 'first_day', 'last_day')})
            manifest['tick_cache'] = dict(directory=str(args.tick_cache_dir.resolve()),
                data_path=str(data), data_sha256=payload['sha256'], ticks=payload['ticks'],
                metadata_path=str(metadata), metadata_sha256=hashlib.sha256(metadata.read_bytes()).hexdigest())
        if args.preflight_only:
            manifest['execution_mode'] = 'preflight_only_no_simulation'
        if args.candidate:
            manifest.update(purpose='registered_development_not_qualification',
                research_protocol=dict(path=str(args.research_protocol.resolve()),
                    sha256=hashlib.sha256(protocol_bytes).hexdigest()))
        if registration:
            validate_registration(registration, inputs, args.candidate,
                protocol_sha256=manifest['research_protocol']['sha256'], source_files=manifest['source_files'],
                account_spec_sha256=account['sha256'], scenarios=manifest['scenarios'],
                allow_source_drift=args.benchmark_only)
            manifest.update(schema=HISTORICAL_SCHEMA, purpose=HISTORICAL_PURPOSE,
                contract=registration['study_id'], data_role=registration['data_role'],
                prior_exposure=registration['prior_exposure'], clean_oos=False,
                study_registration=dict(study_id=registration['study_id'],
                    sha256=args.study_registration_sha256))
            if args.benchmark_only:
                manifest['benchmark_only'] = True
                manifest['benchmark_basis'] = 'current_source_against_frozen_registration_and_golden_artifacts'
            (args.output_dir/'protocol.md').write_bytes(protocol_bytes)
            if registration.get('horizon_cutoffs'):
                manifest['horizon_cutoffs'] = registration['horizon_cutoffs']
        if args.reuse_scenarios_from:
            source_bytes = (args.reuse_scenarios_from/'manifest.json').read_bytes()
            manifest['scenario_reuse_source'] = dict(path=str(args.reuse_scenarios_from.resolve()),
                manifest_sha256=hashlib.sha256(source_bytes).hexdigest(), run_id=json.loads(source_bytes)['run_id'])
        write_json(args.output_dir / 'manifest.json', manifest)
        if args.reuse_scenarios_from:
            prior = json.loads(source_bytes)
            if scenario_binding(prior) != scenario_binding(manifest):
                raise ValueError('completed scenario bindings differ')
            if not any((args.reuse_scenarios_from/(s['name']+'-completed.json')).is_file() for s in scenarios):
                raise ValueError('no sealed completed scenario to reuse')
        quality = {}
        for name, item in inputs.items():
            progress('validate_' + name)
            terms = {k: item[k] for k in ('sha256', 'first_day', 'last_day')}
            if args.inspection_cache_dir:
                from trading_workspace_v2.forex_qdm_inspection import load_inspection, inspection_path
                quality[name], bars = load_inspection(paths[name], cache_dir=args.inspection_cache_dir, **terms)
                entry, _ = inspection_path(args.inspection_cache_dir, **terms)
                manifest['inspection_cache']['entries'][name] = dict(path=str(entry.resolve()),
                    sha256=hashlib.sha256(entry.read_bytes()).hexdigest())
            else:
                quality[name], bars = inspect_qdm(paths[name], **terms)
            if name == 'warmup':
                warmup = bars
        write_json(args.output_dir / 'quality.json', quality)
        if args.inspection_cache_dir:
            write_json(args.output_dir / 'manifest.json', manifest)
        if len(warmup) < (81 if args.candidate else 21):
            raise ValueError('insufficient H4 warmup')
        if args.preflight_only:
            progress('preflight_passed_no_simulation')
            return
        reused = {}
        if args.reuse_scenarios_from:
            progress('verify_completed_scenarios')
            reused = {s['name']: reuse_scenario(args.reuse_scenarios_from, args.output_dir, manifest, s)
                      for s in scenarios}
            if not any(value is not None for value in reused.values()):
                raise ValueError('no sealed completed scenario to reuse')
        results = []
        for scenario in scenarios:
            result = reused.get(scenario['name'])
            if result is None:
                result = run_scenario(paths['development'], warmup, scenario['name'], scenario['slippage'],
                    scenario['buy'], args.output_dir, progress,
                    development=inputs['development'], sell_debit=scenario['sell'], research_candidate=args.candidate,
                    tick_cache_dir=args.tick_cache_dir, horizon_cutoffs=manifest.get('horizon_cutoffs'))
            else:
                receipt.setdefault('reused_scenarios', []).append(scenario['name'])
                progress(scenario['name']+'_reused')
            results.append(result)
            write_json(args.output_dir / 'results.json', results)
            seal_scenario(args.output_dir, manifest, result, reused=scenario['name'] in receipt.get('reused_scenarios', []))
        if args.candidate in PROP_CANDIDATES:
            review_entries = []
            for scenario in scenarios:
                decisions = json.loads((args.output_dir / (scenario['name'] + '-decisions.json')).read_text(encoding='utf-8'))
                for decision in decisions:
                    if decision['signal'] in ('BUY', 'SELL'):
                        review_entries.append(dict(
                            signal_id=f"{scenario['name']}:{decision['time_msc']}:{decision['signal']}",
                            scenario=scenario['name'], signal_time_msc=decision['time_msc'],
                            side=decision['signal'], execution_status=decision['status'],
                            manual_decision=None, decided_at_time_msc=None, reason=None))
            # Historical examples cannot establish prospective human discretion.
            write_json(args.output_dir / 'manual-review-template.json', dict(
                schema='forex-manual-review-template-v1', candidate=args.candidate,
                manifest_sha256=hashlib.sha256((args.output_dir / 'manifest.json').read_bytes()).hexdigest(),
                qualification='historical_schema_example_not_prospective_evidence',
                manual_filter_measured=False, risk_override_allowed=False, entries=review_entries))
        progress('completed_declared_scenarios')
    except Exception as error:
        failure = failure_details(error, receipt['stage'])
        write_json(args.output_dir / 'failure.json', dict(run_id=receipt['run_id'], **failure))
        receipt.update(error_type=type(error).__name__, error_code=failure['error_code'],
                       failed_stage=failure['failed_stage'], error='See failure.json source locations; exception text omitted')
        progress('failed')
        raise
    finally:
        handler.close()
        logger.removeHandler(handler)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Forex study failed ({type(error).__name__}); inspect the attempt receipt/failure.json.', file=sys.stderr)
        raise SystemExit(1) from None
