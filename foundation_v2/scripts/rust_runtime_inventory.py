"""Read-only dispatch and source inventory; no database or owner process access."""
from __future__ import annotations
import argparse
import ast
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--admin',type=Path,default=ROOT/'api-rust/target/debug/rust_runtime_admin.exe')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    def run(profile):
        return json.loads(subprocess.run([str(args.admin.resolve()),'routes'],check=True,capture_output=True,
            text=True,timeout=15,env={**os.environ,'TW_V2_RUNTIME_PROFILE':profile},
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout)
    native=run('native');compatibility=run('compatibility')
    frozen=json.loads((ROOT/'trading_workspace_v2/command_routes.json').read_text(encoding='utf-8'))
    assert len(native['routes'])==len(frozen)==105
    assert native['required_command_routes']==[]
    by_key={(r['method'],r['path']):r for r in frozen}
    api=ast.parse((ROOT/'trading_workspace_v2/api.py').read_text(encoding='utf-8'))
    functions={node.name:node for node in ast.walk(api) if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef))}
    for route in native['routes']:
        old=by_key[(route['method'],route['path'])]
        route['reference_handler']=old['handler']
        route['reference_calls']=sorted({ast.unparse(call.func) for call in ast.walk(functions[old['handler']]) if isinstance(call,ast.Call)})
        route['capability']='native_domain'
        if '/downloads' in route['path'] or route['path'].endswith('/catalog/refresh'):
            route['capability']='native_state_and_scheduler_with_explicit_external_adapter'
        if route['path'] in ('/api/v2/data/market-assets','/api/v2/data/market-assets/update','/api/v2/live/status'):
            route['capability']='explicit_unavailable_without_native_market_connector'
        if '/oauth/' in route['path']:
            route['capability']='native_state_and_http_adapter; actual_authorization_not_run'
    sources={str(path.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(path.read_bytes()).hexdigest()
        for folder,pattern in [('api-rust/src','*.rs'),('trading_workspace_v2','*.py'),('engine_runtime','*.py')]
        for path in (ROOT/folder).glob('**/'+pattern) if '.venv' not in path.parts}
    modules=[]
    for path in sorted((ROOT/'trading_workspace_v2').glob('*.py')):
        role='compatibility_runtime_and_differential_oracle; not native HTTP dispatch'
        if path.stem in ('nautilus_worker','research_engine'):
            role='installed-adapter setup identity/oracle; native domain does not import Python'
        modules.append(dict(path=str(path.relative_to(ROOT)).replace('\\','/'),native_runtime_role=role))
    exceptions=[
        dict(component='engine_runtime/adapter.py + run.py + limits.py',language='Python',role='isolated installed Nautilus scientific adapter',
            reason='preserve validated engine fill semantics and supported Python binding; Rust owns protocol, leases, accounting, normalization and publication',interactive=False),
        dict(component='scripts/rust_legacy_parquet_codec.py',language='Python',role='explicit legacy PyArrow 21 byte-identity codec',
            reason='preserve existing immutable content hashes; new Rust datasets use native codec',interactive=False),
        dict(component='data_worker/index.mjs + pinned dukascopy-node dependencies',language='Node',role='explicit external data transport',
            reason='reuse existing provider protocol; Rust owns lifecycle, validation, immutable publication and recovery',interactive=False),
        dict(component='licensed qdmcli.exe',language='vendor binary',role='optional external data transport',
            reason='vendor executable is not owned product source; explicit local capability and identity required',interactive=False),
        dict(component='scripts/run_api_platform.py + bootstrap/acceptance scripts',language='Python',role='local setup, process supervisor and tests',
            reason='outside HTTP/domain path; no Python command or research service in native profile',interactive=False),
    ]
    value=dict(schema='native-runtime-source-inventory-v1',scope='selected native profile; source/dispatch inventory is not whole-product acceptance',
        native=native,compatibility=compatibility,route_owners=dict(Counter(r['owner'] for r in native['routes'])),
        python_modules=modules,retained_adapters=exceptions,source_hashes=sources,
        admin_sha256=hashlib.sha256(args.admin.read_bytes()).hexdigest(),owner_runtime_touched=False,
        pending=['Native market/live SDK connector remains explicitly unavailable; broker execution is gated.',
                 'Independent integration review and wider data/research UI/runtime performance acceptance remain open.',
                 'Long-history response and snapshot persistence still scale with full canonical ledger.'])
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(routes=len(native['routes']),delegated=len(native['required_command_routes']),owners=value['route_owners'],output=str(args.output.resolve()))))


if __name__=='__main__':main()
