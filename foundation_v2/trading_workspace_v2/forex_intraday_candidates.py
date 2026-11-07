"""Eight frozen H1 hypotheses; execution and account risk remain external."""
from collections import deque
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import Candle, CandleState, HOUR, advance_atr14

RSI_REENTRY = 'eurusd-h1-rsi14-reentry-atr14x1p5-time12-r025-v1'
SHOCK = 'eurusd-h1-shock2-reclaim-atr14x1p5-time12-r025-v1'
DAY_BREAK = 'eurusd-h1-prior-day-break-atr14x1p5-close20-r025-v1'
DAY_FADE = 'eurusd-h1-prior-day-fade-atr14x1p5-close20-r025-v1'
BB_REENTRY = 'eurusd-h1-bb20-reentry-atr14x1p5-time12-r025-v1'
PULLBACK = 'eurusd-h1-pullback20-80-atr14x1p5-time24-r025-v1'
EUROPE_AM = 'eurusd-h1-europe-am-short-atr14x1p5-close13-r025-v1'
POSTFIX = 'eurusd-h1-london-postfix16-20-atr14x1p5-r025-v1'
INTRADAY_CANDIDATES = (RSI_REENTRY, SHOCK, DAY_BREAK, DAY_FADE, BB_REENTRY,
                       PULLBACK, EUROPE_AM, POSTFIX)
DAY = 86400


class IntradayH1State(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    schema_version: str = 'forex-intraday-h1-v1'
    candidate: str
    history: tuple[CandleState, ...] = Field(default=(), max_length=100)
    tr_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    atr: Decimal | None = Field(default=None, ge=0)
    gain_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    loss_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    average_gain: Decimal | None = Field(default=None, ge=0)
    average_loss: Decimal | None = Field(default=None, ge=0)
    rsi: Decimal | None = Field(default=None, ge=0, le=100)
    position_id: str | None = Field(default=None, min_length=1)
    position_side: str | None = None
    held_bars: int = Field(default=0, ge=0, strict=True)
    last_entry_day: int | None = Field(default=None, ge=0, strict=True)
    day_index: int | None = Field(default=None, ge=0, strict=True)
    day_hours: int = Field(default=0, ge=0, le=24, strict=True)
    day_high: Decimal | None = Field(default=None, gt=0)
    day_low: Decimal | None = Field(default=None, gt=0)
    range_day: int | None = Field(default=None, ge=0, strict=True)
    range_high: Decimal | None = Field(default=None, gt=0)
    range_low: Decimal | None = Field(default=None, gt=0)

    @model_validator(mode='after')
    def consistent(self):
        times = [p.timestamp for p in self.history]
        seed_length = min(max(len(times)-1, 0), 14)
        if (self.schema_version != 'forex-intraday-h1-v1' or self.candidate not in INTRADAY_CANDIDATES
                or any(t % HOUR for t in times) or any(b <= a for a,b in zip(times,times[1:]))
                or len(self.tr_seed) != min(len(times), 14) or any(v < 0 for v in self.tr_seed)
                or (self.atr is None) != (len(times) < 14)
                or len(self.gain_seed) != seed_length or len(self.loss_seed) != seed_length
                or any(v < 0 for v in (*self.gain_seed, *self.loss_seed))
                or (self.average_gain is None) != (seed_length < 14)
                or (self.average_loss is None) != (seed_length < 14)
                or (self.rsi is None) != (seed_length < 14)
                or self.position_side not in (None, 'BUY', 'SELL')
                or (self.position_id is None) != (self.position_side is None)
                or (self.position_id is None and self.held_bars != 0)
                or (self.position_id is not None and (not self.position_id.strip() or self.held_bars < 1))):
            raise ValueError('inconsistent intraday indicator/position state')
        if (bool(times) != (self.day_index is not None)
                or (times and self.day_index != times[-1]//DAY)
                or (self.day_index is None) != (self.day_high is None)
                or (self.day_index is None) != (self.day_low is None)
                or (self.day_index is None and self.day_hours != 0)
                or (self.day_index is not None and (self.day_hours < 1 or self.day_low > self.day_high))
                or (self.range_day is None) != (self.range_high is None)
                or (self.range_day is None) != (self.range_low is None)
                or (self.range_day is not None and (self.day_index is None or self.range_day >= self.day_index
                    or self.range_low > self.range_high))
                or (self.last_entry_day is not None and (not times
                    or self.last_entry_day > (times[-1]+HOUR)//DAY))):
            raise ValueError('inconsistent intraday daily range state')
        return self


class IntradayH1Candidate:
    def __init__(self, candidate):
        state = IntradayH1State(candidate=candidate)
        self.candidate = candidate
        self.history = deque(maxlen=100)
        for name in type(state).model_fields:
            if name not in ('schema_version', 'candidate', 'history'):
                value = getattr(state, name)
                setattr(self, name, list(value) if name.endswith('_seed') else value)

    def export_state(self):
        fields = {name:getattr(self,name) for name in IntradayH1State.model_fields
                  if name not in ('schema_version','history')}
        return IntradayH1State(**fields, history=tuple(CandleState(**vars(p)) for p in self.history))

    @classmethod
    def from_state(cls, state):
        state = IntradayH1State.model_validate(state)
        result = cls(state.candidate)
        result.history.extend(p.candle() for p in state.history)
        for name in type(state).model_fields:
            if name not in ('schema_version','candidate','history'):
                value = getattr(state,name)
                setattr(result,name,list(value) if name.endswith('_seed') else value)
        return result

    def observe(self, candle:Candle, *, side=None, position_id=None):
        bar = CandleState(**vars(candle))
        if (bar.timestamp % HOUR or (self.history and bar.timestamp <= self.history[-1].timestamp)
                or side not in (None,'BUY','SELL') or (side is None) != (position_id is None)
                or (position_id is not None and (not isinstance(position_id,str) or not position_id.strip()))
                or (position_id is not None and position_id == self.position_id and side != self.position_side)):
            raise ValueError('intraday requires closed increasing H1 and an unambiguous position identity')
        previous = self.history[-1] if self.history else None
        old_atr, old_rsi = self.atr, self.rsi
        if previous is not None:
            change = bar.close-previous.close
            gain, loss = max(change,Decimal(0)), max(-change,Decimal(0))
            if self.average_gain is None:
                self.gain_seed.append(gain);self.loss_seed.append(loss)
                if len(self.gain_seed) == 14:
                    self.average_gain=sum(self.gain_seed,Decimal(0))/14
                    self.average_loss=sum(self.loss_seed,Decimal(0))/14
            else:
                self.average_gain=(self.average_gain*13+gain)/14
                self.average_loss=(self.average_loss*13+loss)/14
            if self.average_gain is not None:
                self.rsi=(Decimal(50) if self.average_loss == self.average_gain == 0 else
                          Decimal(100) if self.average_loss == 0 else
                          100-100/(1+self.average_gain/self.average_loss))
        self.atr=advance_atr14(candle,previous.close if previous else None,self.tr_seed,self.atr)
        distance=self.atr*Decimal('1.5') if self.atr is not None else None
        day=bar.timestamp//DAY
        if day != self.day_index:
            if self.day_hours >= 18:
                self.range_day,self.range_high,self.range_low=self.day_index,self.day_high,self.day_low
            self.day_index,self.day_hours,self.day_high,self.day_low=day,0,bar.high,bar.low
        self.day_hours+=1;self.day_high=max(self.day_high,bar.high);self.day_low=min(self.day_low,bar.low)
        self.held_bars=(self.held_bars+1 if position_id == self.position_id else 1) if position_id else 0
        end=bar.timestamp+HOUR;entry_day=end//DAY;hour=end%DAY//HOUR
        closes=[p.close for p in self.history]
        mean=sum(closes[-20:],Decimal(0))/20 if len(closes) >= 20 else None
        signal=None
        limit=24 if self.candidate == PULLBACK else 12
        if self.candidate in (DAY_BREAK,DAY_FADE):
            if side is not None:
                if hour >= 20 or self.last_entry_day != entry_day:
                    signal='EXIT'
                elif self.candidate == DAY_FADE and self.range_day is not None:
                    midpoint=(self.range_high+self.range_low)/2
                    if (side == 'BUY' and bar.close >= midpoint) or (side == 'SELL' and bar.close <= midpoint):
                        signal='EXIT'
            elif (8 <= hour <= 16 and self.last_entry_day != entry_day and self.range_day is not None
                    and 0 < day-self.range_day <= 4):
                if self.candidate == DAY_BREAK:
                    signal='BUY' if bar.close > self.range_high else 'SELL' if bar.close < self.range_low else None
                else:
                    lower,upper=bar.low < self.range_low,bar.high > self.range_high
                    if lower and not upper and bar.close > self.range_low:signal='BUY'
                    elif upper and not lower and bar.close < self.range_high:signal='SELL'
        elif self.candidate in (EUROPE_AM,POSTFIX):
            zone,start_hour,stop_hour,entry_side=(('Europe/Berlin',8,13,'SELL') if self.candidate == EUROPE_AM
                                                else ('Europe/London',16,20,'BUY'))
            local=datetime.fromtimestamp(end,timezone.utc).astimezone(ZoneInfo(zone))
            if side is not None and (local.hour >= stop_hour or self.last_entry_day != entry_day):signal='EXIT'
            elif (side is None and local.weekday() < 5 and local.hour == start_hour
                    and self.last_entry_day != entry_day):signal=entry_side
        elif side is not None and self.held_bars >= limit:
            signal='EXIT'
        elif self.candidate == RSI_REENTRY and self.rsi is not None:
            if (side == 'BUY' and self.rsi >= 50) or (side == 'SELL' and self.rsi <= 50):signal='EXIT'
            elif side is None and old_rsi is not None:
                if old_rsi <= 30 < self.rsi:signal='BUY'
                elif old_rsi >= 70 > self.rsi:signal='SELL'
        elif self.candidate in (SHOCK,BB_REENTRY) and mean is not None:
            if (side == 'BUY' and bar.close >= mean) or (side == 'SELL' and bar.close <= mean):signal='EXIT'
            elif side is None and self.candidate == SHOCK and old_atr is not None:
                span=previous.high-previous.low
                if span > 0 and span >= 2*old_atr:
                    if previous.close <= previous.low+span/4 and bar.close > (previous.high+previous.low)/2:signal='BUY'
                    elif previous.close >= previous.high-span/4 and bar.close < (previous.high+previous.low)/2:signal='SELL'
            elif side is None and self.candidate == BB_REENTRY:
                sd=(sum(((v-mean)**2 for v in closes[-20:]),Decimal(0))/20).sqrt()
                if sd > 0:
                    if previous.close <= mean-2*sd < bar.close:signal='BUY'
                    elif previous.close >= mean+2*sd > bar.close:signal='SELL'
        elif self.candidate == PULLBACK and len(closes) >= 80:
            values=closes[-79:]+[bar.close]
            fast=sum(values[-20:],Decimal(0))/20;slow=sum(values,Decimal(0))/80
            if (side == 'BUY' and fast <= slow) or (side == 'SELL' and fast >= slow):signal='EXIT'
            elif side is None:
                prior_fast=sum(closes[-20:],Decimal(0))/20
                if fast > slow and previous.close <= prior_fast and bar.close > fast:signal='BUY'
                elif fast < slow and previous.close >= prior_fast and bar.close < fast:signal='SELL'
        if signal in ('BUY','SELL'):
            if distance is None or distance <= 0:signal=None
            elif self.candidate in (DAY_BREAK,DAY_FADE,EUROPE_AM,POSTFIX):self.last_entry_day=entry_day
        self.position_id,self.position_side=position_id,side
        self.history.append(candle)
        return signal,distance
