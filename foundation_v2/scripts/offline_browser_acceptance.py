"""Shared owned PostgreSQL/HTTP fixture for real browser acceptance."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from api_platform_acceptance import PG, V2, port, wait_until
from trading_workspace_v2.store import PostgresStore
import httpx


def run_acceptance(evidence_name, browser_script, *, pytest_paths=()):
    out = V2 / 'evidence' / evidence_name
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tw-browser-qa-') as temporary:
        work = Path(temporary)
        data = work / 'pg'
        (work / 'artifacts').mkdir()
        pgport, apiport, uiport = port(), port(), port()

        def pg_run(name, *args):
            subprocess.run([str(PG / f'{name}.exe'), *args], check=True, timeout=45,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)

        pg_run('initdb', '-D', str(data), '-U', 'prop_fixture', '-A', 'trust', '--locale=C', '--encoding=UTF8')
        pg_run('pg_ctl', '-D', str(data), '-l', str(work / 'pg.log'), '-o', f'-h 127.0.0.1 -p {pgport}', '-w', 'start')
        env = {**os.environ, 'TW_V2_DATABASE_URL': f'host=127.0.0.1 port={pgport} user=prop_fixture dbname=postgres',
               'TW_V2_API_TARGET': f'http://127.0.0.1:{apiport}', 'TW_V2_RUST_REQUESTS_PER_MINUTE': '10000'}
        base = [sys.executable, '-B', str(V2 / 'scripts/run_api_platform.py'), '--database-name', 'postgres',
                '--port', str(apiport), '--artifact-root', str(work / 'artifacts'), '--download-engine', 'none',
                '--manifest', str(work / 'runtime/owner.json')]
        children, logs = [], []
        try:
            subprocess.run([*base, '--setup-only', '--migrate'], env=env, cwd=V2, check=True, timeout=45)
            store = PostgresStore(env['TW_V2_DATABASE_URL'])
            store.ensure_workspace('tenant-a')
            store.close()
            if pytest_paths:
                subprocess.run([sys.executable, '-B', '-m', 'pytest', *pytest_paths, '-q'], env=env, cwd=V2, check=True, timeout=240)
            for name, command, cwd in [('api', base, V2), ('vite', ['node', 'node_modules/vite/bin/vite.js', '--port', str(uiport), '--strictPort'], V2 / 'web')]:
                log = (out / f'{name}.log').open('wb')
                logs.append(log)
                children.append(subprocess.Popen(command, env=env, cwd=cwd, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW))
            wait_until(lambda: httpx.get(f'http://127.0.0.1:{apiport}/health/ready').status_code == 200)
            wait_until(lambda: httpx.get(f'http://127.0.0.1:{uiport}').status_code == 200)
            subprocess.run(['node', browser_script, f'http://127.0.0.1:{uiport}', str(out), str(work / 'artifacts')],
                           cwd=V2 / 'web', check=True, timeout=240)
        finally:
            manifest_path = work / 'runtime/owner.json'
            if manifest_path.exists():
                manifest = json.loads(manifest_path.read_text())
                Path(manifest['stop_file']).write_text('stop\n')
            for child in children:
                try:
                    child.wait(timeout=50 if child is children[0] else 1)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            for log in logs:
                log.close()
            pg_run('pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop')
