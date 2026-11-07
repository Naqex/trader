"""Three preregistered H4 hypotheses, not a parameter-search engine."""
from collections import deque
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import Candle, CandleState, H4, advance_atr14

FAILED20 = 'eurusd-h4-failed20-atr14-time6-r025-v1'
COMPRESSION = 'eurusd-h4-compression6-24-atr14-time6-r025-v1'
RANGE_FADE = 'eurusd-h4-utc-range-fade-atr14-r025-v1'
DISCOVERY_CANDIDATES = (FAILED20, COMPRESSION, RANGE_FADE)
DAY = 86400


class DiscoveryH4State(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    schema_version: Literal['forex-discovery-h4-v1'] = 'forex-discovery-h4-v1'
    candidate: Literal['eurusd-h4-failed20-atr14-time6-r025-v1',
                       'eurusd-h4-compression6-24-atr14-time6-r025-v1',
                       'eurusd-h4-utc-range-fade-atr14-r025-v1']
    history: tuple[CandleState, ...] = Field(default=(), max_length=24)
    tr_seed: tuple[Decimal, ...] = Field(default=(), max_length=14)
    atr: Decimal | None = Field(default=None, ge=0)
    position_id: str | None = Field(default=None, min_length=1)
    position_side: Literal['BUY', 'SELL'] | None = None
    held_bars: int = Field(default=0, ge=0, strict=True)
    last_entry_day: int | None = Field(default=None, ge=0, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        times = [bar.timestamp for bar in self.history]
        if (any(t % H4 for t in times) or any(b <= a for a,b in zip(times,times[1:]))
                or len(self.tr_seed) != min(len(times),14) or any(v<0 for v in self.tr_seed)
                or (self.atr is None) != (len(self.tr_seed)<14)
                or (self.position_id is None) != (self.position_side is None)
                or (self.position_id is None and self.held_bars != 0)
                or (self.position_id is not None and (not times or not self.position_id.strip() or self.held_bars<1))
                or (self.last_entry_day is not None and (self.candidate != RANGE_FADE or not times
                    or self.last_entry_day>times[-1]//DAY))):
            raise ValueError('inconsistent discovery candidate state')
        return self


class DiscoveryH4Candidate:
    def __init__(self, candidate):
        if candidate not in DISCOVERY_CANDIDATES:
            raise ValueError('unregistered discovery candidate')
        self.candidate=candidate
        self.history=deque(maxlen=24)
        self.tr_seed=[]
        self.atr=None
        self.position_id=self.position_side=None
        self.held_bars=0
        self.last_entry_day=None

    def export_state(self):
        return DiscoveryH4State(candidate=self.candidate,
            history=tuple(CandleState(**vars(bar)) for bar in self.history),
            tr_seed=tuple(self.tr_seed),atr=self.atr,position_id=self.position_id,
            position_side=self.position_side,held_bars=self.held_bars,last_entry_day=self.last_entry_day)

    @classmethod
    def from_state(cls,state):
        state=DiscoveryH4State.model_validate(state)
        result=cls(state.candidate)
        result.history.extend(bar.candle() for bar in state.history)
        result.tr_seed=list(state.tr_seed);result.atr=state.atr
        result.position_id=state.position_id;result.position_side=state.position_side
        result.held_bars=state.held_bars;result.last_entry_day=state.last_entry_day
        return result

    def observe(self,candle:Candle,*,side=None,position_id=None):
        bar=CandleState(**vars(candle))
        if (bar.timestamp%H4 or (self.history and bar.timestamp<=self.history[-1].timestamp)
                or side not in (None,'BUY','SELL') or (side is None)!=(position_id is None)
                or (position_id is not None and (not isinstance(position_id,str) or not position_id.strip()))
                or (position_id is not None and position_id==self.position_id and side!=self.position_side)):
            raise ValueError('discovery requires increasing closed H4 and unambiguous position identity')
        self.atr=advance_atr14(candle,self.history[-1].close if self.history else None,self.tr_seed,self.atr)
        self.held_bars=(self.held_bars+1 if position_id==self.position_id else 1) if position_id else 0
        signal=None
        if self.candidate==RANGE_FADE:
            day,offset=divmod(bar.timestamp,DAY)
            if side is not None and (offset>=4*H4 or self.last_entry_day!=day):
                signal='EXIT'
            elif side is None and offset in (2*H4,3*H4) and self.last_entry_day!=day:
                bounds=[p for p in self.history if p.timestamp//DAY==day and p.timestamp%DAY in (0,H4)]
                if len(bounds)==2:
                    low=min(p.low for p in bounds);high=max(p.high for p in bounds)
                    lower=bar.low<low;upper=bar.high>high
                    if lower and not upper and bar.close>low:signal='BUY'
                    elif upper and not lower and bar.close<high:signal='SELL'
        elif side is not None and self.held_bars>=6:
            signal='EXIT'
        elif len(self.history)>=(20 if self.candidate==FAILED20 else 24):
            prior=list(self.history)
            levels=prior[-20:] if self.candidate==FAILED20 else prior[-6:]
            low=min(p.low for p in levels);high=max(p.high for p in levels)
            middle=(low+high)/2
            if side is not None:
                if self.candidate==FAILED20:
                    if (side=='BUY' and bar.close>=middle) or (side=='SELL' and bar.close<=middle):signal='EXIT'
                elif (side=='BUY' and bar.close<middle) or (side=='SELL' and bar.close>middle):signal='EXIT'
            elif self.candidate==FAILED20:
                lower=bar.low<low;upper=bar.high>high
                if lower and not upper and bar.close>low:signal='BUY'
                elif upper and not lower and bar.close<high:signal='SELL'
            else:
                width=max(p.high for p in prior)-min(p.low for p in prior)
                if width>0 and high-low<=width/2:
                    if bar.close>high:signal='BUY'
                    elif bar.close<low:signal='SELL'
        distance=self.atr*2 if self.atr is not None else None
        if signal in ('BUY','SELL'):
            if distance is None or distance<=0:signal=None
            elif self.candidate==RANGE_FADE:self.last_entry_day=bar.timestamp//DAY
        self.position_id=position_id;self.position_side=side
        self.history.append(candle)
        return signal,distance
