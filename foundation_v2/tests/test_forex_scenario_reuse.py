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
