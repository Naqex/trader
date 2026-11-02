from __future__ import annotations

import hashlib
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from trading_workspace_v2.forex_h4 import (
    Candle, FixedH4Candidate, H4Builder, read_qdm_ticks, size_for_stop,
)
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
from forex_h4_pilot import START, financing_calendar, run_scenario


def candle(index, close='1.1000', high='1.1010', low='1.0990'):
    return Candle(index * 14400, Decimal(close), Decimal(high), Decimal(low), Decimal(close))


class H4Tests(unittest.TestCase):
    def test_channels_exclude_current_candle_and_wilder_seed_is_fixed(self):
        strategy = FixedH4Candidate()
        for i in range(20):
            signal, _ = strategy.observe(candle(i))
            self.assertIsNone(signal)
        self.assertEqual(strategy.atr, Decimal('0.0020'))
        signal, distance = strategy.observe(candle(20, '1.1020', '1.1100'))
        self.assertEqual(signal, 'BUY')
        self.assertEqual(distance, 2 * (13 * Decimal('0.0020') + Decimal('0.0110')) / 14)
        self.assertEqual(strategy.observe(candle(21, '1.0980', low='1.0970'), side='BUY')[0], 'EXIT')
        self.assertEqual(strategy.observe(candle(22, '1.1200', high='1.1210'), side='SELL')[0], 'EXIT')

    def test_incomplete_hours_are_excluded_without_filling_weekend(self):
        builder = H4Builder()
        self.assertIsNone(builder.add(candle(0)))
        self.assertIsNone(builder.add(Candle(7200, *(Decimal('1') for _ in range(4)))))
        self.assertIsNone(builder.add(Candle(10800, *(Decimal('1') for _ in range(4)))))
        self.assertEqual(builder.excluded, [0])
        for t in (14400, 18000, 21600, 25200):
            result = builder.add(Candle(t, *(Decimal('1') for _ in range(4))))
        self.assertEqual(result.timestamp, 14400)

    def test_size_rounds_down_costs_and_minimum_lot_skips(self):
        quantity = size_for_stop(Decimal('0.002'), slippage=Decimal('0.00002'))
        self.assertEqual(quantity, Decimal('0.11'))
        self.assertLessEqual(quantity * (Decimal('0.00205') * 100000 + 5), 25)
        self.assertIsNone(size_for_stop(Decimal('0.1'), slippage=Decimal(0)))
        with self.assertRaises(ValueError):
            size_for_stop(Decimal('NaN'), slippage=Decimal(0))

    def test_parser_preserves_equal_timestamp_ordinal_and_rejects_bad_source(self):
        text = ('DateTime,Bid,Ask,Volume\n20220103 00:00:00.001,1.10000,1.10020,1\n'
                '20220103 00:00:00.001,1.10010,1.10030,1\n')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ticks.csv'
            path.write_bytes(text.encode())
            def read(digest=None):
                return list(read_qdm_ticks(path, sha256=digest or hashlib.sha256(path.read_bytes()).hexdigest(),
                    first_day='20220103', last_day='20220114'))
            self.assertEqual([q.sequence for q in read()], [1, 2])
            with self.assertRaisesRegex(ValueError, 'hash'):
                read('0' * 64)
            for changed, message in ((text.replace('20220103', '20250103'), 'registered dates'),
                (text.replace('1.10020', '1.00000'), 'ask must'),
                (text.replace('1.10000', '1.100001'), 'tick size')):
                path.write_bytes(changed.encode())
                with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                    read()

    def test_hourly_runner_roundtrip_and_declared_calendar(self):
        warmup = [candle(i - 20) for i in range(20)]
        ticks = []
        for hour in range(10):
            bid = '1.10000' if hour < 3 else '1.10200' if hour < 7 else '1.09880'
            ask = str(Decimal(bid) + Decimal('0.00020'))
            ticks.append(BrokerReplayTick(time_msc=START + hour * 3600000 + 1,
                                         sequence=hour, bid=bid, ask=ask))
        with tempfile.TemporaryDirectory() as folder, patch('forex_h4_pilot.read_qdm_ticks', return_value=iter(ticks)):
            result = run_scenario(Path('unused'), warmup, 'synthetic', Decimal(0), Decimal(10),
                                  Path(folder), lambda *args: None)
        self.assertEqual(result['entry_fills'], 1)
        self.assertEqual(result['closed_trades'], 1)
        self.assertEqual(result['independent_accounting'], 'passed')
        self.assertEqual(result['snapshot_restart'], 'passed')
        self.assertEqual(result['observed_ticks'], 10)
        self.assertFalse(result['strategy_pass'])
        calendar = list(financing_calendar(Decimal(10)))
        self.assertEqual(len(calendar), 10)
        self.assertEqual([t.multiplier for t in calendar], [1, 1, 3, 1, 1] * 2)


if __name__ == '__main__':
    unittest.main()
