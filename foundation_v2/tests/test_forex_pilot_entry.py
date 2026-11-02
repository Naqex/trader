from __future__ import annotations

import copy
import unittest
from decimal import Decimal

from test_forex_pilot_risk import execution, ms, tick, advance
from trading_workspace_v2.forex_pilot_risk import (
    ForexPilotSnapshot, initialize_forex_pilot, queue_forex_pilot_order,
)
from trading_workspace_v2.replay_tick_execution import ReplayTickExecutionSnapshot


class PilotEntryTests(unittest.TestCase):
    def initial(self):
        e = execution().model_copy(update={'cost_model': {
            **execution().cost_model, 'commission_per_side_per_quantity_account': '2.50'}})
        return advance(initialize_forex_pilot(e, start_time_msc=ms()), [tick()])

    def test_entry_waits_past_decision_and_anchors_stop_to_gap_fill(self):
        for side, expected in (('BUY', '1.10119'), ('SELL', '1.10301')):
            with self.subTest(side=side):
                queued = queue_forex_pilot_order(self.initial(), operation_id='gap', side=side,
                    quantity='0.01', stop_loss='1.09900' if side == 'BUY' else '1.10500',
                    stop_distance='0.001001', take_profit=None)
                queued = ForexPilotSnapshot.model_validate_json(queued.model_dump_json())
                result = advance(queued, [tick(when=ms() + 60000),
                    tick('1.10200', '1.10220', when=ms() + 60001)])
                fill = next(e for e in result.execution.ledger if e['kind'] == 'market_fill')
                self.assertEqual(fill['details']['time_msc'], ms() + 60001)
                self.assertEqual(result.execution.position.stop_loss, Decimal(expected))
                self.assertIsNone(result.risk.entry_stop_distance)
                self.assertEqual(result.execution.floating_pl, Decimal('-0.25'))
                ForexPilotSnapshot.model_validate_json(result.model_dump_json())
                bad = copy.deepcopy(result.execution.model_dump(mode='json'))
                next(e for e in bad['ledger'] if e['kind'] == 'market_fill')[
                    'details']['pilot_entry']['stop_distance'] = '0.0001'
                with self.assertRaisesRegex(ValueError, 'declared distance'):
                    ReplayTickExecutionSnapshot.model_validate(bad)

    def test_invalid_distance_and_quantity_scaled_risk(self):
        for distance in ('NaN', 'Infinity', '0', '-1'):
            with self.subTest(distance=distance), self.assertRaises(ValueError):
                queue_forex_pilot_order(self.initial(), operation_id='bad', side='BUY',
                    quantity='0.01', stop_loss='1.09', stop_distance=distance, take_profit=None)
        queued = queue_forex_pilot_order(self.initial(), operation_id='risk', side='BUY',
            quantity='0.13', stop_loss='1.09820', take_profit=None)
        result = advance(queued, [tick(when=ms() + 60001)])
        self.assertIsNone(result.execution.position)
        self.assertEqual(result.risk.rejections[-1].reason, 'trade_risk')
        self.assertEqual(result.risk.rejections[-1].estimated_loss, Decimal('26.65'))


if __name__ == '__main__':
    unittest.main()
