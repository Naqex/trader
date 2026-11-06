"""Exit expectations calculated from explicit rules, outside candidate helpers."""
from decimal import Decimal as D
from pathlib import Path
import sys
import unittest

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'scripts')]
from trading_workspace_v2.forex_h4 import Candle,H4
from trading_workspace_v2.forex_h4_candidates import ResearchH4Candidate,ZSCORE
from trading_workspace_v2.forex_prop_candidates import PropH4Candidate,UTC_RANGE
from trading_workspace_v2.forex_pilot_risk import initialize_forex_pilot,queue_forex_pilot_exit
from test_forex_pilot_risk import execution,advance,queue,tick,ms


class ExitOracleTests(unittest.TestCase):
    def test_zscore_entries_reversion_and_six_observed_closes_match_independent_rules(self):
        candidate = ResearchH4Candidate(ZSCORE)
        history=[]
        side=position=None
        age=0
        exits=entries=0
        for index in range(180):
            # Missing calendar bars cannot increase held-observation count.
            close=D('1.1')+D(((index*7)%23)-11)/D(10000)
            if index%29==0: close+=D('.005')
            if index%41==0: close-=D('.005')
            candle=Candle(ms()//1000//H4*H4+index*2*H4,close,close+D('.001'),close-D('.001'),close)
            age=age+1 if side else 0
            expected=None
            if side and age>=6:
                expected='EXIT'
            elif len(history)>=20:
                prior=history[-20:]
                mean=sum(prior,D(0))/20
                variance=sum(((v-mean)**2 for v in prior),D(0))/20
                if variance:
                    z=(close-mean)/variance.sqrt()
                    if side=='BUY' and z>=0 or side=='SELL' and z<=0:
                        expected='EXIT'
                    elif side is None:
                        expected='BUY' if z<=-2 else 'SELL' if z>=2 else None
            self.assertEqual(candidate.observe(candle,side=side,position_id=position)[0],expected)
            history.append(close)
            if expected=='EXIT': side=position=None;age=0;exits+=1
            elif expected in ('BUY','SELL'): side=expected;position=f'p{index}';age=0;entries+=1
        self.assertGreater(entries,0)
        self.assertGreater(exits,0)

    def test_zscore_sixth_actual_close_exits_for_both_sides_without_reversion(self):
        for side,close in [('BUY',D('1.09')),('SELL',D('1.11'))]:
            candidate=ResearchH4Candidate(ZSCORE)
            for i in range(20):
                v=D('1.1')+D(i%2)/10000
                candidate.observe(Candle(i*H4,v,v+D('.001'),v-D('.001'),v))
            for age in range(1,7):
                v=close + (-1 if side=='BUY' else 1)*D(age)/10000
                signal,_=candidate.observe(Candle((20+age*2)*H4,v,v+D('.001'),v-D('.001'),v),
                    side=side,position_id='same-position')
                self.assertEqual(signal,'EXIT' if age==6 else None)

    def test_range_exits_at_20_utc_or_next_valid_candle_and_cross_day(self):
        for side in ('BUY','SELL'):
            for entry_day,offset,expected in [(1,3*H4,None),(1,4*H4,'EXIT'),
                                            (1,5*H4,'EXIT'),(0,0,'EXIT')]:
                candidate=PropH4Candidate(UTC_RANGE)
                candidate.last_entry_day=entry_day
                v=D('1.1')
                signal,_=candidate.observe(Candle(86400+offset,v,v+D('.001'),v-D('.001'),v),
                    side=side,position_id='p')
                self.assertEqual(signal,expected)

    def test_stop_precedes_queued_strategy_exit_on_same_next_quote(self):
        for side,bid,ask,stop in [('BUY','1.09900','1.09920','1.09950'),
                                  ('SELL','1.10100','1.10120','1.10050')]:
            initial=initialize_forex_pilot(execution(),start_time_msc=ms())
            opened=advance(queue(initial,side=side,quantity='.01',stop=stop),[tick()])
            queued=queue_forex_pilot_exit(opened,operation_id='closed-bar-exit')
            result=advance(queued,[tick(bid,ask,when=ms()+60001)])
            closes=[e for e in result.execution.ledger if e['kind']=='protective_fill']
            self.assertEqual(len(closes),1)
            self.assertEqual(closes[0]['details']['reason'],'stop_loss')
            self.assertIsNone(result.execution.position)


if __name__=='__main__':unittest.main()
