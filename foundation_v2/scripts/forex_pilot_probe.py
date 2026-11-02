"""Bounded accounting probe on registered QDM ticks; no strategy or broker access."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from itertools import groupby
from pathlib import Path

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from trading_workspace_v2.forex_pilot_risk import (
    ForexPilotSnapshot, advance_forex_pilot, initialize_forex_pilot, queue_forex_pilot_order,
)
from trading_workspace_v2.replay_tick_execution import (
    BrokerReplayTick, close_tick_order, initialize_tick_execution,
)

REGISTERED_HASH = 'd994e395d53b4e8c01e18e10ec65f0b5d394a17a0020d025f96de8cd6f72ba49'
START = int(datetime(2022, 1, 3, 12, tzinfo=timezone.utc).timestamp()) * 1000
END = START + 3600000
QUANTITY = Decimal('0.01')
CONTRACT = Decimal('100000')
COMMISSION_RATE = Decimal('2.50')


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def load_ticks(path: Path, expected_hash=REGISTERED_HASH):
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected_hash:
            raise ValueError('registered CSV hash mismatch')
    previous = before = None
    ticks = []
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ['DateTime', 'Bid', 'Ask', 'Volume']:
            raise ValueError('unexpected QDM tick header')
        for ordinal, row in enumerate(reader, start=1):
            # Check the authorized day before consuming price fields.
            stamp = row['DateTime']
            if not stamp.startswith('20220103 ') or len(stamp) != 21 or stamp[-4] != '.':
                raise ValueError('quote outside registered day or missing milliseconds')
            dt = datetime.strptime(stamp, '%Y%m%d %H:%M:%S.%f').replace(tzinfo=timezone.utc)
            time_msc = int(dt.timestamp()) * 1000 + dt.microsecond // 1000
            quote = BrokerReplayTick(time_msc=time_msc, sequence=ordinal,
                                    bid=row['Bid'], ask=row['Ask'])
            if previous is not None and quote.time_msc < previous.time_msc:
                raise ValueError('QDM source timestamp order reversed')
            if any(price % Decimal('0.00001') for price in (quote.bid, quote.ask)):
                raise ValueError('quote does not align with declared price step')
            previous = quote
            if quote.time_msc < START:
                before = quote
            elif quote.time_msc < END:
                ticks.append(quote)
    if before is None or START - before.time_msc > 60000 or not ticks:
        raise ValueError('missing recent pre-entry reference or registered quotes')
    if {t.time_msc // 60000 for t in ticks} != set(range(START // 60000, END // 60000)):
        raise ValueError('minute without quote inside registered probe; no fill permitted')
    return before, ticks


def run_case(before, ticks, *, side, slippage):
    tick_hash = canonical_hash([t.model_dump(mode='json') for t in ticks])
    stop = before.bid - Decimal('0.0010') if side == 'BUY' else before.ask + Decimal('0.0010')
    costs = dict(version=f'intraday-reference-20261102-slip-{slippage}',
        spread_basis='bid_ask_embedded', commission_per_side_account=str(COMMISSION_RATE * QUANTITY),
        minimum_fee_account='0', slippage_price_per_side=str(slippage), financing_account='0',
        quote_to_account_rate='1', account_ccy='USD', rounding_decimals=2)
    spec = dict(instrument_id='EURUSD', asset_class='fx', base_ccy='EUR', quote_ccy='USD',
        account_ccy='USD', tick_size='0.00001', pip_size='0.0001', contract_size=str(CONTRACT),
        quantity_min='0.01', quantity_step='0.01', effective_from_utc='2022-01-03T12:00:00Z')
    execution = initialize_tick_execution(replay_session_id=f'probe-{side}-{slippage}',
        branch_id='main', dataset_id='qdm-eurusd-20220103', dataset_sha256=REGISTERED_HASH,
        tick_snapshot_id='qdm-eurusd-20220103-1200-1300', tick_snapshot_sha256=tick_hash,
        instrument_spec=spec, cost_model=costs, spread_price='0', timeframe_seconds=60,
        starting_balance='10000', cursor_index=0,
        research_margin={'version': 'fixed-starting-balance-leverage-v1', 'leverage': '30'})
    pilot = initialize_forex_pilot(execution, start_time_msc=START)
    pilot = queue_forex_pilot_order(pilot, operation_id='entry', side=side,
                                    quantity=QUANTITY, stop_loss=stop, take_profit=None)
    for minute, group in groupby(ticks, key=lambda t: t.time_msc // 60000):
        quotes = list(group)
        mids = [(t.bid + t.ask) / 2 for t in quotes]
        bar = dict(timestamp=minute * 60, open=mids[0], high=max(mids), low=min(mids), close=mids[-1])
        pilot = advance_forex_pilot(pilot, ticks=quotes, bar=bar,
                                    cursor_index=pilot.execution.cursor_index + 1)
    terminal_valuation = pilot.execution.position is not None
    if terminal_valuation:
        if pilot.risk.close_pending is not None:
            raise ValueError('pending risk liquidation needs a later quote; cannot force terminal valuation')
        # This is terminal closeable-value accounting, not an executable future fill.
        closed = close_tick_order(pilot.execution, target_id=pilot.execution.position.position_id,
            operation_id='terminal-valuation', mid_close=(ticks[-1].bid + ticks[-1].ask) / 2,
            virtual_time_utc=END // 1000)
        pilot = ForexPilotSnapshot(execution=closed, limits=pilot.limits, risk=pilot.risk)
    pilot = ForexPilotSnapshot.model_validate_json(pilot.model_dump_json())
    ledger = pilot.execution.ledger
    entries = [e for e in ledger if e['kind'] == 'market_fill']
    exits = [e for e in ledger if e['kind'] in {'manual_close', 'protective_fill'}]
    if len(entries) != 1 or len(exits) != 1 or pilot.risk.rejections:
        raise ValueError('probe requires exactly one admitted entry and one closing valuation/fill')
    entry, exit_event = entries[0], exits[0]
    entry_tick = next(t for t in ticks if t.sequence == entry['details']['sequence'])
    exit_tick = next(t for t in ticks if t.sequence == exit_event['details']['sequence'])
    if not before.time_msc < START <= entry_tick.time_msc <= exit_tick.time_msc < END:
        raise ValueError('probe causal timestamps or intraday boundary violated')
    entry_price = entry_tick.ask if side == 'BUY' else entry_tick.bid
    exit_price = exit_tick.bid if side == 'BUY' else exit_tick.ask
    direction = Decimal(1) if side == 'BUY' else Decimal(-1)
    money = lambda value: value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    gross = direction * (exit_price - entry_price) * QUANTITY * CONTRACT
    commission = COMMISSION_RATE * QUANTITY * 2
    slip_cost = slippage * QUANTITY * CONTRACT * 2
    expected = money(gross - commission - slip_cost)
    cost = exit_event['details']['cost_breakdown']
    expected_fields = dict(gross_account=money(gross), commission_account=money(commission),
        slippage_account=money(slip_cost), financing_account=Decimal(0), net_account=expected,
        spread_cost_account=Decimal(0))
    if any(Decimal(str(cost[k])) != value for k, value in expected_fields.items()):
        raise ValueError('independent Decimal accounting differs from execution breakdown')
    if (Decimal(entry['details']['fill_price']) != entry_price
            or Decimal(exit_event['details']['fill_price']) != exit_price
            or pilot.execution.balance != Decimal('10000') + expected
            or pilot.execution.equity != pilot.execution.balance
            or pilot.execution.position is not None or pilot.risk.observed_ticks != len(ticks)):
        raise ValueError('fill/account/tick-count reconciliation failed')
    return dict(side=side, quantity=str(QUANTITY), stop_loss=str(stop),
        slippage_price_per_side=str(slippage), costs=costs, instrument_spec=spec,
        entry_time_msc=entry_tick.time_msc, exit_quote_time_msc=exit_tick.time_msc,
        entry_price=str(entry_price), exit_price=str(exit_price), net_account=str(expected),
        balance=str(pilot.execution.balance), tick_count=len(ticks),
        terminal_close_is_valuation_only=terminal_valuation, independent_oracle='passed',
        checkpoint=pilot.model_dump(mode='json'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    before, ticks = load_ticks(args.csv)
    # Register inputs and declared assumptions before calculating any P/L.
    manifest = dict(schema_version='forex-accounting-probe-v1', purpose='accounting_only',
        source_csv=args.csv.resolve().as_posix(), source_sha256=REGISTERED_HASH,
        source='Dukascopy via QDM CLI; not target-broker quotes',
        window_start_msc=START, window_end_exclusive_msc=END,
        reference=before.model_dump(mode='json'), tick_count=len(ticks),
        tick_sha256=canonical_hash([t.model_dump(mode='json') for t in ticks]),
        sequence='original CSV data row ordinal; no sorting or deduplication',
        source_revision=subprocess.check_output(
            ['git', '-C', str(V2.parent), 'rev-parse', 'HEAD'], text=True).strip(),
        source_hashes={p.relative_to(V2).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [Path(__file__), *(V2 / 'trading_workspace_v2' / name for name in
                ['forex_pilot_risk.py', 'replay_tick_execution.py', 'replay_execution.py',
                 'semantics/data_costs.py', 'semantics/data_contracts.py'])]},
        broker_spec_verified=False, strategy_pass=False, prop_pass=False,
        financing='zero events in strictly intraday window; overnight rates unknown',
        assumptions=['current published commission reference applied to 2022 price scenario',
            'lot min/step 0.01 assumed; price step observed; account limits/rounding unverified',
            'fixed research leverage 30; no broker stop-out/tiered margin certification',
            'last-quote terminal valuation, not guaranteed executable closing fill',
            'minute presence does not establish continuous tick coverage'],
        sources=['https://ftmo.com/en/symbols/',
                 'https://ftmo.com/en/blog/trading-updates/trading-update-25-sep-2025/',
                 'https://ftmo.com/en/faq/what-is-the-swing-account-type-and-how-does-it-work/'])
    args.output_dir.mkdir(parents=True, exist_ok=False)
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    cases = [run_case(before, ticks, side=side, slippage=slip)
             for side in ('BUY', 'SELL') for slip in (Decimal('0'), Decimal('0.00002'))]
    for baseline, stress in ((cases[0], cases[1]), (cases[2], cases[3])):
        if Decimal(stress['net_account']) != Decimal(baseline['net_account']) - Decimal('0.04'):
            raise ValueError('declared slippage sensitivity differs from independent expected delta')
    result = dict(status='accounting_passed_only', manifest_sha256=canonical_hash(manifest), cases=cases)
    (args.output_dir / 'results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps([dict(side=c['side'], slippage=c['slippage_price_per_side'],
        net_account=c['net_account'], oracle=c['independent_oracle']) for c in cases], indent=2))


if __name__ == '__main__':
    main()
