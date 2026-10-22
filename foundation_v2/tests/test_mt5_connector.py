"""Synthetic SDK fixtures; never authorize or log into a broker."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
from datetime import datetime, timedelta, timezone
import tempfile
import unittest
from unittest.mock import Mock, patch
import uuid

spec=importlib.util.spec_from_file_location('connector',Path(__file__).parents[1]/'scripts/mt5_connector.py')
connector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(connector)

class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.secret={'login':'1234567','server':'Fixture-Demo','password':'fixture-only'}
        self.account=NS(login=1234567,server='Fixture-Demo',trade_allowed=False,trade_mode=0,currency='USD',balance=1000,equity=1000,profit=0,margin=0,margin_free=1000,leverage=100)
        self.sdk=Mock()
        self.sdk.account_info.return_value=self.account
        self.sdk.terminal_info.return_value=NS(connected=True)
        self.sdk.positions_get.return_value=()
        self.sdk.orders_get.return_value=()
        self.sdk.history_deals_get.return_value=()

    def read(self):
        return connector.snapshot(self.sdk,self.secret,datetime.now(timezone.utc)-timedelta(days=65),'2026-01-01T00:00:00Z')

    def test_empty_is_known_and_no_execution_or_secret(self):
        result=self.read()
        self.assertEqual(result['deals'],[])
        self.assertEqual(result['cashflows'],[])
        self.assertEqual(result['account']['account_ref'],'…4567')
        self.assertFalse(result['execution_capability'])
        self.assertNotIn('password',str(result))
        self.assertNotIn('login',result['account'])
        self.sdk.order_send.assert_not_called()
        self.sdk.order_check.assert_not_called()
        self.assertEqual(self.sdk.history_deals_get.call_count,3)

    def test_reject_trade_permission_and_identity_change(self):
        self.account.trade_allowed=True
        with self.assertRaisesRegex(RuntimeError,'mt5_investor_required'):self.read()
        self.account.trade_allowed=False
        self.sdk.account_info.side_effect=[self.account,NS(login=7,server='Fixture-Demo')]
        with self.assertRaisesRegex(RuntimeError,'mt5_identity_changed'):self.read()

    def test_initialize_errors_distinguish_auth_ipc_timeout_and_unknown(self):
        cases = {-6:'mt5_auth_failed', -10005:'mt5_sync_timeout',
                 -5:'mt5_version_unsupported', -1:'mt5_initialization_failed',
                 -10000:'mt5_terminal_unavailable', -10001:'mt5_terminal_unavailable',
                 -10002:'mt5_terminal_unavailable', -10003:'mt5_terminal_unavailable'}
        for code, expected in cases.items():
            with self.subTest(code=code):
                self.sdk.last_error.return_value=(code,'sensitive fixture description')
                self.assertEqual(connector.initialization_error(self.sdk),expected)
                self.assertIn(expected,connector.ERRORS)
        for malformed in (None, (), {}, 'unexpected'):
            self.sdk.last_error.return_value=malformed
            self.assertEqual(connector.initialization_error(self.sdk),'mt5_initialization_failed')
        self.sdk.last_error.side_effect=RuntimeError('sensitive fixture exception')
        self.assertEqual(connector.initialization_error(self.sdk),'mt5_initialization_failed')

    def test_incomplete_history_never_becomes_empty_success(self):
        self.sdk.history_deals_get.return_value=None
        with self.assertRaisesRegex(RuntimeError,'mt5_history_failed'):self.read()

    def test_cashflow_and_costs_keep_signed_numbers_and_deduplicate(self):
        tick=int((datetime.now(timezone.utc)-timedelta(days=1)).timestamp()*1000)
        deal=dict(ticket=1,order=3,position_id=9,symbol='EURUSD',type=1,entry=1,volume=.1,price=1.1,profit=-10,commission=-.5,swap=-1,fee=-.1,time_msc=tick)
        cash={**deal,'ticket':2,'type':2,'profit':1000}
        self.sdk.history_deals_get.return_value=(NS(**deal),NS(**cash))
        result=self.read()
        self.assertEqual(len(result['deals']),1)
        self.assertEqual(result['deals'][0]['profit'],-10)
        self.assertEqual(result['cashflows'][0]['profit'],1000)

    def test_dpapi_roundtrip_and_scope_binding(self):
        sealed=connector.protect(b'fixture-secret','workspace:a:connection:1')
        self.assertNotIn(b'fixture-secret',sealed)
        self.assertEqual(connector.protect(sealed,'workspace:a:connection:1',True),b'fixture-secret')
        with self.assertRaisesRegex(RuntimeError,'mt5_secret_unavailable'):
            connector.protect(sealed,'workspace:b:connection:1',True)

    def test_cleanup_and_private_directory_preserve_only_owned_binary(self):
        with tempfile.TemporaryDirectory(prefix='mt5-connector-') as temp:
            root=Path(temp)/'private'
            source=Path(temp)/'source/terminal64.exe';source.parent.mkdir();source.write_bytes(b'fixture binary')
            connection=str(uuid.uuid4())
            with patch.object(connector,'terminal_source',return_value=source):
                target,_=connector.prepare_terminal(root,connection)
                (Path(temp)/'api-rust').mkdir()
                # Matches CARGO_MANIFEST_DIR/../.runtime used by the native owner.
                alternate=Path(temp)/'api-rust/../private'
                again,_=connector.prepare_terminal(alternate,connection)
                self.assertEqual(target,again)
            (target.parent/'Config/accounts.dat').write_text('synthetic account file')
            (target.parent/'Logs').mkdir();(target.parent/'Logs/log').write_text('fixture')
            connector.clean_terminal(root,connection)
            self.assertEqual([p.name for p in target.parent.iterdir()],['terminal64.exe'])
            self.assertEqual(target.read_bytes(),b'fixture binary')

    def test_junction_cleanup_fails_closed_and_preserves_external_files(self):
        import subprocess
        with tempfile.TemporaryDirectory(prefix='mt5-junction-') as temp:
            root=Path(temp)/'root';folder=root/str(uuid.uuid4());folder.mkdir(parents=True)
            outside=Path(temp)/'outside';outside.mkdir();file=outside/'accounts.dat';file.write_text('preserve')
            junction=folder/'Config'
            subprocess.run(['cmd','/c','mklink','/J',str(junction),str(outside)],check=True,capture_output=True)
            try:
                with self.assertRaisesRegex(RuntimeError,'mt5_terminal_isolation_failed'):
                    connector.clean_terminal(root,folder.name)
                self.assertEqual(file.read_text(),'preserve')
            finally:junction.rmdir()

    def test_collect_uses_explicit_portable_terminal_and_cleans_failed_login(self):
        import base64
        import json
        with tempfile.TemporaryDirectory(prefix='mt5-run-') as temp:
            root=Path(temp)/'private';folder=root/str(uuid.uuid4());folder.mkdir(parents=True)
            binary=folder/'terminal64.exe';binary.write_bytes(b'fixture')
            (folder/'Config').mkdir();(folder/'Config/accounts.dat').write_text('fixture session')
            config=folder/'connector.ini';config.write_text('fixture config')
            request={'action':'collect','root':str(root),'workspace':'fixture','connection_id':folder.name,'from_utc':'2026-10-01T00:00:00Z','history_from_utc':'2026-10-01T00:00:00Z'}
            request['credential']=base64.b64encode(connector.protect(json.dumps(self.secret).encode(),connector.entropy(request))).decode()
            self.sdk.initialize.return_value=False
            self.sdk.last_error.return_value=(-6,'sensitive fixture description')
            process=Mock();process.poll.return_value=None
            with patch.dict('sys.modules',MetaTrader5=self.sdk),patch.object(connector,'prepare_terminal',return_value=(binary,config)),patch.object(connector.subprocess,'Popen',return_value=process) as spawn,patch.object(connector.time,'sleep'):
                with self.assertRaisesRegex(RuntimeError,'mt5_auth_failed'):connector.run(request)
                self.sdk.initialize.assert_called_once_with(str(binary),login=1234567,password='fixture-only',server='Fixture-Demo',timeout=20000,portable=True)
                self.assertNotIn('fixture-only',str(spawn.call_args))
                process.terminate.assert_called_once();self.sdk.shutdown.assert_called_once()
                self.assertEqual([p.name for p in folder.iterdir()],['terminal64.exe'])

if __name__=='__main__':unittest.main()
