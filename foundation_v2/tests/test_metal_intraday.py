from datetime import datetime,timezone
from decimal import Decimal as D
from pathlib import Path
import random,sys,unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from forex_h4_pilot import ALL_STUDY_CANDIDATES
from trading_workspace_v2.forex_h4 import Candle
from trading_workspace_v2.forex_intraday_candidates import (
    METAL_INTRADAY_CANDIDATES,METAL_ASIA_ORB,METAL_RSI,METAL_AFTERNOON,
    ASIA_ORB,RSI_REENTRY,IntradayH1Candidate)


def stamp(value):return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())
def bar(end,close='2000',span='1'):
    price=D(close);width=D(span)
    return Candle(end-3600,price,price+width,price-width,price)


class MetalIntradayTests(unittest.TestCase):
    def test_gold_never_implicitly_enters_eurusd_native_registry(self):
        self.assertFalse(set(METAL_INTRADAY_CANDIDATES)&set(ALL_STUDY_CANDIDATES))

    def test_shared_recipes_exact_with_asset_identity_and_restore(self):
        rng=random.Random(23);start=stamp('2023-01-01T00:00:00')
        candles=[bar(start+i*3600,str(2000+rng.randrange(-10,11))) for i in range(240)]
        for gold,fx in ((METAL_ASIA_ORB,ASIA_ORB),(METAL_RSI,RSI_REENTRY)):
            a,b=IntradayH1Candidate(gold),IntradayH1Candidate(fx)
            for candle in candles[:120]:self.assertEqual(a.observe(candle),b.observe(candle))
            state=a.export_state();self.assertEqual(state.candidate,gold)
            restored=IntradayH1Candidate.from_state(state)
            for candle in candles[120:]:self.assertEqual(a.observe(candle),restored.observe(candle))
            self.assertEqual(a.export_state(),restored.export_state())

    def test_afternoon_signed_move_dst_deadline_and_missing_open(self):
        for end in (stamp('2024-01-03T15:00:00'),stamp('2024-07-03T14:00:00')):
            for close,expected in (('2005','SELL'),('1995','BUY'),('2000',None)):
                c=IntradayH1Candidate(METAL_AFTERNOON)
                for i in range(105):c.observe(bar(end-(105-i)*3600))
                self.assertEqual(c.observe(bar(end,close))[0],expected)
                if expected:
                    self.assertEqual(c.scheduled_exit,end+4*3600)
                    self.assertIsNone(c.observe(bar(end+3600,close),side=expected,position_id='p')[0])
                    restored=IntradayH1Candidate.from_state(c.export_state())
                    self.assertEqual(c.observe(bar(end+5*3600,close),side=expected,position_id='p')[0],'EXIT')
                    restored.observe(bar(end+5*3600,close),side=expected,position_id='p')
                    self.assertEqual(c.export_state(),restored.export_state())
        end=stamp('2024-07-03T14:00:00');c=IntradayH1Candidate(METAL_AFTERNOON)
        for i in range(105):
            at=end-(105-i)*3600
            if at!=end-5*3600:c.observe(bar(at)) # missing09:00–10:00London
        self.assertIsNone(c.observe(bar(end,'2005'))[0])
