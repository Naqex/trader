"""Offline EURUSD pilot limits; observed quotes do not certify Prop compliance."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .execution_semantics import protection_brackets
from .replay_execution import ReplayExecutionError, _decimal, _liquidation_pnl, queue_market_order
from .replay_tick_execution import (
    BrokerReplayTick, ReplayTickExecutionSnapshot, advance_tick_execution,
)
from .retained import CostModel, InstrumentSpec, calculate_round_trip_cost


class PilotRiskLimits(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    per_trade_loss: Decimal = Field(default=Decimal("25"), gt=0)
    daily_loss: Decimal = Field(default=Decimal("100"), gt=0)
    overall_loss: Decimal = Field(default=Decimal("500"), gt=0)
    reset_timezone: Literal["Europe/Prague"] = "Europe/Prague"

    @model_validator(mode="after")
    def limits_are_ordered(self):
        if not self.per_trade_loss <= self.daily_loss <= self.overall_loss:
            raise ValueError("pilot limits must satisfy trade <= daily <= overall")
        return self


class PilotStopTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    reason: Literal["daily_loss", "overall_loss"]
    tick: BrokerReplayTick
    balance: Decimal
    equity: Decimal
    anchor: Decimal
    allowance: Decimal = Field(gt=0)
    position_id: str | None
    event_time_msc: int | None = Field(default=None, ge=0, strict=True)

    @model_validator(mode="after")
    def threshold_was_reached(self):
        if self.equity > self.anchor - self.allowance:
            raise ValueError("pilot stop requires equity at or below its floor")
        if self.event_time_msc is not None and self.event_time_msc < self.tick.time_msc:
            raise ValueError("pilot cash stop cannot precede its valuation quote")
        return self


class PilotOrderRejection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    operation_id: str
    tick: BrokerReplayTick
    reason: Literal["halted", "stop_required", "entry_gap", "trade_risk", "remaining_budget"]
    estimated_loss: Decimal | None = None


class PilotExitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    operation_id: str = Field(min_length=1, max_length=128)
    position_id: str = Field(min_length=1, max_length=128)
    decision_time_msc: int = Field(ge=0, strict=True)
    submitted_cursor_index: int = Field(ge=1, strict=True)
    observed_tick: BrokerReplayTick

    @model_validator(mode="after")
    def decision_follows_observed_quote(self):
        if not self.operation_id.strip() or self.observed_tick.time_msc >= self.decision_time_msc:
            raise ValueError("pilot exit requires an identifier and a closed-bar decision after its quote")
        return self


def _validate_exit_source(execution, request):
    source = next((raw for raw in reversed(execution.ledger)
        if raw["cursor_index"] == request.submitted_cursor_index and raw["kind"] == "price_mark"), None)
    if (source is None or source["virtual_time_utc"] * 1000 != request.decision_time_msc
            or (source["details"].get("open_position") or {}).get("position_id") != request.position_id
            or BrokerReplayTick.model_validate(source["details"]) != request.observed_tick):
        raise ReplayExecutionError("pilot exit must retain its canonical closed-bar decision and position")


class PilotRiskState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    day: date
    start_time_msc: int = Field(ge=0, strict=True)
    daily_anchor_balance: Decimal
    daily_stopped: bool = False
    overall_stopped: bool = False
    close_pending: PilotStopTrigger | None = None
    exit_pending: PilotExitRequest | None = None
    last_tick: BrokerReplayTick | None = None
    observed_ticks: int = Field(default=0, ge=0, strict=True)
    minimum_observed_equity: Decimal
    stops: tuple[PilotStopTrigger, ...] = ()
    rejections: tuple[PilotOrderRejection, ...] = ()
    entry_stop_distance: Decimal | None = Field(default=None, gt=0)
    entry_decision_time_msc: int | None = Field(default=None, ge=0, strict=True)


class ForexPilotSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    schema_version: Literal["forex-pilot-risk-v1"] = "forex-pilot-risk-v1"
    execution: ReplayTickExecutionSnapshot
    limits: PilotRiskLimits
    risk: PilotRiskState

    @model_validator(mode="after")
    def supported_offline_account(self):
        e = self.execution
        spec = InstrumentSpec.from_mapping(e.instrument_spec)
        costs = CostModel.from_mapping(e.cost_model)
        if (spec.asset_class != "fx" or (spec.base_ccy, spec.quote_ccy, spec.account_ccy)
                != ("EUR", "USD", "USD") or costs.account_ccy != "USD"
                or costs.quote_to_account_rate != 1):
            raise ValueError("Forex pilot supports EURUSD in a USD research account only")
        if self.limits.overall_loss >= e.starting_balance:
            raise ValueError("pilot overall loss must be below starting balance")
        if self.risk.observed_ticks == 0:
            if self.risk.last_tick is not None or e.ledger or e.position is not None:
                raise ValueError("new pilot requires an unconsumed execution snapshot")
        else:
            tick = self.risk.last_tick
            last = next((raw["details"] for raw in reversed(e.ledger)
                         if "bid" in raw.get("details", {})), {})
            if tick is None or (e.last_bid, e.last_ask) != (tick.bid, tick.ask) or (
                    last.get("time_msc"), last.get("sequence")) != (tick.time_msc, tick.sequence):
                raise ValueError("pilot risk checkpoint must retain the execution's last quote")
        if self.risk.overall_stopped != any(t.reason == "overall_loss" for t in self.risk.stops):
            raise ValueError("pilot overall latch must retain its stop evidence")
        if self.risk.daily_stopped != any(t.reason == "daily_loss" and _day(
                                         t.event_time_msc if t.event_time_msc is not None else t.tick.time_msc)
                                         == self.risk.day for t in self.risk.stops):
            raise ValueError("pilot daily latch must retain its current-day stop evidence")
        for t in self.risk.stops:
            if t.allowance != (self.limits.daily_loss if t.reason == "daily_loss"
                               else self.limits.overall_loss):
                raise ValueError("pilot stop evidence must retain its frozen allowance")
        if self.risk.close_pending and (e.position is None
                or e.position.position_id != self.risk.close_pending.position_id):
            raise ValueError("pilot close request must refer to its open position")
        if self.risk.close_pending and (self.risk.close_pending not in self.risk.stops
                or self.risk.close_pending.tick != self.risk.last_tick):
            raise ValueError("pilot pending close must retain the last quote's stop evidence")
        if self.risk.minimum_observed_equity > e.equity:
            raise ValueError("pilot minimum equity cannot exceed its current equity")
        if self.risk.exit_pending:
            request = self.risk.exit_pending
            if (e.position is None or e.position.position_id != request.position_id
                    or e.pending_market_order is not None):
                raise ValueError("pilot strategy exit must refer to its open position")
            _validate_exit_source(e, request)
        if (self.risk.entry_stop_distance is not None or self.risk.entry_decision_time_msc is not None
                ) and e.pending_market_order is None:
            raise ValueError("pilot entry timing/distance requires a pending order")
        return self


def _day(time_msc: int) -> date:
    return datetime.fromtimestamp(time_msc / 1000, timezone.utc).astimezone(
        ZoneInfo("Europe/Prague")).date()


def _day_bounds(day: date):
    midnight = datetime(day.year, day.month, day.day, tzinfo=ZoneInfo("Europe/Prague"))
    # Add a local calendar day: UTC elapsed time can be 23 or 25 hours at DST.
    return int(midnight.timestamp()*1000), int((midnight+timedelta(days=1)).timestamp()*1000)


def initialize_forex_pilot(execution: ReplayTickExecutionSnapshot, *, start_time_msc: int,
                             limits: PilotRiskLimits | None = None) -> ForexPilotSnapshot:
    if type(start_time_msc) is not int or start_time_msc < 0:
        raise ValueError("pilot start_time_msc must be nonnegative integer milliseconds")
    return ForexPilotSnapshot(execution=execution, limits=limits or PilotRiskLimits(),
        risk=PilotRiskState(day=_day(start_time_msc), start_time_msc=start_time_msc,
                            daily_anchor_balance=execution.balance,
                            minimum_observed_equity=execution.equity))


def queue_forex_pilot_order(snapshot: ForexPilotSnapshot, *, stop_distance=None, **order) -> ForexPilotSnapshot:
    r = snapshot.risk
    if r.daily_stopped or r.overall_stopped or r.close_pending:
        raise ReplayExecutionError("pilot is stopped; consume new-day quotes before submitting again")
    if order.get("stop_loss") is None:
        raise ReplayExecutionError("pilot requires a stop loss")
    if any(x.operation_id == order.get("operation_id") for x in r.rejections):
        raise ReplayExecutionError("pilot operation_id was already rejected")
    execution = queue_market_order(snapshot.execution, **order)
    risk = r.model_copy(update={"entry_stop_distance": _decimal(stop_distance, "stop_distance", positive=True)
        if stop_distance is not None else None,
        "entry_decision_time_msc": snapshot.execution.ledger[-1]["virtual_time_utc"] * 1000
            if snapshot.execution.ledger else None})
    return ForexPilotSnapshot(execution=execution, limits=snapshot.limits, risk=risk)


def _stop_at_fill(side, fill, distance, tick_size):
    raw = fill - distance if side == "BUY" else fill + distance
    return (raw / tick_size).to_integral_value(rounding=ROUND_FLOOR if side == "BUY" else ROUND_CEILING) * tick_size


def queue_forex_pilot_exit(snapshot: ForexPilotSnapshot, *, operation_id: str) -> ForexPilotSnapshot:
    execution, risk = snapshot.execution, snapshot.risk
    if execution.position is None or execution.pending_market_order is not None or risk.last_tick is None:
        raise ReplayExecutionError("pilot exit requires an open position and an observed closed bar")
    if risk.exit_pending is not None:
        raise ReplayExecutionError("pilot strategy exit is already queued")
    if any(operation_id in (raw["details"].get("operation_id"),
                            raw["details"].get("command_operation_id")) for raw in execution.ledger):
        raise ReplayExecutionError("pilot exit operation_id was already consumed")
    if any(rejected.operation_id == operation_id for rejected in risk.rejections):
        raise ReplayExecutionError("pilot exit operation_id was already rejected")
    if not execution.ledger or execution.ledger[-1]["kind"] not in {"price_mark", "financing"}:
        raise ReplayExecutionError("pilot exit requires a closed-bar checkpoint")
    request = PilotExitRequest(operation_id=operation_id, position_id=execution.position.position_id,
        decision_time_msc=execution.ledger[-1]["virtual_time_utc"] * 1000,
        submitted_cursor_index=execution.cursor_index, observed_tick=risk.last_tick)
    # A risk stop blocks new exposure, never an owner's or strategy's request to exit.
    return ForexPilotSnapshot(execution=execution, limits=snapshot.limits,
                              risk=risk.model_copy(update={"exit_pending": request}))


class _PilotGuard:
    """Transactional adapter used only by advance_forex_pilot, never by a broker."""
    def __init__(self, snapshot: ForexPilotSnapshot, observer=None):
        self.state = snapshot.risk
        self.limits = snapshot.limits
        self.starting_balance = snapshot.execution.starting_balance
        self.last_tick = snapshot.risk.last_tick
        self.observed_ticks = snapshot.risk.observed_ticks
        self.observer = observer.fork() if observer is not None else None
        self.day_start_msc, self.day_end_msc = _day_bounds(snapshot.risk.day)

    def _observe(self, tick, balance, floating, position, *, event_time_msc=None):
        equity = balance + floating
        state = self.state
        minimum = min(state.minimum_observed_equity, equity)
        updates = {"minimum_observed_equity": minimum} if minimum != state.minimum_observed_equity else {}
        stops = []
        for reason, anchor, allowance, stopped in (
            ("overall_loss", self.starting_balance, self.limits.overall_loss, state.overall_stopped),
            ("daily_loss", state.daily_anchor_balance, self.limits.daily_loss, state.daily_stopped),
        ):
            if not stopped and equity <= anchor - allowance:
                trigger = PilotStopTrigger(reason=reason, tick=tick, balance=balance, equity=equity,
                    anchor=anchor, allowance=allowance,
                    position_id=position.position_id if position else None,
                    event_time_msc=event_time_msc)
                stops.append(trigger)
                updates["overall_stopped" if reason == "overall_loss" else "daily_stopped"] = True
                if position and state.close_pending is None and "close_pending" not in updates:
                    updates["close_pending"] = trigger
        if stops:
            updates["stops"] = (*state.stops, *stops)
        # Keep every loss check, but avoid allocating the same frozen state
        # twice per tick when neither its minimum nor stop history changed.
        if updates:
            self.state = state.model_copy(update=updates)

    def begin_quote(self, tick, balance, floating, position, pending=0):
        state = self.state
        if tick.time_msc < state.start_time_msc:
            raise ReplayExecutionError("pilot quote precedes its registered start time")
        if self.last_tick and (tick.time_msc, tick.sequence) <= (
                self.last_tick.time_msc, self.last_tick.sequence):
            raise ReplayExecutionError("pilot quotes must increase across windows and restarts")
        day = state.day if self.day_start_msc <= tick.time_msc < self.day_end_msc else _day(tick.time_msc)
        if day < state.day:
            raise ReplayExecutionError("pilot quote precedes its registered start day")
        if day != state.day:
            # No invented midnight quote: balance is carried from the last observed event.
            state = state.model_copy(update={"day": day, "daily_anchor_balance": balance,
                                             "daily_stopped": False})
            self.day_start_msc, self.day_end_msc = _day_bounds(day)
        prior_close = state.close_pending
        self.state = state
        self._observe(tick, balance, floating, position)
        if self.observer is not None:
            self.observer.quote(tick,balance,floating,position,pending)
        if (prior_close is not None and prior_close.event_time_msc is not None
                and tick.time_msc <= prior_close.event_time_msc):
            return None
        return prior_close

    def admit(self, order, tick, balance, instrument, costs):
        state = self.state
        reason, loss = None, None
        if state.daily_stopped or state.overall_stopped or state.close_pending:
            reason = "halted"
        elif order.stop_loss is None:
            reason = "stop_required"
        elif not protection_brackets(order.side, tick.ask if order.side == "BUY" else tick.bid,
                                      order.stop_loss, order.take_profit):
            reason = "entry_gap"
        else:
            result = calculate_round_trip_cost(costs, order.side, order.quantity,
                instrument.contract_size, tick.bid, tick.ask, order.stop_loss, order.stop_loss)
            loss = max(Decimal("0"), -Decimal(str(result["net_account"])))
            if loss > self.limits.per_trade_loss:
                reason = "trade_risk"
            elif loss >= min(balance - state.daily_anchor_balance + self.limits.daily_loss,
                             balance - self.starting_balance + self.limits.overall_loss):
                reason = "remaining_budget"
        if reason:
            rejected = PilotOrderRejection(operation_id=order.operation_id, tick=tick,
                                           reason=reason, estimated_loss=loss)
            self.state = state.model_copy(update={"rejections": (*state.rejections, rejected)})
            return False
        return True

    def entry_ready(self, tick):
        decision = self.state.entry_decision_time_msc
        return ((self.observer is None or self.observer.running)
                and (decision is None or tick.time_msc > decision))

    def prepare_order(self, order, tick, instrument):
        if self.state.entry_stop_distance is None:
            return order
        return order.model_copy(update={"stop_loss": _stop_at_fill(order.side,
            tick.ask if order.side == "BUY" else tick.bid,
            self.state.entry_stop_distance, instrument.tick_size)})

    def entry_proof(self):
        if self.state.entry_stop_distance is None and self.state.entry_decision_time_msc is None:
            return {}
        return {"pilot_entry": {"stop_distance": str(self.state.entry_stop_distance)
                if self.state.entry_stop_distance is not None else None,
            "decision_time_msc": self.state.entry_decision_time_msc}}

    def record_entry(self,tick,balance,floating,position,pending=0):
        if self.observer is not None:
            self.observer.quote(tick,balance,floating,position,pending)

    def finish_quote(self, tick, balance, floating, position, pending=0):
        self._observe(tick, balance, floating, position)
        if self.observer is not None:
            self.observer.quote(tick,balance,floating,position,pending,completed=True)
        # These counters are private to this atomic window, not risk decisions.
        # Publish them once after all quotes validate instead of copying per tick.
        self.last_tick = tick
        self.observed_ticks += 1
        if position is None and (self.state.close_pending is not None or self.state.exit_pending is not None):
            self.state = self.state.model_copy(update={"close_pending": None, "exit_pending": None})

    def checkpoint(self):
        return self.state.model_copy(update={"last_tick": self.last_tick, "observed_ticks": self.observed_ticks})

    def strategy_exit(self, tick, position):
        request = self.state.exit_pending
        if request is not None and position is not None and tick.time_msc > request.decision_time_msc:
            return request
        return None


def advance_forex_pilot(snapshot: ForexPilotSnapshot, *, ticks, bar: dict,
                        cursor_index: int, observer=None) -> ForexPilotSnapshot:
    # Changes are published together only after the entire supplied window validates.
    guard = _PilotGuard(snapshot,observer)
    result = advance_tick_execution(snapshot.execution, ticks=ticks, bar=bar,
                                    cursor_index=cursor_index, _pilot_guard=guard)
    risk = guard.checkpoint()
    if result.snapshot.pending_market_order is None:
        risk = risk.model_copy(update={"entry_stop_distance": None, "entry_decision_time_msc": None})
    checkpoint = ForexPilotSnapshot(execution=result.snapshot, limits=snapshot.limits, risk=risk)
    if observer is not None:
        observer.commit(guard.observer)
    return checkpoint


def validate_pilot_close(snapshot, tick, closed, raw_trigger):
    trigger = PilotStopTrigger.model_validate(raw_trigger)
    if ((trigger.tick.time_msc, trigger.tick.sequence) >= (tick.time_msc, tick.sequence)
            or trigger.position_id != closed.position_id
            or (trigger.event_time_msc is not None and tick.time_msc <= trigger.event_time_msc)):
        raise ReplayExecutionError("pilot close must follow its triggering quote and position")
    floating, _ = _liquidation_pnl(closed, exit_bid=trigger.tick.bid, exit_ask=trigger.tick.ask,
        instrument=InstrumentSpec.from_mapping(snapshot.instrument_spec),
        cost_model=CostModel.from_mapping(snapshot.cost_model))
    if trigger.balance + floating != trigger.equity:
        raise ReplayExecutionError("pilot trigger equity differs from its frozen quote and costs")


def validate_pilot_exit(snapshot, tick, closed, event):
    request = PilotExitRequest.model_validate(event.details.get("pilot_exit"))
    _validate_exit_source(snapshot, request)
    if (tick.time_msc <= request.decision_time_msc or request.position_id != closed.position_id
            or request.submitted_cursor_index >= event.cursor_index
            or event.details.get("command_operation_id") != request.operation_id):
        raise ReplayExecutionError("pilot strategy exit must fill strictly after its closed-bar decision")


def validate_pilot_entry(snapshot, tick, event):
    proof = event.details["pilot_entry"]
    decision = proof.get("decision_time_msc")
    if decision is not None and (type(decision) is not int or tick.time_msc <= decision):
        raise ReplayExecutionError("pilot entry must fill strictly after its decision")
    if decision is not None:
        source = next((raw for raw in reversed(snapshot.ledger)
            if raw["sequence"] < event.sequence and raw["cursor_index"] == event.cursor_index - 1
            and raw["kind"] in {"price_mark", "financing"}), None)
        if source is None or source["virtual_time_utc"] * 1000 != decision:
            raise ReplayExecutionError("pilot entry decision must retain its canonical checkpoint")
    if proof.get("stop_distance") is not None and event.kind == "market_fill":
        distance = Decimal(proof["stop_distance"])
        if not distance.is_finite() or distance <= 0:
            raise ReplayExecutionError("pilot entry stop distance must be finite and positive")
        position = event.details["open_position"]
        expected = _stop_at_fill(position["side"], Decimal(position["entry_fill"]), distance,
                                 InstrumentSpec.from_mapping(snapshot.instrument_spec).tick_size)
        if Decimal(position["stop_loss"]) != expected:
            raise ReplayExecutionError("pilot entry stop must retain its declared distance from actual fill")
