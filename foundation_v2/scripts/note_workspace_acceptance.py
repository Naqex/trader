"""Note library acceptance on an owned PostgreSQL fixture; never owner runtime."""
from pathlib import Path
import argparse, base64, hashlib, json, os, socket, subprocess, sys, tempfile, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode

V2=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(V2),str(V2/'scripts'),str(V2/'tests')]
from rust_replay_service_acceptance import PG
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from test_replay_execution_core import initial_state


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--probe',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--browser-test',type=Path)
    parser.add_argument('--ui-origin',default='http://127.0.0.1:5198')
    args=parser.parse_args();args.output=args.output.resolve();args.probe=args.probe.resolve()
    if args.browser_test:args.browser_test=args.browser_test.resolve()
    args.output.mkdir(parents=True,exist_ok=True)
    checks=[]
    with tempfile.TemporaryDirectory(prefix='note-library-',dir=args.output) as tmp:
        work=Path(tmp)
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        def pg(command,*values):
            with (args.output/'postgres-commands.log').open('ab') as log:
                subprocess.run([str(PG/(command+'.exe')),*values],check=True,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
        pg('initdb','-D',str(work/'pg'),'-U','fixture','-A','trust','--locale=C','--encoding=UTF8')
        pg('pg_ctl','-D',str(work/'pg'),'-l',str(work/'pg.log'),'-o',f'-h 127.0.0.1 -p {port} -c shared_buffers=32MB','-w','start')
        dsn=f'host=127.0.0.1 port={port} user=fixture dbname=postgres'
        store=PostgresStore(dsn);process=server=None
        try:
            store.initialize();store.ensure_workspace('tenant-a');store.ensure_workspace('tenant-b')
            artifacts=ArtifactStore(work/'artifacts');initial=initial_state()
            rows=[dict(timestamp=1767225600+i*60,open=1.1+i*.0001,high=1.101+i*.0001,low=1.099+i*.0001,close=1.1002+i*.0001,volume=100) for i in range(60)]
            path,sha=artifacts.write_dataset('tenant-a','notes-fixture',rows)
            store.put_dataset(DatasetManifest(dataset_id='notes-fixture',workspace_id='tenant-a',source=DatasetSource(source_id='synthetic',provider='synthetic',instrument_mapping={'EURUSD':'EURUSD'},license_use='fixture',retrieved_at_utc='2026-01-01T00:00:00Z',export_settings='fixture'),instrument_id='EURUSD',timeframe='M1',timeframe_seconds=60,instrument_spec=initial.instrument_spec,row_count=60,first_timestamp=rows[0]['timestamp'],last_timestamp=rows[-1]['timestamp'],artifact_path=path,artifact_sha256=sha,created_at_utc='2026-01-01T00:00:00Z'))
            env={key:value for key,value in os.environ.items() if not key.startswith('TW_V2_')}
            env.update(TW_V2_DATABASE_URL=dsn,TW_V2_ARTIFACT_ROOT=str(work/'artifacts'),TW_V2_LOCAL_IDENTITY='local-owner',TW_V2_LOCAL_WORKSPACES='tenant-a,tenant-b',TW_V2_RUNTIME_PROFILE='native',TW_V2_RUST_REQUESTS_PER_MINUTE='10000')
            with (args.output/'probe.log').open('w',encoding='utf-8') as log:
                process=subprocess.Popen([str(args.probe)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',env=env,creationflags=subprocess.CREATE_NO_WINDOW)
                lock=threading.Lock()
                def request(method,path,body=None,workspace='tenant-a',key=None):
                    value=dict(method=method,path=path,workspace=workspace)
                    if body is not None:value['body']=body
                    if method!='GET':value['key']=key or str(uuid.uuid4())
                    with lock:
                        process.stdin.write(json.dumps(value)+'\n');process.stdin.flush();line=process.stdout.readline()
                    assert line,(args.output/'probe.log').read_text()
                    return json.loads(line)
                def api(method,path,body=None,status=200,**opts):
                    result=request(method,path,body,**opts);assert result['status']==status,(method,path,result)
                    return result['body']
                session=api('POST','/api/v2/replay/sessions',dict(dataset_id='notes-fixture',name='Note workspace fixture',starting_balance='100000'),201)
                sid=session['record_id'];base=f'/api/v2/replay/sessions/{sid}'
                def replay(suffix,body):
                    nonlocal session
                    session=api('POST',base+suffix,dict(expected_revision=session['revision'],**body))
                replay('/execution',dict(instrument_spec=initial.instrument_spec,cost_model=initial.cost_model,spread_price='0.0002',timeframe_seconds=60,starting_balance='100000'))
                replay('/orders/market',dict(operation_id='fixture-buy',side='BUY',quantity='0.12',stop_loss=None,take_profit=None,execution_timing='current_quote'))
                replay('/step',dict(steps=3))
                replay('/orders/close',dict(target_id=session['payload']['execution']['position']['position_id'],operation_id='fixture-close'))
                trade=api('GET','/api/v2/replay/trades?page=1&page_size=10')['ledger'][0]['trade_id']
                for number in range(12):
                    replay('/orders/market',dict(operation_id=f'nav-buy-{number}',side='BUY',quantity='0.12',stop_loss=None,take_profit=None,execution_timing='current_quote'))
                    replay('/orders/close',dict(target_id=session['payload']['execution']['position']['position_id'],operation_id=f'nav-close-{number}'))
                labels='/api/v2/trade-labels'
                loose=api('POST',labels,dict(action='create',name='Ungrouped fixture',color='green'))
                captured=api('POST',labels,dict(action='create_group',name='Captured fixture',capture_ungrouped=True))
                group=next(item for item in captured['groups'] if item['name']=='Captured fixture')
                assert next(item for item in captured['items'] if item['name']=='Ungrouped fixture')['group_id']==group['id']
                body=dict(action='duplicate_group',id=group['id'],expected_revision=group['revision'],name='Copied fixture')
                copied=api('POST',labels,body,key='duplicate-group')
                assert api('POST',labels,body,key='duplicate-group')==copied
                copy=next(item for item in copied['groups'] if item['name']=='Copied fixture')
                assert any(item['group_id']==copy['id'] and item['name']=='Ungrouped fixture (1)' for item in copied['items'])
                api('POST',labels,{**body,'name':'Wrong revision','expected_revision':999},status=409)
                api('POST',labels,{**body,'name':'Other tenant'},workspace='tenant-b',status=422)
                current=api('GET',labels)
                assert not any(item['name']=='Wrong revision' for item in current['groups'])
                comment=dict(entry_type='observation',note='Isolated comment',tags=[],source=dict(kind='trade-comment',id='comment-fixture',parent_session_id=sid,parent_trade_id=trade))
                saved_comment=api('POST','/api/v2/journal',comment,status=201,key='comment-create')
                assert api('POST','/api/v2/journal',comment,status=201,key='comment-create')==saved_comment
                context=api('GET','/api/v2/journal/context?'+urlencode(dict(session_id=sid)))
                assert not any(item.get('has_notes') for item in context['trades'])
                checks.append('atomic tag-group capture/duplication, duplicate idempotency, stale CAS rollback, tenant isolation, comments do not create trade notes')
                doc=dict(format='blocknote',version=1,blocks=[dict(type='paragraph',content='Verified note template')])
                types='/api/v2/note-types'
                default_types=api('GET',types)
                assert default_types['revision']==0 and len(default_types['items'])==4
                for bad in [default_types['items'][1:],[{**item,'archived':True} if item['id']=='general' else item for item in default_types['items']]]:
                    api('POST',types,dict(expected_revision=0,items=bad),status=422)
                custom=dict(id='custom_'+str(uuid.uuid4()),name='Research review',color='cyan',archived=False)
                draft_types=dict(expected_revision=0,items=[*default_types['items'],custom])
                saved_types=api('POST',types,draft_types,key='create-note-type')
                assert saved_types==api('POST',types,draft_types,key='create-note-type') and saved_types['revision']==1
                assert api('GET',types,workspace='tenant-b')==default_types
                api('POST',types,draft_types,status=409)
                typed_note=dict(title='Custom classification',note='Persist custom type',note_type=custom['id'])
                typed_record=api('POST','/api/v2/live/records',dict(kind='note',payload=typed_note),status=201)
                api('POST','/api/v2/live/records',dict(kind='note',payload=typed_note),workspace='tenant-b',status=422)
                for bad in [[*default_types['items'],{**custom,'name':'General'}],default_types['items'],[*default_types['items'],{**custom,'id':'custom_bad'}]]:
                    api('POST',types,dict(expected_revision=1,items=bad),status=422)
                archived=api('POST',types,dict(expected_revision=1,items=[*default_types['items'],{**custom,'archived':True}]))
                assert archived['revision']==2 and archived['items'][-1]['archived']
                api('POST','/api/v2/live/records',dict(kind='note',payload=typed_note),status=422)
                retained=api('POST',f"/api/v2/live/records/{typed_record['record_id']}/revisions",dict(kind='note',expected_revision=typed_record['revision'],payload={**typed_note,'title':'Still editable'}))
                assert retained['payload']['note_type']==custom['id']
                checks.append('note types: protected defaults, persistent custom identity, idempotency, stale CAS, cross-workspace denial, archive tombstone, old note revision retained')
                library='/api/v2/note-templates'
                empty=api('GET',library);assert empty['items']==[] and empty['preferences']['defaults']=={}
                created=api('POST',library,dict(action='create',name='QA template',document=doc),key='create-template')
                assert api('POST',library,dict(action='create',name='QA template',document=doc),key='create-template')==created
                template=created['items'][0];tid=template['id']
                assert api('GET',library,workspace='tenant-b')['items']==[]
                api('POST',library,dict(action='update',id=tid,expected_revision=1,name='Renamed',document=doc),workspace='tenant-b',status=409)
                updated=api('POST',library,dict(action='update',id=tid,expected_revision=1,name='Renamed',document=doc));assert updated['items'][0]['revision']==2
                api('POST',library,dict(action='update',id=tid,expected_revision=1,name='Stale',document=doc),status=409)
                for bad in [dict(action='create',name=' ',document=doc),dict(action='create',name='Bad',document={**doc,'blocks':[dict(type='script',content='x')]}),dict(action='create',name='Bad table',document={**doc,'blocks':[dict(type='table',content={'type':'tableContent'})]}),dict(action='create',name='Null',document=None),dict(action='preferences',expected_revision=0,favorites=['missing'],defaults={}),dict(action='preferences',expected_revision=0,favorites=[],defaults={'wrong':'beginner'})]:api('POST',library,bad,status=422)
                prefs=api('POST',library,dict(action='preferences',expected_revision=0,favorites=[tid],defaults={'testing-trades':tid,'live-trades':'beginner','live-notes':'daily-report'}))
                assert len(prefs['preferences']['defaults'])==3
                api('POST',library,dict(action='preferences',expected_revision=0,favorites=[],defaults={}),status=409)
                deleted=api('POST',library,dict(action='delete',id=tid,expected_revision=2));assert tid not in deleted['preferences']['favorites'] and 'testing-trades' not in deleted['preferences']['defaults']
                assert deleted['preferences']['defaults']=={'live-trades':'beginner','live-notes':'daily-report'}
                checks.append('real template CRUD, idempotency, timestamps, optimistic revisions, tenant isolation, independent defaults, atomic delete cleanup, invalid request rejection')
                png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
                media='/api/v2/trade-media';query='?'+urlencode(dict(session_id=sid,trade_id=trade))
                body=dict(action='upload',session_id=sid,trade_id=trade,name='fixture.png',mime_type='image/png',data=base64.b64encode(png).decode())
                uploaded=api('POST',media,body,key='upload-image');mid=uploaded['id']
                assert api('POST',media,body,key='upload-image')==uploaded
                assert api('POST',media,body)==uploaded
                assert len(api('GET',media+query)['items'])==1
                result=request('GET',media+'/'+mid);assert base64.b64decode(result['body_base64'])==png and result['headers']['x-content-type-options']=='nosniff' and 'no-store' in result['headers']['cache-control']
                api('GET',media+'/'+mid,workspace='tenant-b',status=404)
                api('POST',media,{**body,'trade_id':'missing'},status=404)
                api('POST',media,{**body,'mime_type':'image/svg+xml','data':base64.b64encode(b'<svg/>').decode()},status=422)
                api('POST',media,{**body,'data':'not-base64'},status=422)
                api('POST',media,{**body,'data':base64.b64encode(b'not a PNG').decode()},status=422)
                big=png+b'\0'*(5*1024*1024-len(png))
                large=api('POST',media,{**body,'name':'max-size.png','data':base64.b64encode(big).decode()})
                api('POST',media,{**body,'data':base64.b64encode(big+b'\0').decode()},status=422)
                api('POST',media,dict(action='remove_media',id=large['id']))
                api('POST',media,dict(action='remove_media',id=mid),workspace='tenant-b',status=404)
                api('POST',media,dict(action='remove_media',id=mid));assert api('GET',media+query)['items']==[]
                assert api('GET',base)['revision']==session['revision']
                checks.append('real image bytes, 5MiB upload, signature/type/size guards, digest dedup, scoped read/delete, replay revision unchanged')
                import psycopg
                with psycopg.connect(dsn) as db:
                    connection=uuid.uuid4()
                    fills=[]
                    for position in [123,124]:
                        for offset in [0,1]:
                            fills.append(dict(ticket=position*10+offset,position_id=position,order=position*10+offset,type=offset,entry=offset,symbol='EURUSD',volume=0.1,price=1.1+offset*0.00015,time_msc=1793347200000+position*10000+offset*3600000,profit=1.51*offset,commission=0,swap=0,fee=0))
                    snapshot=dict(deals=fills,positions=[],orders=[],quotes=[],cashflows=[],account=dict(balance=1000,equity=1000,account_ref='1234567',currency='USD',opening_balance=10000))
                    db.execute("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,status,snapshot) VALUES('tenant-a',%s,%s,'synthetic','Fixture','Fixture-Demo','1234567','2026-01-01','connected',%s)",(connection,uuid.uuid4(),json.dumps(snapshot)))
                    db.commit()
                    live=api('POST',media,{**body,'session_id':f'live:{connection}','trade_id':'position:123'})
                    api('POST',media,{**body,'session_id':f'live:{connection}','trade_id':'position:999'},status=404)
                    assert json.loads(json.dumps(db.execute('SELECT snapshot FROM mt5_connections WHERE connection_id=%s',(connection,)).fetchone()[0]))==snapshot
                    api('POST',media,dict(action='remove_media',id=live['id']))
                    db.execute("INSERT INTO note_templates(workspace_id,subject,template_id,name,document,revision) VALUES('tenant-a','another-user',%s,'Private',%s,1)",(uuid.uuid4(),json.dumps(doc)));db.commit()
                    assert api('GET',library)['items']==[]
                checks.append('broker-position ownership from stored snapshot only; no terminal/API polling; identity-private templates')
                # Start browser from clean preferences while retaining server-owned revisions.
                current=api('GET',library)['preferences']
                api('POST',library,dict(action='preferences',expected_revision=current['revision'],favorites=['beginner','daily-report'],defaults={}))
                if args.browser_test:
                    class Handler(BaseHTTPRequestHandler):
                        def log_message(self,*_):pass
                        def handle_api(self):
                            if self.path=='/fixture':result=dict(status=200,headers={},body=dict(session_id=sid,trade_id=trade,live_payload=dict(snapshot,status='ready',source='MT5',connection_id=str(connection),account_login='1234567',account_environment='demo')))
                            elif self.path=='/api/v2/events':result=dict(status=204,headers={},body={})
                            elif self.path.startswith('/api/v2/'):
                                body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))) if self.command=='POST' else None
                                result=request(self.command,self.path,body,workspace=self.headers.get('X-Workspace-Id','tenant-a'),key=self.headers.get('Idempotency-Key'))
                            else:result=dict(status=403,headers={},body=dict(detail='fixture_scope_denied'))
                            data=base64.b64decode(result['body_base64']) if result.get('body_base64') else json.dumps(result['body']).encode()
                            self.send_response(result['status']);self.send_header('Content-Type',result.get('headers',{}).get('content-type','application/json'));self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
                        do_GET=handle_api
                        do_POST=handle_api
                    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
                    subprocess.run(['node',str(args.browser_test),args.ui_origin,str(args.output/'browser'),f'http://127.0.0.1:{server.server_port}'],check=True,cwd=V2/'web')
                    checks.append('browser using real isolated native Router/PostgreSQL')
                receipt=dict(status='PASS',scope='owned disposable PostgreSQL + synthetic dataset/snapshot; no owner runtime or broker action',checks=checks,probe_sha256=hashlib.sha256(args.probe.read_bytes()).hexdigest())
                (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
        finally:
            if server:server.shutdown();server.server_close()
            if process:process.terminate();process.wait(timeout=10)
            store.close();pg('pg_ctl','-D',str(work/'pg'),'-m','fast','-w','stop')

if __name__=='__main__':main()
