"""Two fixed research comparators; no parameter search or broker access."""
from collections import deque
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import Candle, CandleState, H4, advance_atr14

SMA = 'eurusd-h4-sma20-80-atr14-r025-v1'
ZSCORE = 'eurusd-h4-z20-2-atr14-time6-r025-v1'
BASELINE = 'eurusd-h4-donchian20-10-atr14-r025-v1'
CANDIDATES = (SMA, ZSCORE)
STUDY_CANDIDATES = (BASELINE, *CANDIDATES)
METAL_BASELINE = 'xauusd-h4-donchian20-10-atr14-r025-v1'
METAL_SMA = 'xauusd-h4-sma20-80-atr14-r025-v1'
METAL_ZSCORE = 'xauusd-h4-z20-2-atr14-time6-r025-v1'
METAL_CANDIDATES = (METAL_BASELINE, METAL_SMA, METAL_ZSCORE)


def candidate_rule(candidate):
    return {METAL_SMA:SMA,METAL_ZSCORE:ZSCORE}.get(candidate,candidate)


class ResearchH4State(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    schema_version: Literal['forex-h4-research-candidate-v1'] = 'forex-h4-research-candidate-v1'
    candidate: Literal['eurusd-h4-sma20-80-atr14-r025-v1', 'eurusd-h4-z20-2-atr14-time6-r025-v1',
                       'xauusd-h4-sma20-80-atr14-r025-v1', 'xauusd-h4-z20-2-atr14-time6-r025-v1']
    history: tuple[CandleState, ...] = Field(default=(), max_length=80)
    tr_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    atr: Decimal | None = Field(default=None, ge=0)
    previous_difference: Decimal | None = None
    position_id: str | None = Field(default=None, min_length=1)
    position_side: Literal['BUY', 'SELL'] | None = None
    held_bars: int = Field(default=0, ge=0, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        times = [bar.timestamp for bar in self.history]
        limit = 80 if candidate_rule(self.candidate) == SMA else 20
        if (len(self.history) > limit or any(t % H4 for t in times)
                or any(b <= a for a, b in zip(times, times[1:]))
                or len(self.tr_seed) != min(len(self.history), 14)
                or any(v < 0 for v in self.tr_seed)
                or (self.atr is None) != (len(self.tr_seed) < 14)
                or (self.previous_difference is not None) != (candidate_rule(self.candidate) == SMA and len(self.history) == 80)
                or (self.position_id is None) != (self.position_side is None)
                or (self.position_id is None and self.held_bars != 0)
                or (self.position_id is not None and (not self.history or self.held_bars < 1 or not self.position_id.strip()))):
            raise ValueError('inconsistent research candidate state')
        if candidate_rule(self.candidate) == SMA and len(self.history) == 80:
            closes = [bar.close for bar in self.history]
            expected = sum(closes[-20:], Decimal(0))/20 - sum(closes, Decimal(0))/80
            if self.previous_difference != expected:
                raise ValueError('research SMA state differs from its history')
        return self


class ResearchH4Candidate:
    def __init__(self, candidate):
        if candidate not in (*CANDIDATES,METAL_SMA,METAL_ZSCORE):
            raise ValueError('unregistered research candidate')
        self.candidate = candidate
        self.history = deque(maxlen=80 if candidate_rule(candidate) == SMA else 20)
        self.tr_seed = []
        self.atr = None
        self.previous_difference = None
        self.position_id = self.position_side = None
        self.held_bars = 0

    def export_state(self):
        return ResearchH4State(candidate=self.candidate,
            history=tuple(CandleState(**vars(bar)) for bar in self.history),
            tr_seed=tuple(self.tr_seed), atr=self.atr,
            previous_difference=self.previous_difference, position_id=self.position_id,
            position_side=self.position_side, held_bars=self.held_bars)

    @classmethod
    def from_state(cls, state):
        state = ResearchH4State.model_validate(state)
        result = cls(state.candidate)
        result.history.extend(bar.candle() for bar in state.history)
        result.tr_seed, result.atr = list(state.tr_seed), state.atr
        result.previous_difference = state.previous_difference
        result.position_id, result.position_side = state.position_id, state.position_side
        result.held_bars = state.held_bars
        return result

    def observe(self, candle: Candle, *, side=None, position_id=None):
        bar = CandleState(**vars(candle))
        if bar.timestamp % H4 or (self.history and bar.timestamp <= self.history[-1].timestamp):
            raise ValueError('research candidate requires increasing aligned H4 candles')
        if (side not in (None, 'BUY', 'SELL') or (side is None) != (position_id is None)
                or (position_id is not None and (not isinstance(position_id, str) or not position_id.strip()))
                or (position_id is not None and position_id == self.position_id and side != self.position_side)):
            raise ValueError('research candidate requires an unambiguous position identity')
        previous_close = self.history[-1].close if self.history else None
        self.atr = advance_atr14(candle, previous_close, self.tr_seed, self.atr)
        # Count actual completed H4 observations while the same position exists,
        # including the bar containing its fill; skipped hours are never invented.
        self.held_bars = (self.held_bars + 1 if position_id == self.position_id else 1) if position_id else 0
        self.position_id, self.position_side = position_id, side
        signal = None
        if candidate_rule(self.candidate) == SMA:
            closes = [p.close for p in self.history] + [bar.close]
            if len(closes) >= 80:
                difference = sum(closes[-20:], Decimal(0))/20 - sum(closes[-80:], Decimal(0))/80
                if (side == 'BUY' and difference <= 0) or (side == 'SELL' and difference >= 0):
                    signal = 'EXIT'
                elif side is None and self.previous_difference is not None:
                    if self.previous_difference <= 0 < difference:
                        signal = 'BUY'
                    elif self.previous_difference >= 0 > difference:
                        signal = 'SELL'
                self.previous_difference = difference
        else:
            if side is not None and self.held_bars >= 6:
                signal = 'EXIT'
            elif len(self.history) == 20:
                mean = sum((p.close for p in self.history), Decimal(0))/20
                variance = sum(((p.close-mean)**2 for p in self.history), Decimal(0))/20
                if variance > 0:
                    z = (bar.close-mean)/variance.sqrt()
                    if (side == 'BUY' and z >= 0) or (side == 'SELL' and z <= 0):
                        signal = 'EXIT'
                    elif side is None:
                        signal = 'BUY' if z <= -2 else 'SELL' if z >= 2 else None
        self.history.append(candle)
        distance = self.atr * 2 if self.atr is not None else None
        if signal in ('BUY', 'SELL') and (distance is None or distance <= 0):
            signal = None
        return signal, distance
