"""Complete packets must preserve execution, clocks and research state after interruption."""
from copy import deepcopy
from decimal import Decimal as D
import json
from pathlib import Path
import sys,tempfile,unittest
from unittest.mock import patch

sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'scripts')]
import forex_h4_pilot as pilot
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
from trading_workspace_v2.forex_prop_observer import ForexPropObserver
from test_forex_h4 import candle
from test_forex_prop_observer import observation,quote,profile


class ScenarioResumeTests(unittest.TestCase):
    def fixture(self):
        warmup=[candle(pilot.START//14400000+i-20) for i in range(20)]
        ticks=[BrokerReplayTick(time_msc=pilot.START+h*3600000+1,sequence=h+1,
            bid='1.10200',ask='1.10220') for h in range(48)]
        return warmup,ticks

    def run_case(self,output,*,observer=True,stop=None,packet=None,ticks=None):
        warmup,standard=self.fixture()
        def progress(stage,boundary,*args):
            if stop is not None and boundary*1000>=pilot.START+stop*3600000:
                raise InterruptedError('controlled fixture interruption')
        with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks or standard)):
            return pilot.run_scenario(Path('unused'),warmup,'reference',D(0),D(10),output,progress,
                development=dict(sha256='a'*64,first_day='20220103',last_day='20220104'),
                horizon_cutoffs=[pilot.START+h*3600000 for h in (12,24,48)],
                prop_profile=profile(targets=('1000','500')) if observer else None,
                checkpoint_binding='fixture-bound-source-and-input',resume_packet=packet)

    def test_interrupted_and_eof_packets_match_uninterrupted_artifacts(self):
        for observer,stop in [(False,31),(True,31),(True,48)]:
            with self.subTest(observer=observer,stop=stop),tempfile.TemporaryDirectory() as folder:
                root=Path(folder)
                for name in ('baseline','partial','resumed'):(root/name).mkdir()
                expected=self.run_case(root/'baseline',observer=observer)
                with self.assertRaises(InterruptedError):
                    self.run_case(root/'partial',observer=observer,stop=stop)
                packet=json.loads((root/'partial/reference-resume.json').read_bytes())
                self.assertIsNotNone(packet['payload']['checkpoint']['execution']['position'])
                actual=self.run_case(root/'resumed',observer=observer,packet=packet)
                self.assertEqual(actual,expected)
                names=['reference-checkpoint.json','reference-decisions.json','reference-horizons.json']
                if observer:names.append('reference-prop-path.json')
                for name in names:
                    self.assertEqual((root/'resumed'/name).read_bytes(),(root/'baseline'/name).read_bytes(),name)

    def test_bad_binding_changed_risk_and_input_prefix_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'partial').mkdir()
            with self.assertRaises(InterruptedError):self.run_case(root/'partial',stop=31)
            packet=json.loads((root/'partial/reference-resume.json').read_bytes())
            for kind in ('checksum','context','risk','prefix'):
                with self.subTest(kind=kind):
                    changed=deepcopy(packet);ticks=None
                    if kind=='checksum':changed['payload_sha256']='0'*64
                    if kind=='context':changed['payload']['context_sha256']='0'*64
                    if kind=='risk':changed['payload']['checkpoint']['limits']['per_trade_loss']='10'
                    if kind=='prefix':
                        _,ticks=self.fixture()
                        ticks[23]=ticks[23].model_copy(update={'sequence':999})
                    if kind!='checksum':changed['payload_sha256']=pilot.content_hash(changed['payload'])
                    with self.assertRaises(ValueError):self.run_case(root,packet=changed,ticks=ticks)

    def test_checkpoint_keeps_newly_queued_entry_before_its_first_fill(self):
        _,ticks=self.fixture()
        for index in range(20):
            ticks[index]=ticks[index].model_copy(update={'bid':D('1.10000'),'ask':D('1.10020')})
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name in ('base','partial','resumed'):(root/name).mkdir()
            expected=self.run_case(root/'base',ticks=ticks)
            with self.assertRaises(InterruptedError):self.run_case(root/'partial',ticks=ticks,stop=24)
            packet=json.loads((root/'partial/reference-resume.json').read_bytes())
            self.assertIsNotNone(packet['payload']['checkpoint']['execution']['pending_market_order'])
            actual=self.run_case(root/'resumed',ticks=ticks,packet=packet)
            self.assertEqual(actual,expected)

    def test_observer_restores_reset_phase_and_latched_breach_state(self):
        for state in ('running','phase2','breached'):
            with self.subTest(state=state):
                before=observation(targets=('10','5'))
                if state=='phase2':
                    quote(before,1,balance='10020',position='p');quote(before,2,balance='10020')
                    before.advance_phase(before.start+3600000)
                elif state=='breached':quote(before,1,floating='-501',position='p')
                else:quote(before,1,floating='-100',position='p')
                packet=json.loads(json.dumps(before.checkpoint()))
                after=ForexPropObserver.from_checkpoint(packet)
                self.assertEqual(after.export(),before.export())
                for offset in (86400001,86400002):
                    quote(before,offset,balance='10000');quote(after,offset,balance='10000')
                    self.assertEqual(after.export(),before.export())
                bad=deepcopy(packet);bad['reset_msc']+=1000
                with self.assertRaises(ValueError):ForexPropObserver.from_checkpoint(bad)
                bad=deepcopy(packet)
                bad['session']['profile']['phases'][0]['profit_target']['threshold']['amount']='999'
                with self.assertRaises(ValueError):ForexPropObserver.from_checkpoint(bad)

    def test_runner_resume_preserves_actual_phase_accounts(self):
        from trading_workspace_v2.forex_prop_candidates import UTC_RANGE
        warmup=[candle(pilot.START//14400000+i-80) for i in range(80)]
        ticks=[]
        for h in range(72):
            bid=D('1.100') if h%24<8 else D('1.104') if h%24<16 else D('1.106')
            ticks.append(BrokerReplayTick(time_msc=pilot.START+h*3600000+1,sequence=h+1,
                bid=str(bid),ask=str(bid+D('.0002'))))
        def run(output,packet=None,stop=False):
            def progress(stage,boundary,*args):
                if stop and boundary*1000>=pilot.START+55*3600000:raise InterruptedError('phase2 stop')
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                return pilot.run_scenario(Path('unused'),warmup,'reference',D(0),D(10),output,progress,
                    development=dict(sha256='a'*64,first_day='20220103',last_day='20220105'),
                    prop_profile=profile(targets=('1','1000')),research_candidate=UTC_RANGE,
                    checkpoint_binding='fixture-phase-accounts',resume_packet=packet)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name in ('base','partial','resumed'):(root/name).mkdir()
            expected=run(root/'base')
            with self.assertRaises(InterruptedError):run(root/'partial',stop=True)
            packet=json.loads((root/'partial/reference-resume.json').read_bytes())
            self.assertEqual(len(packet['payload']['phase_accounts']),1)
            actual=run(root/'resumed',packet=packet)
            self.assertEqual(actual,expected)
            self.assertEqual((root/'base/reference-prop-path.json').read_bytes(),
                             (root/'resumed/reference-prop-path.json').read_bytes())

    def test_h1_restore_preserves_pending_exit_through_financing_and_quote_gap(self):
        from trading_workspace_v2.forex_h4 import Candle,HOUR
        from trading_workspace_v2.forex_intraday_candidates import ASIA_ORB
        warmup=[Candle(pilot.START//1000+(i-100)*HOUR,D('1.1001'),D('1.101'),D('1.099'),D('1.1001'))
                for i in range(100)]
        ticks=[]
        for h in range(72):
            if 40<=h<48:continue
            bid=D('1.10000') if h%24<8 else D('1.10200')
            for offset in (1,10,3300000):
                ticks.append(BrokerReplayTick(time_msc=pilot.START+h*3600000+offset,
                    sequence=len(ticks)+1,bid=str(bid),ask=str(bid+D('.00020'))))
        def run(output,packet=None,stop=False):
            def progress(stage,boundary,*args):
                if stop and boundary*1000>=pilot.START+31*3600000:raise InterruptedError('H1 stop')
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                return pilot.run_scenario(Path('unused'),warmup,'reference',D(0),D(10),output,progress,
                    development=dict(sha256='a'*64,first_day='20220103',last_day='20220105'),
                    prop_profile=profile(targets=('1000','500')),research_candidate=ASIA_ORB,
                    checkpoint_binding='fixture-H1-gap',resume_packet=packet)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name in ('base','partial','resumed'):(root/name).mkdir()
            expected=run(root/'base')
            with self.assertRaises(InterruptedError):run(root/'partial',stop=True)
            packet=json.loads((root/'partial/reference-resume.json').read_bytes())
            actual=run(root/'resumed',packet=packet)
            self.assertEqual(actual,expected)
            self.assertGreater(D(actual['financing_debit_usd']),0)
            for name in ('reference-prop-path.json','reference-candidate.json','reference-checkpoint.json'):
                self.assertEqual((root/'base'/name).read_bytes(),(root/'resumed'/name).read_bytes(),name)
            changed=deepcopy(packet)
            changed['payload']['candidate_state']['candidate']='eurusd-h1-ny-orb08-09-atr14x1p5-r025-v1'
            changed['payload_sha256']=pilot.content_hash(changed['payload'])
            (root/'wrong-policy').mkdir()
            with self.assertRaisesRegex(ValueError,'candidate identity'):
                run(root/'wrong-policy',packet=changed)


if __name__=='__main__':unittest.main()
