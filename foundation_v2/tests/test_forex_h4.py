from __future__ import annotations

import hashlib
import json
import copy
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
from forex_h4_pilot import START, financing_calendar, run_scenario, observed_account_spec, input_contract, write_json, main


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


class AccountScenarioTests(unittest.TestCase):
    def test_native_progress_cancellation_stops_before_reading_ticks_and_retains_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output = root / 'run'
            stages = []
            def progress(stage):
                stages.append(stage)
                if stage == 'validate_warmup':
                    raise RuntimeError('cancelled by native workflow')
            with patch('forex_h4_pilot.inspect_qdm') as inspect, self.assertRaisesRegex(RuntimeError, 'cancelled'):
                main(['--input-dir', str(root), '--output-dir', str(output)], on_progress=progress)
            inspect.assert_not_called()
            receipt = json.loads((output / 'receipt.json').read_text())
            self.assertEqual(receipt['stage'], 'failed')
            self.assertEqual(receipt['error'], 'cancelled by native workflow')
            self.assertEqual(stages, ['manifest', 'validate_warmup'])

    def test_windows_sharing_lock_retries_but_persistent_failure_is_not_hidden(self):
        locked = PermissionError('reader blocks replacement')
        locked.winerror = 5
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'receipt.json'
            write_json(path, {'stage': 'old'})
            replace = Path.replace
            attempts = []
            def transient(source, target):
                attempts.append(source)
                if len(attempts) == 1:
                    raise locked
                return replace(source, target)
            with patch.object(Path, 'replace', transient), patch('forex_h4_pilot.time.sleep'):
                write_json(path, {'stage': 'new'})
            self.assertEqual(json.loads(path.read_text()), {'stage': 'new'})
            with patch.object(Path, 'replace', side_effect=locked) as persist, \
                    patch('forex_h4_pilot.time.sleep'), self.assertRaises(PermissionError):
                write_json(path, {'stage': 'must-not-overwrite'})
            self.assertEqual(persist.call_count, 21)
            self.assertEqual(json.loads(path.read_text()), {'stage': 'new'})

    def spec(self):
        return dict(schema='ftmo-current-mt5-spec-v1',
            qualification='current_observation_not_historical_2022',
            captured_at_utc='2026-11-02T08:58:49+00:00',
            historical_spec_verified=False, commission_account_specific_verified=False,
            account=dict(currency='USD', currency_digits=2, leverage=30, server='FTMO-Demo',
                trade_mode=0, margin_mode=2, margin_so_mode=0, margin_so_call=100, margin_so_so=50),
            instrument=dict(name='EURUSD', currency_base='EUR', currency_profit='USD', currency_margin='EUR',
                trade_calc_mode=0, trade_contract_size=100000, point=0.00001, trade_tick_size=0.00001,
                trade_tick_value=1, trade_tick_value_profit=1, trade_tick_value_loss=1, digits=5,
                volume_min=0.01, volume_step=0.01, volume_max=50, volume_limit=0,
                trade_stops_level=0, trade_freeze_level=0, margin_initial=0, margin_maintenance=0,
                swap_mode=1, swap_rollover3days=3, swap_long=-9.3, swap_short=0.31))

    def load_spec(self, raw, digest=None):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'spec.json'
            data = json.dumps(raw).encode()
            path.write_bytes(data)
            return observed_account_spec(path, digest or hashlib.sha256(data).hexdigest())

    def test_swap_points_convert_to_usd_debit_and_credit_without_historical_promotion(self):
        actual = self.load_spec(self.spec())
        self.assertEqual(Decimal(actual['debit_buy_usd_per_lot']), Decimal('9.30'))
        self.assertEqual(Decimal(actual['debit_sell_usd_per_lot']), Decimal('-0.31'))
        self.assertTrue(actual['instrument_spec_verified_at_capture'])
        self.assertFalse(actual['historical_spec_verified'])
        self.assertFalse(actual['commission_account_specific_verified'])
        self.assertEqual(actual['captured_at_utc'], '2026-11-02T08:58:49+00:00')

    def test_wrong_hash_unsupported_units_and_false_verification_claims_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'hash'):
            self.load_spec(self.spec(), '0' * 64)
        for section, key, value in (('account', 'currency', 'EUR'), ('account', 'leverage', 100),
                ('instrument', 'swap_mode', 5), ('instrument', 'trade_tick_value', 10),
                ('instrument', 'volume_max', 1), ('instrument', 'swap_short', 'NaN'),
                (None, 'historical_spec_verified', True),
                (None, 'commission_account_specific_verified', True)):
            raw = copy.deepcopy(self.spec())
            (raw[section] if section else raw)[key] = value
            with self.subTest(field=key), self.assertRaises(ValueError):
                self.load_spec(raw)

    def test_custom_calendar_preserves_side_sign_and_scenario_clock(self):
        events = list(financing_calendar(Decimal('9.3'), sell_rate=Decimal('-0.31'),
            start=START, end=START + 3 * 86400000))
        self.assertEqual(len(events), 3)
        self.assertEqual([e.multiplier for e in events], [1, 1, 3])
        self.assertTrue(all(e.debit_sell_usd_per_lot == Decimal('-0.31') for e in events))
        self.assertTrue(all(e.qualification == 'declared_scenario' and e.known_at_msc == START for e in events))

    def test_registered_input_windows_only_and_custom_runner_uses_pinned_csv(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            inputs = input_contract(root)
            csv = root / 'q1.csv'
            csv.write_bytes(b'DateTime,Bid,Ask,Volume\n20220103 00:00:00.001,1.10000,1.10020,1\n'
                            b'20220331 23:00:00.001,1.10000,1.10020,1\n')
            inputs['development'].update(path=str(csv), sha256=hashlib.sha256(csv.read_bytes()).hexdigest(),
                                         last_day='20220331')
            manifest = root / 'inputs.json'
            raw = dict(schema='forex-h4-inputs-v1', **inputs)
            manifest.write_text(json.dumps(raw), encoding='utf-8')
            registered = input_contract(root, manifest)
            result = run_scenario(csv, [], 'q1-test', Decimal(0), Decimal('9.3'), root,
                lambda *args: None, development=registered['development'], sell_debit=Decimal('-0.31'))
            self.assertEqual(result['observed_ticks'], 2)
            snapshot = json.loads((root / 'q1-test-checkpoint.json').read_text())
            execution = snapshot['execution']
            self.assertEqual(execution['dataset_sha256'], inputs['development']['sha256'])
            self.assertIn('20220331', execution['dataset_id'])
            self.assertFalse(result['broker_spec_verified'])
            self.assertEqual(result['independent_accounting'], 'passed')
            raw['development']['last_day'] = '20250103'
            manifest.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'registered development'):
                input_contract(root, manifest)


if __name__ == '__main__':
    unittest.main()
