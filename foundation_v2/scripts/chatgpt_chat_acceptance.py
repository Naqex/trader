"""Rust -> owned real core handler with synthetic responder; no account/network inference."""
from __future__ import annotations
import json, os, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import psycopg
from rust_runtime_lifecycle_acceptance import PG_DEFAULT, port

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]
from trading_workspace_v2.store import PostgresStore


def main():
    output = V2 / '.runtime/chatgpt-chat-integration'
    output.mkdir(parents=True, exist_ok=True)
    (output/'fixture-error.txt').unlink(missing_ok=True)
    binary = V2 / 'api-rust/target/chatgpt-account/debug'
    core = V2.parents[2] / 'tooling/chatgpt-web-core'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    logs = []
    def launch(command, env, name):
        log = (output / f'{name}.log').open('w', encoding='utf-8'); logs.append(log)
        return subprocess.Popen(command, cwd=V2, env=env, stdout=log, stderr=log, creationflags=flags)
    # The core intentionally refuses runtime commands from the OS Temp directory.
    with tempfile.TemporaryDirectory(prefix='fixture-', dir=output) as temporary:
        root = Path(temporary); pgport, apiport, coreport = [port() for _ in range(3)]
        subprocess.run([str(PG_DEFAULT/'initdb.exe'), '-D', str(root/'pg'), '-A', 'trust', '-U', 'fixture', '--encoding=UTF8', '--locale=C'], check=True, capture_output=True, creationflags=flags)
        pg = launch([str(PG_DEFAULT/'postgres.exe'), '-D', str(root/'pg'), '-h', '127.0.0.1', '-p', str(pgport)], os.environ.copy(), 'postgres')
        api = None
        source = root/'synthetic-core'; (source/'src').mkdir(parents=True); (source/'node_modules').mkdir()
        script = '''
import { writeFileSync } from "node:fs";
try {
const { initializeCore } = await import(CORE_PROFILE);
const { CoreAccount } = await import(CORE_ACCOUNT);
const { createCoreHandler } = await import(CORE_SERVER);
const args = process.argv;
const config = initializeCore(args[args.indexOf("--home")+1], Number(args[args.indexOf("--port")+1]));
config.solAvailable = true;
const account = new CoreAccount(config, async () => true, {present: () => true});
const handler = createCoreHandler(config, {account, loginPresent: () => true, respond: async request => {
  const body = await request.json(); writeFileSync(CAPTURE, JSON.stringify(body));
  if (JSON.parse(body.input.at(-1).content).user_message === "WAIT") return await new Promise(resolve => {
    const cancel = () => { writeFileSync(CANCELLED, "cancelled"); resolve(Response.json({status:"cancelled"})); };
    if (request.signal.aborted) cancel(); else request.signal.addEventListener("abort", cancel, {once:true});
  });
  return Response.json({status:"completed",output:[{type:"message",role:"assistant",content:[{type:"output_text",text:"Synthetic transport reply"}]}]});
}});
Bun.serve({hostname:"127.0.0.1",port:config.port,fetch:handler,idleTimeout:255});
} catch (error) { writeFileSync(FIXTURE_ERROR, String(error)); }
'''
        for key, value in {
            'CORE_PROFILE': str(core/'src/core-profile.ts'), 'CORE_ACCOUNT': str(core/'src/core-account.ts'),
            'CORE_SERVER': str(core/'src/core-server.ts'), 'CAPTURE': str(root/'capture.json'), 'CANCELLED': str(root/'cancelled'),
            'FIXTURE_ERROR': str(output/'fixture-error.txt'),
        }.items(): script = script.replace(key, json.dumps(value))
        (source/'src/core-cli.ts').write_text(script, encoding='utf-8')
        env = {key: value for key, value in os.environ.items() if not key.startswith(('TW_V2_', 'TW_CHATGPT_'))}
        artifacts = root/'artifacts'; artifacts.mkdir()
        dsn = f'host=127.0.0.1 port={pgport} user=fixture dbname=postgres'
        env.update(TW_V2_DATABASE_URL=dsn, TW_V2_ARTIFACT_ROOT=str(artifacts), TW_V2_RUNTIME_PROFILE='native',
                   TW_V2_DOWNLOAD_ENGINE='none', TW_V2_LOCAL_WORKSPACES='tenant-a,tenant-b', TW_V2_LOCAL_IDENTITY='fixture',
                   TW_V2_RUST_BIND=f'127.0.0.1:{apiport}', TW_V2_SHUTDOWN_FILE=str(root/'stop'),
                   TW_V2_OPENAPI_PATH=str(V2/'contracts/openapi.json'), TW_V2_REPLAY_STORAGE_PROFILE='compact',
                   TW_CHATGPT_WEB_HOME=str(root/'account'), TW_CHATGPT_WEB_CORE=str(source), TW_CHATGPT_WEB_PORT=str(coreport))
        origin = f'http://127.0.0.1:{apiport}'
        def call(path, method='GET', body=None, workspace='tenant-a', origin_header=True):
            headers = {'X-Workspace-Id': workspace, 'Content-Type': 'application/json'}
            if origin_header: headers['Origin'] = origin
            request = Request(origin+path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
            try:
                with urlopen(request, timeout=10) as response: return response.status, json.load(response)
            except HTTPError as response: return response.code, json.load(response)
        chat = '/api/v2/ai/chatgpt/chat'
        try:
            for _ in range(100):
                try:
                    with psycopg.connect(dsn, connect_timeout=1): break
                except psycopg.OperationalError: time.sleep(.1)
            subprocess.run([str(binary/'rust_runtime_admin.exe'), 'migrate'], env=env, check=True, capture_output=True, creationflags=flags)
            store = PostgresStore(dsn)
            for workspace in ['tenant-a','tenant-b']: store.ensure_workspace(workspace)
            api = launch([str(binary/'trading-workspace-api.exe')], env, 'api')
            for _ in range(150):
                try:
                    if call('/health')[0] == 200: break
                except OSError:
                    assert api.poll() is None; time.sleep(.1)
            assert call(chat, 'POST', {'messages':[{'role':'user','content':'Hello'}]}, origin_header=False)[0] == 403
            assert call(chat, 'POST', {'messages':[], 'tools':[]})[0] == 422
            context = {'screen':'playbook','locale':'vi'}
            assert call(chat, 'POST', {'messages':[{'role':'user','content':'Hello'}], 'context':{**context,'balance':1000}})[0] == 422
            code, turn = call(chat, 'POST', {'messages':[{'role':'user','content':'Hello'}], 'context':context})
            assert code == 202, (code, turn)
            status_path = chat+'/'+turn['id']
            for _ in range(100):
                code, result = call(status_path)
                if result['status'] != 'running': break
                time.sleep(.03)
            assert result['status'] == 'completed' and result['text'] == 'Synthetic transport reply', result
            assert call(status_path, workspace='tenant-b')[0] == 404
            captured = json.loads((root/'capture.json').read_text(encoding='utf-8'))
            packed = json.loads(captured['input'][-1]['content'])
            assert packed == {'app_context':{'schema_version':1,'source':'client-route', **context,'data_access':'none'},'user_message':'Hello'}
            assert turn['grounding']['context'] == result['grounding']['context'] == context
            assert result['grounding']['policy_version'] == 'wmreplay-chat-2026-10-19.1'
            assert captured['instructions'] == (V2/'api-rust/src/ai-assistant-policy.md').read_bytes().decode('utf-8')
            assert captured['stream'] is False and captured['store'] is False
            assert set(captured) == {'model','reasoning','input','instructions','stream','store','client_metadata'}
            identity = captured['client_metadata']['x-codex-turn-metadata']
            assert identity['thread_id'].startswith('core-')
            assert captured['input'][-1]['internal_chat_message_metadata_passthrough']['turn_id'] == identity['turn_id']
            code, turn = call(chat, 'POST', {'messages':[{'role':'user','content':'WAIT'}]})
            assert code == 202
            for _ in range(100):
                if json.loads(json.loads((root/'capture.json').read_text(encoding='utf-8'))['input'][-1]['content'])['user_message'] == 'WAIT': break
                time.sleep(.03)
            assert call(chat, 'POST', {'messages':[{'role':'user','content':'duplicate'}]})[0] == 409
            assert call('/api/v2/ai/chatgpt/account/disconnect', 'POST', {})[0] == 409
            assert call(chat+'/'+turn['id'], 'DELETE', workspace='tenant-b')[0] == 404
            assert call(chat+'/'+turn['id'], 'DELETE')[1]['status'] == 'cancelled'
            for _ in range(100):
                if (root/'cancelled').exists(): break
                time.sleep(.03)
            assert (root/'cancelled').exists(), 'Rust cancellation did not reach the real Bun core request signal'
            code, turn = call(chat, 'POST', {'messages':[{'role':'user','content':'After cancellation'}]})
            assert code == 202
            for _ in range(100):
                result = call(chat+'/'+turn['id'])[1]
                if result['status'] != 'running': break
                time.sleep(.03)
            assert result['status'] == 'completed', result
            report = {'scope':'isolated Rust + owned real core handler with synthetic responder; no actual account or external inference',
                      'checks':['same-origin/workspace guards','strict text contract','202/poll/completed text','upstream model/effort forwarding',
                                'single-flight/account mutation exclusion','scoped cancellation reaches Bun request signal','slot reusable after cancel']}
            (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps(report))
        finally:
            if api and api.poll() is None:
                (root/'stop').touch()
                try: api.wait(timeout=25)
                except subprocess.TimeoutExpired: api.terminate(); api.wait(timeout=10)
            subprocess.run([str(PG_DEFAULT/'pg_ctl.exe'), '-D', str(root/'pg'), 'stop', '-m', 'fast'], capture_output=True, creationflags=flags)
            pg.wait(timeout=10)
            for log in logs: log.close()

if __name__ == '__main__': main()
