from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from trading_workspace_v2.forex_h4 import Candle, H4
from trading_workspace_v2.forex_h4_candidates import BASELINE, SMA, ZSCORE, ResearchH4Candidate, ResearchH4State
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
from forex_h4_pilot import START, EXPECTED, input_contract, run_scenario


def candle(index, close='1.10000'):
    value = Decimal(close)
    return Candle(START//1000 + index*H4, value, value+Decimal('.001'), value-Decimal('.001'), value)


class ResearchCandidateTests(unittest.TestCase):
    def test_sma_requires_a_previous_full_window_and_exits_without_reversing(self):
        for value, entry, side, reversal in [('1.108', 'BUY', 'BUY', '1.000'),
                                               ('1.092', 'SELL', 'SELL', '1.200')]:
            with self.subTest(side=side):
                candidate = ResearchH4Candidate(SMA)
                for i in range(80):
                    self.assertIsNone(candidate.observe(candle(i))[0])
                self.assertEqual(candidate.observe(candle(80, value))[0], entry)
                self.assertEqual(candidate.observe(candle(81, reversal), side=side, position_id='p1')[0], 'EXIT')

    def test_zscore_uses_previous_twenty_closes_and_population_variance(self):
        for value, expected in [('1.10210', 'SELL'), ('1.09790', 'BUY')]:
            candidate = ResearchH4Candidate(ZSCORE)
            for i in range(20):
                candidate.observe(candle(i, '1.09900' if i % 2 else '1.10100'))
            # Previous mean=1.10000, population SD=.00100: z=+/-2.1.
            self.assertEqual(candidate.observe(candle(20, value))[0], expected)
        candidate = ResearchH4Candidate(ZSCORE)
        for i in range(20):
            candidate.observe(candle(i))
        self.assertIsNone(candidate.observe(candle(20, '1.11000'))[0])

    def test_time_exit_counts_actual_closes_and_resets_on_position_identity(self):
        candidate = ResearchH4Candidate(ZSCORE)
        for i in range(20):
            candidate.observe(candle(i))
        for i in range(5):
            self.assertIsNone(candidate.observe(candle(20+i), side='BUY', position_id='first')[0])
        self.assertIsNone(candidate.observe(candle(30), side='BUY', position_id='second')[0])
        restored = ResearchH4Candidate.from_state(ResearchH4State.model_validate_json(candidate.export_state().model_dump_json()))
        for i in range(31, 36):
            expected = 'EXIT' if i == 35 else None
            self.assertEqual(candidate.observe(candle(i), side='BUY', position_id='second')[0], expected)
            self.assertEqual(restored.observe(candle(i), side='BUY', position_id='second'),
                             (expected, candidate.atr*2))
        with self.assertRaises(ValueError):
            candidate.observe(candle(36), side='SELL', position_id='second')

    def test_prefix_causality_and_state_roundtrip_for_both_candidates(self):
        for kind in (SMA, ZSCORE):
            bars = [candle(i, str(Decimal('1.1')+Decimal((i*7)%19-9)/10000)) for i in range(130)]
            candidate = ResearchH4Candidate(kind)
            prefix = [candidate.observe(bar) for bar in bars[:90]]
            state = candidate.export_state()
            restored = ResearchH4Candidate.from_state(ResearchH4State.model_validate_json(state.model_dump_json()))
            self.assertEqual([candidate.observe(bar) for bar in bars[90:]],
                             [restored.observe(bar) for bar in bars[90:]])
            second = ResearchH4Candidate(kind)
            mutated = bars[:90] + [candle(i, '1.4') for i in range(90, 130)]
            self.assertEqual([second.observe(bar) for bar in mutated][:90], prefix)
            bad = state.model_dump(mode='json')
            bad['history'][-1]['timestamp'] = bad['history'][-2]['timestamp']
            with self.assertRaises(ValueError):
                ResearchH4State.model_validate(bad)
            bad = state.model_dump(mode='json')
            bad['previous_difference'] = '123'
            with self.assertRaises(ValueError):
                ResearchH4State.model_validate(bad)
            bad = state.model_dump(mode='json')
            bad['candidate'] = 'unregistered'
            with self.assertRaises(ValueError):
                ResearchH4State.model_validate(bad)

    def test_bad_bar_or_ambiguous_position_does_not_advance_state(self):
        candidate = ResearchH4Candidate(SMA)
        candidate.observe(candle(0))
        original = candidate.export_state()
        for bar, args in [(candle(0), {}), (candle(1), {'side': 'BUY'}),
                          (candle(1), {'position_id': 'unknown'})]:
            with self.assertRaises(ValueError):
                candidate.observe(bar, **args)
            self.assertEqual(candidate.export_state(), original)


class StudyRunnerTests(unittest.TestCase):
    def test_new_warmup_is_scoped_to_registered_study_and_holdout_stays_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = input_contract(root)
            manifest = root/'inputs.json'
            manifest.write_text(json.dumps(dict(schema='forex-h4-inputs-v1', **original)))
            self.assertEqual(input_contract(root, manifest), original)
            new = copy.deepcopy(original)
            new['warmup'].update(first_day='20211201', sha256='a'*64)
            raw = dict(schema='forex-h4-inputs-v1', **new)
            manifest.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError, 'registered development'):
                input_contract(root, manifest)
            self.assertEqual(input_contract(root, manifest, research_candidate=SMA), new)
            raw['development']['first_day'] = '20230103'
            raw['development']['last_day'] = '20230114'
            manifest.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError, 'registered development'):
                input_contract(root, manifest, research_candidate=SMA)
            with self.assertRaises(ValueError):
                input_contract(root, manifest, research_candidate='unregistered')

    def test_shared_tick_runner_executes_comparators_with_accounting_and_identity(self):
        warmup = [candle(i, '1.09990' if i % 2 else '1.10010') for i in range(-90, 0)]
        ticks = []
        for hour in range(32):
            bid = '1.10200' if hour < 8 else '1.09990' if hour < 24 else '1.09500'
            ticks.append(BrokerReplayTick(time_msc=START+hour*3600000+1, sequence=hour,
                bid=bid, ask=str(Decimal(bid)+Decimal('.00020'))))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in (BASELINE, SMA, ZSCORE):
                with self.subTest(kind=kind), patch('forex_h4_pilot.read_qdm_ticks', return_value=iter(ticks)):
                    result = run_scenario(Path('unused'), warmup, 'fixture', Decimal(0), Decimal(10), root,
                        lambda *args: None, research_candidate=kind)
                    self.assertEqual(result['independent_accounting'], 'passed')
                    self.assertEqual(result['candidate_state_roundtrip'], 'passed')
                    self.assertGreaterEqual(result['entry_fills'], 1)
                    self.assertEqual(result['observed_ticks'], 32)
                    self.assertFalse(result['prop_pass'])
                    self.assertFalse(json.loads((root/'fixture-candidate.json').read_text())['cli_resume_supported'])

    def test_default_baseline_matches_explicit_study_baseline(self):
        warmup = [candle(i) for i in range(-90, 0)]
        ticks = [BrokerReplayTick(time_msc=START+i*3600000+1, sequence=i,
                 bid='1.10200' if i < 7 else '1.09500', ask='1.10220' if i < 7 else '1.09520') for i in range(12)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch('forex_h4_pilot.read_qdm_ticks', return_value=iter(ticks)):
                original = run_scenario(Path('unused'), warmup, 'fixture', Decimal(0), Decimal(10), root, lambda *a: None)
            with patch('forex_h4_pilot.read_qdm_ticks', return_value=iter(ticks)):
                study = run_scenario(Path('unused'), warmup, 'fixture', Decimal(0), Decimal(10), root, lambda *a: None,
                                     research_candidate=BASELINE)
            for key in ('candidate', 'candidate_state_roundtrip'):
                study.pop(key)
            self.assertEqual(original, study)


if __name__ == '__main__':
    unittest.main()
