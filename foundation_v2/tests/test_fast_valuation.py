from decimal import Decimal
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.replay_execution import (
    _liquidation_net_account, _liquidation_pnl, ReplayOpenPosition,
)
from trading_workspace_v2.retained import CostModel, InstrumentSpec


class FastValuationTests(unittest.TestCase):
    def setUp(self):
        self.instrument = InstrumentSpec.from_mapping(dict(
            instrument_id='EURUSD', asset_class='fx', base_ccy='EUR', quote_ccy='USD', account_ccy='USD',
            tick_size='0.00001', pip_size='0.0001', contract_size='100000', quantity_min='0.01',
            quantity_step='0.01', effective_from_utc='2022-01-01T00:00:00Z'))
        self.costs = CostModel.from_mapping(dict(
            version='fast-test', spread_basis='bid_ask_embedded', commission_per_side_account='2.50',
            minimum_fee_account='0', slippage_price_per_side='0.00001', financing_account='1.25',
            quote_to_account_rate='1', account_ccy='USD', rounding_decimals=2,
            commission_per_side_per_quantity_account='0.10'))

    def position(self, side='BUY', partial=False):
        return ReplayOpenPosition(position_id='p', source_operation_id='o', side=side,
            quantity=Decimal('0.11') if partial else Decimal('0.10'),
            original_quantity=Decimal('0.20') if partial else None,
            realized_pnl=Decimal('3.25') if partial else None,
            entry_bid=Decimal('1.10000'), entry_ask=Decimal('1.10020'), entry_fill=Decimal('1.10020'),
            stop_loss=Decimal('1.09800'), take_profit=Decimal('1.10400'), opened_cursor_index=1,
            opened_time_utc=1641168000)

    def test_fast_path_matches_full_cost_for_sides_and_partial_position(self):
        for side in ('BUY', 'SELL'):
            for partial in (False, True):
                with self.subTest(side=side, partial=partial):
                    position = self.position(side, partial)
                    fast = _liquidation_net_account(position, exit_bid=Decimal('1.10234'),
                        exit_ask=Decimal('1.10254'), instrument=self.instrument, cost_model=self.costs)
                    full, breakdown = _liquidation_pnl(position, exit_bid=Decimal('1.10234'),
                        exit_ask=Decimal('1.10254'), instrument=self.instrument, cost_model=self.costs)
                    self.assertEqual(fast, full)
                    self.assertEqual(fast, Decimal(str(breakdown['net_account'])))

    def test_fast_path_rounding_and_zero_financing_match(self):
        costs = CostModel.from_mapping(dict(version='round', spread_basis='bid_ask_embedded',
            commission_per_side_account='0', minimum_fee_account='1.01', slippage_price_per_side='0',
            financing_account='0', quote_to_account_rate='1', account_ccy='USD', rounding_decimals=0))
        position = self.position('SELL')
        fast = _liquidation_net_account(position, exit_bid=Decimal('1.10001'), exit_ask=Decimal('1.10021'),
            instrument=self.instrument, cost_model=costs)
        full, breakdown = _liquidation_pnl(position, exit_bid=Decimal('1.10001'), exit_ask=Decimal('1.10021'),
            instrument=self.instrument, cost_model=costs)
        self.assertEqual(fast, full)
        self.assertEqual(fast, Decimal(str(breakdown['net_account'])))
