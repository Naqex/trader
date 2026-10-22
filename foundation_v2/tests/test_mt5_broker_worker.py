"""Worker authority and session protocol using synthetic SDK/DB only."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
import uuid

spec = importlib.util.spec_from_file_location('broker_worker', Path(__file__).parents[1]/'scripts/mt5_broker_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.request = dict(workspace='fixture',connection_id=str(uuid.uuid4()),generation=3,credential='ciphertext',root='C:/owned',requested_mode='trading',operation='collect')

    def test_db_fence_rejects_revocation_credential_change_and_wrong_scope(self):
        import psycopg
        db = Mock()
        db.__enter__ = Mock(return_value=db)
        db.__exit__ = Mock(return_value=False)
        with patch.dict(os.environ,TW_V2_DATABASE_URL='fixture-not-a-real-connection'),patch.object(psycopg,'connect',return_value=db):
            valid=(3,'trading','connected','ciphertext')
            for row in (None,(4,*valid[1:]),(3,'read_only',*valid[2:]),(3,'trading','paused','ciphertext'),(3,'trading','connected','changed')):
                db.execute.return_value.fetchone.return_value=row
                with self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
                    worker.fence(self.request,'command')
            db.execute.return_value.fetchone.return_value=valid
            worker.fence(self.request,'command')
            self.assertEqual(db.execute.call_args.args[1],('fixture',self.request['connection_id']))
            db.execute.return_value.fetchone.return_value=(3,'trading','syncing','ciphertext')
            worker.fence(self.request,'collect')
            with self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
                worker.fence(self.request,'command')

    def session(self):
        session=worker.Session.__new__(worker.Session)
        session.context={k:v for k,v in self.request.items() if k!='operation'}
        session.guard=Mock()
        session.check_identity=Mock(return_value=NS(trade_mode=0))
        session.sdk=Mock()
        session.sdk.symbols_get.return_value=(NS(name='EURUSD',trade_mode=4,visible=True),)
        session.secret={'login':'123','server':'Fixture','password':'fixture-only'}
        session.terminal=Path('C:/owned/terminal64.exe')
        return session

    def test_read_only_fence_allows_collection_but_never_execution(self):
        import psycopg
        db = Mock()
        db.__enter__ = Mock(return_value=db)
        db.__exit__ = Mock(return_value=False)
        request = {**self.request, 'requested_mode':'read_only'}
        with patch.dict(os.environ,TW_V2_DATABASE_URL='fixture-not-a-real-connection'),patch.object(psycopg,'connect',return_value=db):
            db.execute.return_value.fetchone.return_value=(3,'read_only','connected','ciphertext')
            worker.fence(request,'collect')
            worker.fence(request,'health')
            worker.fence(request,'snapshot')
            for operation in ('preview','command','reconcile'):
                with self.subTest(operation=operation),self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
                    worker.fence(request,operation)
            for row in ((3,'trading','connected','ciphertext'),(4,'read_only','connected','ciphertext'),(3,'read_only','paused','ciphertext')):
                db.execute.return_value.fetchone.return_value=row
                with self.subTest(row=row),self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
                    worker.fence(request,'collect')

    def test_read_only_terminal_authenticates_once_and_stays_warm_without_trade_permissions(self):
        request={**self.request,'credential':'e30=','requested_mode':'read_only','from_utc':'2026-10-22T00:00:00Z','history_from_utc':'2026-10-22T00:00:00Z'}
        terminal=Path('C:/owned/terminal64.exe')
        sdk=Mock()
        sdk.account_info.return_value=NS(login=123,server='Fixture',trade_allowed=False,trade_expert=False)
        sdk.terminal_info.return_value=NS(connected=True,path=str(terminal.parent),data_path=str(terminal.parent),trade_allowed=False,tradeapi_disabled=True)
        secret=b'{"login":"123","server":"Fixture","password":"fixture-only"}'
        with patch.object(worker.connector,'protect',return_value=secret),patch.object(worker.connector,'prepare_terminal',return_value=(terminal,Path('C:/owned/connector.ini'))) as prepare,patch.object(worker.subprocess,'Popen') as process,patch.object(worker.connector,'snapshot',return_value={'verified_permissions':{'read':True,'trade':False}}) as snapshot:
            session=worker.Session(request,guard=Mock(),sdk_loader=lambda:sdk)
            self.assertFalse(session.handle(request)['verified_permissions']['trade'])
            session.handle(request)
            self.assertEqual(session.handle({**request,'operation':'health'}),{'status':'ready','connected':True})
            prepare.assert_called_once_with(request['root'],request['connection_id'],trading=False)
            sdk.initialize.assert_called_once()
            self.assertEqual(snapshot.call_count,2)
            self.assertEqual(snapshot.call_args.args[-2:],('read_only',3))
            for operation in ('preview','command','reconcile'):
                with self.subTest(operation=operation),self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
                    session.handle({**request,'operation':operation})
            sdk.symbols_get.assert_not_called()
            sdk.order_send.assert_not_called()
            sdk.shutdown.assert_not_called()
            process.return_value.terminate.assert_not_called()

    def test_read_only_chart_snapshot_keeps_execution_disabled(self):
        session=self.session()
        session.context['requested_mode']='read_only'
        request={**self.request,'requested_mode':'read_only','operation':'snapshot'}
        def snapshot(sdk,policy,symbol,timeframe):
            self.assertIs(policy['read_only'],True)
            return {'execution_enabled':False,'account':{}}
        with patch.object(worker.trading,'snapshot',side_effect=snapshot):
            result=session.handle(request)
        self.assertFalse(result['execution_enabled'])
        self.assertEqual(result['verified_permissions'],{'read':True,'trade':False})
        session.sdk.order_check.assert_not_called()
        session.sdk.order_send.assert_not_called()

    def test_identity_distinguishes_stopped_terminal_from_network_disconnect(self):
        session=self.session()
        session.context['requested_mode']='read_only'
        session.process=Mock()
        session.process.poll.return_value=None
        with patch.object(worker.connector,'verify_identity',side_effect=RuntimeError('mt5_disconnected')):
            with self.assertRaisesRegex(RuntimeError,'^mt5_disconnected$'):
                worker.Session.check_identity(session)
            session.process.poll.return_value=0
            with self.assertRaisesRegex(RuntimeError,'^mt5_terminal_stopped$'):
                worker.Session.check_identity(session)

    def test_session_rejects_changed_generation_before_sdk(self):
        session=self.session()
        with self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
            session.handle({**self.request,'generation':4,'operation':'snapshot'})
        session.sdk.symbols_get.assert_not_called()

    def test_command_keeps_broker_result_when_revoked_after_send(self):
        session=self.session()
        # First gate and immediate before-send gate pass. A third post-send gate
        # would wrongly turn a broker fill into a safely retryable rejection.
        session.guard.side_effect=[None,None,RuntimeError('mt5_connection_revoked')]
        def execute(sdk,policy,command,before_send):
            before_send()
            return {'status':'filled','order':17}
        with patch.object(worker.trading,'execute',side_effect=execute):
            result=session.handle({**self.request,'operation':'command','command':{}})
        self.assertEqual(result['status'],'filled')
        self.assertEqual(session.guard.call_count,2)

    def test_collect_keeps_generation_binding_and_same_warm_session(self):
        session=self.session()
        request={**self.request,'from_utc':'2026-10-22T00:00:00Z','history_from_utc':'2026-10-22T00:00:00Z'}
        with patch.object(worker.connector,'snapshot',return_value={'status':'ready'}) as snapshot:
            session.handle(request)
            session.handle(request)
        self.assertEqual(snapshot.call_count,2)
        self.assertEqual(snapshot.call_args.args[-2:],('trading',3))
        session.sdk.initialize.assert_not_called()


if __name__=='__main__':
    unittest.main()
