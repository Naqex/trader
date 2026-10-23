import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description='Pinned CLIProxyAPI Windows preflight; synthetic requests, no login or inference.')
parser.add_argument('--gateway-dir', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
if os.name != 'nt':
    parser.error('Windows-only binary evaluation')
root = args.gateway_dir.resolve(strict=True)
binary = root / 'cli-proxy-api.exe'
expected = '0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443'
if hashlib.sha256(binary.read_bytes()).hexdigest() != expected:
    parser.error('binary does not match evaluated v8.0.40 Windows AMD64 executable')
port = 17852
with socket.socket() as check:
    check.bind(('127.0.0.1', port))
home = root / ('preflight-' + uuid.uuid4().hex)
home.mkdir(exist_ok=True)
auth = home / 'auth'
auth.mkdir(exist_ok=True)
config = home / 'preflight.yaml'
config.write_text(f'''config-version: 8
server:
  host: "127.0.0.1"
  port: {port}
  max-request-body-bytes: 65536
  commercial-mode: true
  discovery:
    enabled: false
management:
  allow-remote: false
  secret-key: ""
  disable-control-panel: true
  disable-auto-update-panel: true
access:
  api-keys: ["synthetic-preflight-no-upstream"]
oauth:
  auth-dir: {json.dumps(str(auth))}
routing:
  retry:
    request-retry: 0
    max-retry-credentials: 1
    max-retry-interval: 0
observability:
  logs:
    debug: false
    logging-to-file: false
    request-log: false
  usage:
    usage-statistics-enabled: false
''', encoding='utf-8')
env = {name: os.environ[name] for name in ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'] if name in os.environ}
env.update(USERPROFILE=str(home), HOME=str(home), APPDATA=str(home), LOCALAPPDATA=str(home))
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def request(path, key=None, payload=None):
    headers = {'Authorization': 'Bearer ' + key} if key else {}
    data = json.dumps(payload).encode() if payload is not None else None
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=data, headers=headers)
    start = time.perf_counter()
    try:
        response = client.open(req, timeout=2)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        body = response.read(262145)
        return response.code, body, (time.perf_counter() - start) * 1000

result = {'scope': 'official Windows binary; isolated empty auth home; synthetic local requests only',
          'binary_sha256': expected,
          'repo': 'router-for-me/CLIProxyAPI', 'version': 'v8.0.40',
          'commit': 'd946c4fba6fc9a5cfbca1f3d85184d62ad2fb683',
          'archive_sha256': 'a5c4ca84350e1b31a11331a573a50bcffd9fc775b8f9111fd2caec480e826e57',
          'real_account_used': False, 'product_runtime_changed': False, 'passed': False}
proc = None
try:
    start = time.perf_counter()
    with (home / 'preflight.stdout.log').open('wb') as out, (home / 'preflight.stderr.log').open('wb') as err:
        proc = subprocess.Popen([str(root/'cli-proxy-api.exe'), '--local-model', '--config', str(config)],
                                cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 15
        while True:
            if proc.poll() is not None:
                raise RuntimeError('gateway exited during startup')
            try:
                unauth = request('/v1/models')[0]
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('startup deadline exceeded')
                time.sleep(0.1)
        result['startup_ms'] = round((time.perf_counter() - start)*1000, 2)
        assert unauth == 401, f'unauthenticated models status={unauth}'
        status, body, _ = request('/v1/models', 'synthetic-preflight-no-upstream')
        models = json.loads(body)
        assert status == 200 and models['data'] == [], 'expected empty isolated catalog'
        result['models'] = {'without_key': unauth, 'with_key': status, 'count': len(models['data'])}
        management = request('/v0/management/auth-files', 'synthetic-preflight-no-upstream')[0]
        management_v8 = request('/v8/management/auth-files', 'synthetic-preflight-no-upstream')[0]
        panel = request('/management.html')[0]
        assert management == management_v8 == panel == 404, 'management/control panel must remain disabled'
        result['management_status'] = management
        result['management_v8_status'] = management_v8
        result['control_panel_status'] = panel
        denied = request('/v1/chat/completions', payload={'model':'synthetic-unavailable','messages':[{'role':'user','content':'synthetic preflight'}]})[0]
        assert denied == 401
        result['unauthenticated_inference_status'] = denied
        latency = [request('/v1/models', 'synthetic-preflight-no-upstream')[2] for _ in range(20)]
        result['local_empty_catalog_ms'] = {'n':20, 'median':round(statistics.median(latency), 3), 'p95':round(sorted(latency)[18], 3)}
        ps = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        command = f"$p=Get-Process -Id {proc.pid}; $l=@(Get-NetTCPConnection -OwningProcess {proc.pid} -State Listen -ErrorAction SilentlyContinue); [pscustomobject]@{{working_set_bytes=$p.WorkingSet64;listeners=@($l|Select-Object LocalAddress,LocalPort)}}|ConvertTo-Json -Depth 3 -Compress"
        metrics = json.loads(subprocess.check_output([str(ps), '-NoProfile', '-Command', command], text=True, creationflags=subprocess.CREATE_NO_WINDOW))
        assert metrics['listeners'] and all(row['LocalAddress']=='127.0.0.1' and row['LocalPort']==port for row in metrics['listeners'])
        entries = sorted(str(path.relative_to(auth)) for path in auth.rglob('*'))
        assert all(path.parts[0] == 'logs' for path in (p.relative_to(auth) for p in auth.rglob('*'))), 'unexpected auth-store entry'
        assert not list(auth.rglob('*.json')), 'preflight must not create provider credential JSON'
        assert not any(path.is_file() for path in auth.rglob('*')), 'commercial mode must not persist synthetic request bodies'
        result['auth_store'] = {'credential_json_files': 0, 'generated_entries': entries}
        result['commercial_mode'] = True
        result['request_body_files_after_error'] = 0
        logs = (home / 'preflight.stdout.log').read_text(encoding='utf-8', errors='replace')
        result['background_version_metadata_fetch_observed'] = {
            'antigravity': 'fetched latest antigravity version' in logs,
            'grok_npm': 'updated Grok CLI client version' in logs,
        }
        result['network_isolated'] = False
        result['inference_or_pool_acceptance'] = False
        result.update(metrics)
        result['passed'] = True
except Exception as error:
    result['failure_type'] = type(error).__name__
    raise
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    result['gateway_stopped'] = proc is None or proc.poll() is not None
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result))
