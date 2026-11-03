"""Worker authority and session protocol using synthetic SDK/DB only."""
import importlib.util
import copy
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
import uuid
from datetime import datetime,timezone,timedelta
from decimal import Decimal

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
        def snapshot(sdk,policy,symbol,timeframe,bar_count):
            self.assertIs(policy['read_only'],True)
            self.assertEqual(bar_count,300)
            return {'execution_enabled':False,'account':{}}
        with patch.object(worker.trading,'snapshot',side_effect=snapshot):
            result=session.handle(request)
        self.assertFalse(result['execution_enabled'])
        self.assertEqual(result['verified_permissions'],{'read':True,'trade':False})
        session.sdk.order_check.assert_not_called()
        session.sdk.order_send.assert_not_called()

    def test_catalog_is_read_only_preserves_broker_metadata_and_checks_revocation(self):
        session=self.session()
        session.context['requested_mode']='read_only'
        request={**self.request,'requested_mode':'read_only','operation':'symbols'}
        session.sdk.symbols_get.return_value=(NS(name='ODD_SYMBOL',category='Crypto',path='CFD\\Crypto',description='Bitcoin',currency_base='BTC',currency_profit='USD',trade_mode=4,trade_calc_mode=2,swap_long=float('nan')), NS(name='DISABLED',trade_mode=0))
        result=session.handle(request)
        self.assertEqual([s['symbol'] for s in result['items']],['DISABLED','ODD_SYMBOL'])
        self.assertEqual(result['items'][1]['category'],'Crypto')
        self.assertNotIn('swap_long',result['items'][1])
        self.assertEqual(session.guard.call_count,2)
        session.sdk.symbol_select.assert_not_called()
        session.sdk.symbol_info_tick.assert_not_called()
        session.sdk.order_check.assert_not_called()
        session.sdk.order_send.assert_not_called()
        session.guard.side_effect=[None,RuntimeError('mt5_connection_revoked')]
        with self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
            session.handle(request)

    def test_catalog_failure_is_not_an_empty_success(self):
        session=self.session()
        session.sdk.symbols_get.return_value=None
        with self.assertRaisesRegex(RuntimeError,'demo_symbol_unavailable'):
            session.handle({**self.request,'operation':'symbols'})
        session.sdk.symbols_get.return_value=tuple(NS(name=str(i),description='x'*512,path='x'*512,category='x'*512,currency_base='x'*512,currency_profit='x'*512,currency_margin='x'*512) for i in range(1000))
        with self.assertRaisesRegex(RuntimeError,'demo_catalog_too_large'):
            session.handle({**self.request,'operation':'symbols'})

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


    def grant_fixture(self):
        expiry=datetime.now(timezone.utc)+timedelta(minutes=5)
        policy=dict(connection_id=self.request['connection_id'],connection_generation=3,
            login='123',server='Fixture',environment='demo',account_currency='USD',artifact_sha256='a'*64,
            symbols=['EURUSD'],actions=['place','close'],expires_at=expiry.isoformat(),
            max_risk_amount='25',max_risk_pct='2',max_aggregate_risk_amount='100',max_volume='0.5',
            max_positions=3,max_attempts=10,session_equity_floor='9500',free_margin_floor='100',
            cost_buffer_per_lot='10',max_quote_age_ms=2000,max_spread_points='10',deviation_points=5)
        digest=hashlib.sha256(json.dumps(policy,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        credential_id=uuid.uuid4()
        context=dict(grant_id=str(uuid.uuid4()),credential_id=str(credential_id),policy_sha256=digest,artifact_sha256='a'*64)
        command=dict(request_id=str(uuid.uuid4()),action='place',mode='demo',account_id='123',server='Fixture',
            symbol='EURUSD',side='BUY',order_type='market',volume=.1,stop_loss=1.099)
        request={**self.request,'operation':'command','automation':context,'command':command}
        row=dict(policy_sha256=digest,policy=policy,status='active',expires_at=expiry,
            approved_at=datetime.now(timezone.utc)-timedelta(minutes=1),approved_by='owner-fixture',
            terminal_key=hashlib.sha256(f"mt5-managed:{self.request['workspace']}:{self.request['connection_id']}".encode()).hexdigest(),
            grant_credential_id=credential_id,request_credential_id=credential_id,request_policy_sha256=digest,
            risk_reserved=Decimal('25'),reserved_total=Decimal('25'),command_body=command,request_status='unknown',
            attempts=1,paused=False,unresolved=False)
        row.update(request_terminal_key=row['terminal_key'],request_fingerprint='f'*64,receipt_fingerprint='f'*64)
        return request,row

    def grant_db(self,row):
        db=Mock()
        db.__enter__=Mock(return_value=db);db.__exit__=Mock(return_value=False)
        db.execute.return_value.fetchone.return_value=row
        db.execute.return_value.fetchall.return_value=[{'opening_order':'17'}]
        return db

    def test_native_grant_reader_binds_receipt_scope_hash_counters_and_unknown_state(self):
        import psycopg
        request,row=self.grant_fixture()
        db=self.grant_db(row)
        secret={'login':'123','server':'Fixture'}
        with patch.dict(os.environ,TW_V2_DATABASE_URL='fixture-not-real'),patch.object(psycopg,'connect',return_value=db):
            self.assertEqual(worker.automation_grant(request,secret)['owned_order_ids'],[17])
            self.assertEqual(db.execute.call_args_list[0].args[1],
                ('fixture',uuid.UUID(request['automation']['grant_id']),uuid.UUID(request['command']['request_id'])))
            mutations=[None,{'status':'revoked'},{'paused':True},{'paused':None},{'unresolved':True},
                {'attempts':11},{'reserved_total':Decimal('101')},{'risk_reserved':Decimal(0)},
                {'request_status':'filled'},{'request_credential_id':uuid.uuid4()},
                {'grant_credential_id':uuid.uuid4()},{'request_policy_sha256':'0'*64},
                {'terminal_key':'wrong-terminal'}, {'command_body':{**request['command'],'volume':.2}},
                {'request_terminal_key':'other-receipt-terminal'},{'receipt_fingerprint':'e'*64},
                {'approved_at':datetime.now(timezone.utc)+timedelta(hours=1)}]
            for changes in mutations:
                db.execute.return_value.fetchone.return_value=None if changes is None else {**row,**changes}
                with self.subTest(changes=changes),self.assertRaisesRegex(worker.trading.Denied,'grant_denied'):
                    worker.automation_grant(request,secret)
            db.execute.return_value.fetchone.return_value=row
            for changes in ({'workspace':'other'},{'generation':4},
                {'automation':{**request['automation'],'artifact_sha256':'0'*64}},
                {'automation':{**request['automation'],'policy_sha256':'0'*64}},
                {'automation':{}}, {'operation':'snapshot'}):
                with self.subTest(request_changes=changes),self.assertRaisesRegex(worker.trading.Denied,'grant_denied'):
                    worker.automation_grant({**request,**changes},secret)
            changed=copy.deepcopy(row);changed['policy']['max_volume']='1'
            db.execute.return_value.fetchone.return_value=changed
            with self.assertRaisesRegex(worker.trading.Denied,'grant_denied'):
                worker.automation_grant(request,secret)

    def test_revoked_expired_grant_can_only_reconcile_and_never_reopen_admission(self):
        import psycopg
        request,row=self.grant_fixture()
        row['expires_at']=datetime.now(timezone.utc)-timedelta(seconds=1)
        row['policy']['expires_at']=row['expires_at'].isoformat()
        digest=hashlib.sha256(json.dumps(row['policy'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        request['automation']['policy_sha256']=digest
        row.update(policy_sha256=digest,request_policy_sha256=digest,status='revoked',request_status='filled')
        db=self.grant_db(row)
        with patch.dict(os.environ,TW_V2_DATABASE_URL='fixture-not-real'),patch.object(psycopg,'connect',return_value=db):
            with self.assertRaises(worker.trading.Denied):
                worker.automation_grant(request,{'login':'123','server':'Fixture'})
            result=worker.automation_grant({**request,'operation':'reconcile'},{'login':'123','server':'Fixture'})
            self.assertEqual(result['owned_order_ids'],[17])

    def test_worker_constructs_native_automation_policy_and_rechecks_grant_at_send_fence(self):
        request,row=self.grant_fixture()
        session=self.session()
        evidence=dict(policy=row['policy'],owned_order_ids=[17],risk_reserved=Decimal('25'))
        def execute(sdk,policy,command,before_send):
            self.assertIsInstance(policy,worker.trading.AutomationBrokerPolicy)
            self.assertEqual(policy['max_risk_amount'],25)
            self.assertEqual(policy['owned_order_ids'],frozenset({17}))
            before_send()
            return {'status':'filled','order':17}
        with patch.object(worker,'automation_grant',side_effect=[evidence,worker.trading.Denied('demo_automation_grant_denied')]) as grant,patch.object(worker.trading,'execute',side_effect=execute):
            with self.assertRaisesRegex(worker.trading.Denied,'grant_denied'):
                session.handle(request)
            self.assertEqual(grant.call_count,2)
        session.sdk.order_send.assert_not_called()
        session.sdk.order_check.assert_not_called()
        with patch.object(worker,'automation_grant',return_value=evidence),patch.object(worker.trading,'execute',side_effect=execute):
            self.assertEqual(session.handle(request),{'status':'filled','order':17})


if __name__=='__main__':
    unittest.main()
