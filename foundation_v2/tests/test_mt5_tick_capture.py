"""Actual SDK array shape, fake SDK only; no terminal or broker calls."""
import sys
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import mt5_tick_capture as capture


class TickCaptureTests(unittest.TestCase):
    def setUp(self):
        self.start = int(datetime(2026,11,4,3,tzinfo=timezone.utc).timestamp()*1000)
        self.sdk = Mock()
        self.sdk.__version__ = 'fixture'
        self.sdk.symbol_info.return_value = SimpleNamespace(visible=True)

    def ticks(self, *rows):
        return np.array(list(rows),dtype=[('time_msc','i8'),('bid','f8'),('ask','f8'),('flags','u4')])

    def read(self,server='Exness-MT5Trial17',**kwargs):
        return capture.capture(self.sdk,server,'EURUSDm',self.start,self.start+10000,
                               now_msc=self.start+12000,**kwargs)

    def test_same_millisecond_order_and_identical_duplicates_survive_half_open_pages(self):
        row = (self.start,1.1,1.1002,6)
        self.sdk.copy_ticks_range.return_value = self.ticks(row,row,(self.start+10000,1.2,1.2002,6))
        result = self.read()
        self.assertEqual(len(result['rows']),2)
        self.assertEqual(result['rows'][0],result['rows'][1])
        self.assertEqual(result['coverage'],'broker_history_unverified')
        self.assertFalse(result['execution_capability'])
        self.sdk.order_check.assert_not_called()
        self.sdk.order_send.assert_not_called()
        self.sdk.initialize.assert_not_called()

    def test_ftmo_query_uses_broker_clock_and_publishes_utc(self):
        self.sdk.copy_ticks_range.return_value = self.ticks((self.start+7200001,1.1,1.1002,6))
        result = self.read('FTMO-Demo')
        self.assertEqual(result['rows'][0]['time_msc'],self.start+1)
        args = self.sdk.copy_ticks_range.call_args.args
        self.assertEqual(int(args[1].timestamp()*1000),self.start+7200000)
        self.assertEqual(int(args[2].timestamp()*1000),self.start+7210000)

    def test_missing_empty_overflow_invalid_price_and_reversed_data_do_not_fake_coverage(self):
        self.sdk.copy_ticks_range.return_value = self.ticks()
        self.assertEqual(self.read()['rows'],[])
        cases = [(None,'mt5_tick_history_unavailable'),
                 (self.ticks(*[(self.start,1.1,1.2,6)]*5001),'mt5_tick_page_too_large'),
                 (self.ticks((self.start,0,1.2,6)),'mt5_tick_data_invalid'),
                 (self.ticks((self.start,float('nan'),1.2,6)),'mt5_tick_data_invalid'),
                 (self.ticks((self.start,1.3,1.2,6)),'mt5_tick_data_invalid'),
                 (self.ticks((self.start+2,1.1,1.2,6),(self.start+1,1.1,1.2,6)),'mt5_tick_order_invalid')]
        for data,reason in cases:
            self.sdk.copy_ticks_range.return_value = data
            with self.subTest(reason=reason),self.assertRaisesRegex(RuntimeError,reason):
                self.read()

    def test_range_limits_reject_before_sdk_and_dst_ambiguity_stays_closed(self):
        for start,end,now in ((True,10000,20000),(0,61000,70000),(1001,10000,20000),
                              (1000,10000,11999),(10000,10000,20000)):
            with self.subTest(start=start,end=end),self.assertRaisesRegex(RuntimeError,'mt5_tick_range_invalid'):
                capture.capture(self.sdk,'Fixture','EURUSD',start,end,now_msc=now)
        self.sdk.copy_ticks_range.assert_not_called()
        fold = int(datetime(2026,11,1,5,30,tzinfo=timezone.utc).timestamp()*1000)
        with self.assertRaisesRegex(RuntimeError,'mt5_clock_unavailable'):
            capture.source_range(fold,fold+10000,'FTMO-Demo')


if __name__=='__main__':
    unittest.main()
