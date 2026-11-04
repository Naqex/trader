"""Bounded history reads on an already authenticated SDK; never attaches or sends."""
from datetime import datetime, timedelta, timezone
import hashlib
import math
from numbers import Integral
from pathlib import Path
import time

import mt5_clock

MAX_ROWS = 5000


def source_range(start, end, server):
    def wall(stamp):
        utc = datetime.fromtimestamp(stamp/1000, timezone.utc)
        if server == 'FTMO-Demo':
            from zoneinfo import ZoneInfo
            try:
                offset = utc.astimezone(ZoneInfo('America/New_York')).utcoffset()+timedelta(hours=7)
                raw = int((utc+offset).timestamp()*1000)
                if mt5_clock.utc_msc(raw, server) != stamp:
                    raise RuntimeError('mt5_clock_unavailable')
                return utc+offset
            except (ValueError, OSError, KeyError):
                raise RuntimeError('mt5_clock_unavailable') from None
        return utc
    first, last = wall(start), wall(end)
    if int((last-first).total_seconds()*1000) != end-start:
        raise RuntimeError('mt5_clock_unavailable')
    return first, last


def capture(sdk, server, symbol, start, end, *, now_msc=None):
    now_msc = int(time.time()*1000) if now_msc is None else now_msc
    if (type(start) is not int or type(end) is not int or start < 0 or
            not 0 < end-start <= 60000 or start % 1000 or end % 1000 or end > now_msc-2000):
        raise RuntimeError('mt5_tick_range_invalid')
    if not isinstance(symbol, str) or not 1 <= len(symbol) <= 64 or any(ord(c)<32 for c in symbol):
        raise RuntimeError('mt5_tick_symbol_invalid')
    info = sdk.symbol_info(symbol)
    if info is None or (not info.visible and not sdk.symbol_select(symbol, True)):
        raise RuntimeError('mt5_tick_symbol_unavailable')
    ticks = sdk.copy_ticks_range(symbol, *source_range(start, end, server), sdk.COPY_TICKS_ALL)
    if ticks is None:
        raise RuntimeError('mt5_tick_history_unavailable')
    if len(ticks) > MAX_ROWS:
        raise RuntimeError('mt5_tick_page_too_large')
    rows, previous = [], -1
    for tick in ticks:
        raw = tick['time_msc']
        if not isinstance(raw, Integral) or isinstance(raw, bool) or raw < 0:
            raise RuntimeError('mt5_tick_data_invalid')
        stamp = mt5_clock.utc_msc(int(raw), server)
        if stamp < previous:
            raise RuntimeError('mt5_tick_order_invalid')
        previous = stamp
        # SDK ranges include their end. Publish half-open pages without deduping
        # identical ticks or sorting away their original same-ms sequence.
        if not start <= stamp < end:
            continue
        bid, ask = float(tick['bid']), float(tick['ask'])
        if not all(math.isfinite(v) and v>0 for v in (bid,ask)) or ask < bid:
            raise RuntimeError('mt5_tick_data_invalid')
        if not isinstance(tick['flags'],Integral) or not 0<=tick['flags']<=0xffffffff:
            raise RuntimeError('mt5_tick_data_invalid')
        rows.append(dict(time_msc=stamp, source_time_msc=int(raw), bid=bid, ask=ask,
                         flags=int(tick['flags'])))
    return dict(schema_version='mt5-tick-range-v1', status='ready', symbol=symbol,
        from_msc=start, to_msc=end, observed_at_msc=now_msc, clock=mt5_clock.metadata(server),
        coverage='broker_history_unverified', execution_capability=False,
        sdk_version=str(sdk.__version__),
        source_sha256={name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                       for name in ('mt5_tick_capture.py','mt5_clock.py')}, rows=rows)
