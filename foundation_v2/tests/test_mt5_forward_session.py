"""Production candidate + durable native intents, synthetic clock, no broker."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import copy
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from scripts import mt5_demo_session as durable, mt5_forward_session as runner


class Crash(BaseException):
    pass


class Native:
    def __init__(self, test):
        self.test = test
        self.calls, self.receipts, self.positions = [], {}, []
        self.behavior = 'filled'

    def call(self, route, body=None):
        self.calls.append((route, body))
        t = self.test
        if '/snapshot?' in route:
            value = copy.deepcopy(t.snapshot)
            value['positions'] = copy.deepcopy(self.positions)
            return 200, value
        if route.endswith('/commands'):
            c = body['command']
            if self.behavior=='crash_before':
                raise Crash()
            result = dict(request_id=c['request_id'], action=c['action'], status='filled', retcode=10009,
                requires_reconciliation=False, volume=c['volume'], order=17 if c['action']=='place' else 18,
                scope={**{k:c[k] for k in ('connection_id','mode','account_id','server','symbol')},
                    'generation':t.plan['connection_generation']},
                automation=dict(grant_id=t.secret['grant_id'],credential_id=t.secret['credential_id'],
                    artifact_sha256=t.plan['artifact_sha256']))
            if self.behavior=='partial':
                result.update(volume=.005, requires_reconciliation=True)
            else:
                self.positions = [dict(ticket=17, symbol=c['symbol'],side=c['side'],volume=c['volume'],sl=c['stop_loss'])] if c['action']=='place' else []
            self.receipts[c['request_id']]=result
            if self.behavior=='crash_after':
                raise Crash()
            return 200,result
        rid = route.rsplit('/',1)[1] if body is None else body['request_id']
        return (200,self.receipts[rid]) if rid in self.receipts else (404,{})

    def sends(self):
        return [body['command'] for route,body in self.calls if route.endswith('/commands')]


class ForwardTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        self.clock=datetime(2026,11,4,15,59,50,tzinfo=timezone.utc)
        self.secret=dict(grant_id=str(uuid4()),credential_id=str(uuid4()),credential='x'*43)
        self.manifest,self.credential,self.directory=[self.root/n for n in ('plan.json','credential.json','session')]
        (self.root/'artifact.json').write_bytes(b'{"purpose":"system_fixture"}\n')
        self.plan=dict(schema_version='mt5-forward-session-v1',session_id=str(uuid4()),
            api_origin='http://127.0.0.1:8010',workspace_id='fixture',connection_id=str(uuid4()),
            connection_generation=11,account_id='123',server='Fixture',symbol='EURUSD',artifact_path='artifact.json',
            artifact_sha256=durable.digest((self.root/'artifact.json').read_bytes()),
            starts_at=self.clock.isoformat(), finish_at=(self.clock+timedelta(minutes=10)).isoformat(),
            expires_at=(self.clock+timedelta(minutes=11)).isoformat(),max_risk_amount='2',cost_buffer_per_lot='20',
            source_sha256=runner.source_pins(),adapter_sha256={n:'a'*64 for n in ('mt5_broker_worker.py','mt5_demo_trading.py','mt5_clock.py')},
            sdk_version='fixture',clock={'basis':'utc'})
        self.snapshot=dict(status='ready',mode='demo',symbol='EURUSD',timeframe='H1',
            account=dict(login='123',server='Fixture',currency='USD',trade_mode='demo'),
            binding=runner.binding(runner.Plan.model_validate(self.plan)),basis=runner.BASIS,
            source_sha256=self.plan['adapter_sha256'],sdk_version='fixture',clock=self.plan['clock'],
            automation=dict(grant_id=self.secret['grant_id'],credential_id=self.secret['credential_id'],
                artifact_sha256=self.plan['artifact_sha256'],status='active'),
            positions=[],orders=[],foreign_exposure=False,unknown_submission=False,paused=False)
        self.bars=[]
        end=int(datetime(2026,11,4,12,tzinfo=timezone.utc).timestamp())
        for t in range(end-24*14400,end+14400,3600):
            self.bars.append(self.bar(t))
        self.refresh()
        self.api=Native(self)
        self.write_inputs()

    def bar(self, t, close=1.10000):
        return dict(timestamp=datetime.fromtimestamp(t,timezone.utc).isoformat(),open=1.10000,
            high=max(1.10005,close),low=min(1.09995,close),close=close)

    def refresh(self):
        stamp=int(self.clock.timestamp()*1000)
        self.snapshot.update(bars=copy.deepcopy(self.bars),quote=dict(bid=1.1003,ask=1.1004,time_msc=stamp),
            data_quality=dict(quote_status='fresh',observed_at_msc=stamp,quote_age_ms=0))

    def write_inputs(self):
        self.manifest.write_bytes(durable.encoded(self.plan));self.credential.write_bytes(durable.encoded(self.secret))

    def run_step(self, **kwargs):
        return runner.run(self.manifest,self.credential,self.directory,client_factory=lambda *_:self.api,
            now=lambda:self.clock,**kwargs)

    def enter(self):
        self.assertEqual(self.run_step()['reason'],'waiting_for_new_closed_h4')
        # Only the final H1 closes after registration; its close breaks the
        # previous 20 H4 highs. The production candidate chooses BUY itself.
        self.bars[-1]=self.bar(int(datetime(2026,11,4,15,tzinfo=timezone.utc).timestamp()),1.1003)
        self.clock+=timedelta(seconds=41);self.refresh()
        return self.run_step(resume=True)

    def test_candidate_to_native_entry_inventory_end_exit_and_final_flat(self):
        result=self.enter()
        self.assertEqual(result['reason'],'entry_filled_awaiting_inventory')
        self.assertEqual(result['decision']['signal'],'BUY')
        self.assertEqual(self.run_step(resume=True)['reason'],'waiting_for_new_closed_h4')
        self.clock=datetime.fromisoformat(self.plan['finish_at']);self.refresh()
        self.assertEqual(self.run_step(resume=True)['reason'],'awaiting_flat_inventory')
        final=self.run_step(resume=True)
        self.assertEqual(final['status'],'completed');self.assertEqual(final['exposure'],[])
        self.assertEqual([x['action'] for x in self.api.sends()],['place','close'])
        self.run_step(resume=True)
        self.assertEqual(len(self.api.sends()),2)
        self.assertNotIn(self.secret['credential'],(self.directory/'state.json').read_text())

    def test_no_signal_never_opens_and_finishes_flat(self):
        self.run_step()
        self.clock=datetime.fromisoformat(self.plan['finish_at']);self.refresh()
        self.assertEqual(self.run_step(resume=True)['reason'],'session_finished_flat_no_entry')
        self.assertEqual(self.api.sends(),[])

    def test_missing_warmup_or_a_missed_session_cannot_report_success(self):
        self.snapshot['bars']=self.snapshot['bars'][-16:]
        self.assertEqual(self.run_step()['reason'],'insufficient_closed_h4_warmup')
        self.assertEqual(self.api.sends(),[])
        self.directory=self.root/'missed'
        self.clock=datetime.fromisoformat(self.plan['finish_at']);self.refresh()
        self.assertEqual(self.run_step()['reason'],'session_window_missed')

    def test_crash_after_entry_fill_resumes_from_receipt_and_broker_position(self):
        self.run_step();self.clock+=timedelta(seconds=41)
        self.bars[-1]['close']=self.bars[-1]['high']=1.1003;self.refresh();self.api.behavior='crash_after'
        with self.assertRaises(Crash):self.run_step(resume=True)
        self.api.behavior='filled'
        result=self.run_step(resume=True)
        self.assertEqual(result['exposure'][0]['ticket'],17)
        self.assertEqual(len(self.api.sends()),1)
        self.assertEqual(result['status'],'running')

    def test_persisted_decision_resumes_before_intent_without_recomputing_history(self):
        self.run_step();self.clock+=timedelta(seconds=41)
        self.bars[-1]['close']=self.bars[-1]['high']=1.1003;self.refresh()
        with patch.object(durable,'submit_once',side_effect=Crash),self.assertRaises(Crash):
            self.run_step(resume=True)
        saved=durable.load(self.directory/'state.json',runner.SCHEMA)
        self.assertIs(saved['decision']['handled'],False)
        self.assertIsNone(saved['opening']);self.assertEqual(self.api.sends(),[])
        self.assertEqual(self.run_step(resume=True)['reason'],'entry_filled_awaiting_inventory')
        self.assertEqual(len(self.api.sends()),1)

    def test_forming_and_unsettled_bars_never_create_a_decision(self):
        self.run_step();self.clock+=timedelta(seconds=11)
        self.bars[-1]['close']=self.bars[-1]['high']=1.1003;self.refresh()
        self.assertEqual(self.run_step(resume=True)['reason'],'waiting_for_new_closed_h4')
        self.assertEqual(self.api.sends(),[])
        self.clock+=timedelta(seconds=30);self.refresh()
        self.assertEqual(self.run_step(resume=True)['decision']['signal'],'BUY')

    def test_crash_before_post_and_partial_never_create_another_intent(self):
        for behavior in ('crash_before','partial'):
            with self.subTest(behavior=behavior):
                self.setUp();self.run_step();self.clock+=timedelta(seconds=41)
                self.bars[-1]['close']=self.bars[-1]['high']=1.1003;self.refresh();self.api.behavior=behavior
                if behavior=='crash_before':
                    with self.assertRaises(Crash):self.run_step(resume=True)
                else:self.run_step(resume=True)
                self.api.behavior='filled'
                for _ in range(2):
                    self.assertEqual(self.run_step(resume=True)['status'],'attention_required')
                self.assertEqual(len(self.api.sends()),1)

    def test_stop_expiry_revoke_and_reconcile_never_imply_flat_or_send_close(self):
        for reason in ('stop','expiry','revoke','reconcile'):
            with self.subTest(reason=reason):
                self.setUp();self.enter()
                if reason=='stop':(self.directory/'STOP').touch()
                if reason=='expiry':self.clock=datetime.fromisoformat(self.plan['expires_at'])
                if reason=='revoke':self.snapshot['automation']['status']='revoked'
                self.refresh()
                result=self.run_step(resume=True,reconcile_only=reason=='reconcile')
                self.assertTrue(result['requires_owner_attention']);self.assertEqual(len(result['exposure']),1)
                self.assertEqual(len(self.api.sends()),1)

    def test_snapshot_revision_source_identity_stale_and_foreign_position_fail_closed(self):
        for change in ('bar','source','generation','stale','foreign'):
            with self.subTest(change=change):
                self.setUp();self.run_step()
                if change=='bar':self.snapshot['bars'][0]['high']=1.10006
                if change=='source':self.snapshot['source_sha256']={}
                if change=='generation':self.snapshot['binding']['generation']+=1
                if change=='stale':self.clock+=timedelta(seconds=6)
                if change=='foreign':self.snapshot['foreign_exposure']=True
                self.assertIn(self.run_step(resume=True)['status'],('blocked','attention_required'))
                self.assertEqual(self.api.sends(),[])

    def test_external_stop_loss_flat_is_observed_not_simulated(self):
        self.enter();self.api.positions=[]
        result=self.run_step(resume=True)
        self.assertEqual(result['reason'],'broker_inventory_flat')
        self.assertEqual(len(self.api.sends()),1)

    def test_changed_artifact_and_checkpoint_are_rejected(self):
        self.run_step()
        path=self.directory/'state.json';raw=path.read_bytes();path.write_bytes(raw.replace(b'waiting_for_new_closed_h4',b'false_complete'))
        with self.assertRaises(ValueError):self.run_step(resume=True)
        path.write_bytes(raw);(self.root/'artifact.json').write_text('{}')
        with self.assertRaises(ValueError):self.run_step(resume=True)


if __name__=='__main__':unittest.main()
