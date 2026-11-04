"""Broker timestamp decoding, independent of host time and quote freshness.

FTMO-Demo is the observed account/server binding, not a prefix match for every
FTMO product. The 2026 broker schedule follows US DST (New York plus 7 hours).
Older FTMO regimes are deliberately unsupported. See MT5-BROKER-CLOCK.md.
"""
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def metadata(server):
    if server == 'FTMO-Demo':
        return {'profile': 'ftmo_demo_server_2026_v1', 'time_basis': 'UTC',
                'source_time_basis': 'broker_server_wall',
                'offset_rule': 'America/New_York+07:00', 'effective_from': '2026-01-01'}
    return {'profile': 'sdk_utc_v1', 'time_basis': 'UTC', 'source_time_basis': 'UTC'}


def utc_msc(value, server):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise RuntimeError('mt5_clock_unavailable')
    if server != 'FTMO-Demo' or value == 0:
        return value
    try:
        zone = ZoneInfo('America/New_York')
        candidates = []
        for hours in (2, 3):
            candidate = value - hours * 3600000
            instant = datetime.fromtimestamp(candidate / 1000, timezone.utc)
            if instant.year < 2026:
                continue
            if instant.astimezone(zone).utcoffset() + timedelta(hours=7) == timedelta(hours=hours):
                candidates.append(candidate)
        # DST folds/gaps must not choose an arbitrary occurrence.
        if len(candidates) != 1:
            raise ValueError()
        return candidates[0]
    except (ZoneInfoNotFoundError, ValueError, OverflowError, OSError):
        raise RuntimeError('mt5_clock_unavailable') from None


def utc_seconds(value, server):
    return utc_msc(value * 1000, server) / 1000


def history_range(start, end, server):
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise RuntimeError('mt5_clock_unavailable')
    if server == 'FTMO-Demo':
        # The SDK's datetime carrier is UTC-aware, but its filter compares broker
        # wall-clock values. Query an envelope, then filter normalized event UTC.
        return start + timedelta(hours=2), end + timedelta(hours=3)
    return start, end
