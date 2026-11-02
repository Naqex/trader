"""Fixed offline EURUSD candidate. No parameter search or broker connection."""
from __future__ import annotations

import csv
import hashlib
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from itertools import groupby
from pathlib import Path

from .replay_tick_execution import BrokerReplayTick

HOUR = 3600
H4 = 4 * HOUR
TICK = Decimal('0.00001')


@dataclass(frozen=True)
class Candle:
    timestamp: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal


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


class FixedH4Candidate:
    def __init__(self):
        self.history = deque(maxlen=20)
        self.tr_seed = []
        self.atr = None
        self.previous_close = None

    def observe(self, candle: Candle, *, side=None):
        if self.history and candle.timestamp <= self.history[-1].timestamp:
            raise ValueError('candidate candles must increase')
        tr = candle.high - candle.low
        if self.previous_close is not None:
            tr = max(tr, abs(candle.high - self.previous_close), abs(candle.low - self.previous_close))
        if self.atr is None:
            self.tr_seed.append(tr)
            if len(self.tr_seed) == 14:
                self.atr = sum(self.tr_seed, Decimal(0)) / 14
        else:
            self.atr = (13 * self.atr + tr) / 14
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
