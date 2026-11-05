"""Reusable QDM quality/H4 evidence; simulation still reads every original tick."""
import hashlib
import json
import os
from pathlib import Path

from .forex_h4 import CandleState, inspect_qdm
from .forex_study_registration import runtime_binding


def _digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8')


def inspection_path(cache_dir, *, sha256, first_day, last_day):
    source = Path(__file__).parent
    binding = dict(schema='forex-qdm-inspection-v1', sha256=sha256,
        first_day=first_day, last_day=last_day, runtime=runtime_binding(),
        sources={name: _digest(source/name) for name in
                 ('forex_qdm_inspection.py', 'forex_h4.py', 'replay_tick_execution.py')})
    key = hashlib.sha256(_json_bytes(binding)).hexdigest()
    return Path(cache_dir)/(key+'.json'), binding


def _load(entry, binding):
    raw = json.loads(entry.read_bytes())
    payload = raw['payload']
    if (payload['binding'] != binding
            or hashlib.sha256(_json_bytes(payload)).hexdigest() != raw['payload_sha256']):
        raise ValueError('QDM inspection cache binding or checksum mismatch')
    quality = payload['quality']
    bars = [CandleState.model_validate(item).candle() for item in payload['bars']]
    if (type(quality['ticks']) is not int or quality['ticks'] <= 0
            or quality['complete_h4'] != len(bars)
            or any(b.timestamp <= a.timestamp for a, b in zip(bars, bars[1:]))):
        raise ValueError('invalid QDM inspection cache contents')
    return quality, bars


def load_inspection(path, *, cache_dir, sha256, first_day, last_day):
    entry, binding = inspection_path(cache_dir, sha256=sha256, first_day=first_day, last_day=last_day)
    # A valid derived entry never substitutes for checking the current raw bytes.
    if _digest(Path(path)) != sha256:
        raise ValueError('QDM CSV hash mismatch')
    if not entry.is_file():
        raise ValueError('QDM inspection cache missing; prepare it before dispatch')
    return _load(entry, binding)


def prepare_inspection(path, *, cache_dir, sha256, first_day, last_day, on_progress=None):
    path = Path(path)
    entry, binding = inspection_path(cache_dir, sha256=sha256, first_day=first_day, last_day=last_day)
    if entry.exists():
        return load_inspection(path, cache_dir=cache_dir, sha256=sha256,
                               first_day=first_day, last_day=last_day)
    entry.parent.mkdir(parents=True, exist_ok=True)
    lock = entry.with_suffix('.lock')
    # One explicit preparer owns the miss; workers only load published entries.
    with lock.open('x', encoding='utf-8') as stream:
        stream.write(str(os.getpid()))
    try:
        terms = dict(sha256=sha256, first_day=first_day, last_day=last_day)
        if on_progress:
            terms['on_progress'] = on_progress
        quality, bars = inspect_qdm(path, **terms)
        if _digest(path) != sha256:
            raise ValueError('QDM CSV changed during inspection')
        payload = dict(binding=binding, quality=quality,
            bars=[CandleState(**vars(bar)).model_dump(mode='json') for bar in bars])
        envelope = dict(payload=payload, payload_sha256=hashlib.sha256(_json_bytes(payload)).hexdigest())
        temporary = entry.with_suffix('.tmp')
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(_json_bytes(envelope).decode('utf-8'))
        temporary.replace(entry)
        return _load(entry, binding)
    finally:
        lock.unlink()
