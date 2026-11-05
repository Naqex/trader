"""Fixed offline EURUSD candidate. No parameter search or broker connection."""
from __future__ import annotations

import csv
import hashlib
import math
import re
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from itertools import groupby
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .replay_tick_execution import BrokerReplayTick

HOUR = 3600
H4 = 4 * HOUR
TICK = Decimal('0.00001')
QDM_TIMESTAMP = re.compile(r'[0-9]{8} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\Z')


def sdk_tick_price(value):
    """Decode native SDK floats while rejecting genuine sub-tick prices."""
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise ValueError('sdk_tick_grid_invalid')
    price = Decimal(str(value))
    if not price % TICK:
        return price
    nearest = price.quantize(TICK)
    tolerance = Decimal(str(math.ulp(value)))
    # At most one floating-point ULP, never an arbitrary price rounding policy.
    if tolerance >= TICK/2 or nearest <= 0 or abs(price-nearest) > tolerance:
        raise ValueError('sdk_tick_grid_invalid')
    return nearest.normalize()


@dataclass(frozen=True)
class Candle:
    timestamp: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal


class CandleState(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    timestamp: int = Field(ge=0, strict=True)
    open: Decimal = Field(gt=0)
    high: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0)
    close: Decimal = Field(gt=0)

    @model_validator(mode='after')
    def valid_ohlc(self):
        if not self.low <= min(self.open, self.close) <= max(self.open, self.close) <= self.high:
            raise ValueError('invalid candle OHLC')
        return self

    def candle(self):
        return Candle(**self.model_dump())


class H4BuilderState(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    parts: tuple[CandleState, ...] = Field(default=(), max_length=3)
    excluded: tuple[int, ...] = ()

    @model_validator(mode='after')
    def valid_parts(self):
        times = [p.timestamp for p in self.parts]
        if (any(t % HOUR for t in times) or
                any(b <= a or b // H4 != a // H4 for a, b in zip(times, times[1:])) or
                any(t < 0 or t % H4 for t in self.excluded) or
                any(b <= a for a, b in zip(self.excluded, self.excluded[1:]))):
            raise ValueError('invalid H4 builder state')
        return self


class H4CandidateState(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    history: tuple[CandleState, ...] = Field(default=(), max_length=20)
    tr_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    atr: Decimal | None = Field(default=None, ge=0)
    previous_close: Decimal | None = Field(default=None, gt=0)

    @model_validator(mode='after')
    def valid_indicator_state(self):
        times = [p.timestamp for p in self.history]
        if (any(t % H4 for t in times) or any(b <= a for a, b in zip(times, times[1:])) or
                any(v < 0 for v in self.tr_seed) or
                len(self.tr_seed) != min(len(self.history), 14) or
                (self.atr is None) != (len(self.tr_seed) < 14) or
                (self.previous_close != self.history[-1].close if self.history else
                 self.previous_close is not None or self.tr_seed or self.atr is not None)):
            raise ValueError('invalid H4 candidate state')
        return self


def read_qdm_ticks(path: Path, *, sha256: str, first_day: str, last_day: str):
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != sha256:
            raise ValueError('QDM CSV hash mismatch')
    previous = None
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ['DateTime', 'Bid', 'Ask', 'Volume']:
            raise ValueError('unexpected QDM tick header')
        for ordinal, row in enumerate(reader, 1):
            stamp = row['DateTime']
            if len(stamp) != 21 or stamp[-4] != '.' or not first_day <= stamp[:8] <= last_day:
                raise ValueError('quote outside registered dates or missing milliseconds')
            if QDM_TIMESTAMP.fullmatch(stamp):
                # ISO's C parser avoids strptime's per-tick locale/regex work.
                # Guard its broader grammar; retain legacy parsing off the fast path.
                dt = datetime.fromisoformat(stamp[:8] + 'T' + stamp[9:] + '+00:00')
            else:
                dt = datetime.strptime(stamp, '%Y%m%d %H:%M:%S.%f').replace(tzinfo=timezone.utc)
            tick = BrokerReplayTick(time_msc=int(dt.timestamp()) * 1000 + dt.microsecond // 1000,
                                    sequence=ordinal, bid=row['Bid'], ask=row['Ask'])
            if previous is not None and tick.time_msc < previous:
                raise ValueError('QDM source timestamp order reversed')
            if tick.bid % TICK or tick.ask % TICK:
                raise ValueError('QDM price does not align with declared tick size')
            previous = tick.time_msc
            yield tick


def hourly_quotes(ticks):
    for hour, group in groupby(ticks, lambda tick: tick.time_msc // (HOUR * 1000)):
        quotes = list(group)
        mids = [(tick.bid + tick.ask) / 2 for tick in quotes]
        yield Candle(hour * HOUR, mids[0], max(mids), min(mids), mids[-1]), quotes


class H4Builder:
    def __init__(self):
        self.parts = []
        self.excluded = []

    def export_state(self):
        return H4BuilderState(parts=tuple(CandleState(**vars(p)) for p in self.parts),
                              excluded=tuple(self.excluded))

    @classmethod
    def from_state(cls, state: H4BuilderState):
        state = H4BuilderState.model_validate(state)
        result = cls()
        result.parts = [p.candle() for p in state.parts]
        result.excluded = list(state.excluded)
        return result

    def add(self, hour: Candle):
        if self.parts and hour.timestamp // H4 != self.parts[0].timestamp // H4:
            self.excluded.append(self.parts[0].timestamp // H4 * H4)
            self.parts = []
        self.parts.append(hour)
        if (hour.timestamp + HOUR) % H4:
            return None
        parts, self.parts = self.parts, []
        start = hour.timestamp // H4 * H4
        if [p.timestamp for p in parts] != list(range(start, start + H4, HOUR)):
            self.excluded.append(start)
            return None
        return Candle(start, parts[0].open, max(p.high for p in parts),
                      min(p.low for p in parts), parts[-1].close)

    def finish(self):
        if self.parts:
            self.excluded.append(self.parts[0].timestamp // H4 * H4)
            self.parts = []


def advance_atr14(candle, previous_close, seed, atr):
    tr = candle.high - candle.low
    if previous_close is not None:
        tr = max(tr, abs(candle.high - previous_close), abs(candle.low - previous_close))
    if atr is None:
        seed.append(tr)
        return sum(seed, Decimal(0)) / 14 if len(seed) == 14 else None
    return (13 * atr + tr) / 14


class FixedH4Candidate:
    def __init__(self):
        self.history = deque(maxlen=20)
        self.tr_seed = []
        self.atr = None
        self.previous_close = None

    def export_state(self):
        return H4CandidateState(history=tuple(CandleState(**vars(p)) for p in self.history),
            tr_seed=tuple(self.tr_seed), atr=self.atr, previous_close=self.previous_close)

    @classmethod
    def from_state(cls, state: H4CandidateState):
        state = H4CandidateState.model_validate(state)
        result = cls()
        result.history.extend(p.candle() for p in state.history)
        result.tr_seed = list(state.tr_seed)
        result.atr, result.previous_close = state.atr, state.previous_close
        return result

    def observe(self, candle: Candle, *, side=None):
        if self.history and candle.timestamp <= self.history[-1].timestamp:
            raise ValueError('candidate candles must increase')
        self.atr = advance_atr14(candle, self.previous_close, self.tr_seed, self.atr)
        signal = None
        previous = list(self.history)
        if len(previous) == 20 and self.atr is not None and self.atr > 0:
            if side == 'BUY' and candle.close < min(p.low for p in previous[-10:]):
                signal = 'EXIT'
            elif side == 'SELL' and candle.close > max(p.high for p in previous[-10:]):
                signal = 'EXIT'
            elif side is None:
                if candle.close > max(p.high for p in previous):
                    signal = 'BUY'
                elif candle.close < min(p.low for p in previous):
                    signal = 'SELL'
        self.history.append(candle)
        self.previous_close = candle.close
        return signal, self.atr * 2 if self.atr is not None else None


def size_for_stop(distance: Decimal, *, slippage: Decimal, budget=Decimal('25')):
    values = (distance, slippage, budget)
    if any(not v.is_finite() for v in values) or distance <= 0 or slippage < 0 or budget <= 0:
        raise ValueError('invalid sizing terms')
    per_lot = (distance + TICK + 2 * slippage) * 100000 + Decimal('5')
    quantity = (budget / per_lot / Decimal('0.01')).to_integral_value(rounding=ROUND_FLOOR) * Decimal('0.01')
    return quantity if quantity >= Decimal('0.01') else None


def inspect_qdm(path: Path, *, sha256: str, first_day: str, last_day: str):
    count = 0
    first = previous = None
    maximum_gap = 0
    minutes = set()
    builder = H4Builder()
    bars = []
    hours = 0
    for hour, quotes in hourly_quotes(read_qdm_ticks(path, sha256=sha256,
                                                    first_day=first_day, last_day=last_day)):
        hours += 1
        for quote in quotes:
            first = quote.time_msc if first is None else first
            if previous is not None:
                maximum_gap = max(maximum_gap, quote.time_msc - previous)
            previous = quote.time_msc
            count += 1
            minutes.add(quote.time_msc // 60000)
        candle = builder.add(hour)
        if candle:
            bars.append(candle)
    builder.finish()
    if not count:
        raise ValueError('registered QDM slice is empty')
    return dict(ticks=count, first_time_msc=first, last_time_msc=previous,
        quoted_hours=hours, quoted_minutes=len(minutes), maximum_adjacent_gap_msc=maximum_gap,
        minutes_without_quote_between_first_and_last=previous // 60000 - first // 60000 + 1 - len(minutes),
        complete_h4=len(bars), excluded_h4=builder.excluded,
        quality='observed_quotes_only_not_complete_coverage'), bars
