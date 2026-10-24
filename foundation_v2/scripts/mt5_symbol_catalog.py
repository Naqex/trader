"""Broker metadata for display/research; never a replacement for order validation."""
import math
import json


def metadata(info):
    result = {'symbol': info.name, 'source': 'mt5_sdk'}
    for key in ('description', 'path', 'category', 'currency_base', 'currency_profit', 'currency_margin'):
        value = getattr(info, key, None)
        if isinstance(value, str) and len(value) <= 512:
            result[key] = value
    for key in ('trade_calc_mode', 'trade_mode', 'order_mode', 'swap_mode'):
        value = getattr(info, key, None)
        if isinstance(value, int) and not isinstance(value, bool):
            result[key] = value
    for key in ('swap_long', 'swap_short'):
        value = getattr(info, key, None)
        if isinstance(value, (int, float)) and math.isfinite(value):
            result[key] = value
    return result


def catalog(sdk):
    symbols = sdk.symbols_get()
    if symbols is None or not 1 <= len(symbols) <= 10000:
        raise RuntimeError('demo_symbol_unavailable')
    result = {'source': 'mt5_sdk', 'items': sorted((metadata(s) for s in symbols), key=lambda s: s['symbol'])}
    # Reject before writing the worker frame; overflowing its reader would reap
    # the owned terminal. Keep this read error recoverable in the warm session.
    if len(json.dumps(result, separators=(',', ':'), allow_nan=False).encode()) > 2 * 1024 * 1024 - 1024:
        raise RuntimeError('demo_catalog_too_large')
    return result
