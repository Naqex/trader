from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trading_workspace_v2.experiment_forward_binding import bind_experiment_artifacts
from trading_workspace_v2.forex_financing import FinancingTerms
from trading_workspace_v2.forex_forward import (
    ForexForwardSession, ForexForwardSnapshot, ForexForwardCheckpointConflict,
    ForexForwardCheckpointCorrupt, forward_artifact_json,
)
from trading_workspace_v2.forex_h4 import HOUR, H4, Candle, CandleState
from trading_workspace_v2.forex_pilot_risk import initialize_forex_pilot
from trading_workspace_v2.replay_tick_execution import initialize_tick_execution


START = int(datetime(2022, 1, 3, tzinfo=timezone.utc).timestamp())
DATA = b'synthetic quote source; not market data'
DIGEST = hashlib.sha256(DATA).hexdigest()


def quote(hour, bid='1.10200', ask='1.10220', *, offset=1, sequence=0):
    return dict(time_msc=(START + hour * HOUR) * 1000 + offset,
                sequence=sequence, bid=bid, ask=ask)


def fixture(*, warm=True, financing=(), **limits):
    execution = initialize_tick_execution(replay_session_id='forward-system-fixture', branch_id='main',
        dataset_id='synthetic', dataset_sha256=DIGEST, tick_snapshot_id='synthetic-quotes',
        tick_snapshot_sha256=DIGEST,
        instrument_spec=dict(instrument_id='EURUSD', asset_class='fx', base_ccy='EUR', quote_ccy='USD',
            account_ccy='USD', tick_size='0.00001', pip_size='0.0001', contract_size='100000',
            quantity_min='0.01', quantity_step='0.01', effective_from_utc='2022-01-01T00:00:00Z'),
        cost_model=dict(version='synthetic-forward-v1', spread_basis='bid_ask_embedded',
            commission_per_side_account='0', commission_per_side_per_quantity_account='2.50',
            minimum_fee_account='0', slippage_price_per_side='0', financing_account='0',
            quote_to_account_rate='1', account_ccy='USD', rounding_decimals=2),
        spread_price='0', timeframe_seconds=HOUR, starting_balance='10000', cursor_index=0,
        research_margin=dict(version='fixed-starting-balance-leverage-v1', leverage='30'))
    pilot = initialize_forex_pilot(execution, start_time_msc=START * 1000)
    candles = tuple(Candle(START - (20 - i) * H4, Decimal('1.10000'), Decimal('1.10100'),
                           Decimal('1.09900'), Decimal('1.10000')) for i in range(20)) if warm else ()
    artifacts = dict(data=DATA, instrument_spec=forward_artifact_json(execution.instrument_spec),
        cost_model=forward_artifact_json(execution.cost_model), source=b'fixed synthetic source revision')
    if candles:
        artifacts['warmup'] = forward_artifact_json([CandleState(**vars(c)).model_dump(mode='json') for c in candles])
    if financing:
        artifacts['financing'] = forward_artifact_json([f.model_dump(mode='json') for f in financing])
    pins = {k: hashlib.sha256(v).hexdigest() for k, v in artifacts.items()}
    binding = bind_experiment_artifacts(candidate_id='fixed-h4', strategy_revision='system-v1',
        purpose='system_fixture', artifacts=artifacts, expected_sha256=pins)
    return ForexForwardSession.create(pilot, binding=binding, artifacts=artifacts,
        expected_sha256=pins, warmup=candles, financing=financing, **limits), artifacts, pins


def resume(path, artifacts, pins):
    return ForexForwardSession.resume(path, artifacts=artifacts, expected_sha256=pins,
        candidate_id='fixed-h4', strategy_revision='system-v1')


def close_hour(session, hour, bid='1.10200', ask='1.10220'):
    session.observe_quote(quote(hour, bid, ask))
    session.close_before((START + (hour + 1) * HOUR) * 1000)


class ForexForwardTests(unittest.TestCase):
    def test_closed_hour_causality_partial_watermark_duplicate_and_order(self):
        session, _, _ = fixture(warm=False)
        first = quote(0)
        self.assertTrue(session.observe_quote(first))
        self.assertFalse(session.observe_quote(first))
        self.assertEqual(session.snapshot().pilot.execution.cursor_index, 0)
        self.assertFalse(session.close_before(START * 1000 + 500))
        with self.assertRaisesRegex(ValueError, 'watermark'):
            session.observe_quote(quote(0, offset=499))
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            session.observe_quote({**first, 'bid': '1.10199'})
        with self.assertRaisesRegex(ValueError, 'order'):
            session.observe_quote(quote(0, offset=0))
        self.assertEqual(session.snapshot().received_ticks, 1)
        self.assertTrue(session.observe_quote(quote(1)))
        state = session.snapshot()
        self.assertEqual(state.committed_hours, 1)
        self.assertEqual(state.pilot.risk.observed_ticks, 1)
        self.assertEqual(len(state.buffer_ticks), 1)
        self.assertEqual(len(state.builder.parts), 1)
        self.assertEqual(len(state.candidate.history), 0)
        self.assertFalse(state.execution_capability)

    def test_restart_parity_preserves_partial_h4_atr_pending_entry_and_exit(self):
        continuous, _, _ = fixture()
        interrupted, artifacts, pins = fixture()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'session.json'
            for hour in range(9):
                bid, ask = ('1.10200', '1.10220') if hour < 4 else ('1.09850', '1.09870')
                close_hour(continuous, hour, bid, ask)
                # Restart with a buffered quote, then again after closed-hour decisions.
                interrupted.observe_quote(quote(hour, bid, ask))
                interrupted.save(path)
                interrupted = resume(path, artifacts, pins)
                interrupted.close_before((START + (hour + 1) * HOUR) * 1000)
                interrupted.save(path)
                interrupted = resume(path, artifacts, pins)
                self.assertEqual(interrupted.snapshot(), continuous.snapshot())
                if hour == 3:
                    self.assertIsNotNone(interrupted.snapshot().pilot.execution.pending_market_order)
                    self.assertIsNone(interrupted.snapshot().pilot.execution.position)
                if hour == 7:
                    self.assertIsNotNone(interrupted.snapshot().pilot.risk.exit_pending)
            state = interrupted.snapshot()
            self.assertEqual([d.signal for d in state.decisions], ['BUY', 'EXIT'])
            self.assertIsNone(state.pilot.execution.position)
            fills = [e for e in state.pilot.execution.ledger if e['kind'] in {'market_fill', 'protective_fill'}]
            self.assertEqual(len(fills), 2)
            for decision, fill in zip(state.decisions, fills):
                self.assertGreater(fill['details']['time_msc'], decision.time_msc)

    def test_256_hour_replay_with_periodic_restore_matches_continuous_state(self):
        continuous, _, _ = fixture()
        interrupted, artifacts, pins = fixture()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'replay.json'
            for hour in range(256):
                bid, ask = ('1.10200', '1.10220') if hour % 16 < 8 else ('1.09850', '1.09870')
                event = quote(hour, bid, ask)
                continuous.observe_quote(event)
                interrupted.observe_quote(event)
                if hour % 8 == 0:
                    interrupted.save(path)
                    interrupted = resume(path, artifacts, pins)
                    self.assertFalse(interrupted.observe_quote(event))
                watermark = (START + (hour + 1) * HOUR) * 1000
                continuous.close_before(watermark)
                interrupted.close_before(watermark)
                self.assertEqual(interrupted.snapshot(), continuous.snapshot())
            interrupted.save(path)
            self.assertEqual(resume(path, artifacts, pins).snapshot(), continuous.snapshot())
            self.assertEqual(interrupted.snapshot().committed_hours, 256)
            self.assertEqual(interrupted.snapshot().received_ticks, 256)
            self.assertFalse(interrupted.snapshot().execution_capability)

    def test_persisted_quote_duplicate_is_noop_and_stale_writer_cannot_clobber(self):
        session, artifacts, pins = fixture(warm=False)
        session.observe_quote(quote(0))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'session.json'
            self.assertEqual(session.save(path), 1)
            newer, stale = resume(path, artifacts, pins), resume(path, artifacts, pins)
            self.assertFalse(newer.observe_quote(quote(0)))
            newer.observe_quote(quote(0, offset=2))
            self.assertEqual(newer.save(path), 2)
            with self.assertRaises(ForexForwardCheckpointConflict):
                stale.save(path)
            self.assertEqual(resume(path, artifacts, pins).snapshot().received_ticks, 2)

    def test_corrupt_missing_and_changed_artifact_fail_closed(self):
        session, artifacts, pins = fixture(warm=False)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'session.json'
            with self.assertRaises(ForexForwardCheckpointCorrupt):
                resume(path, artifacts, pins)
            session.observe_quote(quote(0))
            session.save(path)
            original = path.read_bytes()
            record = json.loads(original)
            record['snapshot']['received_ticks'] = 7
            path.write_bytes(forward_artifact_json(record))
            with self.assertRaises(ForexForwardCheckpointCorrupt):
                resume(path, artifacts, pins)
            path.write_bytes(original[:-1])
            with self.assertRaises(ForexForwardCheckpointCorrupt):
                resume(path, artifacts, pins)
            path.write_bytes(original)
            for name in ('source', 'instrument_spec', 'cost_model', 'data'):
                with self.subTest(artifact=name), self.assertRaises(ValueError):
                    resume(path, {**artifacts, name: artifacts[name] + b' '}, pins)
            with self.assertRaises(ValueError):
                ForexForwardSession.resume(path, artifacts=artifacts, expected_sha256=pins,
                    candidate_id='different', strategy_revision='system-v1')

    def test_financing_calendar_restarts_exactly_once(self):
        terms = FinancingTerms(event_id='declared-synthetic-swap', scheduled_time_msc=(START + 5 * HOUR) * 1000,
            known_at_msc=START * 1000, debit_buy_usd_per_lot='2', debit_sell_usd_per_lot='1',
            multiplier=1, source='synthetic fixture only', qualification='declared_scenario')
        session, artifacts, pins = fixture(financing=(terms,))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'session.json'
            for hour in range(6):
                close_hour(session, hour)
                session.save(path)
                session = resume(path, artifacts, pins)
            state = session.snapshot()
            self.assertEqual(state.financing_cursor, 1)
            fees = [e for e in state.pilot.execution.ledger if e['kind'] == 'financing']
            self.assertEqual(len(fees), 1)
            self.assertGreater(Decimal(fees[0]['details']['debit_account']), 0)

    def test_resource_bounds_and_reducer_failure_do_not_lose_buffer(self):
        session, _, _ = fixture(warm=False, max_buffer_ticks=1, max_committed_hours=1)
        session.observe_quote(quote(0))
        before = session.snapshot()
        with self.assertRaisesRegex(ValueError, 'buffer resource'):
            session.observe_quote(quote(0, offset=2))
        self.assertEqual(session.snapshot(), before)
        session.observe_quote(quote(1))
        before = session.snapshot()
        with self.assertRaisesRegex(ValueError, 'hour resource'):
            session.close_before((START + 2 * HOUR) * 1000)
        self.assertEqual(session.snapshot(), before)
        with self.assertRaises(ValueError):
            ForexForwardSnapshot.model_validate({**before.model_dump(), 'max_buffer_ticks': True})

    def test_final_watermark_cannot_skip_later_financing_and_failure_is_atomic(self):
        terms = FinancingTerms(event_id='synthetic-fee-after-last-quote',
            scheduled_time_msc=(START + 7 * HOUR) * 1000, known_at_msc=START * 1000,
            debit_buy_usd_per_lot='2', debit_sell_usd_per_lot='1', multiplier=1,
            source='synthetic fixture only', qualification='declared_scenario')
        session, _, _ = fixture(financing=(terms,))
        for hour in range(5):
            close_hour(session, hour)
        self.assertIsNotNone(session.snapshot().pilot.execution.position)
        session.observe_quote(quote(5))
        before = session.snapshot()
        with self.assertRaisesRegex(ValueError, 'unapplied financing'):
            session.close_before((START + 8 * HOUR) * 1000)
        # Even the buffered 05:00 hour must remain untouched after rejection.
        self.assertEqual(session.snapshot(), before)
        self.assertTrue(session.close_before((START + 6 * HOUR) * 1000))
        before = session.snapshot()
        with self.assertRaisesRegex(ValueError, 'unapplied financing'):
            session.close_before((START + 8 * HOUR) * 1000)
        self.assertEqual(session.snapshot(), before)
        close_hour(session, 7)
        state = session.snapshot()
        self.assertEqual(state.financing_cursor, 1)
        fees = [e for e in state.pilot.execution.ledger if e['kind'] == 'financing']
        self.assertEqual(len(fees), 1)
        self.assertEqual(fees[0]['virtual_time_utc'], START + 7 * HOUR)
        self.assertGreater(Decimal(fees[0]['details']['debit_account']), 0)
        self.assertEqual(fees[0]['details']['valuation_quality'], 'last_observed_quote_not_current_market')

    def test_execution_spec_must_match_bound_canonical_bytes(self):
        session, _, _ = fixture(warm=False)
        raw = session.snapshot().model_dump(mode='json')
        raw['pilot']['execution']['cost_model']['slippage_price_per_side'] = '0.00001'
        with self.assertRaisesRegex(ValueError, 'binding differs'):
            ForexForwardSnapshot.model_validate(raw)


if __name__ == '__main__':
    unittest.main()
