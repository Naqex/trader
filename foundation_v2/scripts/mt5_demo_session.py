"""Run one preapproved Demo open/close pair through native Automation HTTP only.

A durable intent is never posted twice, including after a timeout or restart.
This client cannot create/revoke grants, choose risk budgets or renew authority.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import Literal
from urllib import error, request
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from pydantic import BaseModel, ConfigDict, Field, model_validator
from scripts.local_owner_access import exact_origins, private_directory, require_local_tree
from trading_workspace_v2.owner_absence_journal import _exclusive_file_lock

LIMIT = 65536


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read_json(path):
    with Path(path).open('rb') as stream:
        raw = stream.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError('session JSON exceeds 64 KiB')
    return json.loads(raw)


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)


class Entry(FrozenModel):
    request_id: UUID
    connection_id: UUID
    mode: Literal['demo']
    account_id: str = Field(pattern=r'^[1-9][0-9]{0,17}$', strict=True)
    server: str = Field(min_length=1, max_length=160, strict=True)
    action: Literal['place']
    symbol: str = Field(min_length=1, max_length=64, strict=True)
    side: Literal['BUY', 'SELL']
    order_type: Literal['market']
    volume: float = Field(gt=0, strict=True)
    stop_loss: float = Field(gt=0, strict=True)


class Plan(FrozenModel):
    schema_version: Literal['mt5-demo-session-v1']
    api_origin: str
    workspace_id: str = Field(min_length=1, max_length=160, strict=True)
    connection_generation: int = Field(ge=1, strict=True)
    artifact_path: str
    artifact_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    expires_at: datetime
    entry: Entry
    close_request_id: UUID

    @model_validator(mode='after')
    def valid(self):
        exact_origins([self.api_origin])
        if (self.expires_at.tzinfo is None or self.expires_at.utcoffset() is None or
                self.entry.request_id == self.close_request_id or
                any(ord(c) < 32 for c in self.workspace_id)):
            raise ValueError('session requires timezone, distinct request IDs and a valid workspace')
        return self


class Credential(FrozenModel):
    grant_id: UUID
    credential_id: UUID
    credential: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$', repr=False)


class NativeClient:
    def __init__(self, plan, credential):
        self.plan, self.credential = plan, credential
        # Never send a bearer to an environment proxy or redirect destination.
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None):
        receipt = path.startswith('/api/v2/automation/trading/requests/')
        if receipt:
            UUID(path.rsplit('/', 1)[1])
        snapshot = urlsplit(path)
        is_snapshot = (snapshot.path == '/api/v2/automation/trading/snapshot' and body is None
            and parse_qs(snapshot.query) == {'symbol': [getattr(self.plan, 'symbol', None)]}
            and not snapshot.fragment)
        if not ((receipt and body is None) or is_snapshot or
                (path in ('/api/v2/automation/trading/commands', '/api/v2/automation/trading/reconcile') and body is not None)):
            raise ValueError('runner route denied')
        req = request.Request(self.plan.api_origin + path,
            data=None if body is None else encoded(body),
            headers={'Authorization': 'Bearer ' + self.credential.credential,
                     'X-Workspace-Id': self.plan.workspace_id, 'Content-Type': 'application/json'})
        try:
            response = self.opener.open(req, timeout=30)
        except error.HTTPError as response_error:
            response = response_error
        with response:
            limit = 256 * 1024 if is_snapshot else LIMIT
            raw = response.read(limit + 1)
            if len(raw) > limit:
                raise ValueError('native response exceeds limit')
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError('native response must be an object')
            return response.code, result


def save(path, state):
    state['updated_at_utc'] = datetime.now(timezone.utc).isoformat()
    record = {'state': state, 'sha256': digest(encoded(state))}
    raw = encoded(record)
    if len(raw) > LIMIT:
        raise ValueError('session checkpoint exceeds 64 KiB')
    fd, name = tempfile.mkstemp(prefix='.session-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load(path, schema='mt5-demo-session-state-v1'):
    record = read_json(path)
    if (set(record) != {'state', 'sha256'} or
            digest(encoded(record['state'])) != record['sha256'] or
            record['state'].get('schema_version') != schema):
        raise ValueError('session checkpoint integrity failed')
    return record['state']


def matches(result, command, plan, credential):
    scope = result.get('scope', {})
    authority = result.get('automation', {})
    return (isinstance(scope, dict) and isinstance(authority, dict) and
        result.get('request_id') == command['request_id'] and
        result.get('action') == command['action'] and
        all(scope.get(k) == command[k] for k in ('connection_id', 'mode', 'account_id', 'server', 'symbol')) and
        scope.get('generation') == plan.connection_generation and
        authority.get('grant_id') == str(credential.grant_id) and
        authority.get('credential_id') == str(credential.credential_id) and
        authority.get('artifact_sha256') == plan.artifact_sha256)


def complete(result, volume):
    return (result.get('status') == 'filled' and result.get('requires_reconciliation') is False and
        result.get('volume') == volume and result.get('retcode') in (None, 10009) and
        type(result.get('order')) is int and result['order'] > 0)


def settled(result, volume):
    return complete(result, volume) or (result.get('status') == 'rejected' and
                                       result.get('requires_reconciliation') is not True)


def submit_once(plan, credential, state, path, client, label, command, *, reconcile_only, now):
    attempt = state[label]
    if attempt is None:
        if reconcile_only or (path.parent / 'STOP').exists() or now() >= plan.expires_at:
            return None
        # Crash before/after POST is deliberately ambiguous: resume reads and
        # reconciles this same ID. A 404 is never permission to POST it again.
        attempt = state[label] = {'command': command, 'intent_at_utc': now().isoformat()}
        save(path, state)
        started = time.monotonic()
        try:
            code, result = client.call('/api/v2/automation/trading/commands',
                {'artifact_sha256': plan.artifact_sha256, 'command': command})
            attempt['http_status'] = code
            if code == 200 and matches(result, command, plan, credential):
                attempt['result'] = result
        except (OSError, ValueError):
            attempt['transport_outcome'] = 'unknown'
        attempt['request_elapsed_ms'] = round((time.monotonic() - started) * 1000)
        save(path, state)
    elif attempt['command'] != command:
        raise ValueError('saved intent differs from registered command')
    result = attempt.get('result', {})
    if not settled(result, command['volume']):
        for route, body in (
            ('/api/v2/automation/trading/requests/' + command['request_id'], None),
            ('/api/v2/automation/trading/reconcile',
             {'request_id': command['request_id'], 'connection_id': command['connection_id']})):
            try:
                code, readback = client.call(route, body)
                attempt['reconciliation_http_status'] = code
                if code == 200 and matches(readback, command, plan, credential):
                    result = attempt['result'] = readback
            except (OSError, ValueError):
                attempt['reconciliation_transport'] = 'unavailable'
            save(path, state)
            if settled(result, command['volume']):
                break
    return result


def advance(plan, credential, state, path, client, *, reconcile_only, now):
    def store():
        save(path, state)

    def submit_or_read(label, command):
        return submit_once(plan, credential, state, path, client, label, command,
                           reconcile_only=reconcile_only, now=now)

    entry = plan.entry.model_dump(mode='json')
    opening = submit_or_read('opening', entry)
    if opening is None:
        state.update(status='stopped', reason='no_new_send_authority', requires_owner_attention=False)
    elif complete(opening, entry['volume']):
        closing = {key: entry[key] for key in ('connection_id', 'mode', 'account_id', 'server', 'symbol', 'volume')}
        closing.update(request_id=str(plan.close_request_id), action='close', ticket=opening['order'])
        outcome = submit_or_read('closing', closing)
        closed = outcome is not None and complete(outcome, entry['volume'])
        state.update(status='completed' if closed else 'attention_required',
            reason='open_close_proven' if closed else 'opening_filled_close_not_proven',
            requires_owner_attention=not closed)
    else:
        rejected = settled(opening, entry['volume'])
        state.update(status='blocked' if rejected else 'attention_required',
            reason=opening.get('reason', 'opening_outcome_unproven'),
            requires_owner_attention=not rejected)
    store()
    return state


def run(manifest, credential_file, state_dir, *, resume=False, reconcile_only=False,
        client_factory=NativeClient, now=lambda: datetime.now(timezone.utc)):
    manifest, credential_file, state_dir = map(Path, (manifest, credential_file, state_dir))
    require_local_tree(state_dir.absolute())
    plan = Plan.model_validate(read_json(manifest))
    credential = Credential.model_validate(read_json(credential_file))
    artifact = (manifest.resolve().parent / plan.artifact_path).resolve()
    sha = hashlib.sha256()
    with artifact.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            sha.update(block)
    if sha.hexdigest() != plan.artifact_sha256:
        raise ValueError('registered artifact digest mismatch')
    identity = dict(manifest_sha256=digest(encoded(plan.model_dump(mode='json'))),
        credential_sha256=digest(credential.credential.encode()), grant_id=str(credential.grant_id),
        credential_id=str(credential.credential_id))
    if not resume:
        if reconcile_only:
            raise ValueError('reconcile-only requires an existing session')
        state_dir.mkdir(parents=False, exist_ok=False)
        private_directory(state_dir)
    path = state_dir / 'state.json'
    if resume and not path.is_file():
        raise ValueError('existing session checkpoint required')
    with _exclusive_file_lock(state_dir / 'state.lock'):
        if resume:
            state = load(path)
            if any(state.get(k) != v for k, v in identity.items()):
                raise ValueError('session manifest or credential changed')
        else:
            state = dict(schema_version='mt5-demo-session-state-v1', **identity,
                         opening=None, closing=None, status='prepared', requires_owner_attention=False)
            save(path, state)
        if state['status'] == 'completed':
            return state
        return advance(plan, credential, state, path, client_factory(plan, credential),
                       reconcile_only=reconcile_only, now=now)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('start', 'resume', 'reconcile', 'status'))
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--credential-file', type=Path)
    parser.add_argument('--state-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.operation == 'status':
            result = load(args.state_dir / 'state.json')
        else:
            if args.manifest is None or args.credential_file is None:
                raise ValueError('manifest and credential-file are required')
            result = run(args.manifest, args.credential_file, args.state_dir,
                resume=args.operation != 'start', reconcile_only=args.operation == 'reconcile')
        # No credentials, raw HTTP errors or filesystem contents in console output.
        print(json.dumps({k: result.get(k) for k in
            ('status', 'reason', 'grant_id', 'requires_owner_attention', 'updated_at_utc')}))
        return 0 if result['status'] == 'completed' else 3
    except (OSError, ValueError, RuntimeError) as exc:
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__,
                          'action': 'inspect_existing_state_before_resume'}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
