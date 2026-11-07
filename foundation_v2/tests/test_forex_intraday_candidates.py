from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2/'scripts')]

from trading_workspace_v2.forex_h4 import Candle, HOUR
from trading_workspace_v2.forex_intraday_candidates import (
    INTRADAY_CANDIDATES, IntradayH1Candidate, IntradayH1State,
    RSI_REENTRY, SHOCK, DAY_BREAK, DAY_FADE, BB_REENTRY, PULLBACK, EUROPE_AM, POSTFIX,
)

import forex_coarse_screen as coarse
from test_forex_coarse_screen import hour

START=int(datetime(2022,1,3,tzinfo=timezone.utc).timestamp())


def bar(index, close='1.10000', *, start=START, high=None, low=None):
    value=D(close)
    return Candle(start+index*HOUR,value,D(high) if high else value+D('.00010'),
                  D(low) if low else value-D('.00010'),value)


def seed(candidate, bars=None):
    strategy=IntradayH1Candidate(candidate)
    for candle in bars or [bar(i) for i in range(100)]:strategy.observe(candle)
    return strategy


class IntradayTests(unittest.TestCase):
    def test_rsi_wilder_seed_flat_gain_loss_and_reentry(self):
        flat=seed(RSI_REENTRY)
        self.assertEqual(flat.rsi,D(50))
        for direction,expected,signal in [(-1,D(0),'BUY'),(1,D(100),'SELL')]:
            strategy=seed(RSI_REENTRY,[bar(i,D('1.1')+direction*D('.0001')*i) for i in range(100)])
            self.assertEqual(strategy.rsi,expected)
            value=strategy.history[-1].close-direction*D('.002')
            emitted,distance=strategy.observe(bar(100,value))
            self.assertEqual(emitted,signal)
            self.assertGreater(distance,0)
            expected_gain=(D('.002')/14 if direction == -1 else D('.0001')*13/14)
            expected_loss=(D('.0001')*13/14 if direction == -1 else D('.002')/14)
            self.assertEqual(strategy.rsi,100-100/(1+expected_gain/expected_loss))

    def test_bollinger_reentry_uses_prior_band_and_observed_close(self):
        for sign,signal in [(1,'BUY'),(-1,'SELL')]:
            strategy=seed(BB_REENTRY)
            self.assertIsNone(strategy.observe(bar(100,D('1.1')-sign*D('.002')))[0])
            self.assertEqual(strategy.observe(bar(101,D('1.1')-sign*D('.0005')))[0],signal)

    def test_shock_needs_reclaim_not_just_large_range(self):
        strategy=seed(SHOCK)
        self.assertIsNone(strategy.observe(bar(100,'1.0991',high='1.1010',low='1.0990'))[0])
        snapshot=strategy.export_state()
        self.assertIsNone(strategy.observe(bar(101,'1.0995'))[0])
        restored=IntradayH1Candidate.from_state(snapshot)
        self.assertEqual(restored.observe(bar(101,'1.1002'))[0],'BUY')

    def test_pullback_and_time24_exit(self):
        strategy=seed(PULLBACK,[bar(i,D('1.1')+D('.0001')*i) for i in range(100)])
        strategy.observe(bar(100,'1.1088'))
        self.assertEqual(strategy.observe(bar(101,'1.1110'))[0],'BUY')
        for offset in range(24):
            signal,_=strategy.observe(bar(102+offset,D('1.1111')+offset*D('.0001')),side='BUY',position_id='p1')
            self.assertEqual(signal,'EXIT' if offset==23 else None)

    def prior_day(self,candidate):
        friday=int(datetime(2022,1,7,tzinfo=timezone.utc).timestamp())
        strategy=seed(candidate,[bar(i,start=friday,high='1.101',low='1.099') for i in range(21)])
        for index in (70,71,72,73,74,75,76,77,78):strategy.observe(bar(index,start=friday))
        return strategy,friday

    def test_day_range_ignores_sunday_and_latches_emitted_entry(self):
        strategy,friday=self.prior_day(DAY_BREAK)
        self.assertEqual(strategy.range_high,D('1.101'))
        self.assertEqual(strategy.range_day,friday//86400)
        self.assertEqual(strategy.observe(bar(79,'1.102',start=friday))[0],'BUY')
        self.assertIsNone(strategy.observe(bar(80,'1.103',start=friday))[0])

    def test_day_fade_rejects_two_sided_sweep_and_expired_range(self):
        strategy,friday=self.prior_day(DAY_FADE)
        snapshot=strategy.export_state()
        self.assertIsNone(strategy.observe(bar(79,start=friday,high='1.102',low='1.098'))[0])
        restored=IntradayH1Candidate.from_state(snapshot)
        self.assertEqual(restored.observe(bar(79,'1.1005',start=friday,high='1.102',low='1.1002'))[0],'SELL')
        expired=IntradayH1Candidate.from_state(snapshot)
        self.assertIsNone(expired.observe(bar(127,'1.102',start=friday))[0])

    def test_clocks_use_decision_end_time_and_dst(self):
        for candidate,winter_hour,summer_hour,signal in [(EUROPE_AM,7,6,'SELL'),(POSTFIX,16,15,'BUY')]:
            for day,expected_hour in [(24,winter_hour),(31,summer_hour)]:
                decision=int(datetime(2022,3,day,expected_hour,tzinfo=timezone.utc).timestamp())
                begin=decision-101*HOUR
                strategy=seed(candidate,[bar(i,start=begin) for i in range(100)])
                self.assertEqual(strategy.observe(bar(100,start=begin))[0],signal)
                self.assertIsNone(strategy.observe(bar(101,start=begin))[0])
                end_hours=5 if candidate==EUROPE_AM else 4
                for index in range(102,100+end_hours):
                    self.assertIsNone(strategy.observe(bar(index,start=begin),side=signal,position_id='p1')[0])
                self.assertEqual(strategy.observe(bar(100+end_hours,start=begin),side=signal,position_id='p1')[0],'EXIT')

    def test_every_recipe_prefix_and_restore_preserve_state(self):
        rng=random.Random(421)
        candles=[bar(i,D('1.1')+D(rng.randrange(-60,61))/100000) for i in range(250)]
        for candidate in INTRADAY_CANDIDATES:
            with self.subTest(candidate=candidate):
                first=IntradayH1Candidate(candidate)
                for candle in candles[:125]:first.observe(candle)
                state=first.export_state()
                second=IntradayH1Candidate.from_state(IntradayH1State.model_validate_json(state.model_dump_json()))
                for candle in candles[125:]:self.assertEqual(first.observe(candle),second.observe(candle))
                self.assertEqual(first.export_state(),second.export_state())

    def test_bad_clock_identity_and_state_rejected_without_mutation(self):
        strategy=seed(RSI_REENTRY);before=strategy.export_state()
        with self.assertRaises(ValueError):strategy.observe(bar(99))
        with self.assertRaises(ValueError):strategy.observe(bar(100),side='BUY')
        self.assertEqual(strategy.export_state(),before)
        with self.assertRaises(ValueError):IntradayH1State(candidate='not-registered')
        with self.assertRaises(ValueError):IntradayH1State.model_validate(before.model_dump()|{'schema_version':'other'})
        with self.assertRaises(ValueError):IntradayH1State.model_validate(before.model_dump()|{'atr':'NaN'})

    def test_coarse_h1_decision_does_not_fill_at_h4_or_same_bar(self):
        class Rule:
            def observe(self,candle,*,side=None,**kwargs):
                if candle.timestamp<START:return None,D('.001')
                if candle.timestamp==START:return 'BUY',D('.001')
                return ('EXIT' if side else None),D('.001')
        warmup=[bar(i,start=START-100*HOUR) for i in range(100)]
        hours=[hour(i) for i in range(4)]
        with patch.object(coarse,'study_candidate',return_value=Rule()):
            result=coarse.simulate_coarse(RSI_REENTRY,warmup,hours,start=START*1000,end=(START+4*HOUR)*1000,
                data_sha256='a'*64,name='fixture',slippage=D(0),buy_debit=D(0),sell_debit=D(0))
        self.assertEqual(result['entry_fills'],1)
        self.assertEqual(result['trades'][0]['entry_time_msc'],(START+HOUR)*1000+1)
        self.assertEqual(result['trades'][0]['exit_time_msc'],(START+2*HOUR)*1000+1)
        self.assertEqual(result['decisions'][0]['time_msc'],(START+HOUR)*1000)


if __name__=='__main__':unittest.main()
