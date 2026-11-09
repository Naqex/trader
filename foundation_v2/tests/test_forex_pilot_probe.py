from __future__ import annotations

import hashlib
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from forex_pilot_probe import START, BrokerReplayTick, load_ticks, run_case


def quotes():
    before = BrokerReplayTick(time_msc=START - 1, sequence=1, bid='1.10000', ask='1.10020')
    ticks = [BrokerReplayTick(time_msc=START + i * 60000 + 1, sequence=i + 2,
                             bid='1.10000', ask='1.10020') for i in range(60)]
    return before, ticks


class ForexPilotProbeTests(unittest.TestCase):
    def test_both_sides_reconcile_causal_exit_and_cost_sensitivity(self):
        before, ticks = quotes()
        for side in ('BUY', 'SELL'):
            with self.subTest(side=side):
                baseline = run_case(before, ticks, side=side, slippage=Decimal(0))
                stress = run_case(before, ticks, side=side, slippage=Decimal('0.00002'))
                self.assertEqual(baseline['net_account'], '-0.25')
                self.assertEqual(stress['net_account'], '-0.29')
                self.assertFalse(baseline['terminal_close_is_valuation_only'])
                self.assertEqual(baseline['exit_reason'], 'pilot_strategy_exit')
                self.assertEqual(baseline['exit_quote_time_msc'], START + 59 * 60000 + 1)
                self.assertEqual(baseline['checkpoint']['risk']['observed_ticks'], 60)

    def test_observed_gap_stop_fills_once_instead_of_scheduled_exit(self):
        before, ticks = quotes()
        ticks[30] = ticks[30].model_copy(update={'bid': Decimal('1.09850'), 'ask': Decimal('1.09870')})
        result = run_case(before, ticks, side='BUY', slippage=Decimal(0))
        self.assertEqual(result['net_account'], '-1.75')
        self.assertFalse(result['terminal_close_is_valuation_only'])
        exits = [e for e in result['checkpoint']['execution']['ledger'] if e['kind'] == 'protective_fill']
        self.assertEqual(len(exits), 1)
        self.assertEqual(exits[0]['details']['reason'], 'stop_loss')

    def test_no_quote_after_scheduled_decision_cannot_fake_a_close(self):
        before, ticks = quotes()
        ticks[-1] = ticks[-1].model_copy(update={'time_msc': START + 59 * 60000})
        with self.assertRaisesRegex(ValueError, 'no executable exit quote'):
            run_case(before, ticks, side='BUY', slippage=Decimal(0))

    def test_parser_preserves_milliseconds_source_ordinal_and_rejects_corruption(self):
        before, ticks = quotes()
        rows = ['DateTime,Bid,Ask,Volume']
        for tick in [before, *ticks]:
            stamp = datetime.fromtimestamp(tick.time_msc / 1000, timezone.utc).strftime('%Y%m%d %H:%M:%S.%f')[:-3]
            rows.append(f'{stamp},{tick.bid},{tick.ask},1')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ticks.csv'
            def parse(lines):
                data = ('\n'.join(lines) + '\n').encode()
                path.write_bytes(data)
                return load_ticks(path, hashlib.sha256(data).hexdigest())
            ref, parsed = parse(rows)
            self.assertEqual(ref, before)
            self.assertEqual(parsed, ticks)
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                load_ticks(path)
            for lines, message in (
                ([rows[0], rows[1].replace('20220103', '20250103'), *rows[2:]], 'registered day'),
                ([*rows[:2], rows[3], rows[2], *rows[4:]], 'order reversed'),
                (rows[:-1], 'minute without quote'),
                ([rows[0].replace('Bid', 'Price'), *rows[1:]], 'header'),
            ):
                with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                    parse(lines)


if __name__ == '__main__':
    unittest.main()
