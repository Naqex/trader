"""Disposable PostgreSQL/Rust/Bun lifecycle and browser QA; never authenticates a real account."""
from __future__ import annotations
import json, os, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import urlopen
import psycopg
from rust_runtime_lifecycle_acceptance import PG_DEFAULT, port

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]
from trading_workspace_v2.store import PostgresStore

def main():
    output = V2 / '.runtime/chatgpt-account-integration'
    output.mkdir(parents=True, exist_ok=True)
    binary = V2 / 'api-rust/target/chatgpt-account/debug'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    logs = []
    def launch(command, env, name, cwd=V2):
        log = (output / f'{name}.log').open('w', encoding='utf-8'); logs.append(log)
        return subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log, creationflags=flags)
    def wait_http(url, process):
        for _ in range(150):
            try:
                with urlopen(url, timeout=1) as response:
                    if response.status == 200: return
            except Exception:
                assert process.poll() is None, f'process exited before {url}'
                time.sleep(.1)
        raise AssertionError(f'HTTP timeout: {url}')
    with tempfile.TemporaryDirectory(prefix='chatgpt-web-acceptance-') as temporary:
        root = Path(temporary); pgport, apiport, uiport, coreport = [port() for _ in range(4)]
        subprocess.run([str(PG_DEFAULT/'initdb.exe'), '-D', str(root/'pg'), '-A', 'trust', '-U', 'fixture', '--encoding=UTF8', '--locale=C'], check=True, capture_output=True, creationflags=flags)
        pg = launch([str(PG_DEFAULT/'postgres.exe'), '-D', str(root/'pg'), '-h', '127.0.0.1', '-p', str(pgport)], os.environ.copy(), 'postgres')
        api = ui = None
        env = {key: value for key, value in os.environ.items() if not key.startswith(('TW_V2_', 'TW_CHATGPT_'))}
        artifacts = root/'artifacts'; artifacts.mkdir()
        dsn = f'host=127.0.0.1 port={pgport} user=fixture dbname=postgres'
        env.update(TW_V2_DATABASE_URL=dsn, TW_V2_ARTIFACT_ROOT=str(artifacts), TW_V2_RUNTIME_PROFILE='native',
                   TW_V2_DOWNLOAD_ENGINE='none', TW_V2_LOCAL_WORKSPACES='tenant-a', TW_V2_LOCAL_IDENTITY='local-owner',
                   TW_V2_RUST_BIND=f'127.0.0.1:{apiport}', TW_V2_SHUTDOWN_FILE=str(root/'stop'),
                   TW_V2_OPENAPI_PATH=str(V2/'contracts/openapi.json'), TW_V2_REPLAY_STORAGE_PROFILE='compact',
                   TW_CHATGPT_WEB_HOME=str(root/'account'), TW_CHATGPT_WEB_PORT=str(coreport))
        try:
            for _ in range(100):
                try:
                    with psycopg.connect(dsn, connect_timeout=1): break
                except psycopg.OperationalError: time.sleep(.1)
            subprocess.run([str(binary/'rust_runtime_admin.exe'), 'migrate'], env=env, check=True, capture_output=True, creationflags=flags)
            PostgresStore(dsn).ensure_workspace('tenant-a')
            api = launch([str(binary/'trading-workspace-api.exe')], env, 'api')
            wait_http(f'http://127.0.0.1:{apiport}/health', api)
            ui_env = dict(env, TW_V2_API_TARGET=f'http://127.0.0.1:{apiport}')
            ui = launch(['node', str(V2/'web/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', str(uiport), '--strictPort'], ui_env, 'ui', V2/'web')
            wait_http(f'http://127.0.0.1:{uiport}', ui)
            test_env = dict(env, TW_CHATGPT_UI_ORIGIN=f'http://127.0.0.1:{uiport}', TW_CHATGPT_INTEGRATED='1', TW_CHATGPT_UI_EVIDENCE=str(output/'browser'))
            result = subprocess.run(['node', 'run_chatgpt_account_acceptance.mjs'], cwd=V2/'web', env=test_env, capture_output=True, text=True, timeout=160, creationflags=flags)
            (output/'browser.log').write_text(result.stdout+result.stderr, encoding='utf-8')
            assert result.returncode == 0, 'Browser QA failed; inspect .runtime/chatgpt-account-integration/browser.log'
            (root/'stop').touch(); api.wait(timeout=25)
            try:
                urlopen(f'http://127.0.0.1:{coreport}/healthz', timeout=1)
                raise AssertionError('owned core survived API shutdown')
            except OSError: pass
            assert not (root/'account/browser/storage-state.json').exists()
            report = {'isolated_runtime': 'passed', 'core_stopped_with_api': True, 'real_account_login': False,
                      'external_inference': False, 'browser': json.loads((output/'browser/report.json').read_text())}
            (output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(report))
        finally:
            if ui and ui.poll() is None: ui.terminate(); ui.wait(timeout=10)
            if api and api.poll() is None:
                (root/'stop').touch()
                try: api.wait(timeout=25)
                except subprocess.TimeoutExpired: api.terminate(); api.wait(timeout=10)
            subprocess.run([str(PG_DEFAULT/'pg_ctl.exe'), '-D', str(root/'pg'), 'stop', '-m', 'fast'], capture_output=True, creationflags=flags)
            pg.wait(timeout=10)
            for log in logs: log.close()

if __name__ == '__main__': main()
