"""One bounded preparation recipe for CLI and batch; no study or broker authority."""
from pathlib import Path
import time

from .forex_qdm_inspection import prepare_inspection


def prepare_input_set(inputs, *, inspection_cache_dir=None, tick_cache_dir=None, seen=None, on_progress=None):
    seen = set() if seen is None else seen
    records = []
    plans = [('quality', role, inspection_cache_dir) for role in ('warmup', 'development')
             if inspection_cache_dir is not None]
    if tick_cache_dir is not None:
        plans.append(('ticks', 'development', tick_cache_dir))
    for kind, role, directory in plans:
        item = inputs[role]
        key = (kind, str(Path(directory).resolve()), str(Path(item['path']).resolve()),
               item['sha256'], item['first_day'], item['last_day'])
        if key in seen:
            continue
        def notify(count, *, stage='preparing'):
            if on_progress:
                on_progress(dict(kind=kind, role=role, stage=stage, ticks=count))
        notify(0)
        began = time.monotonic()
        cpu_began = time.process_time()
        terms = {name: item[name] for name in ('sha256', 'first_day', 'last_day')}
        if kind == 'quality':
            quality, _ = prepare_inspection(Path(item['path']), cache_dir=directory, **terms, on_progress=notify)
            count = quality['ticks']
        else:
            from .forex_qdm_ticks import prepare_ticks
            payload = prepare_ticks(Path(item['path']), cache_dir=directory, **terms, on_progress=notify)
            count = payload['ticks']
        seen.add(key)
        notify(count, stage='verified')
        records.append(dict(kind=kind, role=role, ticks=count, seconds=round(time.monotonic()-began, 6),
                            cpu_seconds=round(time.process_time()-cpu_began, 6)))
    return records
