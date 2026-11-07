from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import forex_h4_pilot as pilot


class ScenarioReuseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.protocol = self.root/'protocol.md'
        self.protocol.write_text('Synthetic numerical recovery fixture, not market evidence')
        inputs = dict(schema='forex-h4-inputs-v1')
        for name, start, hours, first, last in (
            ('warmup', datetime(2021,12,1,tzinfo=timezone.utc), 324, '20211201', '20211231'),
            ('development', datetime(2022,1,3,tzinfo=timezone.utc), 24, '20220103', '20220114')):
            path = self.root/(name+'.csv')
            lines = ['DateTime,Bid,Ask,Volume']
            for hour in range(hours):
                value = (Decimal('1.10000') + Decimal(hour%4==1)/1000) if name=='warmup' else \
                    Decimal('1.10300') if hour < 8 else Decimal('1.09800')
                stamp = (start+timedelta(hours=hour, milliseconds=1)).strftime('%Y%m%d %H:%M:%S.%f')[:-3]
                lines.append(f'{stamp},{value},{value+Decimal("0.00020")},1')
            path.write_text('\n'.join(lines)+'\n', encoding='utf-8')
            inputs[name] = dict(path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                first_day=first, last_day=last)
        self.inputs = self.root/'inputs.json'
        self.inputs.write_text(json.dumps(inputs), encoding='utf-8')

    def args(self, name, previous=None):
        argv = ['--input-dir',str(self.root),'--input-manifest',str(self.inputs),
            '--candidate','eurusd-h4-donchian20-10-atr14-r025-v1',
            '--research-protocol',str(self.protocol),'--output-dir',str(self.root/name)]
        return argv+(['--reuse-scenarios-from',str(self.root/previous)] if previous else [])

    def test_h1_cli_clock_provenance_and_sealed_reuse(self):
        from trading_workspace_v2.forex_coarse_input import prepare_coarse_hours
        from trading_workspace_v2.forex_intraday_candidates import EUROPE_AM
        warm=json.loads(self.inputs.read_bytes())['warmup']
        cache=self.root/'hours'
        prepare_coarse_hours(Path(warm['path']),cache_dir=cache,
            **{k:warm[k] for k in ('sha256','first_day','last_day')})
        def args(name,previous=None):
            argv=self.args(name,previous)
            argv[argv.index('--candidate')+1]=EUROPE_AM
            return argv+['--warmup-hours-cache-dir',str(cache)]
        with redirect_stdout(io.StringIO()):pilot.main(args('h1-original'))
        manifest=json.loads((self.root/'h1-original/manifest.json').read_bytes())
        self.assertEqual(manifest['decision_timeframe_seconds'],3600)
        self.assertEqual(manifest['hourly_warmup']['hours'],324)
        decisions=json.loads((self.root/'h1-original/reference-decisions.json').read_bytes())
        self.assertEqual(decisions[0]['time_msc'],int(datetime(2022,1,3,7,tzinfo=timezone.utc).timestamp())*1000)
        with patch.object(pilot,'run_scenario') as run,redirect_stdout(io.StringIO()):
            pilot.main(args('h1-reused','h1-original'))
        run.assert_not_called()
        self.assertEqual((self.root/'h1-original/results.json').read_bytes(),
                         (self.root/'h1-reused/results.json').read_bytes())

    def test_cli_resumes_complete_packet_without_rerunning_sealed_scenario(self):
        def interrupt(stage):
            if stage=='cost-stress' and (self.root/'partial/cost-stress-resume.json').exists():
                raise RuntimeError('fixture interruption after complete packet')
        with redirect_stdout(io.StringIO()),self.assertRaises(RuntimeError):
            pilot.main(self.args('partial'),on_progress=interrupt)
        self.assertTrue((self.root/'partial/reference-completed.json').exists())
        self.assertFalse((self.root/'partial/cost-stress-completed.json').exists())
        argv=self.args('resumed')+['--resume-scenarios-from',str(self.root/'partial')]
        with patch.object(pilot,'run_scenario',wraps=pilot.run_scenario) as run,redirect_stdout(io.StringIO()):
            pilot.main(argv)
        self.assertEqual(run.call_count,1)
        self.assertIsNotNone(run.call_args.kwargs['resume_packet'])
        with redirect_stdout(io.StringIO()):pilot.main(self.args('fresh'))
        for name in ('results.json','reference-checkpoint.json','cost-stress-checkpoint.json',
                     'cost-stress-candidate.json','cost-stress-decisions.json'):
            self.assertEqual((self.root/'resumed'/name).read_bytes(),(self.root/'fresh'/name).read_bytes(),name)
        receipt=json.loads((self.root/'resumed/receipt.json').read_bytes())
        self.assertEqual(receipt['reused_scenarios'],['reference'])
        self.assertEqual(receipt['resumed_scenarios'],['cost-stress'])

    def test_cli_resume_rejects_legacy_partial_instead_of_silently_restarting(self):
        self.interrupted()
        argv=self.args('legacy-resume')+['--resume-scenarios-from',str(self.root/'old')]
        with patch.object(pilot,'run_scenario') as run,redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'complete resume packet missing'):pilot.main(argv)
        run.assert_not_called()

    def test_h1_cli_rejects_missing_hourly_warmup_before_dispatch(self):
        from trading_workspace_v2.forex_intraday_candidates import RSI_REENTRY
        argv=self.args('no-h1-cache');argv[argv.index('--candidate')+1]=RSI_REENTRY
        with patch.object(pilot,'run_scenario') as run, self.assertRaises(SystemExit):pilot.main(argv)
        run.assert_not_called()
        self.assertFalse((self.root/'no-h1-cache').exists())

    def interrupted(self):
        original = pilot.run_scenario
        def stop_stress(path, warmup, name, *args, **kwargs):
            if name == 'cost-stress':
                raise RuntimeError('fixture interrupted second scenario')
            return original(path, warmup, name, *args, **kwargs)
        with patch.object(pilot,'run_scenario',side_effect=stop_stress), redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                pilot.main(self.args('old'))
        self.assertTrue((self.root/'old/reference-completed.json').exists())
        self.assertFalse((self.root/'old/cost-stress-completed.json').exists())

    def test_failed_second_scenario_reuses_first_and_matches_uninterrupted_result(self):
        self.interrupted()
        original_bytes = (self.root/'old/reference-checkpoint.json').read_bytes()
        with patch.object(pilot,'run_scenario',wraps=pilot.run_scenario) as run, redirect_stdout(io.StringIO()):
            pilot.main(self.args('continued','old'))
        self.assertEqual(run.call_count,1)
        self.assertEqual(run.call_args.args[2],'cost-stress')
        with redirect_stdout(io.StringIO()):
            pilot.main(self.args('fresh'))
        for filename in ('results.json','reference-checkpoint.json','cost-stress-checkpoint.json',
                         'reference-decisions.json','cost-stress-decisions.json',
                         'reference-candidate.json','cost-stress-candidate.json'):
            self.assertEqual((self.root/'continued'/filename).read_bytes(),
                             (self.root/'fresh'/filename).read_bytes(),filename)
        self.assertEqual((self.root/'old/reference-checkpoint.json').read_bytes(),original_bytes)
        receipt=json.loads((self.root/'continued/receipt.json').read_text())
        self.assertEqual(receipt['reused_scenarios'],['reference'])
        self.assertEqual(receipt['stage'],'completed_declared_scenarios')
        seal=json.loads((self.root/'continued/reference-completed.json').read_text())
        self.assertEqual(seal['reused_from']['run_id'],json.loads((self.root/'old/manifest.json').read_text())['run_id'])

    def test_tampered_checkpoint_or_result_and_active_source_fail_before_simulation(self):
        self.interrupted()
        directory = self.root/'old'
        originals = {n:(directory/n).read_bytes() for n in
                     ('reference-checkpoint.json','results.json','receipt.json')}
        for index, filename in enumerate(originals):
            with self.subTest(filename=filename):
                value = json.loads(originals[filename])
                if filename=='reference-checkpoint.json':
                    value['execution']['balance']='9999'
                elif filename=='results.json':
                    value[0]['equity_usd']='9999'
                else:
                    value['stage']='cost-stress'
                (directory/filename).write_text(json.dumps(value),encoding='utf-8')
                with patch.object(pilot,'run_scenario') as run, redirect_stdout(io.StringIO()):
                    with self.assertRaises(ValueError):
                        pilot.main(self.args('bad-'+str(index),'old'))
                run.assert_not_called()
                (directory/filename).write_bytes(originals[filename])

    def test_changed_costs_refuse_reuse_before_simulation(self):
        self.interrupted()
        changed=[('reference',Decimal('.00001'),Decimal(10)),pilot.SCENARIOS[1]]
        with patch.object(pilot,'SCENARIOS',changed), patch.object(pilot,'run_scenario') as run, \
             redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'bindings'):
                pilot.main(self.args('changed','old'))
        run.assert_not_called()

    def test_changed_data_or_source_binding_refuses_reuse_before_simulation(self):
        self.interrupted()
        manifest_path=self.root/'old/manifest.json'
        old_manifest=manifest_path.read_bytes()
        value=json.loads(old_manifest)
        value['source_files']['scripts/forex_h4_pilot.py']='0'*64
        manifest_path.write_text(json.dumps(value),encoding='utf-8')
        with patch.object(pilot,'run_scenario') as run, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'bindings'):
                pilot.main(self.args('source-drift','old'))
        run.assert_not_called()
        manifest_path.write_bytes(old_manifest)
        inputs=json.loads(self.inputs.read_text())
        data=Path(inputs['development']['path'])
        data.write_text(data.read_text().replace('1.10300','1.10310'),encoding='utf-8')
        inputs['development']['sha256']=hashlib.sha256(data.read_bytes()).hexdigest()
        self.inputs.write_text(json.dumps(inputs),encoding='utf-8')
        with patch.object(pilot,'run_scenario') as run, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'bindings'):
                pilot.main(self.args('data-drift','old'))
        run.assert_not_called()

    def test_unsealed_checkpoint_does_not_silently_rerun_the_study(self):
        self.interrupted()
        (self.root/'old/reference-completed.json').unlink()
        with patch.object(pilot,'run_scenario') as run, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'no sealed'):
                pilot.main(self.args('unsealed','old'))
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
