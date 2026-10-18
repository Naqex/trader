"""Build and exercise tracked backend sources in a disposable Git archive.

Uses the installed Python/toolchain and existing Cargo cache; no dependency
installation, owner service access, external provider or broker connection.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

from rust_runtime_lifecycle_acceptance import PG_DEFAULT

V2 = Path(__file__).resolve().parents[1]
PROJECT = V2.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pg-bin', type=Path, default=PG_DEFAULT)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    receipt = dict(passed=False, owner_runtime_touched=False,
        scope='Tracked backend source build and disposable lifecycle/financial journeys; existing dependency cache and Python environment',
        frontend=False, fresh_dependency_install=False, commands=[])
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('TW_V2_') and key not in ('PYTHONPATH', 'PYTHONHOME')}
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

    def run(label, command, cwd):
        print(label, flush=True)
        receipt['commands'].append(dict(label=label, command=list(map(str, command))))
        with (output / (label + '.txt')).open('wb') as log:
            result = subprocess.run(list(map(str, command)), cwd=cwd, env=env,
                stdout=log, stderr=subprocess.STDOUT, timeout=600, creationflags=flags)
        assert result.returncode == 0, f'{label} failed; inspect its log'

    try:
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=PROJECT, text=True).strip()
        receipt['revision'] = revision
        roots = subprocess.check_output(['git', 'ls-tree', '--name-only', revision], cwd=PROJECT, text=True).splitlines()
        paths = [name for name in roots if name.endswith('.py')]
        paths += ['foundation_v2/' + name for name in (
            'api-rust', 'contracts', 'engine_runtime', 'migrations', 'scripts',
            'tests', 'trading_workspace_v2', 'pyproject.toml', 'uv.lock')]
        receipt['archive_paths'] = paths
        with tempfile.TemporaryDirectory(prefix='tw-native-clean-') as temporary:
            root = Path(temporary)
            archive = root / 'source.tar'
            run('archive', ['git', 'archive', '--format=tar', '-o', archive, revision, *paths], PROJECT)
            receipt['archive_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
            source = root / 'source'
            source.mkdir()
            with tarfile.open(archive) as bundle:
                bundle.extractall(source, filter='data')
            clean_v2 = source / 'foundation_v2'
            receipt['source_sha256'] = {str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in source.rglob('*') if path.is_file()}
            target = V2 / 'api-rust/target/native-clean-source'
            run('build', ['cargo', 'build', '--offline', '--locked', '--release', '--bins',
                '--example', 'rust_replay_mutation_probe', '--target-dir', target], clean_v2 / 'api-rust')
            receipt['binary_sha256'] = {name: hashlib.sha256((target / 'release' / name).read_bytes()).hexdigest()
                for name in ('trading-workspace-api.exe', 'rust_runtime_admin.exe', 'rust_research_worker.exe')}
            run('lifecycle', [sys.executable, '-X', 'utf8', clean_v2 / 'scripts/rust_runtime_lifecycle_acceptance.py',
                '--pg-bin', args.pg_bin.resolve(), '--bin-dir', target / 'release', '--build-profile', 'release',
                '--output', output / 'lifecycle'], clean_v2)
            run('financial', [sys.executable, '-X', 'utf8', clean_v2 / 'scripts/rust_replay_tick_portfolio_acceptance.py',
                '--probe', target / 'release/examples/rust_replay_mutation_probe.exe',
                '--pg-bin', args.pg_bin.resolve(),
                '--output', output / 'financial'], clean_v2)
            assert json.loads((output / 'lifecycle/receipt.json').read_text())['passed']
            assert json.loads((output / 'financial/receipt.json').read_text())['status'] == 'PASS'
            for relative, digest in receipt['source_sha256'].items():
                assert hashlib.sha256((source / relative).read_bytes()).hexdigest() == digest
            receipt['tracked_source_unchanged'] = True
            receipt['passed'] = True
    except Exception as error:
        receipt['error'] = repr(error)
        raise
    finally:
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(dict(passed=True, revision=revision)), flush=True)


if __name__ == '__main__':
    main()
