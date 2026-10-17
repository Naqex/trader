"""Run the pinned engine on synthetic rows through Python and Rust orchestration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]
from rust_runtime_adapter_bootstrap import inspect_adapter
from foundation_v2.tests import test_u5_engine_oracle as oracle
from foundation_v2.tests.test_u5b_protective_margin import protective_protocol
from trading_workspace_v2.nautilus_worker import execute_native_process, normalize_native_result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    descriptor = inspect_adapter()
    path = args.output / 'capability.json'
    path.write_text(json.dumps(descriptor), encoding='utf-8')
    bases = {
        'long': [oracle.bar(0, 9.8, 9.95, 9.7, 9.9), oracle.bar(3600, 9.9, 10.1, 9.85, 10), oracle.bar(7200, 10, 10.25, 9.95, 10.2)],
        'short': [oracle.bar(0, 10.2, 10.3, 10, 10.1), oracle.bar(3600, 10.1, 10.2, 9.9, 10), oracle.bar(7200, 10, 10.05, 9.7, 9.8)],
    }
    cases = []
    for name, direction, last, protective in [
        ('long-horizon', 'long', (10.03,10.3,10,10.21), False),
        ('short-horizon', 'short', (10.17,10.2,9.8,9.93), False),
        ('long-stop', 'long', (10.03,10.2,9.8,10), True),
        ('long-tp', 'long', (10.03,10.5,9.95,10.4), True),
        ('short-stop', 'short', (10.17,10.4,9.95,10.2), True),
        ('short-tp', 'short', (10.17,10.2,9.7,9.8), True),
    ]:
        rows = bases[direction] + [oracle.bar(10800, *last)]
        protocol = (protective_protocol if protective else oracle.protocol_for)(rows, direction=direction)
        protocol['split'] = 'train'
        protocol['dataset']['artifact_sha256'] = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
        protocol['engine'].update(backend='nautilus', native_version='1.231.0', adapter_version='nautilus-breakout-v1',
                                  adapter_sha256=descriptor['adapter_sha256'], runtime_identity=descriptor['runtime_identity'], code_sha256=descriptor['engine_code_sha256'])
        protocol['budget'].update(max_memory_mb=512, max_runtime_ms=20000)
        native = execute_native_process(rows, protocol, continue_check=lambda: True, deadline=time.perf_counter()+20)
        cases.append(dict(name=name, rows=rows, protocol=protocol, expected=dict(value=normalize_native_result(native, protocol))))
    fixture = args.output / 'oracle.json'
    fixture.write_text(json.dumps(cases, allow_nan=False), encoding='utf-8')
    command = ['cargo', 'test', '--locked', '--lib', 'research_execution::scientific::tests::actual_native_adapter_oracle', '--', '--ignored', '--nocapture']
    result = subprocess.run(command, cwd=V2/'api-rust', capture_output=True, text=True, encoding='utf-8', timeout=240,
                            env={**os.environ, 'TW_NATIVE_SCIENTIFIC_ORACLE':str(fixture.resolve()), 'TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY':str(path.resolve())})
    (args.output/'test.log').write_text(result.stdout+result.stderr, encoding='utf-8')
    paths = [V2/'api-rust/src/research_execution/scientific.rs', V2/'api-rust/src/research_execution/scientific_normalize.rs', V2/'api-rust/src/research_execution/independent.rs', *sorted((V2/'api-rust/src/owned_process').rglob('*.rs'))]
    receipt = dict(passed=result.returncode==0, actual_offline_cases=len(cases), scope='actual pinned adapter orchestration, normalization and independent source validation; synthetic data; persisted dispatch not established',
                   source_hashes={str(p.relative_to(V2)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
    (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))
    if result.returncode: print((result.stdout+result.stderr)[-7000:])
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
