from datetime import datetime, timezone
from decimal import Decimal as D
import unittest

from trading_workspace_v2.forex_h4 import Candle
from trading_workspace_v2.forex_intraday_candidates import (
    PRE_ECB, POST_LONDON, PRE_TOKYO, FIX_COMPOSITE, IntradayH1Candidate, fixing_entry)


def stamp(value):return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())
def bar(end):return Candle(end-3600,D('1.1'),D('1.101'),D('1.099'),D('1.1'))


class FixingTests(unittest.TestCase):
    def test_us_europe_dst_mismatch_and_regular_weeks(self):
        for when,end in [('2024-03-08T07:00:00','2024-03-08T13:00:00'),
                         ('2024-03-15T06:00:00','2024-03-15T13:00:00'),
                         ('2024-04-02T06:00:00','2024-04-02T12:00:00')]:
            with self.subTest(when=when):
                self.assertEqual(fixing_entry(PRE_ECB,stamp(when)),('SELL',stamp(end)))
        self.assertEqual(fixing_entry(POST_LONDON,stamp('2024-03-15T16:00:00')),
                         ('BUY',stamp('2024-03-15T20:00:00')))
        self.assertEqual(fixing_entry(POST_LONDON,stamp('2024-04-02T15:00:00')),
                         ('BUY',stamp('2024-04-02T20:00:00')))

    def test_tokyo_crosses_utc_date_and_friday_skipped(self):
        self.assertEqual(fixing_entry(PRE_TOKYO,stamp('2024-01-04T23:00:00')),
                         ('SELL',stamp('2024-01-05T01:00:00')))
        self.assertEqual(fixing_entry(PRE_TOKYO,stamp('2024-07-04T22:00:00')),
                         ('SELL',stamp('2024-07-05T01:00:00')))
        self.assertEqual(fixing_entry(PRE_TOKYO,stamp('2024-01-05T23:00:00')),(None,None))

    def test_missing_entry_not_backfilled_and_exit_can_be_late(self):
        entry=stamp('2024-04-02T15:00:00');c=IntradayH1Candidate(POST_LONDON)
        for i in range(20):c.observe(bar(entry-7200-(19-i)*3600))
        self.assertIsNone(c.observe(bar(entry+3600))[0])
        next_entry=stamp('2024-04-03T15:00:00')
        self.assertEqual(c.observe(bar(next_entry))[0],'BUY')
        self.assertIsNone(c.observe(bar(next_entry+3600),side='BUY',position_id='p')[0])
        restored=IntradayH1Candidate.from_state(c.export_state())
        late=stamp('2024-04-03T22:00:00')
        self.assertEqual(c.observe(bar(late),side='BUY',position_id='p')[0],'EXIT')
        restored.observe(bar(late),side='BUY',position_id='p')
        self.assertEqual(c.export_state(),restored.export_state())

    def test_rejected_or_stopped_entry_clears_deadline_and_no_unknown_position(self):
        entry=stamp('2024-04-02T15:00:00');c=IntradayH1Candidate(POST_LONDON)
        for i in range(20):c.observe(bar(entry-(20-i)*3600))
        self.assertEqual(c.observe(bar(entry))[0],'BUY')
        self.assertIsNotNone(c.scheduled_exit)
        self.assertIsNone(c.observe(bar(entry+3600))[0])
        self.assertIsNone(c.scheduled_exit)
        before=c.export_state()
        with self.assertRaisesRegex(ValueError,'owned entry'):
            c.observe(bar(entry+7200),side='BUY',position_id='external')
        self.assertEqual(c.export_state(),before)

    def test_composite_keeps_one_owned_deadline_and_no_reversal(self):
        entry=stamp('2024-04-02T06:00:00');c=IntradayH1Candidate(FIX_COMPOSITE)
        for i in range(20):c.observe(bar(entry-(20-i)*3600))
        self.assertEqual(c.observe(bar(entry))[0],'SELL')
        deadline=c.scheduled_exit
        self.assertEqual(deadline,stamp('2024-04-02T12:00:00'))
        # Missing ECB exit bars cannot start the London leg while still short.
        self.assertEqual(c.observe(bar(stamp('2024-04-02T15:00:00')),side='SELL',position_id='p')[0],'EXIT')
        self.assertEqual(c.scheduled_exit,deadline)
