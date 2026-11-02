from __future__ import annotations

import copy
import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_forex_pilot_risk import advance, carried, execution, ms, queue, tick
from trading_workspace_v2.forex_financing import FinancingTerms, apply_forex_financing
from trading_workspace_v2.forex_pilot_risk import ForexPilotSnapshot, initialize_forex_pilot, queue_forex_pilot_exit
from trading_workspace_v2.replay_tick_execution import reconstruct_tick_execution_checkpoint


def terms(when, *, event='synthetic-rollover', buy='-10', sell='5', multiplier=1):
    return FinancingTerms(event_id=event, scheduled_time_msc=when, known_at_msc=when - 60000,
        debit_buy_usd_per_lot=buy, debit_sell_usd_per_lot=sell, multiplier=multiplier,
        source='synthetic declared USD per lot; not FTMO rates', qualification='declared_scenario')


def opened(side='BUY', *, at=None, costs=None):
    at = ms() if at is None else at
    initial = initialize_forex_pilot(costs or execution(), start_time_msc=at)
    return advance(queue(initial, side=side, quantity='0.01', stop='1.09' if side == 'BUY' else '1.11'),
                   [tick(when=at)])


class ForexFinancingTests(unittest.TestCase):
    def test_signed_rates_quantity_triple_multiplier_and_no_double_charge_on_exit(self):
        for side, expected in (('BUY', Decimal('10000.30')), ('SELL', Decimal('9999.85'))):
            with self.subTest(side=side):
                charged = apply_forex_financing(opened(side), terms(ms() + 60000, multiplier=3))
                self.assertEqual(charged.execution.balance, expected)
                restored = ForexPilotSnapshot.model_validate_json(charged.model_dump_json())
                requested = queue_forex_pilot_exit(restored, operation_id='exit')
                result = advance(requested, [tick(when=ms() + 60001)])
                self.assertEqual(result.execution.balance, expected - Decimal('0.20'))
                self.assertEqual(result.execution.ledger[-2]['details']['cost_breakdown']['financing_account'], 0)

    def test_flat_and_pending_entries_are_not_charged_retroactively(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms())
        flat = advance(initial, [tick()])
        pending = queue(flat, quantity='0.01', stop='1.09')
        charged = apply_forex_financing(pending, terms(ms() + 60000, buy='100'))
        self.assertEqual(charged.execution.balance, Decimal('10000'))
        result = advance(charged, [tick(when=ms() + 60001)])
        self.assertIsNotNone(result.execution.position)
        self.assertEqual(result.execution.balance, Decimal('10000'))

    def test_cash_breach_latches_even_when_next_quote_recovers_and_restarts(self):
        at = ms()
        initial = carried(at=at)
        charged = apply_forex_financing(initial, terms(at + 60000, buy='100', sell='100'))
        self.assertTrue(charged.risk.daily_stopped)
        self.assertEqual(charged.risk.stops[0].equity, Decimal('9880'))
        self.assertEqual(charged.risk.stops[0].event_time_msc, at + 60000)
        self.assertEqual(charged.risk.observed_ticks, initial.risk.observed_ticks)
        restored = ForexPilotSnapshot.model_validate_json(charged.model_dump_json())
        result = advance(restored, [tick('1.10500', '1.10520', when=at + 60000),
                                   tick('1.10600', '1.10620', when=at + 60001)])
        close = next(e for e in result.execution.ledger if e['details'].get('reason') == 'pilot_risk_stop')
        self.assertEqual(close['details']['time_msc'], at + 60001)
        self.assertTrue(result.risk.daily_stopped)
        self.assertIsNone(result.risk.close_pending)

    def test_prague_reset_then_fee_is_explicit_in_winter_and_summer(self):
        for midnight in (ms('2022-01-03T23:00:00+00:00'), ms('2022-07-03T22:00:00+00:00')):
            with self.subTest(midnight=midnight):
                initial = opened(at=midnight - 60000)
                charged = apply_forex_financing(initial, terms(midnight, buy='10'))
                self.assertEqual(charged.risk.daily_anchor_balance, Decimal('10000'))
                self.assertEqual(charged.execution.balance, Decimal('9999.90'))
                self.assertNotEqual(charged.risk.day, initial.risk.day)
                ForexPilotSnapshot.model_validate_json(charged.model_dump_json())

    def test_server_rollover_does_not_prematurely_reset_prague_day(self):
        rollover = ms('2022-01-03T22:00:00+00:00')
        initial = opened(at=rollover - 60000)
        charged = apply_forex_financing(initial, terms(rollover, buy='10'))
        self.assertEqual(charged.risk.day, initial.risk.day)
        result = advance(charged, [tick(when=rollover + 3600000)])
        self.assertNotEqual(result.risk.day, charged.risk.day)
        self.assertEqual(result.risk.daily_anchor_balance, Decimal('9999.90'))

    def test_unknown_backdated_duplicate_and_aggregate_fees_fail_without_mutation(self):
        initial = opened()
        before = initial.model_dump(mode='json')
        with self.assertRaises(ValueError):
            FinancingTerms(**{**terms(ms() + 60000).model_dump(), 'known_at_msc': ms() + 60001})
        with self.assertRaisesRegex(ValueError, 'boundary'):
            apply_forex_financing(initial, terms(ms() + 59000))
        with self.assertRaisesRegex(ValueError, 'aggregate'):
            apply_forex_financing(opened(costs=execution(financing='0.01')), terms(ms() + 60000))
        charged = apply_forex_financing(initial, terms(ms() + 60000))
        later = advance(charged, [tick(when=ms() + 60001)])
        with self.assertRaisesRegex(ValueError, 'already applied'):
            apply_forex_financing(later, terms(ms() + 120000))
        self.assertEqual(initial.model_dump(mode='json'), before)

    def test_weekend_gap_posts_multiple_explicit_fees_without_inventing_quotes(self):
        initial = opened()
        first = apply_forex_financing(initial, terms(ms() + 3600000, event='fee-1', buy='10'))
        second = apply_forex_financing(first, terms(ms() + 86400000, event='fee-2', buy='10'))
        self.assertEqual(second.execution.balance, Decimal('9999.80'))
        self.assertEqual(second.risk.observed_ticks, 1)
        self.assertEqual(second.risk.last_tick, initial.risk.last_tick)
        ForexPilotSnapshot.model_validate_json(second.model_dump_json())

    def test_tampered_cash_amount_and_valuation_are_rejected_and_rewind_retains_fee(self):
        charged = apply_forex_financing(opened(), terms(ms() + 60000))
        for key, value in (('debit_account', '200'), ('previous_balance', '9999')):
            raw = copy.deepcopy(charged.model_dump(mode='json'))
            raw['execution']['ledger'][-1]['details'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                ForexPilotSnapshot.model_validate(raw)
        advanced = advance(charged, [tick(when=ms() + 60001)])
        rewound = reconstruct_tick_execution_checkpoint(advanced.execution, cursor_index=1)
        self.assertEqual(rewound.balance, charged.execution.balance)
        self.assertEqual(rewound.ledger[-1]['kind'], 'financing')
        self.assertEqual(rewound.event_sequence, len(rewound.ledger))


if __name__ == '__main__':
    unittest.main()
