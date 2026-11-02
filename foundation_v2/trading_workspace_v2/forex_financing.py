"""Explicit UTC financing events for offline Forex; no inferred broker swap rates."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_pilot_risk import ForexPilotSnapshot, _PilotGuard, _day
from .replay_execution import (
    ReplayExecutionError, ReplayExecutionEventV2, ReplayQueuedMarketOrder, _validate_quantity,
)
from .retained import InstrumentSpec
from .replay_tick_execution import BrokerReplayTick


class FinancingTerms(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    event_id: str = Field(min_length=1, max_length=128)
    scheduled_time_msc: int = Field(ge=0, strict=True)
    known_at_msc: int = Field(ge=0, strict=True)
    debit_buy_usd_per_lot: Decimal
    debit_sell_usd_per_lot: Decimal
    multiplier: int = Field(ge=0, le=10, strict=True)
    source: str = Field(min_length=1, max_length=512)
    qualification: Literal["declared_scenario", "verified_account"]
    reset_order: Literal["reset_then_financing"] = "reset_then_financing"

    @model_validator(mode="after")
    def terms_were_available(self):
        if self.known_at_msc > self.scheduled_time_msc or self.scheduled_time_msc % 1000:
            raise ValueError("financing terms must be known by an exact-second event time")
        if not self.event_id.strip() or not self.source.strip():
            raise ValueError("financing event and source must not be blank")
        return self


def _debit(terms, position):
    if position is None:
        return Decimal(0)
    rate = terms.debit_buy_usd_per_lot if position.side == "BUY" else terms.debit_sell_usd_per_lot
    return (rate * position.quantity * terms.multiplier).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def apply_forex_financing(snapshot: ForexPilotSnapshot, terms: FinancingTerms) -> ForexPilotSnapshot:
    """Post on the declared event clock, preserving the latest known quote through gaps."""
    e, risk = snapshot.execution, snapshot.risk
    if Decimal(str(e.cost_model["financing_account"])) != 0:
        raise ReplayExecutionError("timed financing cannot also use aggregate closing financing")
    if (not e.ledger or e.ledger[-1]["kind"] not in {"price_mark", "financing"} or risk.last_tick is None
            or e.ledger[-1]["virtual_time_utc"] * 1000 > terms.scheduled_time_msc
            or risk.last_tick.time_msc >= terms.scheduled_time_msc):
        raise ReplayExecutionError("financing requires a known boundary before its event; no backdated fees")
    if any(raw.get("details", {}).get("financing_terms", {}).get("event_id") == terms.event_id
           for raw in e.ledger):
        raise ReplayExecutionError("financing event was already applied")
    debit = _debit(terms, e.position)
    balance = e.balance - debit
    event = ReplayExecutionEventV2(sequence=e.event_sequence + 1, kind="financing",
        replay_session_id=e.replay_session_id, branch_id=e.branch_id, dataset_id=e.dataset_id,
        dataset_sha256=e.dataset_sha256, cursor_index=e.cursor_index,
        virtual_time_utc=terms.scheduled_time_msc // 1000, balance=balance,
        floating_pl=e.floating_pl, equity=balance + e.floating_pl,
        open_positions=int(e.position is not None), pending_orders=int(e.pending_market_order is not None),
        details={"financing_terms": terms.model_dump(mode="json"), "debit_account": str(debit),
            "previous_balance": str(e.balance), "valuation_tick": risk.last_tick.model_dump(mode="json"),
            "valuation_quality": "last_observed_quote_not_current_market",
            "open_position": e.position.model_dump(mode="json") if e.position else None,
            "pending_market_order": e.pending_market_order.model_dump(mode="json") if e.pending_market_order else None})
    validate_financing_event(e, event)
    execution = e.model_copy(update={"balance": balance, "equity": balance + e.floating_pl,
        "event_sequence": event.sequence, "ledger": [*e.ledger, event.model_dump(mode="json")]})
    guard = _PilotGuard(snapshot)
    day = _day(terms.scheduled_time_msc)
    if day != risk.day:
        # Declared order at a coincident Prague reset; not an inferred broker policy.
        guard.state = risk.model_copy(update={"day": day, "daily_anchor_balance": e.balance,
                                             "daily_stopped": False})
    guard._observe(risk.last_tick, balance, e.floating_pl, e.position,
                   event_time_msc=terms.scheduled_time_msc)
    return ForexPilotSnapshot(execution=execution, limits=snapshot.limits, risk=guard.state)


def validate_financing_event(snapshot, event):
    if snapshot.schema_version != "replay-execution-tick-v1":
        raise ReplayExecutionError("timed Forex financing requires a tick snapshot")
    d = event.details
    terms = FinancingTerms.model_validate(d.get("financing_terms"))
    prior = next((raw for raw in snapshot.ledger if raw["sequence"] == event.sequence - 1), None)
    if (prior is None or prior["kind"] not in {"price_mark", "financing"} or prior["cursor_index"] != event.cursor_index
            or prior["virtual_time_utc"] > event.virtual_time_utc
            or event.virtual_time_utc * 1000 != terms.scheduled_time_msc
            or Decimal(str(snapshot.cost_model["financing_account"])) != 0):
        raise ReplayExecutionError("financing differs from its canonical boundary or duplicates aggregate costs")
    from .replay_execution import ReplayOpenPosition
    position = ReplayOpenPosition.model_validate(d["open_position"]) if d.get("open_position") else None
    tick = BrokerReplayTick.model_validate(d.get("valuation_tick"))
    if d.get("pending_market_order") != prior["details"].get("pending_market_order"):
        # Queueing a closed-bar intent does not itself create a core ledger event.
        pending = ReplayQueuedMarketOrder.model_validate(d.get("pending_market_order"))
        if (prior["details"].get("pending_market_order") is not None or position is not None
                or pending.submitted_cursor_index != event.cursor_index):
            raise ReplayExecutionError("financing cannot rewrite an existing queued order")
        _validate_quantity(pending.quantity, InstrumentSpec.from_mapping(snapshot.instrument_spec))
    if (d.get("open_position") != prior["details"].get("open_position")
            or tick != BrokerReplayTick.model_validate(prior["details"].get("valuation_tick", prior["details"]))
            or tick.time_msc >= terms.scheduled_time_msc
            or Decimal(str(d.get("previous_balance"))) != Decimal(str(prior["balance"]))
            or Decimal(str(d.get("debit_account"))) != _debit(terms, position)
            or event.balance != Decimal(str(prior["balance"])) - _debit(terms, position)
            or event.floating_pl != Decimal(str(prior["floating_pl"]))
            or event.open_positions != int(position is not None)
            or event.pending_orders != int(d.get("pending_market_order") is not None)
            or d.get("valuation_quality") != "last_observed_quote_not_current_market"):
        raise ReplayExecutionError("financing account movement differs from its position, rate or known quote")
    if any(raw["sequence"] < event.sequence and raw.get("details", {}).get("financing_terms", {}).get("event_id")
           == terms.event_id for raw in snapshot.ledger):
        raise ReplayExecutionError("duplicate financing event evidence")
