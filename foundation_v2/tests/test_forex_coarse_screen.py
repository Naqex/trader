from datetime import datetime,timezone
from decimal import Decimal as D
import hashlib,json
from pathlib import Path
import sys,tempfile,unittest
from unittest.mock import patch
from copy import deepcopy

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

    def test_observed_mid_extrema_and_spread_survive_hour_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);raw=root/'spread.csv'
            raw.write_text('DateTime,Bid,Ask,Volume\n'
                '20220103 00:00:00.001,1.10000,1.10020,0\n'
                '20220103 00:10:00.002,1.10010,1.10012,0\n'
                '20220103 00:20:00.003,1.09990,1.10030,0\n'
                '20220103 00:59:00.004,1.09980,1.09990,0\n'
                '20220103 02:00:00.005,1.09900,1.09910,0\n')
            hours,_=prepare_coarse_hours(raw,cache_dir=root/'cache',
                sha256=hashlib.sha256(raw.read_bytes()).hexdigest(),
                first_day='20220103',last_day='20220103')
            first,last=hours
            self.assertEqual(first.bid,(D('1.10000'),D('1.10010'),D('1.09980'),D('1.09980')))
            self.assertEqual(first.ask,(D('1.10020'),D('1.10030'),D('1.09990'),D('1.09990')))
            self.assertEqual(first.mid.high,D('1.10011'))
            self.assertEqual(first.mid.low,D('1.09985'))
            self.assertEqual(first.maximum_spread,D('.00040'))
            self.assertEqual((first.first_sequence,first.last_sequence,first.ticks),(1,4,4))
            self.assertEqual(first.last_time_msc,START+3540004)
            self.assertEqual((last.first_sequence,last.last_sequence,last.ticks),(5,5,1))
            self.assertEqual(last.mid.timestamp,START//1000+7200)
            self.assertEqual(last.bid,(D('1.09900'),)*4)

    def registered_fixture(self,root):
        from trading_workspace_v2.forex_intraday_candidates import RSI_REENTRY
        proto=root/'protocol.md';proto.write_text('synthetic registered CLI scope fixture')
        raw=dict(schema='forex-h4-inputs-v1')
        for role,first,last in [('warmup','20221101','20221231'),('development','20230103','20230104')]:
            path=root/(role+'.csv');path.write_text('fixture bytes; cache loader mocked')
            raw[role]=dict(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),first_day=first,last_day=last)
        manifest=root/'inputs.json';manifest.write_text(json.dumps(raw))
        bound={k:v for k,v in coarse.coarse_source_pins().items() if k!='trading_workspace_v2/forex_study_registration.py'}
        reg=dict(study_id='fixture',candidates=[RSI_REENTRY],prop_profile=None,
            windows=dict(warmup={k:raw['warmup'][k] for k in ('first_day','last_day')},
                         evaluation={k:raw['development'][k] for k in ('first_day','last_day')}),
            input_pins={k:raw[k] for k in ('warmup','development')},
            account_spec=dict(path=str(root/'spec.json'),sha256='a'*64),
            protocol=dict(sha256=hashlib.sha256(proto.read_bytes()).hexdigest()),
            coarse_source_files=bound,source_files=bound,data_role='historical_robustness',scenarios=[
                dict(name=name,commission_usd_per_lot_per_side='2.50',slippage_price_per_side=slip,
                     financing_debit_buy_usd_per_lot=buy,financing_debit_sell_usd_per_lot=sell)
                for name,slip,buy,sell in [('reference','0','9.3','-.31'),('cost-stress','.00002','20','20')]])
        registration=root/'registration.json';registration.write_text(json.dumps(reg))
        args=['--input-manifest',str(manifest),'--protocol',str(proto),'--cache-dir',str(root/'cache'),
              '--study-registration',str(registration),'--study-registration-sha256','b'*64]
        return args,raw,reg

    def test_registered_coarse_cli_uses_pinned_historical_window_and_costs(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);args,raw,reg=self.registered_fixture(root)
            warm=int(datetime(2022,12,27,tzinfo=timezone.utc).timestamp())*1000
            start=int(datetime(2023,1,3,tzinfo=timezone.utc).timestamp())*1000
            def loader(path,**kwargs):
                values=[hour(i,start=warm) for i in range(100)] if path.name=='warmup.csv' else [hour(i,start=start) for i in range(4)]
                return values,dict(hours=len(values),binding=kwargs)
            with patch.object(coarse,'load_registration',return_value=reg), \
                 patch.object(coarse,'observed_account_spec',return_value=dict(sha256='a'*64,debit_buy_usd_per_lot='9.3',debit_sell_usd_per_lot='-.31')), \
                 patch.object(coarse,'load_coarse_hours',side_effect=loader):
                coarse.main(args+['--output-dir',str(root/'out')])
            result=json.loads((root/'out/result.json').read_bytes())
            self.assertEqual(len(result['rows']),2)
            self.assertEqual(result['study_registration']['study_id'],'fixture')
            self.assertFalse(result['clean_oos']);self.assertFalse(result['promotion_authorized'])
            self.assertEqual(result['inputs']['development']['first_day'],'20230103')

    def test_coarse_cli_rejects_source_or_holdout_scope_and_keeps_failure_status(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);args,raw,reg=self.registered_fixture(root)
            for kind in ('source','holdout','unknown-registration'):
                bad=deepcopy(reg);manifest=deepcopy(raw)
                if kind=='source':bad['coarse_source_files']['scripts/forex_coarse_screen.py']='0'*64
                if kind=='holdout':
                    for role,window,first,last in [('warmup','warmup','20241101','20241231'),('development','evaluation','20250103','20250104')]:
                        manifest[role].update(first_day=first,last_day=last)
                        bad['windows'][window].update(first_day=first,last_day=last)
                        bad['input_pins'][role].update(first_day=first,last_day=last)
                (root/'inputs.json').write_text(json.dumps(manifest))
                with patch.object(coarse,'load_registration',return_value=bad) as registration, \
                     patch.object(coarse,'observed_account_spec',return_value=dict(sha256='a'*64,debit_buy_usd_per_lot='9.3',debit_sell_usd_per_lot='-.31')), \
                     patch.object(coarse,'load_coarse_hours') as load, self.assertRaises(ValueError):
                    if kind=='unknown-registration':registration.side_effect=ValueError('unregistered')
                    coarse.main(args+['--output-dir',str(root/kind)])
                load.assert_not_called()
                failure=json.loads((root/kind/'failure.json').read_bytes())
                self.assertEqual(failure['status'],'failed');self.assertEqual(failure['failed_phase'],'manifest')
                self.assertEqual(json.loads((root/kind/'progress.json').read_bytes())['stage'],'failed')


if __name__=='__main__':unittest.main()
