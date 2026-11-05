"""Fixed round-two research hypotheses; no broker or model access."""
from collections import deque
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import Candle, CandleState, H4, advance_atr14

PULLBACK = 'eurusd-h4-pullback20-80-atr14-r025-v1'
UTC_RANGE = 'eurusd-h4-utc-range00-08-atr14-r025-v1'
PROP_CANDIDATES = (PULLBACK, UTC_RANGE)
DAY = 86400


class PropH4State(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    schema_version: Literal['forex-prop-candidate-v1'] = 'forex-prop-candidate-v1'
    candidate: Literal['eurusd-h4-pullback20-80-atr14-r025-v1', 'eurusd-h4-utc-range00-08-atr14-r025-v1']
    history: tuple[CandleState, ...] = Field(default=(), max_length=80)
    tr_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    atr: Decimal | None = Field(default=None, ge=0)
    last_entry_day: int | None = Field(default=None, ge=0, strict=True)
    position_id: str | None = Field(default=None, min_length=1)
    position_side: Literal['BUY', 'SELL'] | None = None

    @model_validator(mode='after')
    def consistent(self):
        times = [bar.timestamp for bar in self.history]
        if (any(t % H4 for t in times)
                or any(b <= a for a, b in zip(times, times[1:]))
                or len(self.tr_seed) != min(len(times), 14)
                or any(v < 0 for v in self.tr_seed)
                or (self.atr is None) != (len(self.tr_seed) < 14)
                or (self.position_id is None) != (self.position_side is None)
                or (self.position_id is not None and (not times or not self.position_id.strip()))
                or (self.last_entry_day is not None and
                    (self.candidate != UTC_RANGE or not times or self.last_entry_day > times[-1] // DAY))):
            raise ValueError('inconsistent prop candidate state')
        return self


class PropH4Candidate:
    def __init__(self, candidate):
        if candidate not in PROP_CANDIDATES:
            raise ValueError('unregistered prop candidate')
        self.candidate = candidate
        self.history = deque(maxlen=80)
        self.tr_seed = []
        self.atr = None
        self.last_entry_day = None
        self.position_id = self.position_side = None

    def export_state(self):
        return PropH4State(candidate=self.candidate,
            history=tuple(CandleState(**vars(bar)) for bar in self.history),
            tr_seed=tuple(self.tr_seed), atr=self.atr, last_entry_day=self.last_entry_day,
            position_id=self.position_id, position_side=self.position_side)

    @classmethod
    def from_state(cls, state):
        state = PropH4State.model_validate(state)
        result = cls(state.candidate)
        result.history.extend(bar.candle() for bar in state.history)
        result.tr_seed, result.atr = list(state.tr_seed), state.atr
        result.last_entry_day = state.last_entry_day
        result.position_id, result.position_side = state.position_id, state.position_side
        return result

    def observe(self, candle: Candle, *, side=None, position_id=None):
        bar = CandleState(**vars(candle))
        if bar.timestamp % H4 or (self.history and bar.timestamp <= self.history[-1].timestamp):
            raise ValueError('prop candidate requires increasing aligned H4 candles')
        if (side not in (None, 'BUY', 'SELL') or (side is None) != (position_id is None)
                or (position_id is not None and (not isinstance(position_id, str) or not position_id.strip()))
                or (position_id is not None and position_id == self.position_id and side != self.position_side)):
            raise ValueError('prop candidate requires an unambiguous position identity')
        previous_close = self.history[-1].close if self.history else None
        self.atr = advance_atr14(candle, previous_close, self.tr_seed, self.atr)
        distance = self.atr * 2 if self.atr is not None else None
        signal = None
        if self.candidate == PULLBACK and len(self.history) == 80:
            closes = [p.close for p in self.history]
            previous_fast = sum(closes[-20:], Decimal(0)) / 20
            current = closes[1:] + [bar.close]
            fast = sum(current[-20:], Decimal(0)) / 20
            slow = sum(current, Decimal(0)) / 80
            if (side == 'BUY' and fast <= slow) or (side == 'SELL' and fast >= slow):
                signal = 'EXIT'
            elif side is None:
                if fast > slow and closes[-1] <= previous_fast and bar.close > fast:
                    signal = 'BUY'
                elif fast < slow and closes[-1] >= previous_fast and bar.close < fast:
                    signal = 'SELL'
        elif self.candidate == UTC_RANGE:
            day, offset = divmod(bar.timestamp, DAY)
            if side is not None and (offset >= 4 * H4 or self.last_entry_day != day):
                signal = 'EXIT'
            elif side is None and offset in (2 * H4, 3 * H4) and self.last_entry_day != day:
                # Only today's two complete range bars count; a missing bar does
                # not inherit yesterday's range or a partial hourly projection.
                bounds = {p.timestamp % DAY: p for p in self.history
                          if p.timestamp // DAY == day and p.timestamp % DAY in (0, H4)}
                if len(bounds) == 2:
                    if bar.close > max(p.high for p in bounds.values()):
                        signal = 'BUY'
                    elif bar.close < min(p.low for p in bounds.values()):
                        signal = 'SELL'
        if signal in ('BUY', 'SELL'):
            if distance is None or distance <= 0:
                signal = None
            elif self.candidate == UTC_RANGE:
                # Consume the signal even if execution later rejects it.
                self.last_entry_day = bar.timestamp // DAY
        self.position_id, self.position_side = position_id, side
        self.history.append(candle)
        return signal, distance
