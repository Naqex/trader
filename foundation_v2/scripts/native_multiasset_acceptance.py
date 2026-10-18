"""Multi-asset Backtest/Prop on owned PostgreSQL, native HTTP and a real browser."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from offline_browser_acceptance import V2, run_acceptance

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-name', default='native-multiasset-20261018')
    parser.add_argument('--binary-directory')
    args = parser.parse_args()
    binaries = Path(args.binary_directory).resolve() if args.binary_directory else V2 / 'api-rust/target/native-candidate/release'
    output = V2 / 'evidence' / args.evidence_name
    output.mkdir(parents=True, exist_ok=True)
    def hashes():
        return {name: hashlib.sha256((binaries / f'{name}.exe').read_bytes()).hexdigest()
                for name in ('trading-workspace-api', 'rust_runtime_admin', 'rust_research_worker')}
    receipt = dict(runtime_profile='native', storage_profile='compact', binaries=str(binaries),
                   owner_runtime_touched=False, disposable=True, before_sha256=hashes(), passed=False)
    try:
        run_acceptance(args.evidence_name, 'tests/nativeMultiasset.browser.mjs',
                       runtime_profile='native', replay_storage_profile='compact',
                       binary_directory=binaries)
        receipt['passed'] = True
    finally:
        receipt['after_sha256'] = hashes()
        receipt['binary_unchanged'] = receipt['after_sha256'] == receipt['before_sha256']
        (output / 'candidate.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
