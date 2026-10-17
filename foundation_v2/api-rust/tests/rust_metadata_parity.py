"""Native metadata differential tests; owns an isolated, disposable PostgreSQL cluster."""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

API = Path(__file__).resolve().parents[1]
V2 = API.parent
sys.path[:0] = [str(V2), str(V2.parent)]
import psycopg
from fastapi.testclient import TestClient
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.store import PostgresStore


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pg-bin', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--extra-test', action='append', default=[])
    parser.add_argument('--extra-lib', action='append', default=[])
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='rust-metadata-') as temp:
        runtime = Path(temp)
        pgdata = runtime / 'pgdata'
        pgport = port()
        subprocess.run([str(args.pg_bin / 'initdb.exe'), '-D', str(pgdata), '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8'], check=True, capture_output=True)
        with (runtime / 'postgres.log').open('w') as log:
            postgres = subprocess.Popen([str(args.pg_bin / 'postgres.exe'), '-D', str(pgdata), '-h', '127.0.0.1', '-p', str(pgport)], stdout=log, stderr=log)
            try:
                base = f'host=127.0.0.1 port={pgport} user=postgres dbname=postgres'
                for _ in range(100):
                    try:
                        with psycopg.connect(base, autocommit=True) as conn:
                            database = 'rust_metadata_' + uuid4().hex
                            conn.execute(f'CREATE DATABASE {database}')
                        break
                    except psycopg.OperationalError:
                        if postgres.poll() is not None: raise RuntimeError('fixture PG exited')
                        time.sleep(.1)
                else: raise RuntimeError('fixture PG timeout')
                dsn = f'host=127.0.0.1 port={pgport} user=postgres dbname={database}'
                store = PostgresStore(dsn)
                store.initialize()
                ids, cases = {}, []
                def substitute(value):
                    if isinstance(value, str):
                        for alias, identifier in ids.items(): value = value.replace('$' + alias, identifier)
                    elif isinstance(value, dict): value = {k: substitute(v) for k, v in value.items()}
                    elif isinstance(value, list): value = [substitute(v) for v in value]
                    return value
                with TestClient(create_app(dsn=dsn, artifact_root=runtime/'artifacts', authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a', 'tenant-b']))) as client:
                    def request(name, path, body, status, save=None, workspace='tenant-a', key=None, expected=None):
                        headers = {'x-workspace-id': workspace} if workspace is not None else {}
                        response = client.post(substitute(path), json=substitute(body), headers=headers)
                        assert response.status_code == status, (name, response.status_code, response.text)
                        value = response.json()
                        if save: ids[save] = value['record_id']
                        normalized = deepcopy(value)
                        if isinstance(normalized, dict):
                            for field in ['record_id', 'created_at_utc', 'updated_at_utc']: normalized.pop(field, None)
                            parent = normalized.get('payload', {}).get('parent_playbook_id')
                            for alias, identifier in ids.items():
                                if parent == identifier: normalized['payload']['parent_playbook_id'] = '$' + alias
                        cases.append(dict(name=name, path=path, body=body, status=status, save=save, workspace=workspace, key=key, expected=expected or normalized))
                        return value
                    book = dict(name='London breakout', execution_capability='manual-only', rules={'session': 'London'})
                    request('create defaults', '/api/v2/playbooks', book, 201, 'book', key='create-book')
                    # Python API has no receipt middleware; expected native retry is the original receipt.
                    cases.append({**cases[-1], 'name': 'idempotent retry', 'save': None})
                    cases.append(dict(name='idempotency conflict', path='/api/v2/playbooks', body={**book, 'name':'different'}, status=409, workspace='tenant-a', key='create-book', expected={'detail':'command_idempotency_conflict'}))
                    request('frozen creation denied', '/api/v2/playbooks', {**book, 'status':'frozen'}, 409)
                    request('lineage injection denied', '/api/v2/playbooks', {**book, 'parent_playbook_id':'other'}, 422)
                    request('fork draft denied', '/api/v2/playbooks/$book/fork', {'expected_revision':1}, 409)
                    request('draft revision', '/api/v2/playbooks/$book/revisions', {'expected_revision':'1', 'payload':{**book, 'name':'Changed'}}, 200)
                    request('stale revision', '/api/v2/playbooks/$book/freeze', {'expected_revision':1}, 409)
                    request('freeze', '/api/v2/playbooks/$book/freeze', {'expected_revision':2}, 200)
                    request('freeze idempotent state', '/api/v2/playbooks/$book/freeze', {'expected_revision':3}, 200)
                    request('frozen edit denied', '/api/v2/playbooks/$book/revisions', {'expected_revision':3, 'payload':book}, 409)
                    request('fork', '/api/v2/playbooks/$book/fork', {'expected_revision':3, 'name':'Fork'}, 201, 'fork')
                    request('lineage edit denied', '/api/v2/playbooks/$fork/revisions', {'expected_revision':1, 'payload':book}, 409)
                    journal = dict(entry_type='decision', note='Skip on news', source={'kind':'replay', 'id':'decision-1'})
                    request('journal defaults', '/api/v2/journal', journal, 201, 'journal')
                    request('journal unique source', '/api/v2/journal', journal, 409, key='duplicate-journal')
                    cases.append({**cases[-1], 'name': 'failed receipt retry'})
                    cases.append(dict(name='failed receipt changed body conflict', path='/api/v2/journal', body={**journal,'source':{'kind':'replay','id':'different'}}, status=409, workspace='tenant-a', key='duplicate-journal', expected={'detail':'command_idempotency_conflict'}))
                    request('journal source invalid', '/api/v2/journal', {**journal, 'source':{}}, 422)
                    request('journal revise', '/api/v2/journal/$journal/revisions', {'expected_revision':1, 'payload':{**journal, 'note':'Reviewed', 'plan':'Wait'}}, 200)
                    request('journal source immutable', '/api/v2/journal/$journal/revisions', {'expected_revision':2, 'payload':{**journal, 'source':{'kind':'replay', 'id':'new'}}}, 409)
                    annotation = dict(annotation_type='zone', instrument_id='EURUSD', timeframe='M1', cutoff_timestamp=120, anchors=[{'timestamp':60,'price':1.1}], source='replay')
                    request('annotation create', '/api/v2/chart/annotations', annotation, 201, 'annotation')
                    request('future anchor', '/api/v2/chart/annotations', {**annotation, 'anchors':[{'timestamp':121,'price':1.1}]}, 422)
                    request('annotation missing price', '/api/v2/chart/annotations', {**annotation, 'anchors':[{'timestamp':60}]}, 422)
                    request('annotation revise', '/api/v2/chart/annotations/$annotation/revisions', {'expected_revision':1, 'payload':{**annotation,'label':'Zone'}}, 200)
                    request('annotation stale delete', '/api/v2/chart/annotations/$annotation/delete', {'expected_revision':1}, 409)
                    for value in [True, False, '2', 2.0, None, 0, -1]:
                        request('strict deletion ' + str(value), '/api/v2/chart/annotations/$annotation/delete', {'expected_revision':value}, 422)
                    request('delete annotation', '/api/v2/chart/annotations/$annotation/delete', {'expected_revision':2}, 200)
                    request('tombstone edit denied', '/api/v2/chart/annotations/$annotation/revisions', {'expected_revision':3, 'payload':annotation}, 404)
                    request('tombstone delete denied', '/api/v2/chart/annotations/$annotation/delete', {'expected_revision':3}, 404)
                    for path, body in [('/api/v2/playbooks/$book/freeze', {'expected_revision':3}), ('/api/v2/journal/$journal/revisions', {'expected_revision':2, 'payload':journal}), ('/api/v2/chart/annotations/$annotation/delete', {'expected_revision':3})]:
                        request('cross-workspace denied', path, body, 404, workspace='tenant-b')
                    request('missing auth', '/api/v2/playbooks', book, 422, workspace=None)
                    request('forbidden workspace', '/api/v2/playbooks', book, 403, workspace='not-member')
                    request('unknown field', '/api/v2/playbooks', {**book,'unknown':True}, 422)
                    spec = dict(family='ict',label='Liquidity test',methodology_version='1',hypothesis='Test only',entry_definition='Close above level',exit_definition='Next close',invalidation_definition='Below level')
                    request('strategy nested default factories', '/api/v2/playbooks', {**book,'strategy_spec':spec}, 201, 'strategy')
                    request('strategy capability boundary', '/api/v2/playbooks', {**book,'strategy_spec':{**spec,'execution_capability':'engine-supported'}}, 422)
                    request('strategy evidence boundary', '/api/v2/playbooks', {**book,'strategy_spec':{**spec,'edge_status':'software_only'}}, 422)
                    for metrics in [[], [' '], ['net_pnl','net_pnl']]:
                        request('strategy metrics boundary', '/api/v2/playbooks', {**book,'strategy_spec':{**spec,'evaluation':{'required_metrics':metrics}}}, 422)
                    request('strategy OOS boundary', '/api/v2/playbooks', {**book,'strategy_spec':{**spec,'evaluation':{'walk_forward_required':False}}}, 422)
                with store.connect() as conn:
                    conn.execute('TRUNCATE workspace_record_revisions,workspace_records,workspaces CASCADE')
                    conn.commit()
                golden = runtime/'golden.json'
                golden.write_text(json.dumps(cases), encoding='utf-8')
                env = {**os.environ, 'TW_V2_DATABASE_URL':dsn, 'TW_V2_ARTIFACT_ROOT':str(runtime/'artifacts'), 'TW_V2_LOCAL_IDENTITY':'local-owner', 'TW_V2_LOCAL_WORKSPACES':'tenant-a,tenant-b', 'TW_METADATA_GOLDEN':str(golden)}
                results = []
                targets=[(target,['--test',target]) for target in ['rust_metadata_parity',*args.extra_test]]+[(target,['--lib',target]) for target in args.extra_lib]
                for target,selector in targets:
                    result = subprocess.run(['cargo','test','--locked',*selector,'--','--ignored','--nocapture'], cwd=API, env=env, text=True, capture_output=True)
                    print(result.stdout)
                    print(result.stderr, file=sys.stderr)
                    results.append(dict(target=target, passed=result.returncode==0, stdout=result.stdout, stderr=result.stderr))
                    if result.returncode: break
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps({'passed':all(result['passed'] for result in results),'cases':len(cases),'results':results}, indent=2), encoding='utf-8')
                if result.returncode: raise SystemExit(result.returncode)
            finally:
                subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(pgdata),'-m','fast','stop'], capture_output=True, timeout=20)
                postgres.wait(timeout=20)


if __name__ == '__main__': main()
