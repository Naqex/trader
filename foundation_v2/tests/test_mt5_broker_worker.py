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
