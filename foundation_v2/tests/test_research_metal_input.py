import hashlib
from pathlib import Path
from decimal import Decimal as D
import tempfile,unittest

from trading_workspace_v2.research_metal_input import aggregate_bid_m1,indicative_hours


class MetalInputTests(unittest.TestCase):
    def parse(self,text):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'m1.csv';path.write_text(text,encoding='utf-8')
            return aggregate_bid_m1(path,hashlib.sha256(path.read_bytes()).hexdigest())

    def test_observed_bid_extrema_gaps_and_source_rows_are_not_ticks(self):
        header='Date,Time,Open,High,Low,Close,Volume\n'
        raw,quality=self.parse(header+'2023.01.03,00:00:00,1800.001,1801.001,1799.001,1800.101,1\n'
            +'2023.01.03,00:02:00,1800.101,1802.001,1798.001,1801.101,2\n'
            +'2023.01.03,02:00:00,1801.101,1803.001,1800.001,1802.101,3\n')
        self.assertEqual(quality['rows'],3)
        self.assertIsNone(quality['tick_count'])
        self.assertEqual(quality['gap_count'],2)
        self.assertEqual(len(raw),2)
        self.assertEqual(raw[0]['bid'],[D('1800.001'),D('1802.001'),D('1798.001'),D('1801.101')])
        hours=indicative_hours(raw,D('.5'))
        self.assertEqual(hours[0].ask[1],D('1802.501'))
        self.assertEqual(hours[0].mid.high,D('1802.251'))
        self.assertEqual(hours[0].ticks,2) # internal row count; public report has no observed tick count
        self.assertEqual(hours[1].mid.timestamp-hours[0].mid.timestamp,7200)

    def test_bad_order_holdout_and_price_grid_rejected(self):
        header='Date,Time,Open,High,Low,Close,Volume\n'
        for body in ('2025.01.03,00:00:00,1800,1801,1799,1800,1\n',
                     '2023.01.03,00:00:00,1800.0001,1801,1799,1800,1\n',
                     '2023.01.03,00:00:30,1800,1801,1799,1800,1\n',
                     '2023.01.03,00:00:00,1800,1801,1799,1800,1\n'*2):
            with self.subTest(body=body),self.assertRaises(ValueError):self.parse(header+body)

    def test_raw_hash_checked_before_parsing(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'m1.csv';path.write_bytes(b'bad-format')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):aggregate_bid_m1(path,'a'*64)
