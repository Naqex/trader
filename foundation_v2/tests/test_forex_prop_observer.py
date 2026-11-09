from datetime import datetime, timezone
from decimal import Decimal as D
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[1]/'scripts')]
from trading_workspace_v2.forex_prop_observer import ForexPropObserver
from trading_workspace_v2.forex_pilot_risk import advance_forex_pilot, initialize_forex_pilot
from trading_workspace_v2.replay_tick_execution import BrokerReplayTick
from test_forex_pilot_risk import execution, ms, tick, queue
import forex_h4_pilot as pilot


def timestamp(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()*1000)


def profile(*, days=1, targets=('10','5')):
    return dict(profile_id='static-usd-fixture',terms_version='fixture-not-firm-terms',
        profile_hash='fixture-profile-v1',effective_from='2026-11-06',source_kind='custom',
        phases=[dict(phase_index=i,initial_capital='10000',currency='USD',
            profit_target=dict(threshold=dict(amount=target),basis='balance',comparator='gte'),
            daily_loss=dict(threshold=dict(amount='500'),basis='equity',comparator='lt'),
            daily_anchor_basis='balance',
            overall_drawdown=dict(threshold=dict(amount='1000'),basis='equity',comparator='lt',kind='static'),
            reset_timezone='Europe/Prague',reset_order='reset_then_fees',min_qualifying_days=days,
            carry_policy='reset',position_policy='must_be_flat') for i,target in enumerate(targets,1)])


def observation(start=None, **kwargs):
    start = ms() if start is None else start
    return ForexPropObserver(profile(**kwargs),start=start,end=start+400*86400000,identity='fixture')


def quote(observer, offset, balance='10000', floating='0', position=None, pending=0):
    observer.quote(SimpleNamespace(time_msc=observer.start+offset),D(balance),D(floating),
        SimpleNamespace(position_id=position) if position else None,pending,completed=True)


class PropObservationTests(unittest.TestCase):
    def test_intrabar_peak_trough_and_recovery_do_not_disappear_at_close(self):
        p = observation()
        quote(p,1,floating='100',position='p')
        quote(p,2,floating='-300',position='p')
        quote(p,3,floating='50',position='p')
        self.assertEqual(p.path['maximum_drawdown'],D('400'))
        self.assertEqual(p.path['minimum_equity'],D('9700'))
        self.assertEqual(p.path['minimum_daily_headroom'],D('200'))
        self.assertEqual(p.observed_ticks,3)

    def test_exact_loss_floor_is_allowed_but_first_breach_latches_after_recovery(self):
        p = observation()
        quote(p,1,floating='-500',position='p')
        self.assertTrue(p.running)
        quote(p,2,floating='-501',position='p')
        quote(p,3,floating='0',position='p')
        self.assertEqual(p.attempt.status,'failed_breach')
        self.assertEqual(p.path['first_breach']['time_msc'],p.start+2)
        self.assertEqual(p.path['maximum_drawdown'],D('501'))

    def test_daily_reset_uses_carried_balance_before_new_quote(self):
        start = timestamp('2023-01-02T22:59:00')
        p = observation(start)
        quote(p,1,balance='10100',floating='-400',position='p')
        quote(p,60001,balance='10100',floating='-550',position='p')
        self.assertEqual(p.phase.daily_anchor,D('10100'))
        self.assertEqual(p.daily_floor,D('9600'))
        self.assertEqual(p.attempt.status,'failed_breach')
        self.assertEqual(p.milestones[0]['kind'],'calendar_boundary')
        self.assertEqual(p.milestones[0]['time_msc'],timestamp('2023-01-02T23:00:00'))

    def test_fee_exactly_at_midnight_resets_then_debits_without_a_quote(self):
        start = timestamp('2023-06-01T21:00:00')
        p = observation(start)
        quote(p,1,position='p')
        before = SimpleNamespace(execution=SimpleNamespace(balance=D('10000'),floating_pl=D(0),
            position=SimpleNamespace(position_id='p'),pending_market_order=None))
        after = SimpleNamespace(execution=SimpleNamespace(balance=D('9499'),floating_pl=D(0),
            position=SimpleNamespace(position_id='p'),pending_market_order=None))
        p.cash(timestamp('2023-06-01T22:00:00'),before,after)
        self.assertEqual(p.phase.daily_anchor,D('10000'))
        self.assertEqual(p.phase.balance,D('9499'))
        self.assertEqual(p.attempt.status,'failed_breach')
        self.assertEqual(p.observed_ticks,1)

    def test_prague_dst_days_are_23_and_25_hours(self):
        for begin,hours in [('2023-03-25T23:00:00',23),('2023-10-28T22:00:00',25)]:
            p = observation(timestamp(begin))
            self.assertEqual(p.reset_msc-p.start,hours*3600000)

    def test_flat_and_minimum_days_then_native_reset_and_phase_two(self):
        p = observation()
        quote(p,1,balance='10020')
        self.assertTrue(p.running)  # Cash alone does not create a trading day.
        quote(p,2,balance='10020',position='p')
        self.assertTrue(p.running)  # Profit is not a pass while a position is open.
        quote(p,3,balance='10020',pending=1)
        self.assertTrue(p.running)
        quote(p,4,balance='10020')
        self.assertEqual(p.attempt.status,'phase_passed')
        p.advance_phase(p.start+3600000)
        self.assertEqual(p.phase.balance,D('10000'))
        self.assertEqual(p.phase.qualifying_days,0)
        self.assertEqual(p.phase.phase_index,2)
        self.assertEqual(p.target,D('10005'))
        quote(p,3600001,balance='10006',position='p')
        quote(p,3600002,balance='10006')
        self.assertEqual(p.attempt.status,'completed_pass')
        self.assertEqual(len(p.completed_phases),1)

    def test_minimum_days_count_entries_not_position_carry(self):
        p = observation(days=4)
        for day in range(4):
            quote(p,day*86400000+1,balance='10020',position=f'p{day}')
            quote(p,day*86400000+2,balance='10020')
            self.assertEqual(p.phase.qualifying_days,day+1)
            self.assertEqual(p.attempt.status,'phase_passed' if day==3 else 'running')

    def test_invalid_quote_window_does_not_commit_observer_changes(self):
        p = observation()
        before = p.export()
        state = initialize_forex_pilot(execution(),start_time_msc=ms())
        bar = dict(timestamp=ms()//1000,open='1.10005',high='1.10005',low='1.10005',close='1.10005')
        with self.assertRaises(ValueError):
            advance_forex_pilot(state,ticks=[tick(),tick(when=ms()+3600001)],
                bar=bar,cursor_index=1,observer=p)
        self.assertEqual(p.export(),before)
        advance_forex_pilot(state,ticks=[tick()],bar=bar,cursor_index=1,observer=p)
        self.assertEqual(p.observed_ticks,1)

    def test_entry_and_stop_on_same_quote_still_count_one_trading_day(self):
        p = observation()
        initial = queue(initialize_forex_pilot(execution(),start_time_msc=ms()),quantity='.01',stop='1.10010')
        bar = dict(timestamp=ms()//1000,open='1.10010',high='1.10010',low='1.10010',close='1.10010')
        result = advance_forex_pilot(initial,ticks=[tick()],bar=bar,cursor_index=1,observer=p)
        self.assertIsNone(result.execution.position)
        self.assertEqual(p.phase.qualifying_days,1)
        self.assertEqual(p.observed_ticks,1)

    def test_runner_resets_actual_execution_before_phase_two_without_replaying_ticks(self):
        class FixtureStrategy:
            def __init__(self): self.bars=0
            def observe(self,candle,**kwargs):
                self.bars+=1
                return ('EXIT' if kwargs.get('side') else 'BUY'),D('.001')
        ticks = [BrokerReplayTick(time_msc=pilot.START+h*3600000+1,sequence=h+1,
            bid=str(D('1.102')+D('.002')*(h//5)),
            ask=str(D('1.1022')+D('.002')*(h//5))) for h in range(18)]
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(pilot,'FixedH4Candidate',FixtureStrategy), \
                 patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                result = pilot.run_scenario(Path('unused'),[],'reference',D(0),D(10),Path(folder),lambda *a:None,
                    development=dict(sha256='a'*64,first_day='20220103',last_day='20220103'),
                    prop_profile=profile(targets=('1','1')))
            path = json.loads((Path(folder)/'reference-prop-path.json').read_bytes())
            state = json.loads((Path(folder)/'reference-checkpoint.json').read_bytes())
            self.assertEqual(path['active']['status'],'completed_pass')
            self.assertEqual(len(path['completed_phase_accounts']),1)
            self.assertGreater(D(path['completed_phase_accounts'][0]['checkpoint']['execution']['balance']),D(10000))
            self.assertEqual(state['execution']['starting_balance'],'10000')
            self.assertEqual(result['observed_ticks'],18)
            self.assertLess(state['risk']['observed_ticks'],18)
            first = state['execution']['ledger'][0]
            self.assertEqual(D(first['balance']),D(10000))
            self.assertFalse(result['prop_pass'])  # Declared simulation is not firm certification.

    def test_real_range_candidate_carries_indicators_but_resets_account_day_latch(self):
        from trading_workspace_v2.forex_h4 import Candle,H4
        from trading_workspace_v2.forex_prop_candidates import UTC_RANGE
        warmup=[Candle(pilot.START//1000+(i-80)*H4,D('1.1001'),D('1.101'),D('1.099'),D('1.1001'))
                for i in range(80)]
        ticks=[]
        for hour in range(24):
            bid=D('1.100') if hour<8 else D('1.104') if hour<16 else D('1.106')
            ticks.append(BrokerReplayTick(time_msc=pilot.START+hour*3600000+1,sequence=hour+1,
                bid=str(bid),ask=str(bid+D('.0002'))))
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(pilot,'read_qdm_ticks',return_value=iter(ticks)):
                result=pilot.run_scenario(Path('unused'),warmup,'reference',D(0),D(10),Path(folder),lambda *a:None,
                    research_candidate=UTC_RANGE,prop_profile=profile(targets=('1','1')),
                    development=dict(sha256='a'*64,first_day='20220103',last_day='20220103'))
            path=json.loads((Path(folder)/'reference-prop-path.json').read_bytes())
            candidate=json.loads((Path(folder)/'reference-candidate.json').read_bytes())['state']
            self.assertEqual(path['active']['phase_index'],2)
            self.assertEqual(path['active']['qualifying_days'],0)
            self.assertEqual(result['observed_ticks'],24)
            self.assertIsNone(candidate['last_entry_day'])
            self.assertIsNone(candidate['position_id'])
            self.assertEqual(len(candidate['history']),80)
            self.assertIsNotNone(candidate['atr'])


if __name__=='__main__': unittest.main()
