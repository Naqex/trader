from contextlib import redirect_stdout
from copy import deepcopy
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
from trading_workspace_v2 import forex_study_registration as registry
from test_forex_prop_candidates import candle


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.protocol = self.root/'protocol.md'
        self.protocol.write_bytes(b'Generated fixture, not market research.')
        self.candidate = pilot.ALL_STUDY_CANDIDATES[0]
        self.registration = dict(schema='forex-historical-study-registration-v1', study_id='fixture',
            calendar_accounting='exclusive_event_clock_v1',
            data_role='historical_robustness', prior_exposure='unverified_owner_cannot_recall', clean_oos=False,
            candidates=[self.candidate], authorization=dict(promotion_authorized=False),
            protocol=dict(sha256=hashlib.sha256(self.protocol.read_bytes()).hexdigest()),
            account_spec=dict(sha256='a'*64), source_files={},
            windows=dict(warmup=dict(first_day='20221101',last_day='20221231'),
                         evaluation=dict(first_day='20230101',last_day='20230331')),
            scenarios=[dict(name=name,commission_usd_per_lot_per_side='2.50',slippage_price_per_side=slip,
                            financing_debit_buy_usd_per_lot=buy,financing_debit_sell_usd_per_lot=sell)
                       for name,slip,buy,sell in [('reference','0','9.3','-0.31'),('cost-stress','0.00002','20','20')]])
        self.registration_path = self.root/'registration.json'
        self.registration_path.write_bytes(json.dumps(self.registration).encode())
        self.digest = hashlib.sha256(self.registration_path.read_bytes()).hexdigest()
        self.registered = patch.dict(registry.REGISTERED_STUDIES, {self.digest:'fixture'})
        self.registered.start()
        self.addCleanup(self.registered.stop)
        self.inputs = {role:dict(path=str(self.root/(role+'.csv')),sha256='b'*64,
            **{k:self.registration['windows'][registered_role][k] for k in ('first_day','last_day')})
            for role,registered_role in [('warmup','warmup'),('development','evaluation')]}
        self.input_manifest = self.root/'inputs.json'
        self.input_manifest.write_text(json.dumps(dict(schema='forex-h4-inputs-v1',**self.inputs)))

    def argv(self, name='attempt'):
        return ['--input-dir',str(self.root),'--input-manifest',str(self.input_manifest),
                '--candidate',self.candidate,'--research-protocol',str(self.protocol),
                '--study-registration',str(self.registration_path),'--study-registration-sha256',self.digest,
                '--account-spec',str(self.root/'spec.json'),'--account-spec-sha256','a'*64,
                '--output-dir',str(self.root/name),'--preflight-only']

    def test_load_rejects_changed_bytes_or_unregistered_digest(self):
        self.assertEqual(registry.load_registration(self.registration_path,self.digest), self.registration)
        with self.assertRaises(ValueError):
            registry.load_registration(self.registration_path,'f'*64)
        self.registration_path.write_bytes(self.registration_path.read_bytes()+b' ')
        with self.assertRaises(ValueError):
            registry.load_registration(self.registration_path,self.digest)

    def test_even_registered_hash_cannot_claim_clean_oos(self):
        bad=dict(self.registration,clean_oos=True)
        self.registration_path.write_bytes(json.dumps(bad).encode())
        digest=hashlib.sha256(self.registration_path.read_bytes()).hexdigest()
        with patch.dict(registry.REGISTERED_STUDIES,{digest:'fixture'}), self.assertRaisesRegex(ValueError,'scope'):
            registry.load_registration(self.registration_path,digest)

    def test_opt_in_accepts_only_registered_window_and_candidate(self):
        with self.assertRaisesRegex(ValueError,'registered development'):
            pilot.input_contract(self.root,self.input_manifest,research_candidate=self.candidate)
        accepted=pilot.input_contract(self.root,self.input_manifest,research_candidate=self.candidate,
                                      registration=self.registration)
        self.assertEqual(accepted,self.inputs)
        for change in ('window','candidate','protocol','source','account'):
            inputs=deepcopy(self.inputs)
            args=dict()
            candidate=self.candidate
            if change=='window': inputs['development']['last_day']='20230401'
            if change=='candidate': candidate='other'
            if change=='protocol': args['protocol_sha256']='0'*64
            if change=='source':
                self.registration['source_files']={'core.py':'a'*64}
                args['source_files']={'core.py':'b'*64}
            if change=='account': args['account_spec_sha256']='0'*64
            with self.subTest(change=change), self.assertRaises(ValueError):
                registry.validate_registration(self.registration,inputs,candidate,**args)

    def test_registered_preflight_binds_copy_and_never_simulates(self):
        account=dict(sha256='a'*64,debit_buy_usd_per_lot='9.3',debit_sell_usd_per_lot='-0.31')
        with patch.object(pilot,'observed_account_spec',return_value=account), \
             patch.object(pilot,'inspect_qdm',return_value=(dict(ticks=100,complete_h4=81),[candle(i) for i in range(81)])), \
             patch.object(pilot,'run_scenario') as simulate, redirect_stdout(io.StringIO()):
            pilot.main(self.argv())
        simulate.assert_not_called()
        manifest=json.loads((self.root/'attempt/manifest.json').read_text())
        self.assertEqual(manifest['schema'],registry.HISTORICAL_SCHEMA)
        self.assertFalse(manifest['clean_oos'])
        self.assertEqual(manifest['runtime']['decimal_precision'],28)
        registry.inspect_registered_manifest(manifest,self.root/'attempt')
        self.assertEqual((self.root/'attempt/study-registration.json').read_bytes(),self.registration_path.read_bytes())
        self.assertFalse((self.root/'attempt/results.json').exists())
        for key in ('slippage','calendar','rate','scope'):
            bad=deepcopy(manifest)
            if key=='slippage': bad['scenarios'][0]['slippage']='0.1'
            if key=='calendar': bad['scenarios'][0]['financing_calendar'].pop()
            if key=='rate': bad['scenarios'][0]['financing_calendar'][0]['debit_buy_usd_per_lot']='0'
            if key=='scope': bad['clean_oos']=True
            with self.subTest(key=key),self.assertRaises(ValueError):
                registry.inspect_registered_manifest(bad,self.root/'attempt')

    def test_wrong_protocol_fails_before_any_csv_inspection(self):
        self.protocol.write_text('tampered')
        account=dict(sha256='a'*64,debit_buy_usd_per_lot='9.3',debit_sell_usd_per_lot='-0.31')
        with patch.object(pilot,'observed_account_spec',return_value=account), \
             patch.object(pilot,'inspect_qdm') as inspect, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'protocol'):
                pilot.main(self.argv())
        inspect.assert_not_called()
        self.assertEqual(json.loads((self.root/'attempt/receipt.json').read_text())['stage'],'failed')

    def test_legacy_calendar_registration_cannot_execute_new_runner(self):
        old = deepcopy(self.registration)
        old.pop('calendar_accounting')
        self.registration_path.write_bytes(json.dumps(old).encode())
        self.digest = hashlib.sha256(self.registration_path.read_bytes()).hexdigest()
        with patch.dict(registry.REGISTERED_STUDIES,{self.digest:'fixture'}), \
             patch.object(pilot,'inspect_qdm') as inspect, \
             patch.object(pilot,'run_scenario') as simulate, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'calendar accounting changed'):
                pilot.main(self.argv())
        inspect.assert_not_called()
        simulate.assert_not_called()

    def test_calendar_contract_pins_numerical_cli_and_manifest_semantics(self):
        self.registration['source_files'] = {'scripts/forex_h4_pilot.py':'a'*64}
        with self.assertRaisesRegex(ValueError,'numerical source'):
            registry.validate_registration(self.registration,self.inputs,self.candidate,
                source_files={'scripts/forex_h4_pilot.py':'b'*64})
        # Legacy evidence remains readable under its historical contract.
        old = deepcopy(self.registration)
        old.pop('calendar_accounting')
        registry.validate_registration(old,self.inputs,self.candidate,
            source_files={'scripts/forex_h4_pilot.py':'b'*64})

    def test_reuse_binding_changes_with_runtime_and_registration(self):
        baseline=dict(runtime=dict(python='fixture',pydantic='2',decimal_precision=28))
        self.assertNotEqual(pilot.scenario_binding(baseline),pilot.scenario_binding(dict(
            baseline,runtime=dict(python='fixture',pydantic='3',decimal_precision=28))))
        self.assertNotEqual(pilot.scenario_binding(baseline),pilot.scenario_binding(dict(
            baseline,study_registration=dict(sha256=self.digest))))

    def test_windows_source_paths_match_frozen_posix_pins_without_aliases(self):
        self.registration['source_files']={'trading_workspace_v2/core.py':'a'*64}
        registry.validate_registration(self.registration,self.inputs,self.candidate,
            source_files={'trading_workspace_v2\\core.py':'a'*64})
        for source in ({'trading_workspace_v2\\core.py':'b'*64},
                       {'trading_workspace_v2/core.py':'a'*64,'trading_workspace_v2\\core.py':'a'*64}):
            with self.assertRaises(ValueError):
                registry.validate_registration(self.registration,self.inputs,self.candidate,source_files=source)


if __name__=='__main__':
    unittest.main()
