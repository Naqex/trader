"""Explicit replay defaults for price-only datasets."""

from datetime import datetime, timezone
import re
from collections.abc import Mapping


def replay_instrument_spec(manifest):
    """Return a scoped FX replay contract when a price-only feed is usable.

    Price imports intentionally do not claim broker metadata. Other asset
    classes remain unavailable until the dataset or a reviewed catalog supplies
    their contract.
    """
    def value(key, default=None):
        return manifest.get(key, default) if isinstance(manifest, Mapping) else getattr(manifest, key, default)

    existing = value("instrument_spec")
    if existing:
        return dict(existing)
    symbol = str(value("instrument_id", "") or "").strip().upper()
    compact = symbol.replace("/", "")
    if "/" not in symbol or not re.fullmatch(r"[A-Z]{6}", compact):
        return None
    base_ccy, quote_ccy = compact[:3], compact[3:]
    if base_ccy in {"XAU", "XAG", "XPT", "XPD"} or quote_ccy in {"XAU", "XAG", "XPT", "XPD"}:
        return None
    jpy_pair = quote_ccy == "JPY"
    first_timestamp = value("first_timestamp")
    effective_from = ""
    if isinstance(first_timestamp, int) and first_timestamp >= 0:
        effective_from = datetime.fromtimestamp(first_timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "instrument_id": symbol,
        "asset_class": "fx",
        "base_ccy": base_ccy,
        "quote_ccy": quote_ccy,
        "account_ccy": quote_ccy,
        "tick_size": "0.001" if jpy_pair else "0.00001",
        "pip_size": "0.01" if jpy_pair else "0.0001",
        "contract_size": "100000",
        "quantity_min": "0.01",
        "quantity_step": "0.01",
        "effective_from_utc": effective_from,
        "effective_to_utc": "",
    }
