from __future__ import annotations

import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.replay_execution import _cost_mapping
from trading_workspace_v2.retained import CostModel, calculate_round_trip_cost
from test_forex_pilot_risk import execution
from foundation_v2.tests.test_u5_engine_oracle import bar, protocol_for
from trading_workspace_v2.research_engine import execute_breakout, ResearchEngineValidationError
from trading_workspace_v2.replay_execution import ReplayOpenPosition, _liquidation_pnl
from trading_workspace_v2.retained import InstrumentSpec


class QuantityCostTests(unittest.TestCase):
    def test_rate_scales_with_quantity_without_changing_fixed_fee_semantics(self):
        raw = execution().cost_model
        raw['commission_per_side_per_quantity_account'] = '2.50'
        for quantity, expected in (('0.01', '0.05'), ('0.1', '0.50'), ('1', '5.00')):
            with self.subTest(quantity=quantity):
                model = CostModel.from_mapping(raw)
                result = calculate_round_trip_cost(model, 'BUY', quantity, '100000',
                    '1.1', '1.1002', '1.1', '1.1002')
                self.assertEqual(Decimal(str(result['commission_account'])), Decimal(expected))
                self.assertEqual(_cost_mapping(model)['commission_per_side_per_quantity_account'], '2.50')
        raw.pop('commission_per_side_per_quantity_account')
        raw['commission_per_side_account'] = '2.50'
        old = calculate_round_trip_cost(raw, 'BUY', '0.01', '100000', '1.1', '1.1002', '1.1', '1.1002')
        self.assertEqual(old['commission_account'], 5)
        self.assertNotIn('commission_per_side_per_quantity_account', _cost_mapping(CostModel.from_mapping(raw)))

    def test_nonfinite_or_negative_quantity_rate_is_rejected(self):
        for rate in ('NaN', 'Infinity', '-1'):
            with self.subTest(rate=rate), self.assertRaises(ValueError):
                CostModel.from_mapping({**execution().cost_model,
                    'commission_per_side_per_quantity_account': rate})

    def test_partial_quantity_is_not_scaled_twice(self):
        costs = CostModel.from_mapping({**execution().cost_model,
            'commission_per_side_per_quantity_account': '2.50'})
        p = ReplayOpenPosition(position_id='p', source_operation_id='open', side='BUY',
            quantity='0.04', original_quantity='0.1', entry_bid='1.1', entry_ask='1.1002',
            entry_fill='1.1002', stop_loss=None, take_profit=None, opened_cursor_index=1,
            opened_time_utc=1)
        _, breakdown = _liquidation_pnl(p, exit_bid=Decimal('1.1'), exit_ask=Decimal('1.1002'),
            instrument=InstrumentSpec.from_mapping(execution().instrument_spec), cost_model=costs)
        self.assertEqual(breakdown['commission_account'], 0.2)

    def test_general_research_rejects_offline_pilot_rate(self):
        rows = [bar(i * 3600, 10, 11, 9, 10) for i in range(4)]
        protocol = protocol_for(rows)
        protocol['parameters']['cost_model']['commission_per_side_per_quantity_account'] = '2.50'
        with self.assertRaisesRegex(ResearchEngineValidationError, 'offline Python replay pilot'):
            execute_breakout(rows, protocol)


if __name__ == '__main__':
    unittest.main()
