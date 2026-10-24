"""Fake SDK only: neither imports MetaTrader5 nor launches any terminal."""
import importlib.util
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace as NS
from datetime import datetime,timezone
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('demo', Path(__file__).parents[1] / 'scripts/mt5_demo_trading.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class DemoTradingTests(unittest.TestCase):
    def setUp(self):
        self.policy = dict(enabled=True, mode='demo', workspace_id='tenant-a', terminal_path='C:/DedicatedDemo/terminal64.exe', login='12345', server='Fixture-Demo', symbols=['EURUSD'], max_risk_amount=100, max_risk_pct=2, max_positions=3, max_volume=.5, max_quote_age_ms=2000, deviation_points=5, cost_buffer_per_lot=10, magic=44556)
        self.account = NS(login=12345, server='Fixture-Demo', trade_mode=0, trade_allowed=True, trade_expert=True, currency='USD', balance=10000, equity=10000, margin=0, margin_free=10000, margin_mode=2)
        self.terminal = NS(connected=True, trade_allowed=True, tradeapi_disabled=False, path='C:/DedicatedDemo')
        self.info = NS(visible=True, trade_tick_size=.00001, point=.00001, digits=5, volume_min=.01, volume_max=10., volume_step=.01, trade_stops_level=10, trade_freeze_level=5, filling_mode=3, trade_exemode=2, trade_mode=4, order_mode=1|16|32, trade_calc_mode=0)
        self.tick = NS(bid=1.10000, ask=1.10002, time_msc=int(time.time()*1000))
        self.sdk = Mock()
        self.sdk.account_info.return_value = self.account
        self.sdk.terminal_info.return_value = self.terminal
        self.sdk.symbol_info.return_value = self.info
        self.sdk.symbol_info_tick.return_value = self.tick
        self.sdk.positions_get.return_value = ()
        self.sdk.orders_get.return_value = ()
        self.sdk.order_calc_profit.side_effect = lambda side, symbol, volume, entry, stop: (stop-entry)*100000*volume*(1 if side == 0 else -1)
        self.sdk.order_calc_margin.return_value = 20
        self.sdk.order_check.return_value = NS(retcode=0)
        self.sdk.order_send.return_value = NS(retcode=10009, order=11, deal=12, volume=.1, price=1.10002)
        self.command = dict(request_id='12345678-abcd-4abc-9abc-123456789abc', mode='demo', account_id='12345', server='Fixture-Demo', action='place', symbol='EURUSD', side='BUY', order_type='market', volume=.1, entry_price=None, stop_loss=1.09900, take_profit=1.10200)

    def execute(self, **changes):
        return demo.execute(self.sdk, self.policy, {**self.command, **changes})

    def denied(self, reason, **changes):
        with self.assertRaisesRegex(demo.Denied, reason):
            self.execute(**changes)
        self.sdk.order_send.assert_not_called()

    def test_read_only_snapshot_never_grants_trade_authority_even_with_master_password(self):
        policy=demo.BrokerPolicy(self.policy,read_only=True)
        self.account.leverage=100
        self.account.trade_allowed=False
        self.account.trade_expert=False
        self.terminal.trade_allowed=False
        self.terminal.tradeapi_disabled=True
        self.sdk.copy_rates_from_pos.return_value=[]
        result=demo.snapshot(self.sdk,policy,'EURUSD')
        self.assertEqual(result['account']['balance'],10000)
        self.assertFalse(result['execution_enabled'])
        self.account.trade_allowed=True
        self.account.trade_expert=True
        self.terminal.trade_allowed=True
        self.terminal.tradeapi_disabled=False
        with self.assertRaisesRegex(demo.Denied,'demo_trading_disabled'):
            demo.identity(self.sdk,policy)
        self.sdk.order_send.assert_not_called()
        self.sdk.order_check.assert_not_called()
        self.account.login=999
        with self.assertRaisesRegex(demo.Denied,'demo_identity_changed'):
            demo.snapshot(self.sdk,policy,'EURUSD')

    def test_managed_demo_and_real_use_same_broker_constraints_without_app_caps(self):
        for mode,code in [('demo',0),('real',2)]:
            with self.subTest(mode=mode):
                self.account.trade_mode=code
                self.account.margin_mode=0
                policy=demo.BrokerPolicy(self.policy,mode=mode)
                command={**self.command,'mode':mode,'volume':1.,'stop_loss':None}
                request,preview=demo.prepare(self.sdk,policy,command)
                self.assertEqual(request['volume'],1.)
                self.assertEqual(request['sl'],0.)
                self.assertIsNone(preview['risk_limit'])
                self.assertIsNone(preview['estimated_stop_risk'])
                self.assertIn('commission',preview['risk_estimate_excludes'])
        self.sdk.order_send.assert_not_called()

    def test_snapshot_separates_broker_facts_quote_quality_and_application_policy(self):
        self.account.leverage=100
        self.sdk.copy_rates_from_pos.return_value=[]
        self.tick.time_msc=int(time.time()*1000)-7*3600000
        self.info.trade_mode=3
        result=demo.snapshot(self.sdk,demo.BrokerPolicy(self.policy),'EURUSD')
        self.assertEqual(result['policy']['source'],'application')
        self.assertEqual(result['policy']['profile'],'managed_account')
        self.assertEqual(result['policy']['max_quote_age_ms'],2000)
        self.assertEqual(result['broker_state']['source'],'mt5')
        self.assertEqual(result['broker_state']['symbol']['trade_mode'],3)
        self.assertTrue(result['broker_state']['account']['trade_allowed'])
        self.assertEqual(result['broker_state']['session']['state'],'unknown')
        self.assertEqual(result['data_quality']['source'],'application')
        self.assertEqual(result['data_quality']['quote_source'],'mt5')
        self.assertEqual(result['data_quality']['quote_status'],'stale')
        self.assertTrue(result['execution_enabled'])
        with self.assertRaisesRegex(demo.Denied,'demo_quote_stale'):
            demo.prepare(self.sdk,demo.BrokerPolicy(self.policy),self.command)
        self.sdk.order_send.assert_not_called()
        self.sdk.order_check.assert_not_called()

    def test_broker_closed_market_and_side_restrictions_are_not_inferred_from_quote_age(self):
        for retcode,reason in demo.BROKER_REASONS.items():
            with self.subTest(retcode=retcode):
                self.sdk.order_check.return_value=NS(retcode=retcode)
                with self.assertRaisesRegex(demo.Denied,'^'+reason+'$'):
                    demo.prepare(self.sdk,self.policy,self.command)
                self.sdk.order_send.assert_not_called()
                self.sdk.order_check.return_value=NS(retcode=0)
                self.sdk.order_send.return_value=NS(retcode=retcode)
                result=self.execute()
                self.assertEqual(result['reason'],reason)
                self.assertEqual(result['retcode'],retcode)
                self.assertEqual(result['status'],'rejected')
                self.sdk.order_send.reset_mock()

    def test_managed_connection_revoked_immediately_before_send_never_sends(self):
        policy=demo.BrokerPolicy(self.policy)
        def revoked():
            raise RuntimeError('mt5_connection_revoked')
        with self.assertRaisesRegex(RuntimeError,'mt5_connection_revoked'):
            demo.execute(self.sdk,policy,self.command,revoked)
        self.sdk.order_send.assert_not_called()

    def test_managed_cannot_change_environment_or_broker_volume_grid(self):
        policy=demo.BrokerPolicy(self.policy)
        for command in [{**self.command,'mode':'real'},{**self.command,'volume':10.01},{**self.command,'volume':.015}]:
            with self.assertRaises(demo.Denied):
                demo.prepare(self.sdk,policy,command)
        self.sdk.order_send.assert_not_called()

    def test_managed_netting_and_external_order_cancellation_reconcile(self):
        stamp=int(time.time()*1000);submitted=datetime.fromtimestamp(stamp/1000,timezone.utc).isoformat()
        tag=demo.request_comment(self.command['request_id'])
        deal=NS(ticket=12,order=11,comment=tag,magic=self.policy['magic'],symbol='EURUSD',time_msc=stamp,entry=1,type=0,volume=.1,price=1.1)
        order=NS(ticket=11,comment=tag,magic=self.policy['magic'],symbol='EURUSD',state=4,volume_initial=.1,volume_current=0.)
        self.sdk.history_deals_get.return_value=(deal,);self.sdk.history_orders_get.return_value=(order,)
        policy=demo.BrokerPolicy(self.policy)
        self.assertTrue(demo.reconcile(self.sdk,policy,self.command,submitted,{})['resolved'])
        self.assertFalse(demo.reconcile(self.sdk,self.policy,self.command,submitted,{})['resolved'])
        cancel=NS(ticket=88,symbol='EURUSD',magic=0,state=2,time_done_msc=stamp)
        self.sdk.history_orders_get.return_value=(cancel,)
        command={**self.command,'action':'cancel','ticket':88}
        self.assertTrue(demo.reconcile(self.sdk,policy,command,submitted,{})['resolved'])
        self.assertFalse(demo.reconcile(self.sdk,self.policy,command,submitted,{})['resolved'])
        self.sdk.order_send.assert_not_called()

    def test_no_policy_or_disabled_policy_never_loads_sdk(self):
        loader = Mock(side_effect=AssertionError('SDK must not load'))
        for policy, workspace in [(None, 'tenant-a'), ({**self.policy, 'enabled':False}, 'tenant-a'), (self.policy, 'tenant-b'), ({**self.policy, 'mode':'real'}, 'tenant-a')]:
            with self.assertRaises(demo.Denied):
                demo.run(dict(policy=policy, workspace=workspace, operation='snapshot'), loader)
        loader.assert_not_called()

    def test_policy_requires_limits_and_explicit_cost_buffer(self):
        for field in ('max_risk_amount', 'max_risk_pct', 'max_volume', 'max_quote_age_ms', 'deviation_points', 'cost_buffer_per_lot', 'magic'):
            with self.subTest(field=field):
                policy = self.policy.copy(); policy.pop(field)
                with self.assertRaises(demo.Denied):
                    demo.validate_policy(policy, 'tenant-a', check_path=False)
        for value in (float('nan'), -1, True):
            with self.assertRaises(demo.Denied):
                demo.validate_policy({**self.policy, 'max_risk_amount':value}, 'tenant-a', check_path=False)

    def test_market_uses_fresh_quote_and_actual_broker_risk_margin(self):
        result = self.execute(entry_price=9000)
        self.assertEqual(result['status'], 'filled')
        self.sdk.order_send.assert_called_once()
        request = self.sdk.order_send.call_args.args[0]
        self.assertNotIn('price',request)  # MetaQuotes: omit price for Market Execution.
        self.assertEqual(result['estimate']['entry_price'], self.tick.ask)
        self.assertEqual(request['type_filling'], 0)
        self.assertAlmostEqual(result['estimate']['estimated_stop_risk'], 11.2)
        self.assertEqual(result['estimate']['margin_required'], 20)
        self.sdk.order_calc_profit.assert_called()
        self.sdk.order_calc_margin.assert_called_once()
        self.sdk.order_check.assert_called_once_with(request)

    def test_demo_identity_and_terminal_rechecked_before_send(self):
        for key, value, reason in [('trade_mode', 2, 'demo_account_required'), ('login', 7, 'demo_identity_changed'), ('trade_allowed', False, 'demo_trading_disabled'), ('margin_mode', 0, 'demo_hedging_required')]:
            old=getattr(self.account,key); setattr(self.account,key,value)
            self.denied(reason)
            setattr(self.account,key,old)
        self.terminal.path='C:/Investor'
        self.denied('demo_terminal_identity_changed')

    def test_identity_change_after_order_check_never_sends(self):
        self.sdk.order_check.side_effect=lambda _: (setattr(self.account,'trade_mode',2) or NS(retcode=0))
        self.denied('demo_account_required')

    def test_price_or_staleness_changed_after_check_never_sends(self):
        self.sdk.order_check.side_effect=lambda _: (setattr(self.tick,'ask',1.10003) or NS(retcode=0))
        self.denied('demo_quote_changed_preview_again')
        self.sdk.order_check.side_effect=None
        self.tick.time_msc-=6000
        self.denied('demo_quote_stale')

    def test_volume_tick_stop_target_and_symbol_constraints(self):
        for reason, changes in [('demo_symbol_denied',dict(symbol='XAUUSD')), ('demo_volume_step_or_limit',dict(volume=.015)), ('demo_volume_step_or_limit',dict(volume=.6)), ('demo_stop_required',dict(stop_loss=None)), ('demo_price_step',dict(stop_loss=1.099001)), ('demo_stop_direction_or_distance',dict(stop_loss=1.101)), ('demo_target_direction_or_distance',dict(take_profit=1.099)), ('demo_order_type_unsupported',dict(order_type='limit'))]:
            with self.subTest(changes=changes): self.denied(reason,**changes)
        self.execute(side='SELL',stop_loss=1.102,take_profit=1.099)

    def position(self, **changes):
        return NS(ticket=77,symbol='EURUSD',type=0,magic=self.policy['magic'],volume=.1,price_open=1.10002,sl=1.099,tp=1.102,profit=0,**changes)

    def test_existing_unbounded_risk_position_limit_and_margin_block(self):
        p=self.position(); p.sl=0
        self.sdk.positions_get.return_value=(p,)
        self.denied('demo_existing_risk_unknown')
        p.sl=1.08
        self.denied('demo_risk_limit')
        self.sdk.positions_get.return_value=(p,p,p)
        self.denied('demo_position_limit')
        self.sdk.positions_get.return_value=()
        self.sdk.order_calc_margin.return_value=20000
        self.denied('demo_margin_insufficient')

    def test_equity_risk_reserves_downside_from_current_quote(self):
        p=self.position(); p.price_open=1.09; p.sl=1.099
        self.sdk.positions_get.return_value=(p,)
        request,preview=demo.prepare(self.sdk,self.policy,self.command)
        # Prior profitable SL still gives up $10 floating equity before stopping.
        self.assertAlmostEqual(preview['total_stop_risk'],22.2)

    def test_order_check_rejected_and_no_retries_on_ambiguous_send(self):
        self.sdk.order_check.return_value=NS(retcode=10016)
        self.denied('demo_order_check_rejected')
        self.sdk.order_check.return_value=NS(retcode=0)
        for result in (None,NS(retcode=10012),NS(retcode=10031),NS(retcode=90000)):
            self.sdk.order_send.reset_mock(); self.sdk.order_send.return_value=result
            self.assertEqual(self.execute()['status'],'unknown')
            self.sdk.order_send.assert_called_once()
        self.sdk.order_send.reset_mock(); self.sdk.order_send.side_effect=OSError('private SDK error')
        self.assertEqual(self.execute(),dict(status='unknown',reason='demo_send_outcome_unknown'))
        self.sdk.order_send.assert_called_once()

    def test_managed_full_close_protect_and_cancel(self):
        p=self.position(); self.sdk.positions_get.return_value=(p,)
        self.execute(action='close',ticket=77,volume=None)
        request=self.sdk.order_send.call_args.args[0]
        self.assertEqual((request['action'],request['position'],request['type'],request['volume']),(1,77,1,.1))
        self.sdk.order_send.reset_mock()
        self.denied('demo_partial_close_unsupported',action='close',ticket=77,volume=.05)
        self.execute(action='protect',ticket=77,stop_loss=1.09950)
        self.assertEqual(self.sdk.order_send.call_args.args[0]['action'],6)
        self.sdk.order_send.reset_mock()
        p.magic=1
        self.denied('demo_ticket_not_managed',action='close',ticket=77)
        order=NS(ticket=88,symbol='EURUSD',magic=self.policy['magic'],price_open=1.09)
        self.sdk.orders_get.return_value=(order,)
        self.execute(action='cancel',ticket=88)
        self.assertEqual(self.sdk.order_send.call_args.args[0]['action'],8)

    def test_filling_bitmask_and_freeze_level(self):
        self.info.filling_mode=2
        self.assertEqual(demo.filling(self.info),1)
        self.info.filling_mode=0
        self.denied('demo_filling_unsupported')
        self.info.filling_mode=1
        p=self.position(); p.sl=1.09999
        self.sdk.positions_get.return_value=(p,)
        self.denied('demo_frozen',action='protect',ticket=77)

    def test_snapshot_is_real_sdk_data_and_no_send(self):
        self.sdk.copy_rates_from_pos.return_value=[dict(time=1700000000,open=1.1,high=1.2,low=1.,close=1.15,tick_volume=10)]
        result=demo.snapshot(self.sdk,self.policy,'EURUSD')
        self.assertEqual(result['status'],'ready')
        self.assertEqual(result['account']['login'],'12345')
        self.assertEqual(result['bars'][0]['volume'],10)
        self.assertEqual(result['quote']['time_msc'],self.tick.time_msc)
        self.assertEqual(result['policy']['max_quote_age_ms'],2000)
        self.sdk.order_send.assert_not_called()

    def test_timeframes_and_comment_encode_full_request_id(self):
        self.sdk.copy_rates_from_pos.return_value=[]
        for tf in ('M1','M5','M15','H1','H4','D1'):
            self.assertEqual(demo.snapshot(self.sdk,self.policy,'EURUSD',tf)['timeframe'],tf)
            self.assertEqual(self.sdk.copy_rates_from_pos.call_args.args[1],getattr(self.sdk,'TIMEFRAME_'+tf))
        tag=demo.request_comment(self.command['request_id'])
        self.assertEqual(len(tag),25)
        import base64,uuid
        self.assertEqual(uuid.UUID(bytes=base64.urlsafe_b64decode(tag[3:]+'==')),uuid.UUID(self.command['request_id']))

    def test_policy_revoked_during_validation_never_sends(self):
        with self.assertRaisesRegex(demo.Denied,'demo_policy_changed'):
            demo.execute(self.sdk,self.policy,self.command,lambda:demo.deny('demo_policy_changed'))
        self.sdk.order_send.assert_not_called()

    def test_reconcile_full_fill_and_partial_final_without_send(self):
        tag=demo.request_comment(self.command['request_id']); timestamp=int(time.time()*1000)
        submitted=datetime.fromtimestamp(timestamp/1000,timezone.utc).isoformat()
        deal=NS(ticket=91,order=92,position_id=93,comment=tag,magic=self.policy['magic'],symbol='EURUSD',entry=0,type=0,time_msc=timestamp,volume=.1,price=1.10002)
        order=NS(ticket=92,comment=tag,magic=self.policy['magic'],symbol='EURUSD',state=4,volume_initial=.1,volume_current=0)
        self.sdk.history_deals_get.return_value=(deal,)
        self.sdk.history_orders_get.return_value=(order,)
        result=demo.reconcile(self.sdk,self.policy,self.command,submitted,{})
        self.assertTrue(result['resolved']); self.assertEqual(result['volume'],.1)
        deal.volume=.05; order.state=2; order.volume_current=.05
        result=demo.reconcile(self.sdk,self.policy,self.command,submitted,{})
        self.assertTrue(result['resolved']); self.assertEqual(result['reason'],'demo_reconciled_partial_final')
        self.sdk.order_send.assert_not_called(); self.sdk.order_check.assert_not_called()

    def test_reconcile_missing_tag_active_order_or_mismatched_account_preserves_unknown(self):
        submitted=datetime.now(timezone.utc).isoformat()
        self.sdk.history_deals_get.return_value=()
        self.assertFalse(demo.reconcile(self.sdk,self.policy,self.command,submitted,{})['resolved'])
        order=NS(comment=demo.request_comment(self.command['request_id']),magic=self.policy['magic'])
        self.sdk.orders_get.return_value=(order,)
        self.assertEqual(demo.reconcile(self.sdk,self.policy,self.command,submitted,{})['reason'],'demo_reconciliation_still_active')
        self.account.trade_mode=2
        with self.assertRaisesRegex(demo.Denied,'demo_account_required'):
            demo.reconcile(self.sdk,self.policy,self.command,submitted,{})
        self.sdk.order_send.assert_not_called()

    def test_reconcile_protection_and_cancel_require_exact_managed_state(self):
        stamp=int(time.time()*1000); submitted=datetime.fromtimestamp(stamp/1000,timezone.utc).isoformat()
        p=self.position(); p.time_update_msc=stamp; self.sdk.positions_get.return_value=(p,)
        command={**self.command,'action':'protect','ticket':77}
        self.assertTrue(demo.reconcile(self.sdk,self.policy,command,submitted,{})['resolved'])
        p.sl=1.08
        self.assertFalse(demo.reconcile(self.sdk,self.policy,command,submitted,{})['resolved'])
        order=NS(ticket=88,symbol='EURUSD',magic=self.policy['magic'],state=2,time_done_msc=stamp)
        self.sdk.history_orders_get.return_value=(order,)
        command={**self.command,'action':'cancel','ticket':88}
        self.assertTrue(demo.reconcile(self.sdk,self.policy,command,submitted,{})['resolved'])
        order.state=4
        self.assertFalse(demo.reconcile(self.sdk,self.policy,command,submitted,{})['resolved'])
        self.sdk.order_send.assert_not_called()


if __name__=='__main__': unittest.main()
