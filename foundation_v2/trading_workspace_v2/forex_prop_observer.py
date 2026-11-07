"""Transactional tick-path adapter to the existing offline prop evaluator."""
from __future__ import annotations

from copy import copy, deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from .prop_session import (
    ChallengeAttemptSnapshot, MoneyOracleInput, PhaseStateSnapshot, PropLifecycleEvent,
    PropProfileSnapshot, PropSessionSnapshot, TransitionIntent, apply_prop_lifecycle_command,
    evaluate_prop_lifecycle_event, money_oracle,
)


def utc(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


class ForexPropObserver:
    """All quotes update cheap metrics; native evaluation runs at state milestones.

    Static USD profiles only. Thresholds come from money_oracle, never a second
    rule configuration. No orders, fills, broker calls or invented midnight quotes.
    """

    def __init__(self, profile, *, start, end, identity, initial_balance=Decimal('10000')):
        self.profile = PropProfileSnapshot.model_validate(profile)
        for spec in self.profile.phases:
            if (spec.currency != 'USD' or spec.initial_capital != initial_balance
                    or spec.overall_drawdown.kind != 'static'
                    or spec.daily_anchor_basis != 'balance'
                    or spec.daily_loss.basis != 'equity' or spec.overall_drawdown.basis != 'equity'
                    or spec.profit_target.basis != 'balance'
                    or spec.reset_timezone != 'Europe/Prague' or spec.reset_local_time.isoformat() != '00:00:00'
                    or spec.reset_order != 'reset_then_fees' or spec.carry_policy != 'reset'
                    or spec.position_policy != 'must_be_flat' or spec.max_calendar_days is not None):
                raise ValueError('unsupported Forex observation profile')
            thresholds = (spec.profit_target.threshold, spec.daily_loss.threshold, spec.overall_drawdown.threshold)
            if any(t.percent is not None and t.percent_base != 'initial_capital' for t in thresholds):
                raise ValueError('Forex observer requires fixed initial-capital thresholds')
        self.session = PropSessionSnapshot(workspace_id='offline-research', session_id=identity,
            profile=self.profile, status='running')
        self.attempt = ChallengeAttemptSnapshot(workspace_id='offline-research', session_id=identity,
            attempt_id=identity, profile_id=self.profile.profile_id, terms_version=self.profile.terms_version,
            profile_hash=self.profile.profile_hash, data_version=identity, cost_version=identity,
            engine_version='forex-prop-path-v1', status='running', virtual_start_utc=utc(start),
            virtual_cutoff_utc=utc(end))
        self.phase = PhaseStateSnapshot(workspace_id='offline-research', session_id=identity,
            attempt_id=identity, profile_hash=self.profile.profile_hash, phase_index=1,
            initial_balance=initial_balance, balance=initial_balance, floating_pl=Decimal(0),
            equity=initial_balance, high_water_mark=initial_balance, daily_anchor=initial_balance,
            virtual_time_utc=utc(start), evaluation_quality='full_for_declared_model')
        self.resume = {}
        self.start, self.end, self.last_time = start, end, start
        self.last_balance, self.last_floating = initial_balance, Decimal(0)
        self.last_position, self.last_pending = None, 0
        self.observed_ticks = 0
        self.milestones, self.completed_phases = [], []
        self._new_path(start)
        self._refresh_floors()
        self._next_reset(start)

    def fork(self):
        result = copy(self)
        result.resume = deepcopy(self.resume)
        result.path = dict(self.path)
        result.milestones = list(self.milestones)
        result.completed_phases = list(self.completed_phases)
        return result

    def commit(self, staged):
        self.__dict__.update(staged.__dict__)

    @property
    def running(self):
        return self.attempt.status == 'running'

    def _new_path(self, when):
        self.path = dict(start_time_msc=when, peak_equity=self.phase.initial_balance,
            starting_tick_count=self.observed_ticks,
            minimum_equity=self.phase.initial_balance, maximum_drawdown=Decimal(0),
            peak_time_msc=when, max_underwater_ms=0, underwater_at_end=False,
            minimum_daily_headroom=None, minimum_overall_headroom=None, observations=0,
            first_breach=None, terminal_time_msc=None)

    def _refresh_floors(self):
        spec = self.profile.phases[self.phase.phase_index-1]
        self.money = money_oracle(spec, MoneyOracleInput(initial_capital=self.phase.initial_balance,
            daily_anchor=self.phase.daily_anchor, balance_before_separate_costs=self.last_balance,
            floating_pl=self.last_floating, high_water_mark=max(self.phase.high_water_mark,
                self.last_balance+self.last_floating)))
        self.daily_floor = self.money['daily_loss']['floor']
        self.overall_floor = self.money['overall_drawdown']['floor']
        self.target = self.money['profit_target']['target']
        self.daily_inclusive = spec.daily_loss.comparator == 'lte'
        self.overall_inclusive = spec.overall_drawdown.comparator == 'lte'
        self.target_inclusive = spec.profit_target.comparator == 'gte'

    def _next_reset(self, when):
        local = utc(when).astimezone(ZoneInfo('Europe/Prague'))
        midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)+timedelta(days=1)
        self.reset_msc = int(midnight.timestamp()*1000)

    def _evaluate(self, when, balance, floating, position, pending, *, kind='simulation_snapshot',
                  swap=Decimal(0), qualifying=False):
        if not self.running:
            return
        event = PropLifecycleEvent(workspace_id=self.attempt.workspace_id,
            session_id=self.attempt.session_id, attempt_id=self.attempt.attempt_id,
            profile_hash=self.profile.profile_hash, operation_id=f'path-{self.phase.last_event_sequence+1}',
            expected_revision=self.attempt.revision, event_sequence=self.phase.last_event_sequence+1,
            kind=kind, virtual_time_utc=utc(when), balance_before_separate_costs=balance,
            floating_pl=floating, swap=swap, accounting='costs_separate' if swap else 'costs_included',
            open_positions=int(position is not None), pending_orders=pending,
            qualifying_day=qualifying, evaluation_quality='full_for_declared_model')
        result = evaluate_prop_lifecycle_event(self.session,self.attempt,self.phase,event,resume_state=self.resume)
        self.attempt, self.phase, self.resume = result['attempt'], result['phase'], result['resume_state']
        action = result['objectives']['terminal_action']
        if action or kind=='calendar_boundary':
            self.milestones.append(dict(time_msc=when,phase_index=self.phase.phase_index,
                kind=kind,action=action,status=self.attempt.status,
                balance=str(self.phase.balance),equity=str(self.phase.equity),
                daily_anchor=str(self.phase.daily_anchor),qualifying_days=self.phase.qualifying_days,
                quote_basis='last_observed_quote_at_cash_or_reset_not_new_market' if kind=='calendar_boundary' else 'observed_quote_or_cash'))
        if action:
            self.path['terminal_time_msc'] = when
            if action=='breach':
                self.path['first_breach'] = dict(time_msc=when, objectives=result['objectives'])

    def _roll(self, when, *, inclusive=True):
        if when < self.last_time or when > self.end:
            raise ValueError('observation time outside monotonic study interval')
        while self.reset_msc < when or inclusive and self.reset_msc==when:
            self._evaluate(self.reset_msc,self.last_balance,self.last_floating,
                           self.last_position,self.last_pending,kind='calendar_boundary')
            self._next_reset(self.reset_msc)
            self._refresh_floors()

    def _metric(self, when, balance, floating):
        p = self.path
        equity = balance+floating
        p['observations'] += 1
        p['minimum_equity'] = min(p['minimum_equity'],equity)
        if equity >= p['peak_equity']:
            if p['underwater_at_end']:
                p['max_underwater_ms'] = max(p['max_underwater_ms'],when-p['peak_time_msc'])
            p.update(peak_equity=equity,peak_time_msc=when,underwater_at_end=False)
        else:
            p['underwater_at_end'] = True
            p['maximum_drawdown'] = max(p['maximum_drawdown'],p['peak_equity']-equity)
            p['max_underwater_ms'] = max(p['max_underwater_ms'],when-p['peak_time_msc'])
        if self.running or p['terminal_time_msc']==when:
            for key, value in (('minimum_daily_headroom',equity-self.daily_floor),
                               ('minimum_overall_headroom',equity-self.overall_floor)):
                if p[key] is None or value < p[key]:
                    p[key] = value

    def quote(self, tick, balance, floating, position, pending=0, *, completed=False):
        when = tick.time_msc
        self._roll(when)
        position_id = position.position_id if position is not None else None
        entry = position_id is not None and position_id != self.last_position
        equity = balance+floating
        breached = (equity <= self.daily_floor if self.daily_inclusive else equity < self.daily_floor)
        breached |= (equity <= self.overall_floor if self.overall_inclusive else equity < self.overall_floor)
        self._metric(when,balance,floating)
        if (breached or entry or balance!=self.last_balance
                or position_id!=self.last_position or pending!=self.last_pending):
            self._evaluate(when,balance,floating,position_id,pending,qualifying=entry)
        self.last_time, self.last_balance, self.last_floating = when,balance,floating
        self.last_position, self.last_pending = position_id,pending
        if completed:
            self.observed_ticks += 1

    def cash(self, when, before, after):
        staged = self.fork()
        staged._roll(when,inclusive=False)
        boundary = staged.reset_msc==when
        staged._evaluate(when,before.execution.balance,before.execution.floating_pl,
            before.execution.position.position_id if before.execution.position else None,
            int(before.execution.pending_market_order is not None),
            kind='calendar_boundary' if boundary else 'simulation_snapshot',
            swap=before.execution.balance-after.execution.balance)
        if boundary:
            staged._next_reset(when)
        staged.last_time = when
        staged.last_balance, staged.last_floating = after.execution.balance,after.execution.floating_pl
        staged.last_position = after.execution.position.position_id if after.execution.position else None
        staged.last_pending = int(after.execution.pending_market_order is not None)
        staged._refresh_floors()
        staged._metric(when,staged.last_balance,staged.last_floating)
        self.commit(staged)

    def advance_phase(self, when):
        if self.attempt.status!='phase_passed' or self.last_position or self.last_pending:
            raise ValueError('phase reset requires an evaluator-approved flat account')
        self.completed_phases.append(self.summary())
        for action in ('next_phase','start'):
            intent = TransitionIntent(workspace_id=self.attempt.workspace_id,session_id=self.attempt.session_id,
                attempt_id=self.attempt.attempt_id,profile_hash=self.profile.profile_hash,
                intent_id=f'auto-{action}-{self.attempt.revision}',expected_revision=self.attempt.revision,
                event_sequence=self.phase.last_event_sequence,action=action)
            result = apply_prop_lifecycle_command(self.session,self.attempt,self.phase,intent,resume_state=self.resume)
            self.attempt,self.phase,self.resume = result['attempt'],result['phase'],result['resume_state']
        self.last_balance,self.last_floating = self.phase.balance,self.phase.floating_pl
        self.last_position,self.last_pending = None,0
        self.last_time = when
        self.phase = self.phase.model_copy(update={'virtual_time_utc':utc(when)})
        self._new_path(when)
        self._refresh_floors()
        self._next_reset(when)

    def boundary(self, cutoff):
        self._roll(cutoff,inclusive=False)

    def summary(self):
        # The full checkpoint is for audit; CLI mid-scenario resume is not enabled.
        return dict(schema='forex-prop-path-v1',phase_index=self.phase.phase_index,
            status=self.attempt.status,qualifying_days=self.phase.qualifying_days,
            observed_ticks=self.observed_ticks,last_observation_time_msc=self.last_time,
            phase_observed_ticks=self.observed_ticks-self.path['starting_tick_count'],
            account_balance_usd=str(self.last_balance),account_equity_usd=str(self.last_balance+self.last_floating),
            path={k:str(v) if isinstance(v,Decimal) else v for k,v in self.path.items()},
            phase=self.phase.model_dump(mode='json'),attempt=self.attempt.model_dump(mode='json'),
            resume=deepcopy(self.resume),coverage='all_consumed_quotes_pre_and_post_fill_and_calendar_cash',
            prop_evaluation_cutoff='first_terminal_event_or_current_observation',
            execution_mode='offline_model_not_broker',qualification='declared_profile_only_not_firm_certification',
            cli_resume_supported=False)

    def export(self):
        return dict(active=self.summary(),completed_phases=deepcopy(self.completed_phases),
            milestones=list(self.milestones),profile=self.profile.model_dump(mode='json'))

    def checkpoint(self):
        return dict(schema='forex-prop-observer-checkpoint-v1',start=self.start,end=self.end,
            session=self.session.model_dump(mode='json'),observation=self.export(),
            last_position=self.last_position,last_pending=self.last_pending,reset_msc=self.reset_msc)

    @classmethod
    def from_checkpoint(cls, packet):
        if (set(packet)!={'schema','start','end','session','observation','last_position','last_pending','reset_msc'}
                or packet['schema']!='forex-prop-observer-checkpoint-v1'
                or any(type(packet[k]) is not int for k in ('start','end','last_pending','reset_msc'))
                or not 0<=packet['start']<packet['end'] or packet['last_pending'] not in (0,1)
                or packet['last_position'] is not None and not isinstance(packet['last_position'],str)):
            raise ValueError('invalid observer checkpoint scope')
        raw=packet['observation'];active=raw['active']
        attempt=ChallengeAttemptSnapshot.model_validate(active['attempt'])
        phase=PhaseStateSnapshot.model_validate(active['phase'])
        result=cls(raw['profile'],start=packet['start'],end=packet['end'],identity=attempt.session_id)
        result.session=PropSessionSnapshot.model_validate(packet['session'])
        if (result.session.workspace_id!=attempt.workspace_id or phase.workspace_id!=attempt.workspace_id
                or result.session.session_id!=attempt.session_id or phase.session_id!=attempt.session_id
                or phase.attempt_id!=attempt.attempt_id or phase.profile_hash!=result.profile.profile_hash
                or attempt.profile_hash!=result.profile.profile_hash
                or result.session.profile!=result.profile or attempt.profile_id!=result.profile.profile_id
                or attempt.terms_version!=result.profile.terms_version
                or attempt.virtual_start_utc!=utc(result.start) or attempt.virtual_cutoff_utc!=utc(result.end)):
            raise ValueError('observer checkpoint identity differs')
        result.attempt,result.phase=attempt,phase
        if not 1<=phase.phase_index<=len(result.profile.phases) or set(active['path'])!=set(result.path):
            raise ValueError('observer checkpoint phase/path scope differs')
        if phase.initial_balance!=result.profile.phases[phase.phase_index-1].initial_capital:
            raise ValueError('observer checkpoint initial capital differs')
        result.resume=deepcopy(active['resume'])
        result.last_time=active['last_observation_time_msc'];result.observed_ticks=active['observed_ticks']
        if (any(type(v) is not int for v in (result.last_time,result.observed_ticks))
                or not result.start<=result.last_time<=result.end or result.observed_ticks<0):
            raise ValueError('observer checkpoint clock/count differs')
        result.last_balance=Decimal(active['account_balance_usd'])
        result.last_floating=Decimal(active['account_equity_usd'])-result.last_balance
        result.last_position,result.last_pending=packet['last_position'],packet['last_pending']
        if result.running and (phase.open_positions!=int(result.last_position is not None)
                               or phase.pending_orders!=result.last_pending):
            raise ValueError('observer checkpoint exposure differs')
        result.path=deepcopy(active['path'])
        for key in ('peak_equity','minimum_equity','maximum_drawdown','minimum_daily_headroom','minimum_overall_headroom'):
            if result.path[key] is not None:result.path[key]=Decimal(result.path[key])
        if any(not v.is_finite() for v in (result.last_balance,result.last_floating,
                *[v for v in result.path.values() if isinstance(v,Decimal)])):
            raise ValueError('observer checkpoint money must be finite')
        result.milestones=deepcopy(raw['milestones']);result.completed_phases=deepcopy(raw['completed_phases'])
        result._refresh_floors()
        result._next_reset(max(result.last_time,int(phase.virtual_time_utc.timestamp()*1000)))
        if result.reset_msc!=packet['reset_msc'] or result.export()!=raw:
            raise ValueError('observer checkpoint does not roundtrip canonically')
        return result
