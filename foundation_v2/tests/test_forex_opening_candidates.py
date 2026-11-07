from datetime import datetime,timezone
from decimal import Decimal as D
import unittest

from trading_workspace_v2.forex_h4 import Candle
from trading_workspace_v2.forex_intraday_candidates import (
    LONDON_ORB,NY_ORB,ASIA_ORB,BB_REENTRY,BB_FLAT,opening_entry,IntradayH1Candidate,intraday_contract,PRE_ECB)


def stamp(value):return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())
def bar(at,close='1.10000',high='1.10100',low='1.09900'):
    return Candle(stamp(at) if isinstance(at,str) else at,D(close),D(high),D(low),D(close))


class OpeningTests(unittest.TestCase):
    def test_protocol_ownership_is_not_legacy_discovery4_for_new_rules(self):
        self.assertEqual(intraday_contract(ASIA_ORB),'ORB-DISCOVERY7-20261108.md')
        self.assertEqual(intraday_contract(PRE_ECB),'SESSION-DISCOVERY6-20261108.md')
        self.assertEqual(intraday_contract(BB_REENTRY),'CHALLENGE-DISCOVERY-ROUND4-20261108.md')
        with self.assertRaises(ValueError):intraday_contract('unknown')

    def test_closed_range_and_dst_clock_not_same_bar_breakout(self):
        rangebar=bar('2024-04-02T07:00:00') # 08London
        self.assertEqual(opening_entry(LONDON_ORB,[],rangebar),(None,None))
        decisionbar=bar('2024-04-02T08:00:00','1.10200','1.10300','1.10100') # ends10London
        self.assertEqual(opening_entry(LONDON_ORB,[rangebar],decisionbar),
            ('BUY',stamp('2024-04-02T15:00:00')))
        self.assertEqual(opening_entry(LONDON_ORB,[],decisionbar),(None,None))
        self.assertEqual(opening_entry(NY_ORB,[bar('2024-03-15T12:00:00')],
            bar('2024-03-15T13:00:00','1.09800','1.09900','1.09700')),
            ('SELL',stamp('2024-03-15T20:00:00')))

    def test_asia_requires_all_six_hours_not_previous_day(self):
        base=stamp('2024-04-02T00:00:00')
        history=[bar(base+i*3600) for i in range(6)]
        current=bar('2024-04-02T06:00:00','1.10200','1.10300','1.10100')
        # Ends08London; range09–15Tokyo is already closed.
        self.assertEqual(opening_entry(ASIA_ORB,history,current),('BUY',stamp('2024-04-02T15:00:00')))
        self.assertEqual(opening_entry(ASIA_ORB,history[:-1],current),(None,None))
        stale=[bar(base-86400+i*3600) for i in range(6)]
        self.assertEqual(opening_entry(ASIA_ORB,stale,current),(None,None))

    def test_one_emission_even_rejected_and_roundtrip_exit(self):
        c=IntradayH1Candidate(LONDON_ORB);base=stamp('2024-04-02T07:00:00')
        for i in range(100):c.observe(bar(base-(100-i)*3600))
        c.observe(bar(base))
        self.assertEqual(c.observe(bar(base+3600,'1.102','1.103','1.101'))[0],'BUY')
        self.assertIsNone(c.observe(bar(base+7200,'1.102','1.103','1.101'))[0])
        self.assertIsNone(c.scheduled_exit)
        self.assertIsNone(c.observe(bar(base+10800,'1.102','1.103','1.101'))[0])

    def test_flat_filter_only_affects_entry_not_mean_exit(self):
        base=stamp('2024-04-02T00:00:00')
        for earlier,expected in [('1.090',None),('1.100','BUY')]:
            a,b=IntradayH1Candidate(BB_REENTRY),IntradayH1Candidate(BB_FLAT)
            values=[earlier]*60+['1.100']*19+['1.095']
            for i,value in enumerate(values):
                candle=bar(base+i*3600,value,str(D(value)+D('.001')),str(D(value)-D('.001')))
                a.observe(candle);b.observe(candle)
            current=bar(base+80*3600,'1.099','1.100','1.098')
            self.assertEqual(a.observe(current)[0],'BUY')
            self.assertEqual(b.observe(current)[0],expected)
            # A position retains its normal exit even if the trend filter fails.
            self.assertEqual(b.observe(bar(base+81*3600,'1.101','1.102','1.100'),
                side='BUY',position_id='test')[0],'EXIT')
