import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import mt5_observed_capture as capture


class ObservedCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'capture'
        self.plan = capture.Plan.model_validate(dict(schema_version='mt5-observed-capture-v1',
            api_origin='http://127.0.0.1:8010',symbol='EURUSDm',from_msc=100000,to_msc=130000,
            binding=dict(workspace_id='fixture',connection_id='492ec8a5-3938-41a3-8a26-8c0f7f59ed43',
                generation=1,login='123',server='Fixture',environment='demo')))
        self.fetch = Mock(side_effect=self.page)

    def page(self,start,end):
        row = dict(time_msc=start+1,source_time_msc=start+1,bid=1.1,ask=1.1002,flags=6)
        return dict(schema_version='mt5-tick-range-v1',status='ready',symbol='EURUSDm',
            from_msc=start,to_msc=end,observed_at_msc=200000,clock={'profile':'sdk_utc_v1'},
            binding=self.plan.binding.model_dump(mode='json'),coverage='broker_history_unverified',
            execution_capability=False,source_sha256={'mt5_clock.py':'a'*64,'mt5_tick_capture.py':'b'*64},
            sdk_version='fixture',
            rows=[row,row])

    def run_capture(self,resume=False,**kwargs):
        return capture.record(self.plan,self.path,resume=resume,fetch=self.fetch,
                              now_msc=200000,**kwargs)

    def test_resume_matches_uninterrupted_and_preserves_same_ms_duplicates(self):
        self.assertEqual(self.run_capture(max_batches=1)['ticks'],2)
        result = self.run_capture(True)
        self.assertEqual((result['status'],result['pages'],result['ticks']),('complete',3,6))
        self.assertFalse(result['execution_capability'])
        self.assertEqual(result['coverage'],'broker_history_unverified')
        self.assertEqual(self.fetch.call_args_list[1].args,(100000,110000))
        state,_,_ = capture.load(self.path)
        other = Path(self.temp.name)/'continuous'
        capture.record(self.plan,other,resume=False,fetch=self.page,now_msc=200000)
        self.assertEqual(state,capture.load(other)[0])

    def test_crash_between_durable_page_and_cursor_adopts_once(self):
        original = capture.store
        def fail_commit(path,value):
            if path.name=='state.json' and value['next_from_msc']>100000:
                raise OSError('fixture disk failure')
            original(path,value)
        with patch.object(capture,'store',side_effect=fail_commit),self.assertRaises(OSError):
            self.run_capture(max_batches=1)
        self.assertEqual(capture.load(self.path)[0]['tick_count'],0)
        self.assertTrue((self.path/'00000.json').exists())
        result = self.run_capture(True)
        self.assertEqual(result['ticks'],6)
        self.assertEqual(len(list(self.path.glob('0*.json'))),3)

    def test_changed_committed_or_orphan_window_is_rejected_without_cursor_advance(self):
        self.run_capture(max_batches=1)
        before = (self.path/'state.json').read_bytes()
        def revised(start,end):
            page = self.page(start,end)
            page['rows'].append(copy.deepcopy(page['rows'][0]))
            return page
        self.fetch.side_effect = revised
        with self.assertRaisesRegex(capture.CaptureError,'capture_committed_window_changed'):
            self.run_capture(True)
        self.assertEqual((self.path/'state.json').read_bytes(),before)

    def test_corruption_and_changed_binding_fail_before_fetch(self):
        self.run_capture(max_batches=1)
        self.fetch.reset_mock()
        with self.assertRaisesRegex(capture.CaptureError,'capture_plan_or_client_changed'):
            capture.record(self.plan.model_copy(update={'symbol':'GBPUSD'}),self.path,
                resume=True,fetch=self.fetch,now_msc=200000)
        page = json.loads((self.path/'00000.json').read_text())
        page['value']['rows'][0]['bid'] = 1.11
        (self.path/'00000.json').write_text(json.dumps(page))
        with self.assertRaisesRegex(capture.CaptureError,'capture_checksum_mismatch'):
            self.run_capture(True)
        self.fetch.assert_not_called()

    def test_transport_failure_keeps_last_commit_and_stop_blocks_reads(self):
        self.run_capture(max_batches=1)
        before = (self.path/'state.json').read_bytes()
        self.fetch.side_effect = OSError('fixture offline')
        with self.assertRaises(OSError):
            self.run_capture(True)
        self.assertEqual((self.path/'state.json').read_bytes(),before)
        (self.path/'STOP').touch()
        self.fetch.reset_mock()
        self.assertEqual(self.run_capture(True)['status'],'stopped')
        self.fetch.assert_not_called()

    def test_parallel_writer_cannot_enter_while_first_reader_is_active(self):
        from trading_workspace_v2.owner_absence_journal import OwnerAbsenceJournalBusy
        def concurrent(start,end):
            with self.assertRaises(OwnerAbsenceJournalBusy):
                self.run_capture(True,max_batches=1)
            return self.page(start,end)
        self.fetch.side_effect = concurrent
        self.assertEqual(self.run_capture(max_batches=1)['ticks'],2)

    def test_atomic_replace_failure_preserves_checkpoint_and_cleans_temp(self):
        self.run_capture(max_batches=1)
        before = (self.path/'state.json').read_bytes()
        with patch.object(capture.os,'replace',side_effect=OSError('fixture disk full')),self.assertRaises(OSError):
            capture.store(self.path/'state.json',{'fixture':'uncommitted'})
        self.assertEqual((self.path/'state.json').read_bytes(),before)
        self.assertEqual(list(self.path.glob('.capture-*')),[])

    def test_incomplete_window_and_empty_response_never_assert_tick_watermark(self):
        result = capture.record(self.plan,self.path,resume=False,fetch=self.fetch,now_msc=111999)
        self.assertEqual((result['status'],result['requested_through_msc']),('waiting',100000))
        self.fetch.assert_not_called()
        def empty(start,end):
            return {**self.page(start,end),'rows':[]}
        self.fetch.side_effect = empty
        result = self.run_capture(True)
        self.assertEqual(result['ticks'],0)
        self.assertEqual(result['coverage'],'broker_history_unverified')

    def test_backend_source_binding_and_invalid_rows_fail_before_commit(self):
        for change in ('binding','invalid_quote','source'):
            with self.subTest(change=change):
                directory = Path(self.temp.name)/change
                calls = []
                def changed(start,end):
                    page = self.page(start,end)
                    if change=='binding':
                        page['binding']['generation'] = 2
                    elif change=='invalid_quote':
                        page['rows'][0]['ask'] = 1.
                    elif calls:
                        page['source_sha256']['mt5_clock.py'] = 'c'*64
                    calls.append(start)
                    return page
                with self.assertRaises(ValueError):
                    capture.record(self.plan,directory,resume=False,fetch=changed,now_msc=200000)
                self.assertEqual(capture.load(directory)[0]['next_from_msc'],110000 if change=='source' else 100000)

    def test_quote_policy_is_pinned_and_retains_original_and_reread_on_resume(self):
        capture.record(self.plan, self.path, resume=False, fetch=self.page,
            now_msc=200000, max_batches=1, comparison_policy='ordered_quotes_v1')
        original = (self.path/'00000.json').read_bytes()
        def revised(start, end):
            page = self.page(start, end)
            for row in page['rows']:
                row['flags'] = 134
            return page
        self.fetch.side_effect = revised
        with self.assertRaisesRegex(capture.CaptureError, 'capture_comparison_policy_changed'):
            self.run_capture(True)
        self.fetch.assert_not_called()
        result = self.run_capture(True, comparison_policy='ordered_quotes_v1')
        self.assertEqual((result['pages'], result['ticks']), (3, 6))
        self.assertEqual((self.path/'00000.json').read_bytes(), original)
        evidence = self.path/'audit-observations'
        summary = capture.checked(next(evidence.glob('revision-*.json')))
        self.assertTrue(summary['accepted_for_quotes'])
        self.assertEqual(summary['flag_xor_masks'], [128])
        for prefix in ('original', 'reread'):
            observed = capture.checked(next(evidence.glob(prefix+'-*.json')))
            self.assertEqual(capture.checksum(observed), summary[prefix+'_sha256'])

    def test_quote_policy_adopts_orphan_once_but_rejects_price_revision(self):
        original_store = capture.store
        def fail_commit(path, value):
            if path.name == 'state.json' and value['next_from_msc'] > 100000:
                raise OSError('fixture disk failure')
            original_store(path, value)
        with patch.object(capture, 'store', side_effect=fail_commit), self.assertRaises(OSError):
            self.run_capture(comparison_policy='ordered_quotes_v1')
        raw = (self.path/'00000.json').read_bytes()
        def revised(start, end):
            page = self.page(start, end)
            for row in page['rows']:
                row['flags'] = 134
            return page
        self.fetch.side_effect = revised
        self.assertEqual(self.run_capture(True, comparison_policy='ordered_quotes_v1')['ticks'], 6)
        self.assertEqual((self.path/'00000.json').read_bytes(), raw)
        before = (self.path/'state.json').read_bytes()
        def price_change(start, end):
            page = revised(start, end)
            page['rows'][0]['bid'] = 1.10001
            return page
        self.fetch.side_effect = price_change
        with self.assertRaisesRegex(capture.CaptureError, 'capture_committed_window_changed'):
            self.run_capture(True, comparison_policy='ordered_quotes_v1')
        self.assertEqual((self.path/'state.json').read_bytes(), before)


if __name__=='__main__':
    unittest.main()
