from __future__ import annotations

import copy
from decimal import Decimal
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from trading_workspace_v2.forex_h4 import Candle, H4
from trading_workspace_v2.forex_prop_candidates import DAY, PULLBACK, UTC_RANGE, PROP_CANDIDATES, PropH4Candidate, PropH4State
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
from forex_h4_pilot import START, run_scenario


def candle(index, close='1.10000', *, start=START // 1000):
    value = Decimal(close)
    return Candle(start + index * H4, value, value + Decimal('.001'), value - Decimal('.001'), value)


class PropCandidateTests(unittest.TestCase):
    def test_pullback_recrosses_fast_average_in_both_trend_directions(self):
        for sign, side in [(1, 'BUY'), (-1, 'SELL')]:
            with self.subTest(side=side):
                strategy = PropH4Candidate(PULLBACK)
                for i in range(79):
                    value = Decimal('1.1') + sign * Decimal(i) / 10000
                    self.assertIsNone(strategy.observe(candle(i, str(value)))[0])
                value = Decimal('1.1') + sign * Decimal('.0045')
                self.assertIsNone(strategy.observe(candle(79, str(value)))[0])
                value = Decimal('1.1') + sign * Decimal('.0080')
                self.assertEqual(strategy.observe(candle(80, str(value)))[0], side)
                reversal = '0.90000' if sign == 1 else '1.30000'
                self.assertEqual(strategy.observe(candle(81, reversal), side=side, position_id='filled')[0], 'EXIT')

    def test_range_needs_both_current_day_bars_and_consumes_only_one_signal(self):
        for value, side in [('1.103', 'BUY'), ('1.097', 'SELL')]:
            strategy = PropH4Candidate(UTC_RANGE)
            for i in range(-80, 0):
                strategy.observe(candle(i))
            self.assertIsNone(strategy.observe(candle(0))[0])
            self.assertIsNone(strategy.observe(candle(1))[0])
            self.assertEqual(strategy.observe(candle(2, value))[0], side)
            restored = PropH4Candidate.from_state(strategy.export_state())
            # Even an unfilled/rejected first signal consumes today's entry.
            self.assertIsNone(strategy.observe(candle(3, value))[0])
            self.assertIsNone(restored.observe(candle(3, value))[0])
            self.assertEqual(strategy.observe(candle(4, value), side=side, position_id='p1')[0], 'EXIT')
            # Tomorrow has no 00:00/04:00 pair: never reuse yesterday's range.
            self.assertIsNone(strategy.observe(candle(8, value))[0])

    def test_range_skips_incomplete_range_and_resets_for_next_complete_day(self):
        strategy = PropH4Candidate(UTC_RANGE)
        for i in range(-80, 0):
            strategy.observe(candle(i))
        strategy.observe(candle(0))
        self.assertIsNone(strategy.observe(candle(2, '1.103'))[0])
        strategy.observe(candle(6))
        strategy.observe(candle(7))
        self.assertEqual(strategy.observe(candle(8, '1.103'))[0], 'BUY')
        # Missing the scheduled exit bar does not fabricate a prior close.
        self.assertEqual(strategy.observe(candle(12), side='BUY', position_id='p1')[0], 'EXIT')

    def test_range_requires_atr_and_uses_fixed_utc_even_across_dst_dates(self):
        cold = PropH4Candidate(UTC_RANGE)
        cold.observe(candle(0))
        cold.observe(candle(1))
        self.assertIsNone(cold.observe(candle(2, '1.103'))[0])
        self.assertIsNone(cold.last_entry_day)
        # Friday and Monday straddle Europe's DST change, but this hypothesis
        # deliberately defines its range in UTC rather than London local time.
        for start in (1648166400, 1648425600):
            self.assertEqual(start % DAY, 0)
            strategy = PropH4Candidate(UTC_RANGE)
            for i in range(-80, 0):
                strategy.observe(candle(i, start=start))
            strategy.observe(candle(0, start=start))
            strategy.observe(candle(1, start=start))
            self.assertEqual(strategy.observe(candle(2, '1.103', start=start))[0], 'BUY')

    def test_roundtrip_preserves_future_signals_and_prefix_is_causal(self):
        for kind in PROP_CANDIDATES:
            with self.subTest(kind=kind):
                bars = [candle(i, str(Decimal('1.1') + Decimal((i * 7) % 19 - 9) / 10000)) for i in range(120)]
                strategy = PropH4Candidate(kind)
                prefix = [strategy.observe(bar) for bar in bars[:90]]
                restored = PropH4Candidate.from_state(PropH4State.model_validate_json(strategy.export_state().model_dump_json()))
                self.assertEqual([strategy.observe(bar) for bar in bars[90:]],
                                 [restored.observe(bar) for bar in bars[90:]])
                changed_future = bars[:90] + [candle(i, '1.4') for i in range(90, 120)]
                other = PropH4Candidate(kind)
                self.assertEqual([other.observe(bar) for bar in changed_future][:90], prefix)

    def test_bad_inputs_leave_state_unchanged_and_corrupt_snapshots_fail(self):
        for kind in PROP_CANDIDATES:
            strategy = PropH4Candidate(kind)
            for i in range(80):
                strategy.observe(candle(i))
            original = strategy.export_state()
            for bar, args in [(candle(79), {}), (candle(80), {'side': 'BUY'}),
                              (candle(80), {'side': 'BUY', 'position_id': ' '})]:
                with self.assertRaises(ValueError):
                    strategy.observe(bar, **args)
                self.assertEqual(strategy.export_state(), original)
            for field, value in [('atr', None), ('last_entry_day', 999999999), ('candidate', 'unknown')]:
                bad = original.model_dump(mode='json')
                bad[field] = value
                with self.assertRaises(ValueError):
                    PropH4State.model_validate(bad)
            bad = copy.deepcopy(original.model_dump(mode='json'))
            bad['history'][-1]['timestamp'] = bad['history'][-2]['timestamp']
            with self.assertRaises(ValueError):
                PropH4State.model_validate(bad)

    def test_same_position_cannot_change_side(self):
        strategy = PropH4Candidate(PULLBACK)
        strategy.observe(candle(0), side='BUY', position_id='p1')
        original = strategy.export_state()
        with self.assertRaises(ValueError):
            strategy.observe(candle(1), side='SELL', position_id='p1')
        self.assertEqual(strategy.export_state(), original)

    def test_new_candidates_use_existing_tick_accounting_and_snapshot_path(self):
        warmup = [candle(i) for i in range(-90, 0)]
        ticks = [BrokerReplayTick(time_msc=START + i * 3600000 + 1, sequence=i,
                 bid='1.10300' if 8 <= i < 20 else '1.10000',
                 ask='1.10320' if 8 <= i < 20 else '1.10020') for i in range(32)]
        with tempfile.TemporaryDirectory() as directory:
            for kind in PROP_CANDIDATES:
                with self.subTest(kind=kind), patch('forex_h4_pilot.read_qdm_ticks', return_value=iter(ticks)):
                    result = run_scenario(Path('unused'), warmup, 'fixture', Decimal(0), Decimal(10),
                        Path(directory), lambda *args: None, research_candidate=kind)
                    self.assertEqual(result['independent_accounting'], 'passed')
                    self.assertEqual(result['candidate_state_roundtrip'], 'passed')
                    self.assertEqual(result['observed_ticks'], len(ticks))
                    self.assertFalse(result['prop_pass'])
                    if kind == UTC_RANGE:
                        self.assertEqual(result['entry_fills'], 1)


if __name__ == '__main__':
    unittest.main()
