"""Prepare shared quality/H4 evidence and optional lossless development ticks."""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.forex_input_preparation import prepare_input_set


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path, required=True)
    parser.add_argument('--include-ticks', action='store_true', help='Also prepare lossless development ticks for repeated scenarios')
    args = parser.parse_args(argv)
    inputs = json.loads(args.input_manifest.read_text(encoding='utf-8-sig'))
    if inputs.get('schema') != 'forex-h4-inputs-v1' or set(inputs) != {'schema', 'warmup', 'development'}:
        raise ValueError('unsupported QDM input manifest')
    emitted = 0
    def notify(event):
        nonlocal emitted
        now = time.monotonic()
        if event['stage'] == 'verified' or event['ticks'] == 0 or now-emitted >= 5:
            print(json.dumps(event), flush=True)
            emitted = now
    records = prepare_input_set(inputs, inspection_cache_dir=args.cache_dir,
        tick_cache_dir=args.cache_dir if args.include_ticks else None, on_progress=notify)
    print(json.dumps(dict(stage='prepared', inputs=records)), flush=True)


if __name__ == '__main__':
    main()
