from datetime import datetime,timezone
from decimal import Decimal as D
import hashlib,json
from pathlib import Path
import sys,tempfile,unittest
from unittest.mock import patch

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2/'scripts')]
import forex_coarse_screen as coarse
from trading_workspace_v2.forex_coarse_input import CoarseHour,prepare_coarse_hours,load_coarse_hours
from trading_workspace_v2.forex_h4 import Candle,CandleState,H4
from trading_workspace_v2.forex_h4_candidates import BASELINE

START=int(datetime(2022,1,3,tzinfo=timezone.utc).timestamp())*1000


def hour(index,bid='1.10000',*,ask=None,low=None,high=None,start=START):
    b=D(bid);a=D(ask) if ask else b+D('.00020');spread=a-b
    lo=D(low) if low else b;hi=D(high) if high else b
    return CoarseHour(mid=CandleState(timestamp=start//1000+index*3600,open=(a+b)/2,
        high=hi+spread/2,low=lo+spread/2,close=(a+b)/2),bid=(b,hi,lo,b),
        ask=(a,hi+spread,lo+spread,a),first_time_msc=start+index*3600000+1,
        last_time_msc=start+index*3600000+1000,first_sequence=index+1,last_sequence=index+1,
        ticks=1,maximum_spread=spread)


def warmup(start=START):
    return [Candle(start//1000+(i-81)*H4,D('1.10010'),D('1.10110'),D('1.09910'),D('1.10010')) for i in range(81)]


class Rule:
    def __init__(self,*,side='BUY',hold=False,start=START):self.side=side;self.hold=hold;self.start=start
    def observe(self,bar,*,side=None,**kwargs):
        if bar.timestamp<self.start//1000:return None,D('.001')
        if bar.timestamp==self.start//1000:return self.side,D('.001')
        return ('EXIT' if side and not self.hold else None),D('.001')


class CoarseTests(unittest.TestCase):
    def run_case(self,hours,*,side='BUY',hold=False,start=START,end=None,buy='10',sell='10',slip='0',rule=None):
        with patch.object(coarse,'study_candidate',return_value=rule or Rule(side=side,hold=hold,start=start)):
            return coarse.simulate_coarse(BASELINE,warmup(start),hours,start=start,
                end=end or start+86400000,data_sha256='a'*64,name='fixture',slippage=D(slip),
                buy_debit=D(buy),sell_debit=D(sell))

    def test_next_open_buy_sell_costs_and_no_same_bar_fill(self):
        for side,last in [('BUY','1.10300'),('SELL','1.09700')]:
            with self.subTest(side=side):
                rows=[hour(h) for h in range(8)]+[hour(8,last)]
                result=self.run_case(rows,side=side)
                self.assertEqual(result['entry_fills'],1)
                self.assertEqual(result['closed_trades'],1)
                self.assertEqual(result['trades'][0]['entry_time_msc'],START+4*3600000+1)
                self.assertEqual(result['trades'][0]['exit_time_msc'],START+8*3600000+1)
                self.assertEqual(D(result['net_equity_usd']),D('63.25'))
                self.assertEqual(result['internal_risk_and_prop'],'not_evaluated')
                self.assertFalse(result['promotion_authorized'])

    def test_stop_level_and_gap_are_different_and_intrahour_time_unknown(self):
        rows=[hour(h) for h in range(5)]
        level=self.run_case(rows+[hour(5,low='1.09800')],hold=True)
        gap=self.run_case(rows+[hour(5,'1.09800')],hold=True)
        self.assertEqual(D(level['net_equity_usd']),D('-24.15'))
        self.assertEqual(D(gap['net_equity_usd']),D('-51.75'))
        self.assertIsNone(level['trades'][0]['exit_time_msc'])
        self.assertEqual(gap['trades'][0]['exit_time_msc'],START+5*3600000+1)

    def test_finance_cash_credit_and_unrealized_are_not_counted_twice(self):
        rows=[hour(h) for h in range(24)]
        bought=self.run_case(rows,hold=True)
        sold=self.run_case(rows,side='SELL',hold=True,sell='-.31')
        self.assertEqual(D(bought['financing_debit_usd']),D('2.30'))
        self.assertEqual(D(bought['net_equity_usd']),D('-8.05'))
        self.assertEqual(D(sold['financing_debit_usd']),D('-.07'))
        self.assertEqual(D(sold['net_equity_usd']),D('-5.68'))
        self.assertEqual(bought['closed_trades'],0)
        self.assertIsNotNone(bought['open_position'])

    def test_calendar_posts_through_quote_free_gap_and_triples_wednesday(self):
        rows=[hour(h) for h in range(5)]+[hour(95)]
        result=self.run_case(rows,hold=True,end=START+96*3600000)
        self.assertEqual(D(result['financing_debit_usd']),D('13.80'))
        self.assertEqual(len(result['financing_events']),4)
        self.assertEqual(result['entry_fills'],1)

    def test_pending_end_and_prefix_causality(self):
        short=self.run_case([hour(h) for h in range(4)],end=START+4*3600000)
        long=self.run_case([hour(h) for h in range(9)])
        self.assertEqual(short['entry_fills'],0)
        self.assertTrue(short['pending_entry'])
        self.assertEqual(short['decisions'],long['decisions'][:len(short['decisions'])])

    def test_partial_friday_hours_still_execute_exit_without_fake_weekend_bars(self):
        friday=START+4*86400000
        class FridayRule(Rule):
            def observe(self,bar,*,side=None,**kwargs):
                if bar.timestamp<friday//1000:return None,D('.001')
                if bar.timestamp==friday//1000:return 'BUY',D('.001')
                return ('EXIT' if side and bar.timestamp%86400==16*3600 else None),D('.001')
        rows=[hour(h,start=friday) for h in range(22)]+[hour(72,start=friday)]
        result=self.run_case(rows,start=friday,end=friday+73*3600000,rule=FridayRule())
        self.assertEqual(result['closed_trades'],1)
        self.assertEqual(result['trades'][0]['exit_time_msc'],friday+20*3600000+1)
        self.assertEqual(result['financing_events'],[])
        self.assertIn(friday//1000+20*3600,result['excluded_h4'])

    def test_bad_hour_order_and_future_warmup_fail_before_simulation(self):
        with self.assertRaises(ValueError):self.run_case([hour(1),hour(0)])
        with patch.object(coarse,'study_candidate') as factory,self.assertRaisesRegex(ValueError,'warmup'):
            coarse.simulate_coarse(BASELINE,warmup(START+86400000),[hour(0)],start=START,end=START+86400000,
                data_sha256='a'*64,name='fixture',slippage=D(0),buy_debit=D(0),sell_debit=D(0))
        factory.assert_not_called()

    def test_raw_preparation_cache_reuse_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);raw=root/'tiny.csv'
            raw.write_text('DateTime,Bid,Ask,Volume\n20220103 00:00:00.001,1.10000,1.10020,0\n'
                '20220103 00:59:00.001,1.10010,1.10030,0\n20220103 01:00:00.001,1.09990,1.10010,0\n')
            kwargs=dict(cache_dir=root/'cache',sha256=hashlib.sha256(raw.read_bytes()).hexdigest(),
                first_day='20220103',last_day='20220103')
            first,proof=prepare_coarse_hours(raw,**kwargs)
            self.assertEqual([h.ticks for h in first],[2,1])
            self.assertEqual(first[0].mid.high,D('1.10020'))
            entry=Path(proof['path']);before=entry.read_bytes()
            second,hit=prepare_coarse_hours(raw,**kwargs)
            self.assertTrue(hit['cache_hit']);self.assertEqual(first,second);self.assertEqual(before,entry.read_bytes())
            packet=json.loads(before);packet['payload']['hours'][0]['ticks']=4
            entry.write_text(json.dumps(packet))
            with self.assertRaisesRegex(ValueError,'checksum'):load_coarse_hours(raw,**kwargs)
            entry.write_bytes(before);raw.write_text(raw.read_text()+'\n')
            with self.assertRaisesRegex(ValueError,'hash'):load_coarse_hours(raw,**kwargs)


if __name__=='__main__':unittest.main()
