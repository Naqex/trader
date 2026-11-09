"""Frozen H1 hypotheses; execution and account risk remain external."""
from collections import deque
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import Candle, CandleState, HOUR, advance_atr14

RSI_REENTRY = 'eurusd-h1-rsi14-reentry-atr14x1p5-time12-r025-v1'
SHOCK = 'eurusd-h1-shock2-reclaim-atr14x1p5-time12-r025-v1'
DAY_BREAK = 'eurusd-h1-prior-day-break-atr14x1p5-close20-r025-v1'
DAY_RETEST = 'eurusd-h1-prior-day-retest3-atr14x1p5-close20-r025-v1'
DAY_FADE = 'eurusd-h1-prior-day-fade-atr14x1p5-close20-r025-v1'
BB_REENTRY = 'eurusd-h1-bb20-reentry-atr14x1p5-time12-r025-v1'
PULLBACK = 'eurusd-h1-pullback20-80-atr14x1p5-time24-r025-v1'
EUROPE_AM = 'eurusd-h1-europe-am-short-atr14x1p5-close13-r025-v1'
POSTFIX = 'eurusd-h1-london-postfix16-20-atr14x1p5-r025-v1'
PRE_ECB = 'eurusd-h1-pre-ecb02ny-14berlin-atr14x1p5-r025-v1'
POST_LONDON = 'eurusd-h1-post-london16-16ny-atr14x1p5-r025-v1'
PRE_TOKYO = 'eurusd-h1-pre-tokyo18ny-10tokyo-atr14x1p5-r025-v1'
FIX_COMPOSITE = 'eurusd-h1-fixing-composite-atr14x1p5-r025-v1'
FIXING_CANDIDATES = (PRE_ECB, POST_LONDON, PRE_TOKYO, FIX_COMPOSITE)
LONDON_ORB = 'eurusd-h1-london-orb08-09-atr14x1p5-r025-v1'
NY_ORB = 'eurusd-h1-ny-orb08-09-atr14x1p5-r025-v1'
ASIA_ORB = 'eurusd-h1-asia09-15tokyo-london-break-atr14x1p5-r025-v1'
BB_FLAT = 'eurusd-h1-bb20-reentry-flat80-atr14x1p5-time12-r025-v1'
ORB_CANDIDATES = (LONDON_ORB, NY_ORB, ASIA_ORB)
ROUND7_CANDIDATES = (*ORB_CANDIDATES, BB_FLAT)
INTRADAY_CANDIDATES = (RSI_REENTRY, SHOCK, DAY_BREAK, DAY_RETEST, DAY_FADE, BB_REENTRY,
                       PULLBACK, EUROPE_AM, POSTFIX, *FIXING_CANDIDATES, *ROUND7_CANDIDATES)
METAL_ASIA_ORB = 'xauusd-h1-asia09-15tokyo-london-break-atr14x1p5-r025-v1'
METAL_RSI = 'xauusd-h1-rsi14-reentry-atr14x1p5-time12-r025-v1'
METAL_AFTERNOON = 'xauusd-h1-london-afternoon-reversal15-19-atr14x1p5-r025-v1'
METAL_INTRADAY_CANDIDATES = (METAL_ASIA_ORB,METAL_RSI,METAL_AFTERNOON)
SCHEDULED_CANDIDATES = (*FIXING_CANDIDATES,*ORB_CANDIDATES,METAL_AFTERNOON)
DAY = 86400


def intraday_recipe(candidate):
    return {METAL_ASIA_ORB:ASIA_ORB,METAL_RSI:RSI_REENTRY}.get(candidate,candidate)


def intraday_contract(candidate):
    if candidate == DAY_RETEST:return 'PRIOR-DAY-RETEST-PROTOCOL-20261108.md'
    if candidate in FIXING_CANDIDATES:return 'SESSION-DISCOVERY6-20261108.md'
    if candidate in ROUND7_CANDIDATES:return 'ORB-DISCOVERY7-20261108.md'
    if candidate in INTRADAY_CANDIDATES:return 'CHALLENGE-DISCOVERY-ROUND4-20261108.md'
    raise ValueError('unknown H1 contract')


def fixing_entry(candidate, end):
    now = datetime.fromtimestamp(end, timezone.utc)
    slots = ((PRE_ECB, 'America/New_York', 2, 'Europe/Berlin', 14, 'SELL', 5),
             (POST_LONDON, 'Europe/London', 16, 'America/New_York', 16, 'BUY', 5),
             (PRE_TOKYO, 'America/New_York', 18, 'Asia/Tokyo', 10, 'SELL', 4))
    for identity, entry_zone, entry_hour, exit_zone, exit_hour, side, weekdays in slots:
        local = now.astimezone(ZoneInfo(entry_zone))
        if (candidate not in (identity, FIX_COMPOSITE) or local.weekday() >= weekdays
                or local.hour != entry_hour or local.minute or local.second):
            continue
        deadline = now.astimezone(ZoneInfo(exit_zone)).replace(hour=exit_hour, minute=0, second=0, microsecond=0)
        if deadline <= now:
            deadline += timedelta(days=1)
        return side, int(deadline.timestamp())
    return None, None


def opening_entry(candidate, history, candle):
    entry_zone = 'America/New_York' if candidate == NY_ORB else 'Europe/London'
    range_zone = 'Asia/Tokyo' if candidate == ASIA_ORB else entry_zone
    end = datetime.fromtimestamp(candle.timestamp+HOUR, timezone.utc)
    local = end.astimezone(ZoneInfo(entry_zone))
    if local.weekday() >= 5 or local.hour not in ((8,9,10,11,12) if candidate == ASIA_ORB else (10,11,12)):
        return None, None
    target_date = end.astimezone(ZoneInfo(range_zone)).date()
    required = set(range(9,15)) if candidate == ASIA_ORB else {8}
    observed = []
    for bar in (*history, candle):
        at = datetime.fromtimestamp(bar.timestamp, timezone.utc).astimezone(ZoneInfo(range_zone))
        if at.date() == target_date and at.hour in required:
            observed.append((at.hour,bar))
    if {h for h,_ in observed} != required or len(observed) != len(required):
        return None, None
    high, low = max(b.high for _,b in observed), min(b.low for _,b in observed)
    side = 'BUY' if candle.close > high else 'SELL' if candle.close < low else None
    deadline = int(local.replace(hour=16,minute=0,second=0,microsecond=0).timestamp())
    return side, deadline if side else None


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
    scheduled_exit: int | None = Field(default=None, gt=0, strict=True)
    retest_side: str | None = None
    retest_level: Decimal | None = Field(default=None, gt=0)
    retest_armed_at: int | None = Field(default=None, gt=0, strict=True)
    retest_attempt_day: int | None = Field(default=None, ge=0, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        recipe=intraday_recipe(self.candidate)
        times = [p.timestamp for p in self.history]
        seed_length = min(max(len(times)-1, 0), 14)
        if (self.schema_version != 'forex-intraday-h1-v1' or self.candidate not in (*INTRADAY_CANDIDATES,*METAL_INTRADAY_CANDIDATES)
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
                or (self.scheduled_exit is not None and (recipe not in SCHEDULED_CANDIDATES
                    or self.scheduled_exit % HOUR))
                or (recipe in SCHEDULED_CANDIDATES and self.position_id is not None and self.scheduled_exit is None)
                or (self.last_entry_day is not None and (not times
                    or self.last_entry_day > (times[-1]+HOUR)//DAY))):
            raise ValueError('inconsistent intraday daily range state')
        pending=(self.retest_side,self.retest_level,self.retest_armed_at)
        if ((recipe != DAY_RETEST and any(v is not None for v in (*pending,self.retest_attempt_day)))
                or (any(v is not None for v in pending) and any(v is None for v in pending))
                or (recipe == DAY_RETEST and self.last_entry_day is not None
                    and (self.retest_attempt_day is None or self.last_entry_day>self.retest_attempt_day))
                or (self.retest_attempt_day is not None and (not times
                    or self.retest_attempt_day>(times[-1]+HOUR)//DAY))):
            raise ValueError('inconsistent retest ownership/attempt state')
        if self.retest_side is not None:
            if (self.retest_side not in ('BUY','SELL') or not times or self.position_id is not None
                    or self.retest_armed_at%HOUR or self.retest_armed_at//DAY!=self.day_index
                    or not 8<=self.retest_armed_at%DAY//HOUR<16
                    or self.retest_attempt_day!=self.day_index or self.range_day is None
                    or not 0<self.day_index-self.range_day<=4
                    or not self.retest_armed_at<=times[-1]+HOUR<self.retest_armed_at+3*HOUR
                    or self.retest_level!=(self.range_high if self.retest_side=='BUY' else self.range_low)):
                raise ValueError('inconsistent pending retest level/clock')
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

    def _clear_retest(self):
        self.retest_side=self.retest_level=self.retest_armed_at=None

    def _retest_signal(self,bar,previous,day,entry_day,hour,end):
        if (not 8<=hour<=16 or self.last_entry_day==entry_day or self.range_day is None
                or not 0<day-self.range_day<=4):
            self._clear_retest();return None
        if self.retest_side is not None:
            if (self.retest_armed_at//DAY!=entry_day or previous is None
                    or bar.timestamp!=previous.timestamp+HOUR or end>self.retest_armed_at+3*HOUR):
                self._clear_retest();return None
            # The confirmation is a later closed bar; the breakout bar's wick
            # cannot be interpreted as a retest with an invented intrabar order.
            side,level=self.retest_side,self.retest_level
            invalid=bar.close<=level if side=='BUY' else bar.close>=level
            touched=bar.low<=level if side=='BUY' else bar.high>=level
            if invalid:self._clear_retest();return None
            if touched:self._clear_retest();return side
            if end>=self.retest_armed_at+3*HOUR:self._clear_retest()
        elif hour<16 and self.retest_attempt_day!=entry_day:
            side='BUY' if bar.close>self.range_high else 'SELL' if bar.close<self.range_low else None
            if side:
                self.retest_side=side;self.retest_level=self.range_high if side=='BUY' else self.range_low
                self.retest_armed_at=end;self.retest_attempt_day=entry_day
        return None

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
        recipe=intraday_recipe(self.candidate)
        if (bar.timestamp % HOUR or (self.history and bar.timestamp <= self.history[-1].timestamp)
                or side not in (None,'BUY','SELL') or (side is None) != (position_id is None)
                or (position_id is not None and (not isinstance(position_id,str) or not position_id.strip()))
                or (position_id is not None and position_id == self.position_id and side != self.position_side)):
            raise ValueError('intraday requires closed increasing H1 and an unambiguous position identity')
        if (recipe in SCHEDULED_CANDIDATES and side is not None
                and (self.scheduled_exit is None or (self.position_id is not None and self.position_id != position_id))):
            raise ValueError('fixing position has no owned entry deadline')
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
        limit=24 if recipe == PULLBACK else 12
        if recipe in SCHEDULED_CANDIDATES:
            if side is not None:
                if end >= self.scheduled_exit:signal='EXIT'
            else:
                self.scheduled_exit=None
                if distance is not None and distance > 0:
                    if recipe == METAL_AFTERNOON:
                        local=datetime.fromtimestamp(end,timezone.utc).astimezone(ZoneInfo('Europe/London'))
                        if local.weekday()<5 and local.hour==15 and self.last_entry_day!=entry_day:
                            opens=[p.open for p in self.history if
                                (at:=datetime.fromtimestamp(p.timestamp,timezone.utc).astimezone(ZoneInfo('Europe/London'))).date()==local.date()
                                and at.hour==9]
                            if len(opens)==1 and len(self.history)>=99 and self.atr is not None:
                                change=bar.close-opens[0]
                                signal='SELL' if change>=self.atr else 'BUY' if change<=-self.atr else None
                                if signal:self.scheduled_exit=int(local.replace(hour=19).timestamp())
                    elif recipe in FIXING_CANDIDATES:
                        signal,self.scheduled_exit=fixing_entry(recipe,end)
                    elif self.last_entry_day != entry_day:
                        signal,self.scheduled_exit=opening_entry(recipe,self.history,candle)
        elif recipe in (DAY_BREAK,DAY_RETEST,DAY_FADE):
            if side is not None:
                if recipe == DAY_RETEST:self._clear_retest()
                if hour >= 20 or self.last_entry_day != entry_day:
                    signal='EXIT'
                elif recipe == DAY_FADE and self.range_day is not None:
                    midpoint=(self.range_high+self.range_low)/2
                    if (side == 'BUY' and bar.close >= midpoint) or (side == 'SELL' and bar.close <= midpoint):
                        signal='EXIT'
            elif recipe == DAY_RETEST:
                signal=self._retest_signal(bar,previous,day,entry_day,hour,end)
            elif (8 <= hour <= 16 and self.last_entry_day != entry_day and self.range_day is not None
                    and 0 < day-self.range_day <= 4):
                if recipe == DAY_BREAK:
                    signal='BUY' if bar.close > self.range_high else 'SELL' if bar.close < self.range_low else None
                else:
                    lower,upper=bar.low < self.range_low,bar.high > self.range_high
                    if lower and not upper and bar.close > self.range_low:signal='BUY'
                    elif upper and not lower and bar.close < self.range_high:signal='SELL'
        elif recipe in (EUROPE_AM,POSTFIX):
            zone,start_hour,stop_hour,entry_side=(('Europe/Berlin',8,13,'SELL') if recipe == EUROPE_AM
                                                else ('Europe/London',16,20,'BUY'))
            local=datetime.fromtimestamp(end,timezone.utc).astimezone(ZoneInfo(zone))
            if side is not None and (local.hour >= stop_hour or self.last_entry_day != entry_day):signal='EXIT'
            elif (side is None and local.weekday() < 5 and local.hour == start_hour
                    and self.last_entry_day != entry_day):signal=entry_side
        elif side is not None and self.held_bars >= limit:
            signal='EXIT'
        elif recipe == RSI_REENTRY and self.rsi is not None:
            if (side == 'BUY' and self.rsi >= 50) or (side == 'SELL' and self.rsi <= 50):signal='EXIT'
            elif side is None and old_rsi is not None:
                if old_rsi <= 30 < self.rsi:signal='BUY'
                elif old_rsi >= 70 > self.rsi:signal='SELL'
        elif recipe in (SHOCK,BB_REENTRY,BB_FLAT) and mean is not None:
            if (side == 'BUY' and bar.close >= mean) or (side == 'SELL' and bar.close <= mean):signal='EXIT'
            elif side is None and recipe == SHOCK and old_atr is not None:
                span=previous.high-previous.low
                if span > 0 and span >= 2*old_atr:
                    if previous.close <= previous.low+span/4 and bar.close > (previous.high+previous.low)/2:signal='BUY'
                    elif previous.close >= previous.high-span/4 and bar.close < (previous.high+previous.low)/2:signal='SELL'
            elif side is None and (recipe == BB_REENTRY or (recipe == BB_FLAT
                    and len(closes)>=80 and old_atr is not None
                    and abs(mean-sum(closes[-80:],Decimal(0))/80)<=old_atr/2)):
                sd=(sum(((v-mean)**2 for v in closes[-20:]),Decimal(0))/20).sqrt()
                if sd > 0:
                    if previous.close <= mean-2*sd < bar.close:signal='BUY'
                    elif previous.close >= mean+2*sd > bar.close:signal='SELL'
        elif recipe == PULLBACK and len(closes) >= 80:
            values=closes[-79:]+[bar.close]
            fast=sum(values[-20:],Decimal(0))/20;slow=sum(values,Decimal(0))/80
            if (side == 'BUY' and fast <= slow) or (side == 'SELL' and fast >= slow):signal='EXIT'
            elif side is None:
                prior_fast=sum(closes[-20:],Decimal(0))/20
                if fast > slow and previous.close <= prior_fast and bar.close > fast:signal='BUY'
                elif fast < slow and previous.close >= prior_fast and bar.close < fast:signal='SELL'
        if signal in ('BUY','SELL'):
            if distance is None or distance <= 0:signal=None
            elif recipe in (DAY_BREAK,DAY_RETEST,DAY_FADE,EUROPE_AM,POSTFIX,*ORB_CANDIDATES,METAL_AFTERNOON):self.last_entry_day=entry_day
        self.position_id,self.position_side=position_id,side
        self.history.append(candle)
        return signal,distance
