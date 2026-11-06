"""Horizon snapshots are causal observations, never separate force-closed runs."""
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import sys
import tempfile
import unittest
import hashlib
import io
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[1]/'scripts')]
import forex_h4_pilot as pilot
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
from trading_workspace_v2.forex_study_registration import validate_registration
from test_forex_h4 import candle
import test_forex_study_registration as registration_fixtures


class HorizonTests(unittest.TestCase):
    def test_single_replay_snapshots_preserve_pending_and_match_final_artifacts(self):
        warmup = [candle(pilot.START//14400000+i-20) for i in range(20)]
        ticks = [BrokerReplayTick(time_msc=pilot.START+h*3600000+1, sequence=h+1,
            bid='1.10200', ask='1.10220') for h in range(14)]
        cutoffs = [pilot.START+h*3600000 for h in (4, 8, 12)]
        with tempfile.TemporaryDirectory() as folder:
            baseline=Path(folder)/'base'; baseline.mkdir()
            candidate=Path(folder)/'with-horizons'; candidate.mkdir()
            def run(output, **kwargs):
                with patch.object(pilot, 'read_qdm_ticks', return_value=iter(ticks)):
                    return pilot.run_scenario(Path('unused'),warmup,'reference',Decimal(0),Decimal(10),
                        output,lambda *args:None,**kwargs)
            a=run(baseline); b=run(candidate,horizon_cutoffs=cutoffs)
            self.assertEqual(a,b)
            for file in ('reference-checkpoint.json','reference-decisions.json'):
                self.assertEqual((baseline/file).read_bytes(),(candidate/file).read_bytes())
            records=json.loads((candidate/'reference-horizons.json').read_bytes())
            self.assertEqual([r['cutoff_msc'] for r in records],cutoffs)
            self.assertIsNotNone(records[0]['checkpoint']['execution']['pending_market_order'])
            self.assertIsNone(records[0]['checkpoint']['execution']['position'])
            self.assertIsNotNone(records[1]['checkpoint']['execution']['position'])
            for row in records:
                self.assertLess(row['last_observed_tick']['time_msc'],row['cutoff_msc'])
                self.assertFalse(row['promotion_authorized'])
                self.assertEqual(row['accounting']['independent_accounting'],'passed')
                for event in row['checkpoint']['execution']['ledger']:
                    self.assertLessEqual(event['virtual_time_utc']*1000,row['cutoff_msc'])
                independent=Path(folder)/str(row['cutoff_msc']); independent.mkdir()
                # An EOF prefix represents this cutoff, not the original
                # dataset's later calendar end (which may contain cash events).
                calendar = list(pilot.financing_calendar(Decimal(10)))
                with patch.object(pilot,'read_qdm_ticks',return_value=iter(
                        t for t in ticks if t.time_msc < row['cutoff_msc'])), \
                     patch.object(pilot,'financing_calendar',return_value=iter(
                        t for t in calendar if t.scheduled_time_msc < row['cutoff_msc'])):
                    pilot.run_scenario(Path('unused'),warmup,'reference',Decimal(0),Decimal(10),
                        independent,lambda *args:None)
                expected=json.loads((independent/'reference-checkpoint.json').read_bytes())
                self.assertEqual(row['checkpoint'],expected)

    def test_weekend_cutoffs_and_terminal_include_quote_free_financing(self):
        # Mon Jan 3 to Sun Jan 9, 2022: 5 rollovers, Wednesday counts triple.
        # The last Friday hourly mark is 21:00; its 22:00 fee must still post.
        warmup = [candle(pilot.START//14400000+i-20) for i in range(20)]
        offsets = [0, 1, 2, 3, 4, 4*24+20]
        ticks = [BrokerReplayTick(time_msc=pilot.START+h*3600000+1, sequence=i+1,
            bid='1.10200', ask='1.10220') for i,h in enumerate(offsets)]
        cutoffs = [pilot.START+5*86400000, pilot.START+7*86400000]
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                result = pilot.run_scenario(Path('unused'),warmup,'reference',Decimal(0),Decimal(10),
                    output,lambda *args:None,development=dict(sha256='a'*64,
                        first_day='20220103',last_day='20220109'),horizon_cutoffs=cutoffs)
            records = json.loads((output/'reference-horizons.json').read_bytes())
            final = json.loads((output/'reference-checkpoint.json').read_bytes())
            self.assertTrue(result['open_position'])
            for row in records:
                checkpoint = row['checkpoint']
                fees = [e for e in checkpoint['execution']['ledger'] if e['kind']=='financing']
                self.assertEqual(len(fees),5)
                # Independent arithmetic, not apply_forex_financing/reconcile.
                quantity = Decimal(checkpoint['execution']['position']['quantity'])
                self.assertEqual(Decimal(checkpoint['execution']['balance']),Decimal(10000)-10*quantity*7)
                self.assertEqual(checkpoint['risk']['observed_ticks'],len(ticks))
                self.assertEqual(checkpoint['risk']['last_tick']['time_msc'],ticks[-1].time_msc)
                self.assertEqual(checkpoint['execution']['cursor_index'],len(ticks))
                self.assertEqual(checkpoint['execution']['position'],final['execution']['position'])
                self.assertEqual(checkpoint['execution']['ledger'],final['execution']['ledger'])
                self.assertFalse(checkpoint['risk']['overall_stopped'])
            self.assertEqual(records[-1]['checkpoint'],final)

    def test_exact_cutoff_cash_event_is_deferred_and_end_is_exclusive(self):
        warmup = [candle(pilot.START//14400000+i-20) for i in range(20)]
        ticks = [BrokerReplayTick(time_msc=pilot.START+h*3600000+1, sequence=h+1,
            bid='1.10200', ask='1.10220') for h in range(5)]
        cutoffs = [pilot.START+4*3600000,pilot.START+8*3600000]
        terms = [pilot.FinancingTerms(event_id=str(t),scheduled_time_msc=t,known_at_msc=pilot.START,
                    debit_buy_usd_per_lot='10',debit_sell_usd_per_lot='10',multiplier=1,
                    source='boundary fixture',qualification='declared_scenario')
                 for t in [*cutoffs,pilot.END]]
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)), \
                 patch.object(pilot,'financing_calendar',return_value=iter(terms)):
                pilot.run_scenario(Path('unused'),warmup,'reference',Decimal(0),Decimal(10),
                    output,lambda *args:None,horizon_cutoffs=cutoffs)
            records = json.loads((output/'reference-horizons.json').read_bytes())
            final = json.loads((output/'reference-checkpoint.json').read_bytes())
            event_times = lambda s:[e['virtual_time_utc']*1000 for e in s['execution']['ledger'] if e['kind']=='financing']
            self.assertEqual(event_times(records[0]['checkpoint']),[])
            self.assertIsNotNone(records[0]['checkpoint']['execution']['pending_market_order'])
            self.assertEqual(event_times(records[1]['checkpoint']),[cutoffs[0]])
            self.assertEqual(event_times(final),cutoffs)

    def test_terminal_fee_can_halt_risk_without_fabricating_a_close(self):
        warmup = [candle(pilot.START//14400000+i-20) for i in range(20)]
        ticks = [BrokerReplayTick(time_msc=pilot.START+h*3600000+1,sequence=h+1,
            bid='1.10200',ask='1.10220') for h in range(5)]
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                result = pilot.run_scenario(Path('unused'),warmup,'reference',Decimal(0),Decimal(100000),
                    output,lambda *args:None,development=dict(sha256='a'*64,
                        first_day='20220103',last_day='20220103'))
            state = json.loads((output/'reference-checkpoint.json').read_bytes())
            self.assertTrue(state['risk']['overall_stopped'])
            self.assertIsNotNone(state['risk']['close_pending'])
            self.assertTrue(result['open_position'])
            self.assertEqual(result['closed_trades'],0)
            self.assertEqual(result['observed_ticks'],5)
            self.assertEqual(state['risk']['last_tick']['time_msc'],ticks[-1].time_msc)

    def test_financing_cannot_invent_an_anchor_for_empty_data(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(())), \
                 self.assertRaisesRegex(ValueError,'known boundary'):
                pilot.run_scenario(Path('unused'),[],'reference',Decimal(0),Decimal(10),
                    output,lambda *args:None)
            self.assertFalse((output/'reference-checkpoint.json').exists())

    def test_invalid_cutoff_fails_before_reading_ticks(self):
        for values in ([True], [pilot.START], [pilot.START+1], [pilot.START+8*3600000,pilot.START+4*3600000]):
            with self.subTest(values=values), tempfile.TemporaryDirectory() as folder:
                with patch.object(pilot,'read_qdm_ticks') as read, self.assertRaisesRegex(ValueError,'horizon'):
                    pilot.run_scenario(Path('unused'),[],'reference',Decimal(0),Decimal(0),
                        Path(folder),lambda *args:None,horizon_cutoffs=values)
                read.assert_not_called()

    def test_horizon_artifacts_are_in_reuse_seal_and_binding(self):
        plain={'research_protocol':{}}
        declared={'research_protocol':{},'horizon_cutoffs':[pilot.START+4*3600000]}
        self.assertNotIn('reference-horizons.json',pilot.scenario_files(plain,'reference'))
        self.assertIn('reference-horizons.json',pilot.scenario_files(declared,'reference'))
        self.assertNotEqual(pilot.scenario_binding(plain),pilot.scenario_binding(declared))

    def test_calendar_cutoffs_reject_day_approximations(self):
        fixture=registration_fixtures.RegistrationTests('test_load_rejects_changed_bytes_or_unregistered_digest')
        fixture.setUp()
        try:
            r=fixture.registration; inputs=fixture.inputs
            inputs['development']['last_day']='20231231'
            r['windows']['evaluation']['last_day']='20231231'
            r['horizon_months']=[3,6,12]
            r['horizon_cutoffs']=[int(datetime(y,m,1,tzinfo=timezone.utc).timestamp())*1000
                for y,m in ((2023,4),(2023,7),(2024,1))]
            validate_registration(r,inputs,fixture.candidate)
            r['horizon_cutoffs'][1]-=86400000
            with self.assertRaisesRegex(ValueError,'calendar'):
                validate_registration(r,inputs,fixture.candidate)
        finally:
            fixture.doCleanups()

    def test_registered_cli_preflight_pins_horizons_without_simulation(self):
        fixture=registration_fixtures.RegistrationTests('test_load_rejects_changed_bytes_or_unregistered_digest')
        fixture.setUp()
        try:
            r=fixture.registration
            r['windows']['evaluation']['last_day']='20231231'
            r['horizon_months']=[3,6,12]
            r['horizon_cutoffs']=[int(datetime(y,m,1,tzinfo=timezone.utc).timestamp())*1000
                for y,m in ((2023,4),(2023,7),(2024,1))]
            fixture.inputs['development']['last_day']='20231231'
            fixture.input_manifest.write_text(json.dumps(dict(schema='forex-h4-inputs-v1',**fixture.inputs)))
            fixture.registration_path.write_text(json.dumps(r))
            fixture.digest=hashlib.sha256(fixture.registration_path.read_bytes()).hexdigest()
            from trading_workspace_v2 import forex_study_registration as registry
            with patch.dict(registry.REGISTERED_STUDIES,{fixture.digest:'fixture'}), \
                 patch.object(pilot,'observed_account_spec',return_value=dict(sha256='a'*64,
                    debit_buy_usd_per_lot='9.3',debit_sell_usd_per_lot='-0.31')), \
                 patch.object(pilot,'inspect_qdm',return_value=(dict(ticks=100,complete_h4=81),
                    [candle(i) for i in range(81)])), \
                 patch.object(pilot,'run_scenario') as simulate, redirect_stdout(io.StringIO()):
                pilot.main(fixture.argv())
                simulate.assert_not_called()
                manifest=json.loads((fixture.root/'attempt/manifest.json').read_bytes())
                self.assertEqual(manifest['horizon_cutoffs'],r['horizon_cutoffs'])
                registry.inspect_registered_manifest(manifest,fixture.root/'attempt')
                manifest['horizon_cutoffs'][0]+=1
                with self.assertRaisesRegex(ValueError,'scope'):
                    registry.inspect_registered_manifest(manifest,fixture.root/'attempt')
        finally:
            fixture.doCleanups()

    def test_same_dates_cannot_replace_registered_input_bytes(self):
        fixture=registration_fixtures.RegistrationTests('test_load_rejects_changed_bytes_or_unregistered_digest')
        fixture.setUp()
        try:
            fixture.registration['input_pins']=json.loads(json.dumps(fixture.inputs))
            validate_registration(fixture.registration,fixture.inputs,fixture.candidate)
            fixture.inputs['development']['sha256']='f'*64
            with self.assertRaisesRegex(ValueError,'content pins'):
                validate_registration(fixture.registration,fixture.inputs,fixture.candidate)
        finally:
            fixture.doCleanups()


if __name__=='__main__': unittest.main()
