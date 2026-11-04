import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from unittest.mock import patch
from urllib.error import HTTPError
from io import BytesIO

from scripts import mt5_observed_capture as capture
from scripts import mt5_shadow_step as shadow
from scripts import mt5_shadow_reprocess as offline

HOUR = shadow.HOUR_MS


class ShadowStepTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root/'session'
        self.directory.mkdir()
        self.raw = dict(schema_version='mt5-shadow-session-v2',
            capture=dict(schema_version='mt5-observed-capture-v1',
                api_origin='http://127.0.0.1:8010', symbol='EURUSD', from_msc=0,
                to_msc=4*HOUR, page_seconds=60,
                binding=dict(workspace_id='fixture',connection_id='492ec8a5-3938-41a3-8a26-8c0f7f59ed43',
                    generation=1,login='123',server='Fixture',environment='demo')),
            deadline_msc=4*HOUR+90000, settle_seconds=30, source_sha256=shadow.source_pins())
        self.plan = shadow.Plan.model_validate(self.raw)

    def page(self, start, end):
        return dict(schema_version='mt5-tick-range-v1', status='ready', symbol=self.plan.capture.symbol,
            binding=self.plan.capture.binding.model_dump(mode='json'), from_msc=start, to_msc=end,
            observed_at_msc=4*HOUR+5000, clock={'profile':'fixture'}, coverage='broker_history_unverified',
            execution_capability=False, sdk_version='fixture',
            source_sha256={'mt5_clock.py':'a'*64,'mt5_tick_capture.py':'b'*64},
            rows=[dict(time_msc=t,source_time_msc=t,bid=1.1,ask=1.1002,flags=6)
                  for t in range(start+1,end,30000)])

    def record(self, *, through=None):
        capture.record(self.plan.capture,self.directory/'capture',resume=False,fetch=self.page,
            now_msc=4*HOUR+5000,max_batches=240 if through is None else through//60000)

    def reduce(self, previous=None, fetch=None, now=None, recover=False):
        return shadow.reduce_capture(self.directory/'capture',self.plan,previous,fetch or self.page,
            now if now is not None else 4*HOUR+30000,recover=recover)

    def test_only_settled_requested_hours_feed_fixed_candidate_no_execution_or_pnl(self):
        self.record()
        before = self.reduce(now=4*HOUR+29999)
        self.assertEqual(len(before['hours']),3)
        self.assertEqual(before['decisions'],[])
        after = self.reduce(before)
        self.assertEqual((len(after['hours']),len(after['decisions'])),(4,1))
        decision = after['decisions'][0]
        self.assertEqual(decision['known_not_before_msc'],4*HOUR+30000)
        self.assertGreaterEqual(decision['observed_at_msc'],decision['known_not_before_msc'])
        self.assertEqual(after['candidate_state']['previous_close'],'1.1001')
        self.assertEqual(after['coverage'],'broker_history_unverified')
        self.assertFalse(after['execution_capability'])
        self.assertFalse(after['strategy_qualified'])
        self.assertIsNone(after['pnl'])
        self.assertEqual(after['data_status'],'warming_up')
        # Replaying after restart retains the original decision observation time.
        self.assertEqual(self.reduce(after,now=4*HOUR+40000,recover=True),after)

    def test_partial_hour_never_becomes_candle_and_same_ms_duplicates_are_retained(self):
        self.raw['capture'].update(from_msc=1000,to_msc=61000,page_seconds=10)
        self.raw['deadline_msc']=151000
        self.plan=shadow.Plan.model_validate(self.raw)
        original=self.page
        def duplicate(start,end):
            page=original(start,end)
            page['rows']*=2
            return page
        capture.record(self.plan.capture,self.directory/'capture',resume=False,fetch=duplicate,now_msc=200000)
        report=self.reduce(fetch=duplicate,now=100000)
        self.assertEqual(report['ticks'],12)
        self.assertEqual(report['hours'],[])
        self.assertTrue(report['excluded_leading_partial'])
        self.assertTrue(report['open_partial_hour'])

    def test_sdk_float_tail_normalized_without_changing_raw_capture_or_admitting_subticks(self):
        self.raw['capture']['to_msc'] = HOUR
        self.raw['deadline_msc'] = HOUR+90000
        self.plan = shadow.Plan.model_validate(self.raw)
        original = self.page
        def noisy(start, end):
            page = original(start, end)
            for tick in page['rows']:
                tick.update(bid=1.1227800000000001, ask=1.12298)
            return page
        capture.record(self.plan.capture, self.directory/'capture', resume=False,
            fetch=noisy, now_msc=HOUR+30000, max_batches=60)
        raw = (self.directory/'capture'/'00000.json').read_bytes()
        report = self.reduce(fetch=noisy, now=HOUR+30000)
        self.assertEqual(report['hours'][0]['ohlc_mid'], ['1.12288']*4)
        self.assertEqual(report['hours'][0]['ticks'], 120)
        self.assertFalse(report['execution_capability'])
        self.assertEqual((self.directory/'capture'/'00000.json').read_bytes(), raw)
        for value in (1.122781, 1.122785, 1.12278999999):
            with self.subTest(value=value), self.assertRaisesRegex(
                    capture.CaptureError, 'shadow_tick_grid_invalid'):
                shadow._tick_price(value)

    def test_missing_or_quiet_hour_blocks_without_publishing_decision(self):
        self.record()
        path=self.directory/'capture'/'00020.json'
        page=capture.checked(path)
        page['rows']=[]
        capture.store(path,page)
        state=capture.checked(self.directory/'capture'/'state.json')
        state['pages'][20]=capture.checksum(page)
        state['tick_count']-=2
        capture.store(self.directory/'capture'/'state.json',state)
        def missing(start,end):
            return page if start==page['from_msc'] else self.page(start,end)
        with self.assertRaisesRegex(capture.CaptureError,'shadow_hour_gap_requires_review'):
            self.reduce(fetch=missing)
        self.assertFalse((self.directory/'shadow.json').exists())

    def test_late_backfill_or_revision_rejected_and_existing_report_unchanged(self):
        self.record()
        report=self.reduce()
        capture.store(self.directory/'shadow.json',report)
        before=(self.directory/'shadow.json').read_bytes()
        def changed(start,end):
            page=self.page(start,end)
            if start==60000:
                page['rows'].append(copy.deepcopy(page['rows'][-1]))
            return page
        with self.assertRaisesRegex(capture.CaptureError,'shadow_observed_window_revised'):
            self.reduce(report,fetch=changed,recover=True)
        self.assertEqual((self.directory/'shadow.json').read_bytes(),before)

    def test_recovery_matches_uninterrupted_and_retry_has_no_duplicate_bars(self):
        self.record(through=HOUR)
        initial=self.reduce()
        capture.record(self.plan.capture,self.directory/'capture',resume=True,fetch=self.page,
            now_msc=4*HOUR+5000,max_batches=180)
        resumed=self.reduce(initial,recover=True)
        self.assertEqual(resumed,self.reduce())
        self.assertEqual(self.reduce(resumed,recover=True),resumed)

    def test_stop_or_expiry_prevents_network_and_failed_read_keeps_report(self):
        fetch=Mock(side_effect=OSError('offline fixture'))
        (self.directory/'STOP').touch()
        self.assertEqual(shadow.step(self.plan,self.directory,fetch,100000)['status'],'stopped')
        (self.directory/'STOP').unlink()
        self.assertEqual(shadow.step(self.plan,self.directory,fetch,self.plan.deadline_msc)['status'],'expired')
        fetch.assert_not_called()
        self.record(through=HOUR)
        report=self.reduce()
        capture.store(self.directory/'shadow.json',report)
        before=(self.directory/'shadow.json').read_bytes()
        with self.assertRaises(OSError):
            shadow.step(self.plan,self.directory,fetch,100000)
        self.assertEqual((self.directory/'shadow.json').read_bytes(),before)

    def test_source_symbol_and_deadline_changes_cannot_silently_resume(self):
        for change in ('source','symbol','deadline'):
            raw=copy.deepcopy(self.raw)
            if change=='source': raw['source_sha256']['candidate']='c'*64
            if change=='symbol': raw['capture']['symbol']='BTCUSD'
            if change=='deadline': raw['deadline_msc']=raw['capture']['to_msc']+1000
            with self.subTest(change=change),self.assertRaises(ValueError):
                shadow.Plan.model_validate(raw)

    def test_native_rejection_preserves_safe_diagnostic_without_retry(self):
        error=HTTPError('http://127.0.0.1:8010/',503,'unavailable',{},BytesIO(b'{"detail":"demo_terminal_busy"}'))
        with patch.object(capture.NativeReader,'__call__',side_effect=error) as native:
            with self.assertRaisesRegex(capture.CaptureError,'shadow_native_http_503_demo_terminal_busy'):
                shadow.ShadowReader(self.plan.capture,'private-fixture')(0,60000)
            self.assertEqual(native.call_count,1)

    def test_reprocess_saved_capture_after_reducer_change_without_live_resume(self):
        self.record(through=HOUR)
        raw = {**self.raw, 'source_sha256': {**self.raw['source_sha256'], 'step': 'c'*64}}
        manifest = self.root/'old-registration.json'
        manifest.write_bytes(capture.encoded(raw))
        paths = [manifest, *sorted((self.directory/'capture').glob('*.json'))]
        before = {p:p.read_bytes() for p in paths}
        with patch.object(capture.NativeReader, '__call__', side_effect=AssertionError('network forbidden')):
            result = offline.reprocess(manifest, self.directory, self.root/'offline',
                                       now_msc=self.plan.deadline_msc+1)
        self.assertEqual(len(result['report']['hours']), 1)
        self.assertFalse(result['execution_capability'])
        self.assertFalse(result['continuation_eligible'])
        self.assertEqual(result['network_reads'], 0)
        self.assertEqual({p:p.read_bytes() for p in paths}, before)
        self.assertFalse((self.root/'offline/lifecycle.json').exists())
        with self.assertRaisesRegex(capture.CaptureError, 'output_must_be_new_and_separate'):
            offline.reprocess(manifest, self.directory, self.root/'offline')

    def test_reprocess_rejects_changed_contract_or_tampered_capture(self):
        self.record(through=HOUR)
        manifest = self.root/'old-registration.json'
        raw = copy.deepcopy(self.raw)
        raw['source_sha256']['candidate'] = 'c'*64
        manifest.write_bytes(capture.encoded(raw))
        with self.assertRaisesRegex(capture.CaptureError, 'compatibility_review_required'):
            offline.reprocess(manifest, self.directory, self.root/'offline')
        manifest.write_bytes(capture.encoded(self.raw))
        page = self.directory/'capture/00000.json'
        value = capture.checked(page)
        value['rows'][0]['bid'] = 1.05
        capture.store(page, value)
        with self.assertRaises(capture.CaptureError):
            offline.reprocess(manifest, self.directory, self.root/'offline')
        self.assertFalse((self.root/'offline').exists())

    def test_reprocess_refuses_input_alias_and_changed_manifest_without_publishing(self):
        self.record(through=HOUR)
        manifest = self.root/'old-registration.json'
        manifest.write_bytes(capture.encoded(self.raw))
        with self.assertRaisesRegex(capture.CaptureError, 'output_must_be_new_and_separate'):
            offline.reprocess(manifest, self.directory, self.directory/'offline')
        original = shadow.reduce_capture
        def changed(*args, **kwargs):
            report = original(*args, **kwargs)
            manifest.write_bytes(manifest.read_bytes()+b' ')
            return report
        with patch.object(shadow, 'reduce_capture', side_effect=changed):
            with self.assertRaisesRegex(capture.CaptureError, 'inputs_changed'):
                offline.reprocess(manifest, self.directory, self.root/'offline')
        self.assertFalse((self.root/'offline').exists())


if __name__=='__main__':
    unittest.main()
