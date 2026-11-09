"""Source-bound H1 summaries of observed quotes for explicitly coarse research."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import time

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .execution_semantics import validate_ohlc_bar
from .forex_h4 import CandleState, HOUR, TICK, read_qdm_ticks
from .forex_qdm_inspection import _digest, _json_bytes
from .forex_study_registration import runtime_binding


class CoarseHour(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    mid: CandleState
    bid: tuple[Decimal, Decimal, Decimal, Decimal]
    ask: tuple[Decimal, Decimal, Decimal, Decimal]
    first_time_msc: int = Field(ge=0, strict=True)
    last_time_msc: int = Field(ge=0, strict=True)
    first_sequence: int = Field(ge=1, strict=True)
    last_sequence: int = Field(ge=1, strict=True)
    ticks: int = Field(gt=0, strict=True)
    maximum_spread: Decimal = Field(ge=0)

    @model_validator(mode='after')
    def observed_hour(self):
        start=self.mid.timestamp*1000
        if (self.mid.timestamp%HOUR or not start<=self.first_time_msc<=self.last_time_msc<start+HOUR*1000
                or self.last_sequence-self.first_sequence+1!=self.ticks):
            raise ValueError('invalid coarse hour time/order/count')
        for prices in (self.bid,self.ask):
            validate_ohlc_bar(dict(zip(('open','high','low','close'),prices)))
            if any(price%TICK for price in prices):raise ValueError('coarse side price off tick grid')
        if (any(b>a for b,a in zip(self.bid,self.ask))
                or self.mid.open!=(self.bid[0]+self.ask[0])/2
                or self.mid.close!=(self.bid[3]+self.ask[3])/2
                or self.mid.high>(self.bid[1]+self.ask[1])/2
                or self.mid.low<(self.bid[2]+self.ask[2])/2
                or self.maximum_spread<max(self.ask[0]-self.bid[0],self.ask[3]-self.bid[3])):
            raise ValueError('coarse mid/side quote mismatch')
        return self


def coarse_binding(*, sha256, first_day, last_day):
    if any(type(value) is not str or len(value)!=8 or not value.isdigit() for value in (first_day,last_day)):
        raise ValueError('invalid coarse input dates')
    start=datetime.strptime(first_day,'%Y%m%d').replace(tzinfo=timezone.utc)
    end=datetime.strptime(last_day,'%Y%m%d').replace(tzinfo=timezone.utc)+timedelta(days=1)
    if end<=start:raise ValueError('invalid coarse input dates')
    if len(sha256)!=64 or any(c not in '0123456789abcdef' for c in sha256):
        raise ValueError('invalid coarse input digest')
    source=Path(__file__).parent
    return dict(schema='forex-observed-h1-summary-v1',sha256=sha256,first_day=first_day,last_day=last_day,
        runtime=runtime_binding(),sources={name:_digest(source/name) for name in
            ('forex_coarse_input.py','forex_h4.py','replay_tick_execution.py')})


def coarse_path(cache_dir,binding):
    return Path(cache_dir)/('coarse-hours-'+hashlib.sha256(_json_bytes(binding)).hexdigest()+'.json')


def load_coarse_hours(path,*,cache_dir,sha256,first_day,last_day):
    binding=coarse_binding(sha256=sha256,first_day=first_day,last_day=last_day)
    if _digest(Path(path))!=sha256:raise ValueError('coarse raw input hash mismatch')
    entry=coarse_path(cache_dir,binding)
    packet=json.loads(entry.read_bytes());payload=packet['payload']
    if (payload['binding']!=binding
            or hashlib.sha256(_json_bytes(payload)).hexdigest()!=packet['payload_sha256']):
        raise ValueError('coarse cache binding/checksum mismatch')
    hours=[CoarseHour.model_validate(row) for row in payload['hours']]
    start=int(datetime.strptime(first_day,'%Y%m%d').replace(tzinfo=timezone.utc).timestamp())*1000
    end=int((datetime.strptime(last_day,'%Y%m%d').replace(tzinfo=timezone.utc)+timedelta(days=1)).timestamp())*1000
    if (not hours or payload['ticks']!=sum(h.ticks for h in hours)
            or hours[0].first_sequence!=1
            or any(not start<=h.first_time_msc<=h.last_time_msc<end for h in hours)
            or any(b.mid.timestamp<=a.mid.timestamp or b.first_time_msc<a.last_time_msc
                or b.first_sequence!=a.last_sequence+1 for a,b in zip(hours,hours[1:]))):
        raise ValueError('coarse cache coverage/order mismatch')
    return hours,dict(path=str(entry),sha256=_digest(entry),ticks=payload['ticks'],hours=len(hours),binding=binding)


def prepare_coarse_hours(path,*,cache_dir,sha256,first_day,last_day,on_progress=None,deadline_seconds=300):
    if deadline_seconds<=0:raise ValueError('invalid coarse preparation deadline')
    binding=coarse_binding(sha256=sha256,first_day=first_day,last_day=last_day)
    entry=coarse_path(cache_dir,binding)
    if entry.exists():
        hours,proof=load_coarse_hours(path,cache_dir=cache_dir,sha256=sha256,first_day=first_day,last_day=last_day)
        return hours,dict(proof,cache_hit=True)
    entry.parent.mkdir(parents=True,exist_ok=True)
    began=time.monotonic();cpu=time.process_time();rows=[];current=None;count=0
    with entry.with_suffix('.lock').open('x',encoding='utf-8') as lock:lock.write(str(os.getpid()))
    def publish_hour():
        if current is not None:
            rows.append(CoarseHour(mid=CandleState(timestamp=current['timestamp'],
                **dict(zip(('open','high','low','close'),current['mid']))),
                **{k:v for k,v in current.items() if k not in ('mid','timestamp')}).model_dump(mode='json'))
    try:
        for q in read_qdm_ticks(Path(path),sha256=sha256,first_day=first_day,last_day=last_day):
            bid,ask=q.bid,q.ask
            stamp=q.time_msc//(HOUR*1000)*HOUR;mid=(bid+ask)/2;spread=ask-bid
            if current is None or current['timestamp']!=stamp:
                publish_hour()
                current=dict(timestamp=stamp,mid=[mid]*4,bid=[bid]*4,ask=[ask]*4,
                    first_time_msc=q.time_msc,last_time_msc=q.time_msc,first_sequence=q.sequence,
                    last_sequence=q.sequence,ticks=1,maximum_spread=spread)
                mids,bids,asks=current['mid'],current['bid'],current['ask']
            else:
                # These lists live for one hour. Avoid temporary tuples/kwargs
                # per quote; mid extrema must still come from observed mids.
                if mid>mids[1]:mids[1]=mid
                if mid<mids[2]:mids[2]=mid
                if bid>bids[1]:bids[1]=bid
                if bid<bids[2]:bids[2]=bid
                if ask>asks[1]:asks[1]=ask
                if ask<asks[2]:asks[2]=ask
                mids[3],bids[3],asks[3]=mid,bid,ask
                current['last_time_msc']=q.time_msc;current['last_sequence']=q.sequence
                current['ticks']+=1
                if spread>current['maximum_spread']:current['maximum_spread']=spread
            count+=1
            if count%65536==0:
                if time.monotonic()-began>deadline_seconds:raise TimeoutError('coarse preparation deadline')
                if on_progress:on_progress(dict(stage='coarse_prepare',ticks=count,elapsed_seconds=time.monotonic()-began))
        publish_hour()
        if not rows or _digest(Path(path))!=sha256:raise ValueError('empty or changed coarse raw input')
        payload=dict(binding=binding,ticks=count,hours=rows)
        temporary=entry.with_suffix('.tmp')
        with temporary.open('xb') as stream:
            stream.write(_json_bytes(dict(payload=payload,payload_sha256=hashlib.sha256(_json_bytes(payload)).hexdigest())))
        temporary.rename(entry)
        hours,proof=load_coarse_hours(path,cache_dir=cache_dir,sha256=sha256,first_day=first_day,last_day=last_day)
        return hours,dict(proof,cache_hit=False,wall_seconds=time.monotonic()-began,cpu_seconds=time.process_time()-cpu)
    finally:
        entry.with_suffix('.lock').unlink()
