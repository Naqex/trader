"""Owned harmless local subprocess fixtures; no provider, broker or owner runtime."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

V2 = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for name, target in [('ownership', 'owned_process::'), ('provider', 'provider_routes::execution::tests')]:
        command = ['cargo', 'test', '--locked', '--lib', target, '--', '--nocapture']
        result = subprocess.run(command, cwd=V2 / 'api-rust', capture_output=True, text=True, encoding='utf-8', timeout=240)
        (args.output / f'{name}.log').write_text(result.stdout + result.stderr, encoding='utf-8')
        results.append(dict(name=name, command=command, passed=result.returncode == 0))
        if result.returncode:
            print((result.stdout + result.stderr)[-5000:])
            break
    paths = [V2 / 'api-rust/Cargo.toml', V2 / 'api-rust/Cargo.lock', V2 / 'api-rust/src/owned_process.rs',
             *sorted((V2 / 'api-rust/src/owned_process').rglob('*.rs')), V2 / 'api-rust/src/provider_routes/execution.rs']
    receipt = dict(passed=len(results) == 2 and all(r['passed'] for r in results), results=results,
                   scope='Windows atomic Job Object ownership; harmless Python child/grandchild crash, kill, timeout, pipe and resource tests; no real provider or owner runtime',
                   source_hashes={str(path.relative_to(V2)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})
    (args.output / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(dict(passed=receipt['passed'], results=results)))
    raise SystemExit(0 if receipt['passed'] else 1)


if __name__ == '__main__':
    main()
