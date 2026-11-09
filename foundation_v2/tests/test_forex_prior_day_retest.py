from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
import sys
import unittest

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2/'scripts')]
from trading_workspace_v2.forex_h4 import Candle,HOUR
from trading_workspace_v2.forex_intraday_candidates import DAY_BREAK,DAY_RETEST,IntradayH1Candidate,IntradayH1State
from test_forex_intraday_candidates import bar
from test_forex_coarse_screen import hour,START
from forex_coarse_screen import simulate_coarse

FRIDAY=int(datetime(2022,1,7,tzinfo=timezone.utc).timestamp())

def prior_range():
    result=IntradayH1Candidate(DAY_RETEST)
    for i in range(21):result.observe(bar(i,start=FRIDAY,high='1.101',low='1.099'))
    for i in range(70,79):result.observe(bar(i,start=FRIDAY))
    return result

def arm(side='BUY'):
    result=prior_range()
    candle=bar(79,'1.102' if side=='BUY' else '1.098',start=FRIDAY,
        low='1.1005' if side=='BUY' else '1.0978',high='1.1022' if side=='BUY' else '1.0995')
    signal,_=result.observe(candle)
    assert signal is None
    return result

class PriorDayRetestTests(unittest.TestCase):
    def test_later_bar_confirmation_buy_sell_and_latch(self):
        for side in ('BUY','SELL'):
            with self.subTest(side=side):
                s=arm(side);self.assertEqual(s.retest_side,side)
                self.assertEqual(s.retest_armed_at,FRIDAY+80*HOUR)
                confirm=bar(80,'1.1015' if side=='BUY' else '1.0985',start=FRIDAY,
                    low='1.1009' if side=='BUY' else '1.0982',high='1.1018' if side=='BUY' else '1.0991')
                before=s.export_state();restored=IntradayH1Candidate.from_state(IntradayH1State.model_validate_json(before.model_dump_json()))
                self.assertEqual(s.observe(confirm)[0],side)
                self.assertEqual(restored.observe(confirm)[0],side)
                self.assertEqual(s.export_state(),restored.export_state())
                self.assertIsNone(s.retest_side)
                self.assertIsNone(s.observe(bar(81,'1.102',start=FRIDAY))[0])

    def test_third_bar_inclusive_and_fourth_bar_expired(self):
        for touched in (True,False):
            s=arm()
            for i in (80,81):self.assertIsNone(s.observe(bar(i,'1.102',start=FRIDAY,low='1.1012'))[0])
            signal,_=s.observe(bar(82,'1.102',start=FRIDAY,low='1.1009' if touched else '1.1012'))
            self.assertEqual(signal,'BUY' if touched else None)
            self.assertIsNone(s.retest_side)
            self.assertIsNone(s.observe(bar(83,'1.102',start=FRIDAY,low='1.1009'))[0])

    def test_invalidation_equal_close_and_attempt_consumed(self):
        for side,level in [('BUY','1.101'),('SELL','1.099')]:
            s=arm(side);self.assertIsNone(s.observe(bar(80,level,start=FRIDAY))[0]);self.assertIsNone(s.retest_side)
            self.assertIsNone(s.observe(bar(81,'1.102' if side=='BUY' else '1.098',start=FRIDAY))[0])
            self.assertIsNone(s.retest_side);self.assertIsNotNone(s.retest_attempt_day)

    def test_gap_day_roll_stale_range_and_last_entry_hour(self):
        for index in (81,96):
            s=arm();self.assertIsNone(s.observe(bar(index,'1.102',start=FRIDAY,low='1.1009'))[0]);self.assertIsNone(s.retest_side)
        s=prior_range();self.assertIsNone(s.observe(bar(151,'1.102',start=FRIDAY))[0]);self.assertIsNone(s.retest_side)
        s=prior_range()
        for i in range(79,86):s.observe(bar(i,start=FRIDAY))
        self.assertIsNone(s.observe(bar(86,'1.102',start=FRIDAY))[0])
        self.assertEqual(s.observe(bar(87,'1.102',start=FRIDAY,low='1.1009'))[0],'BUY')
        s=prior_range()
        for i in range(79,87):s.observe(bar(i,start=FRIDAY))
        s.observe(bar(87,'1.102',start=FRIDAY));self.assertIsNone(s.retest_side)

    def test_state_ownership_level_clock_mutations(self):
        state=arm().export_state().model_dump()
        for change in [dict(candidate=DAY_BREAK),dict(retest_side=None),dict(retest_side='EXIT'),dict(retest_level='1.102'),
                       dict(retest_armed_at=state['retest_armed_at']+HOUR),dict(retest_attempt_day=state['retest_attempt_day']+1)]:
            with self.subTest(change=change),self.assertRaises(ValueError):IntradayH1State.model_validate(state|change)
        s=arm();s.observe(bar(80,'1.102',start=FRIDAY,low='1.1009'));s.observe(bar(81,start=FRIDAY),side='BUY',position_id='p1')
        with self.assertRaises(ValueError):s.observe(bar(82,start=FRIDAY),side='SELL',position_id='p1')

    def fixture(self,*,stop=False,gap_confirm=False,missing_entry=False,missing_exit=False):
        begin=START+7*HOUR*1000
        warm=[Candle(begin//1000+(i-100)*HOUR,D('1.1'),D('1.101'),D('1.099'),D('1.1')) for i in range(100)]
        rows=[hour(0,'1.10200',low='1.10070',high='1.10210',start=begin),hour(1,'1.10150',low='1.10080',high='1.10160',start=begin)]
        rows += [hour(i,'1.10170',low='1.09500' if stop and i==3 else '1.10160',high='1.10200',start=begin) for i in range(2,14)]
        if gap_confirm:rows=[r for r in rows if r.mid.timestamp!=begin//1000+HOUR]
        if missing_entry:rows=[r for r in rows if r.mid.timestamp not in (begin//1000+2*HOUR,begin//1000+3*HOUR)]
        if missing_exit:rows=rows[:-1]+[hour(19,'1.10170',start=begin)]
        return simulate_coarse(DAY_RETEST,warm,rows,start=begin,end=begin+24*HOUR*1000,data_sha256='a'*64,name='fixture',slippage=D('.00002'),buy_debit=D('9.3'),sell_debit=D('-.31')),begin

    def test_real_coarse_entry_exit_cash_and_stop(self):
        for stopped in (False,True):
            result,begin=self.fixture(stop=stopped)
            self.assertEqual((result['entry_fills'],result['closed_trades']),(1,1))
            trade=result['trades'][0];self.assertEqual(trade['entry_time_msc'],begin+2*HOUR*1000+1)
            self.assertEqual(trade['reason'],'stop_loss' if stopped else 'strategy_exit')
            if not stopped:self.assertEqual(trade['exit_time_msc'],begin+13*HOUR*1000+1)
            self.assertEqual(D(result['balance_usd']),D(10000)+D(trade['price_net_usd'])-D(result['financing_debit_usd']))

    def test_missing_confirmation_does_not_invent_a_retest(self):
        result,_=self.fixture(gap_confirm=True);self.assertEqual(result['entry_fills'],0)

    def test_missing_entry_exit_quotes_keep_actual_late_fill(self):
        result,begin=self.fixture(missing_entry=True);self.assertEqual(result['trades'][0]['entry_time_msc'],begin+4*HOUR*1000+1)
        result,begin=self.fixture(missing_exit=True);self.assertEqual(result['trades'][0]['exit_time_msc'],begin+19*HOUR*1000+1)

if __name__=='__main__':unittest.main()
