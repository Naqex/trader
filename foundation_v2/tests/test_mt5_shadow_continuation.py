"""Synthetic observations only; no SDK, network, broker or strategy tuning."""
import copy
from decimal import Decimal
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from scripts import mt5_observed_capture as capture
from scripts import mt5_shadow_step as shadow
from trading_workspace_v2.forex_h4 import Candle, FixedH4Candidate, H4Builder

HOUR = shadow.HOUR_MS


def write_record(path, value):
    # These fixtures exercise continuity, not fsync. Recorder durability already
    # has its own crash/atomic-replace tests; avoid thousands of redundant fsyncs.
    path.write_bytes(capture.encoded(dict(value=value, sha256=capture.checksum(value))))


class ShadowContinuationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def plan(self, start=0, hours=4, predecessor=None):
        return shadow.Plan.model_validate(dict(schema_version='mt5-shadow-session-v2',
            capture=dict(schema_version='mt5-observed-capture-v1',
                api_origin='http://127.0.0.1:8010', symbol='EURUSD', from_msc=start,
                to_msc=start+int(hours*HOUR), page_seconds=60,
                binding=dict(workspace_id='fixture',connection_id='492ec8a5-3938-41a3-8a26-8c0f7f59ed43',
                    generation=1,login='123',server='Fixture',environment='demo')),
            deadline_msc=start+int(hours*HOUR)+90000, settle_seconds=30,
            source_sha256=shadow.source_pins(), continuation=predecessor))

    def page(self, plan, start, end):
        bid = Decimal('1.10000')+Decimal(start//HOUR)*Decimal('0.00001')
        return dict(schema_version='mt5-tick-range-v1', status='ready', symbol=plan.capture.symbol,
            binding=plan.capture.binding.model_dump(mode='json'), from_msc=start, to_msc=end,
            observed_at_msc=end+2000, clock={'profile':'fixture'}, coverage='broker_history_unverified',
            execution_capability=False, sdk_version='fixture',
            source_sha256={'mt5_clock.py':'a'*64,'mt5_tick_capture.py':'b'*64},
            rows=[dict(time_msc=start+1,source_time_msc=start+1,bid=float(bid),ask=float(bid+Decimal('0.0002')),flags=6)])

    def finished(self, name, plan):
        directory=self.root/name
        directory.mkdir()
        output=directory/'capture'
        output.mkdir()
        state=dict(schema_version='mt5-observed-state-v1',plan=plan.capture.model_dump(mode='json'),
            client_sha256=plan.source_sha256['capture'], pages=[],next_from_msc=plan.capture.from_msc,tick_count=0)
        for index,start in enumerate(range(plan.capture.from_msc,plan.capture.to_msc,60000)):
            end=min(start+60000,plan.capture.to_msc)
            page=capture.validate_page(self.page(plan,start,end),plan.capture,start,end)
            write_record(output/f'{index:05d}.json',page)
            state['pages'].append(capture.checksum(page))
            state['next_from_msc']=end
            state['tick_count']+=len(page['rows'])
        write_record(output/'state.json',state)
        seed=shadow.warmup(plan,directory,verify_pages=True)
        report=shadow.reduce_capture(output,plan,None,lambda a,b:self.page(plan,a,b),
            plan.capture.to_msc+30000,seed=seed)
        write_record(directory/'shadow.json',report)
        self.lifecycle(directory,report)
        return directory,report

    def lifecycle(self,directory,report,**changes):
        state=dict(schema_version='mt5-shadow-lifecycle-v1',status='complete',execution_capability=False,
            manifest_sha256=report['registration_sha256'],observation=dict(status='complete',
                requested_through_msc=report['requested_through_msc'],pages=report['pages'],ticks=report['ticks'],
                closed_hours=len(report['hours']),h4_bars=len(report['decisions'])))
        state.update(changes)
        raw=capture.json.dumps(state,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
        (directory/'lifecycle.json').write_bytes(capture.encoded(dict(state=state,sha256=hashlib.sha256(raw).hexdigest())))

    def link(self,directory,report):
        return dict(state_dir=str(directory),report_sha256=capture.checksum(report))

    def test_92_hours_across_four_sessions_preserve_partial_h4_and_indicator_state(self):
        predecessor=None
        for ordinal in range(4):
            plan=self.plan(ordinal*23*HOUR,23,predecessor)
            directory,report=self.finished(str(ordinal),plan)
            self.assertEqual(report['cumulative_hours'],(ordinal+1)*23)
            self.assertEqual(report['chain_depth'],ordinal)
            if ordinal==0:
                self.assertEqual(len(report['builder_state']['parts']),3)
            predecessor=self.link(directory,report)
        builder,candidate=H4Builder(),FixedH4Candidate()
        expected_signal=None
        for hour in range(92):
            mid=Decimal('1.10010')+Decimal(hour)*Decimal('0.00001')
            bar=builder.add(Candle(hour*3600,mid,mid,mid,mid))
            if bar:
                expected_signal,_=candidate.observe(bar)
        self.assertEqual(shadow.H4CandidateState.model_validate(report['candidate_state']),candidate.export_state())
        self.assertEqual(shadow.H4BuilderState.model_validate(report['builder_state']),builder.export_state())
        self.assertEqual(report['cumulative_h4_bars'],23)
        self.assertEqual(report['decisions'][-1]['signal'],expected_signal)
        self.assertEqual(expected_signal,'BUY')
        self.assertTrue(report['indicator_ready'])
        self.assertEqual(report['data_status'],'advisory_ready')
        self.assertFalse(report['execution_capability'])
        self.assertIsNone(report['pnl'])
        # A cold reducer with the same frozen seed produces exactly the same
        # current-session result, retaining original observation timestamps.
        seed=shadow.warmup(plan,directory,verify_pages=True)
        resumed=shadow.reduce_capture(directory/'capture',plan,report,lambda a,b:self.page(plan,a,b),
            plan.capture.to_msc+60000,recover=True,seed=seed)
        self.assertEqual(resumed,report)

    def test_noncontiguous_identity_policy_and_partial_hour_handoffs_are_rejected(self):
        directory,report=self.finished('first',self.plan())
        original=self.plan(4*HOUR,4,self.link(directory,report)).model_dump(mode='json')
        for change in ('gap','overlap','generation','symbol','policy'):
            raw=copy.deepcopy(original)
            if change=='gap':raw['capture']['from_msc']+=HOUR
            if change=='overlap':raw['capture']['from_msc']-=HOUR
            if change=='generation':raw['capture']['binding']['generation']+=1
            if change=='symbol':raw['capture']['symbol']='EURUSDm'
            if change=='policy':raw['settle_seconds']=31
            with self.subTest(change=change),self.assertRaisesRegex(capture.CaptureError,'shadow_predecessor_continuity_invalid'):
                shadow.warmup(shadow.Plan.model_validate(raw),self.root/'next',verify_pages=True)
        partial,part_report=self.finished('partial',self.plan(hours=1.5))
        with self.assertRaisesRegex(capture.CaptureError,'shadow_predecessor_continuity_invalid'):
            shadow.warmup(self.plan(int(1.5*HOUR),4,self.link(partial,part_report)),self.root/'next')

    def test_unfinished_or_mismatched_native_lifecycle_cannot_seed(self):
        directory,report=self.finished('first',self.plan())
        plan=self.plan(4*HOUR,4,self.link(directory,report))
        for change in (dict(status='running'),dict(status='failed'),dict(manifest_sha256='c'*64)):
            self.lifecycle(directory,report,**change)
            with self.subTest(change=change),self.assertRaisesRegex(capture.CaptureError,'shadow_predecessor_not_complete'):
                shadow.warmup(plan,self.root/'next')

    def test_changed_predecessor_or_raw_page_blocks_before_new_quote_read(self):
        directory,report=self.finished('first',self.plan())
        plan=self.plan(4*HOUR,4,self.link(directory,report))
        page=capture.checked(directory/'capture/00020.json')
        page['rows'][0]['bid']=1.09
        write_record(directory/'capture/00020.json',page)
        fetch=Mock()
        next_dir=self.root/'next'
        next_dir.mkdir()
        with self.assertRaisesRegex(capture.CaptureError,'capture_prefix_changed'):
            shadow.step(plan,next_dir,fetch,4*HOUR+62000,recover=True)
        fetch.assert_not_called()
        changed=copy.deepcopy(report)
        changed['ticks']+=1
        write_record(directory/'shadow.json',changed)
        with self.assertRaisesRegex(capture.CaptureError,'shadow_predecessor_report_changed'):
            shadow.warmup(plan,next_dir)

    def test_new_sdk_lineage_is_rejected_without_committing_any_new_tick(self):
        directory,report=self.finished('first',self.plan())
        plan=self.plan(4*HOUR,4,self.link(directory,report))
        next_dir=self.root/'next'
        next_dir.mkdir()
        def changed(start,end):
            page=self.page(plan,start,end)
            page['sdk_version']='changed'
            return page
        with self.assertRaisesRegex(capture.CaptureError,'shadow_predecessor_source_changed'):
            shadow.step(plan,next_dir,changed,4*HOUR+62000)
        state,_,_=capture.load(next_dir/'capture',plan.capture)
        self.assertEqual(state['tick_count'],0)
        self.assertFalse((next_dir/'shadow.json').exists())

    def test_later_verification_cannot_backdate_a_new_h4_decision(self):
        plan=self.plan()
        directory,report=self.finished('first',plan)
        def late(start,end):
            return {**self.page(plan,start,end),'observed_at_msc':plan.capture.to_msc+45000}
        later=shadow.reduce_capture(directory/'capture',plan,None,late,plan.capture.to_msc+30000)
        self.assertEqual(later['decisions'][0]['observed_at_msc'],plan.capture.to_msc+45000)
        self.assertEqual(later['candidate_state'],report['candidate_state'])

    def test_first_successor_step_keeps_seed_and_resume_matches_exact_report(self):
        directory,report=self.finished('first',self.plan(hours=3))
        plan=self.plan(3*HOUR,1,self.link(directory,report))
        successor=self.root/'next'
        successor.mkdir()
        fetch=lambda start,end:self.page(plan,start,end)
        first=shadow.step(plan,successor,fetch,3*HOUR+62000)
        saved=capture.checked(successor/'shadow.json')
        self.assertEqual(first['cumulative_hours'],3)
        self.assertEqual(saved['builder_state'],report['builder_state'])
        self.assertEqual(saved['candidate_state'],report['candidate_state'])
        self.assertEqual(saved['chain_depth'],1)
        shadow.step(plan,successor,fetch,3*HOUR+62000,recover=True)
        self.assertEqual(capture.checked(successor/'shadow.json'),saved)


if __name__=='__main__':
    unittest.main()
