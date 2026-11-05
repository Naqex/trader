"""Prepare shared quality/H4 evidence from explicitly scoped, pinned QDM inputs."""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.forex_qdm_inspection import prepare_inspection, inspection_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    inputs = json.loads(args.input_manifest.read_text(encoding='utf-8-sig'))
    if inputs.get('schema') != 'forex-h4-inputs-v1' or set(inputs) != {'schema', 'warmup', 'development'}:
        raise ValueError('unsupported QDM input manifest')
    for role in ('warmup', 'development'):
        item = inputs[role]
        terms = {key: item[key] for key in ('sha256', 'first_day', 'last_day')}
        entry, _ = inspection_path(args.cache_dir, **terms)
        began = time.perf_counter()
        print(json.dumps(dict(role=role, stage='checking' if entry.exists() else 'preparing')), flush=True)
        quality, _ = prepare_inspection(Path(item['path']), cache_dir=args.cache_dir, **terms)
        print(json.dumps(dict(role=role, stage='verified', ticks=quality['ticks'],
            entry=str(entry), seconds=time.perf_counter()-began)), flush=True)


if __name__ == '__main__':
    main()
