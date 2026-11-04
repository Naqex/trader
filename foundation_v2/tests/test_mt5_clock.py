"""Clock decoding fixtures; no SDK, OS clock change or broker calls."""
import importlib.util
from pathlib import Path
from datetime import datetime, timedelta, timezone
import unittest

spec = importlib.util.spec_from_file_location('clock', Path(__file__).parents[1]/'scripts/mt5_clock.py')
clock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clock)


class BrokerClockTests(unittest.TestCase):
    def test_verified_winter_summer_and_us_eu_mismatch_weeks(self):
        for text, offset in (('2026-01-05T12:00:00+00:00',2),
                             ('2026-03-09T12:00:00+00:00',3),
                             ('2026-10-26T12:00:00+00:00',3),
                             ('2026-11-02T12:00:00+00:00',2),
                             ('2027-03-15T12:00:00+00:00',3)):
            with self.subTest(text=text):
                stamp = int(datetime.fromisoformat(text).timestamp()*1000)+123
                self.assertEqual(clock.utc_msc(stamp+offset*3600000,'FTMO-Demo'),stamp)

    def test_stale_and_future_times_are_not_rebased_on_the_host_clock(self):
        stamp = int(datetime(2026,11,4,tzinfo=timezone.utc).timestamp()*1000)
        for age in (-60000,0,500,7200000):
            with self.subTest(age=age):
                self.assertEqual(clock.utc_msc(stamp-age+7200000,'FTMO-Demo'),stamp-age)

    def test_unknown_servers_preserve_sdk_utc_contract_without_prefix_inference(self):
        for server in ('Exness-MT5Trial17','FTMO-Demo2','FTMO-Server','Fixture'):
            self.assertEqual(clock.utc_msc(1793756800123,server),1793756800123)

    def test_fold_gap_and_unverified_historical_regime_fail_closed(self):
        for text in ('2026-11-01T08:30:00+00:00','2026-03-08T09:30:00+00:00',
                     '2025-11-04T12:00:00+00:00'):
            with self.subTest(text=text),self.assertRaisesRegex(RuntimeError,'mt5_clock_unavailable'):
                clock.utc_msc(int(datetime.fromisoformat(text).timestamp()*1000),'FTMO-Demo')

    def test_history_request_envelope_and_clock_provenance(self):
        start = datetime(2026,3,7,tzinfo=timezone.utc)
        end = start + timedelta(days=3)
        self.assertEqual(clock.history_range(start,end,'FTMO-Demo'),
                         (start+timedelta(hours=2),end+timedelta(hours=3)))
        self.assertEqual(clock.history_range(start,end,'Exness-MT5Trial17'),(start,end))
        self.assertEqual(clock.metadata('FTMO-Demo')['source_time_basis'],'broker_server_wall')
        with self.assertRaisesRegex(RuntimeError,'mt5_clock_unavailable'):
            clock.history_range(start.replace(tzinfo=None),end,'FTMO-Demo')
