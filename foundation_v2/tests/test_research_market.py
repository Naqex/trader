from decimal import Decimal as D
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import forex_coarse_screen as coarse
from trading_workspace_v2.forex_h4 import Candle,H4,size_for_stop
from trading_workspace_v2.forex_h4_candidates import SMA,ZSCORE,METAL_BASELINE,METAL_SMA,METAL_ZSCORE,ResearchH4Candidate
from trading_workspace_v2.forex_pilot_risk import initialize_forex_pilot
from trading_workspace_v2.forex_coarse_input import CoarseHour
from trading_workspace_v2.forex_h4 import CandleState
from trading_workspace_v2.research_market import MetalStudyMarket,size_for_market_stop
from trading_workspace_v2.retained import CostModel,InstrumentSpec,calculate_round_trip_cost

START=1704067200000


def hour(i,bid='2000.000'):
    b=D(bid);s=D('.5');at=START+i*3600000
    return CoarseHour(mid=CandleState(timestamp=at//1000,open=b+s/2,close=b+s/2,
        high=b+1+s/2,low=b-1+s/2),bid=(b,b+1,b-1,b),ask=(b+s,b+1+s,b-1+s,b+s),
        first_time_msc=at,last_time_msc=at+1000,first_sequence=i+1,last_sequence=i+1,ticks=1,maximum_spread=s)


class MarketTests(unittest.TestCase):
    def test_gold_units_risk_and_minimum_lot_hand_values(self):
        market=MetalStudyMarket();state=market.execution('fixture',D('.1'),'a'*64,START)
        instrument=InstrumentSpec.from_mapping(state.instrument_spec);model=CostModel.from_mapping(state.cost_model)
        self.assertEqual(instrument.contract_size,100)
        quantity=size_for_market_stop(D(10),instrument=instrument,model=model)
        self.assertEqual(quantity,D('.02'))
        self.assertIsNone(size_for_market_stop(D(30),instrument=instrument,model=model))
        cost=calculate_round_trip_cost(model,'BUY',quantity,100,D('1999.833'),D('2000.333'),
            D('1990.333'),D('1990.833'))
        self.assertEqual(D(str(cost['net_account'])),D('-20.50'))
        # Coarse geometry does not broaden the native pilot/broker boundary.
        with self.assertRaisesRegex(ValueError,'EURUSD'):initialize_forex_pilot(state,start_time_msc=START)

    def test_existing_fx_sizing_is_unchanged_for_representative_grid(self):
        state=coarse.initial_state('fixture',D(0),'a'*64,start=START).execution
        instrument=InstrumentSpec.from_mapping(state.instrument_spec)
        for slip in (D(0),D('.00002')):
            costs=dict(state.cost_model,slippage_price_per_side=str(slip));model=CostModel.from_mapping(costs)
            for steps in range(1,100):
                distance=D(steps)/10000
                self.assertEqual(size_for_market_stop(distance,instrument=instrument,model=model),
                    size_for_stop(distance,slippage=slip))

    def test_capital_feasibility_preserves_risk_percent_with_actual_lot_floor(self):
        small=MetalStudyMarket();large=MetalStudyMarket(starting_balance_usd='50000')
        a=small.execution('fixture',D('.1'),'a'*64,START)
        b=large.execution('fixture',D('.1'),'a'*64,START)
        self.assertEqual(b.starting_balance,50000)
        instrument=InstrumentSpec.from_mapping(b.instrument_spec);model=CostModel.from_mapping(b.cost_model)
        self.assertIsNone(size_for_market_stop(D(30),instrument=instrument,model=model,budget=a.starting_balance*D('.0025')))
        self.assertEqual(size_for_market_stop(D(30),instrument=instrument,model=model,budget=b.starting_balance*D('.0025')),D('.04'))

    def test_incompatible_geometry_currency_and_nonfinite_rejected(self):
        for update in ({'tick_size':'.01'},{'contract_size':'100000'},{'instrument_id':'EURUSD'},
                       {'quote_ccy':'JPY'},{'leverage':'Infinity'}):
            with self.subTest(update=update),self.assertRaises(ValueError):MetalStudyMarket(**update)
        state=MetalStudyMarket().execution('fixture',D('.1'),'a'*64,START)
        instrument=InstrumentSpec.from_mapping(state.instrument_spec);model=CostModel.from_mapping(state.cost_model)
        with self.assertRaises(ValueError):size_for_market_stop(D('NaN'),instrument=instrument,model=model)

    def test_shared_coarse_cash_buy_sell_and_truthful_source_basis(self):
        warm=[Candle(START//1000+(i-81)*H4,D('2000.25'),D('2001.25'),D('1999.25'),D('2000.25')) for i in range(81)]
        for direction,last in [('BUY','2005'),('SELL','1995')]:
            class Rule:
                def observe(self,bar,*,side=None,**kwargs):
                    if bar.timestamp<START//1000:return None,D(10)
                    return ('EXIT' if side else direction),D(10)
            with patch.object(coarse,'metal_candidate',return_value=Rule()):
                result=coarse.simulate_coarse(METAL_BASELINE,warm,[hour(i) for i in range(8)]+[hour(8,last)],
                    start=START,end=START+86400000,data_sha256='a'*64,name='fixture',slippage=D('.1'),
                    buy_debit=D(0),sell_debit=D(0),market_spec=MetalStudyMarket(),input_basis='bid_ohlc_declared_ask')
            self.assertEqual(result['closed_trades'],1)
            self.assertEqual(D(result['net_equity_usd']),D('8.50'))
            self.assertIsNone(result['source_ticks'])
            self.assertEqual(result['source_m1_rows'],9)
            self.assertIn('not_observed_quote',result['trades'][0]['exit_price_basis'])
            self.assertFalse(result['broker_spec_verified'])

    def test_explicit_asset_source_pair_is_required_before_simulation(self):
        kwargs=dict(start=START,end=START+86400000,data_sha256='a'*64,name='fixture',slippage=D(0),buy_debit=D(0),sell_debit=D(0))
        with self.assertRaisesRegex(ValueError,'matching metal'):coarse.simulate_coarse(METAL_SMA,[],[],**kwargs)
        with self.assertRaisesRegex(ValueError,'source basis'):coarse.simulate_coarse(METAL_SMA,[],[],market_spec=MetalStudyMarket(),**kwargs)
        with self.assertRaisesRegex(ValueError,'matching metal'):coarse.simulate_coarse(SMA,[],[],market_spec=MetalStudyMarket(),**kwargs)

    def test_aliases_keep_exact_rule_math_and_own_state_identity(self):
        rng=random.Random(11)
        bars=[Candle(i*H4,D(2000+rng.randrange(-20,21)),D(2030),D(1970),D(2000+rng.randrange(-20,21))) for i in range(200)]
        for old,new in ((SMA,METAL_SMA),(ZSCORE,METAL_ZSCORE)):
            a,b=ResearchH4Candidate(old),ResearchH4Candidate(new)
            for bar in bars[:100]:self.assertEqual(a.observe(bar),b.observe(bar))
            self.assertEqual(b.export_state().candidate,new)
            restored=ResearchH4Candidate.from_state(b.export_state())
            for bar in bars[100:]:self.assertEqual(b.observe(bar),restored.observe(bar))
            self.assertEqual(b.export_state(),restored.export_state())
