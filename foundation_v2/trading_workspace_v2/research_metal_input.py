"""Indicative H1 geometry from bounded QDM M1 Bid bars; never invent tick quotes."""
import csv
from datetime import datetime,timezone
from decimal import Decimal
import hashlib
from pathlib import Path

from .forex_coarse_input import CoarseHour
from .forex_h4 import CandleState


def aggregate_bid_m1(path,sha256,*,on_progress=None):
    path=Path(path)
    with path.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=sha256:
            raise ValueError('metal raw M1 hash mismatch')
    hours=[];current=None;previous=None;day_text=None;count=0;gaps=0;maxgap=0
    with path.open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.DictReader(stream)
        if reader.fieldnames!=['Date','Time','Open','High','Low','Close','Volume']:
            raise ValueError('unsupported QDM M1 columns')
        for row in reader:
            if row['Date']!=day_text:
                day=datetime.strptime(row['Date'],'%Y.%m.%d').replace(tzinfo=timezone.utc)
                if not 2020<=day.year<=2024:raise ValueError('metal source scope excludes holdout/other years')
                base=int(day.timestamp());day_text=row['Date']
            clock=row['Time']
            if (len(clock)!=8 or clock[2]!=':' or clock[5]!=':' or clock[6:]!='00'
                    or not clock[:2].isdigit() or not clock[3:5].isdigit()
                    or not 0<=int(clock[:2])<24 or not 0<=int(clock[3:5])<60):
                raise ValueError('invalid closed M1 timestamp')
            at=base+int(clock[:2])*3600+int(clock[3:5])*60
            if previous is not None and at<=previous:raise ValueError('M1 order/duplicates')
            values=[Decimal(row[key]) for key in ('Open','High','Low','Close')]
            o,h,l,c=values;volume=Decimal(row['Volume'])
            if (any(not p.is_finite() or p<=0 or p%Decimal('.001') for p in values)
                    or not volume.is_finite() or volume<0 or l>min(o,c) or h<max(o,c)):
                raise ValueError('invalid M1 Bid OHLC/grid/volume')
            if previous is not None:
                gap=at-previous;maxgap=max(maxgap,gap);gaps+=gap>60
            previous=at;count+=1;hour=at//3600*3600
            if current is None or hour!=current['timestamp']:
                if current is not None:hours.append(current)
                current=dict(timestamp=hour,first=at,last=at,first_sequence=count,last_sequence=count,
                    source_rows=1,bid=[o,h,l,c])
            else:
                current['last']=at;current['last_sequence']=count;current['source_rows']+=1
                current['bid'][1]=max(current['bid'][1],h);current['bid'][2]=min(current['bid'][2],l);current['bid'][3]=c
            if on_progress and count%200000==0:on_progress(count)
    if current is not None:hours.append(current)
    if not count:raise ValueError('empty M1 input')
    return hours,dict(rows=count,hours=len(hours),gap_count=gaps,max_adjacent_gap_seconds=maxgap,
        raw_sha256=sha256,source_price_basis='Bid',observed_Ask=False,tick_count=None,
        timestamp_basis='UTC_start_of_M1_bar; modeled open time, not actual first quote millisecond')


def indicative_hours(raw,spread):
    if not spread.is_finite() or spread<0 or spread%Decimal('.001'):
        raise ValueError('invalid declared metal spread')
    result=[]
    for bar in raw:
        bid=tuple(bar['bid']);ask=tuple(v+spread for v in bid);mid=tuple(v+spread/2 for v in bid)
        result.append(CoarseHour(mid=CandleState(timestamp=bar['timestamp'],**dict(zip(('open','high','low','close'),mid))),
            bid=bid,ask=ask,first_time_msc=bar['first']*1000,last_time_msc=(bar['last']+60)*1000-1,
            first_sequence=bar['first_sequence'],last_sequence=bar['last_sequence'],
            ticks=bar['source_rows'],maximum_spread=spread))
    return result
