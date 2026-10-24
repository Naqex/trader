"""Persisted-label and dashboard-scope acceptance on disposable PostgreSQL only."""
from pathlib import Path
import argparse, hashlib, json, os, socket, subprocess, sys, tempfile, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / 'foundation_v2'
sys.path[:0] = [str(ROOT), str(V2), str(V2 / 'tests'), str(V2 / 'scripts')]
from rust_replay_service_acceptance import PG
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from test_replay_execution_core import initial_state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--probe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser-test', type=Path)
    parser.add_argument('--node', type=Path)
    parser.add_argument('--ui-origin', default='http://127.0.0.1:5194')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    checks = []
    with tempfile.TemporaryDirectory(prefix='labels-', dir=args.output) as tmp:
        work = Path(tmp)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        def pg(name, *values):
            subprocess.run([str(PG / (name + '.exe')), *values], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        pg('initdb', '-D', str(work / 'pg'), '-U', 'fixture', '-A', 'trust', '--locale=C', '--encoding=UTF8')
        pg('pg_ctl', '-D', str(work / 'pg'), '-l', str(work / 'pg.log'), '-o', f'-h 127.0.0.1 -p {port} -c shared_buffers=32MB', '-w', 'start')
        store = PostgresStore(f'host=127.0.0.1 port={port} user=fixture dbname=postgres')
        process = server = None
        try:
            store.initialize(); store.ensure_workspace('tenant-a'); store.ensure_workspace('tenant-b')
            artifacts = ArtifactStore(work / 'artifacts')
            rows = [dict(timestamp=1767225600 + i * 60, open=1.1 + i*.0001, high=1.101 + i*.0001, low=1.099 + i*.0001, close=1.1002 + i*.0001, volume=100) for i in range(60)]
            path, sha = artifacts.write_dataset('tenant-a', 'labels-fixture', rows)
            initial = initial_state()
            store.put_dataset(DatasetManifest(dataset_id='labels-fixture', workspace_id='tenant-a', source=DatasetSource(source_id='synthetic', provider='synthetic', instrument_mapping={'EURUSD':'EURUSD'}, license_use='fixture', retrieved_at_utc='2026-01-01T00:00:00Z', export_settings='fixture'), instrument_id='EURUSD', timeframe='M1', timeframe_seconds=60, instrument_spec=initial.instrument_spec, row_count=60, first_timestamp=rows[0]['timestamp'], last_timestamp=rows[-1]['timestamp'], artifact_path=path, artifact_sha256=sha, created_at_utc='2026-01-01T00:00:00Z'))
            env = {**os.environ, 'TW_V2_DATABASE_URL':f'host=127.0.0.1 port={port} user=fixture dbname=postgres', 'TW_V2_ARTIFACT_ROOT':str(work/'artifacts'), 'TW_V2_LOCAL_WORKSPACES':'tenant-a,tenant-b', 'TW_V2_OPENAPI_PATH':str(V2/'api-rust/openapi.json')}
            log = (args.output / 'probe.log').open('w', encoding='utf-8')
            process = subprocess.Popen([str(args.probe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8', env=env, creationflags=subprocess.CREATE_NO_WINDOW)
            lock = threading.Lock()
            def request(method, path, body=None, workspace='tenant-a', key=None):
                value = dict(method=method, path=path, workspace=workspace)
                if body is not None: value['body'] = body
                if method != 'GET': value['key'] = key or str(uuid.uuid4())
                with lock:
                    process.stdin.write(json.dumps(value)+'\n'); process.stdin.flush()
                    line = process.stdout.readline()
                assert line, (args.output/'probe.log').read_text()
                return json.loads(line)
            def api(method, path, body=None, status=200, **opts):
                response = request(method, path, body, **opts)
                assert response['status'] == status, (method, path, response)
                return response['body']
            session = api('POST', '/api/v2/replay/sessions', dict(dataset_id='labels-fixture', name='Label acceptance', starting_balance='100000'), 201)
            sid = session['record_id']; base = f'/api/v2/replay/sessions/{sid}'
            def replay(suffix, body):
                nonlocal session
                session = api('POST', base+suffix, dict(expected_revision=session['revision'], **body))
            replay('/execution', dict(instrument_spec=initial.instrument_spec, cost_model=initial.cost_model, spread_price='0.0002', timeframe_seconds=60, starting_balance='100000'))
            replay('/orders/market', dict(operation_id='fixture-buy', side='BUY', quantity='0.12', stop_loss=None, take_profit=None, execution_timing='current_quote'))
            replay('/step', dict(steps=3))
            replay('/orders/close', dict(target_id=session['payload']['execution']['position']['position_id'], operation_id='fixture-close'))
            def page(**extra):
                return api('GET', '/api/v2/replay/trades?'+urlencode(dict(page=1, page_size=10, **extra)))
            original = page(); trade = original['ledger'][0]['trade_id']; pnl = original['ledger'][0]['net_pnl']
            def label(body, **opts): return api('POST', '/api/v2/trade-labels', body, **opts)
            def assign(tags, revision, **opts): return label(dict(action='assign', session_id=sid, trade_id=trade, expected_revision=revision, tags=tags), **opts)
            first = label(dict(action='create', name='Breakout', color='green'), key='create-one')
            assert label(dict(action='create', name='Breakout', color='green'), key='create-one') == first
            a = first['items'][0]
            b = label(dict(action='create', name='Retest', color='orange'))['items'][1]
            selected = assign(['Breakout', 'Retest'], 0)
            assert selected['assignment']['revision'] == 1
            loaded = page(); assert loaded['ledger'][0]['tags'] == ['Breakout','Retest']
            assert loaded['snapshot_key'] != original['snapshot_key']
            assert loaded['ledger'][0]['net_pnl'] == pnl
            assert api('GET', base)['revision'] == session['revision']
            checks.append('migration16, label create/idempotent retry, multi assignment/reload, immutable execution')
            assign(['Retest'], 0, status=409)
            assert page()['ledger'][0]['tags'] == ['Breakout','Retest']
            label(dict(action='assign', session_id=sid, trade_id='missing', expected_revision=0, tags=[]), status=404)
            assign(['Retest'], 1, workspace='tenant-b', status=404)
            assert api('GET', '/api/v2/trade-labels', workspace='tenant-b')['items'] == []
            label(dict(action='create', name='breakout', color='green'), status=409)
            checks.append('stale revision, missing trade, cross-workspace isolation, duplicate names')
            label(dict(action='update', id=a['id'], expected_revision=a['revision'], name='Momentum', color='blue'))
            renamed = page(); assert renamed['ledger'][0]['tags'] == ['Momentum','Retest']
            assert renamed['snapshot_key'] != loaded['snapshot_key']
            assert api('GET', '/api/v2/journal/context?'+urlencode(dict(session_id=sid)))['trades'][0]['tags'] == ['Momentum','Retest']
            assign(['breakout','RETEST'], 1)
            assert page()['ledger'][0]['tags'] == ['Momentum','Retest']
            filtered = page(extra_filters=json.dumps(dict(tagInclude=['Momentum'], tagIncludeMode='OR')))
            assert filtered['pagination']['filtered_count'] == 1
            assert page(extra_filters=json.dumps(dict(tagInclude=['Breakout'])))['pagination']['filtered_count'] == 1
            label(dict(action='delete', id=b['id'], expected_revision=b['revision']))
            assert page()['ledger'][0]['tags'] == ['Momentum']
            checks.append('rename aliases/case/color/delete, compact context, canonical facets/filter and snapshot invalidation')
            note = dict(entry_type='decision',source=dict(kind='replay',id='fixture-note',session_id=sid,trade_id=trade), tags=[], note='Note without label changes')
            journal = api('POST', '/api/v2/journal', note, 201)
            assert page()['ledger'][0]['tags'] == ['Momentum']
            api('POST', f'/api/v2/journal/{journal["record_id"]}/revisions', dict(expected_revision=journal['revision'],payload={**note,'note':'Updated text'}))
            assert page()['ledger'][0]['tags'] == ['Momentum']
            second_note=dict(entry_type='decision',source=dict(kind='replay',id='fixture-note2',session_id=sid,trade_id=trade),tags=['New note label'],note='Append label')
            second_journal=api('POST','/api/v2/journal',second_note,201)
            assert page()['ledger'][0]['tags'] == ['Momentum','New note label']
            revised=api('POST', f'/api/v2/journal/{journal["record_id"]}/revisions',dict(expected_revision=journal['revision']+1,payload={**note,'tags':['Note edit'],'note':'Add from stale journal form'}))
            assert page()['ledger'][0]['tags'] == ['Momentum','New note label','Note edit']
            api('POST', f'/api/v2/journal/{journal["record_id"]}/revisions',dict(expected_revision=revised['revision'],payload={**note,'tags':[],'note':'Remove own label only'}))
            assert page()['ledger'][0]['tags'] == ['Momentum','New note label']
            assign(['Momentum'],page()['ledger'][0]['label_revision'])
            api('POST',f'/api/v2/journal/{second_journal["record_id"]}/revisions',dict(expected_revision=second_journal['revision'],payload={**second_note,'tags':['New note label','Only added now']}))
            assert page()['ledger'][0]['tags']==['Momentum','Only added now'],'A stale form must not restore a label explicitly removed in the table'
            assign(['Momentum','New note label'],page()['ledger'][0]['label_revision'])
            checks.append('creating/editing blank-tag notes preserves explicit labels; nonempty note merges')
            checks.append('journal edit applies only added/removed labels; does not resurrect unchanged stale tags')
            overview = lambda source, **extra: api('GET','/api/v2/overview?'+urlencode(dict(dashboard_source=source, **extra)))['performance']
            assert overview('backtest')['metrics']['closed_trade_count'] == 1
            assert overview('prop')['metrics']['closed_trade_count'] == 0
            assert overview('prop', session_id=sid)['metrics']['closed_trade_count'] == 0
            assert overview('all')['metrics']['closed_trade_count'] == 1
            branch=api('POST',base+'/branch',dict(expected_revision=session['revision'],cursor_index=session['payload']['cursor_index']),201)
            child=branch['record_id']
            store.create_record('tenant-a','journal',dict(entry_type='decision',source=dict(kind='replay',id='legacy',session_id=child,trade_id=trade),tags=['Legacy'],note='Existing journal metadata'),source_key='legacy-fixture')
            api('POST','/api/v2/journal',dict(entry_type='decision',source=dict(kind='replay',id='child-new',session_id=child,trade_id=trade),tags=['Added'],note='New label'),201)
            child_context=api('GET','/api/v2/journal/context?'+urlencode(dict(session_id=child)))
            assert child_context['trades'][0]['tags']==['Legacy','Added']
            assert overview('all')['metrics']['closed_trade_count']==1,'All must deduplicate inherited fills'
            store.update_record('tenant-a','replay',child,branch['revision'],{**branch['payload'],'session_kind':'prop'})
            assert overview('prop')['metrics']['closed_trade_count']==1
            assert overview('all')['metrics']['closed_trade_count']==1
            checks.append('dashboard source selection and empty intersection; All keeps one metric layout contract')
            if args.browser_test:
                class Handler(BaseHTTPRequestHandler):
                    def log_message(self, *_): pass
                    def handle_api(self):
                        if self.path == '/fixture':
                            result = dict(status=200,body=dict(session_id=sid,trade_id=trade))
                        elif self.path.startswith('/api/v2/') and (self.command=='GET' or self.path=='/api/v2/trade-labels'):
                            body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))) if self.command=='POST' else None
                            result=request(self.command,self.path,body,workspace=self.headers.get('X-Workspace-Id','tenant-a'),key=self.headers.get('Idempotency-Key'))
                        else: result=dict(status=403,body=dict(detail='fixture_scope_denied'))
                        data=json.dumps(result['body']).encode();self.send_response(result['status']);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
                    do_GET=handle_api
                    do_POST=handle_api
                server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
                threading.Thread(target=server.serve_forever,daemon=True).start()
                subprocess.run([str(args.node),str(args.browser_test),args.ui_origin,str(args.output/'browser'),f'http://127.0.0.1:{server.server_port}'],check=True,cwd=V2/'web')
                checks.append('rendered UI with real disposable native Rust/PG label mutations')
            receipt=dict(status='PASS',scope='disposable PostgreSQL, synthetic licensed dataset, no broker',checks=checks,probe_sha256=hashlib.sha256(args.probe.read_bytes()).hexdigest())
            (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
            print(json.dumps(receipt))
        finally:
            if server: server.shutdown();server.server_close()
            if process: process.terminate();process.wait(timeout=10)
            store.close();pg('pg_ctl','-D',str(work/'pg'),'-m','immediate','-w','stop')

if __name__ == '__main__': main()
