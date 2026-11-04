"""Bounded, restartable native tick capture. No strategy, grants or broker commands."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import Literal
from urllib import request
from urllib.parse import urlencode
from uuid import UUID

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from pydantic import BaseModel, ConfigDict, Field, model_validator
from scripts.local_owner_access import exact_origins, private_directory, require_local_tree
from trading_workspace_v2.owner_absence_journal import _exclusive_file_lock

LIMIT = 4*1024*1024


class CaptureError(ValueError):
    pass


class Frozen(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)


class Binding(Frozen):
    workspace_id: str = Field(min_length=1, max_length=160, strict=True)
    connection_id: UUID
    generation: int = Field(ge=1, strict=True)
    login: str = Field(pattern=r'^[1-9][0-9]{0,17}$', strict=True)
    server: str = Field(min_length=1, max_length=160, strict=True)
    environment: Literal['demo']


class Plan(Frozen):
    schema_version: Literal['mt5-observed-capture-v1']
    api_origin: str
    binding: Binding
    symbol: str = Field(min_length=1, max_length=64, strict=True)
    from_msc: int = Field(ge=0, strict=True)
    to_msc: int = Field(ge=0, strict=True)
    page_seconds: int = Field(default=10, ge=1, le=60, strict=True)

    @model_validator(mode='after')
    def bounded(self):
        exact_origins([self.api_origin])
        if (not 0 < self.to_msc-self.from_msc <= 86400000 or
                self.from_msc%1000 or self.to_msc%1000 or
                any(ord(c)<32 for text in (self.binding.workspace_id,self.binding.server,self.symbol) for c in text) or
                (self.to_msc-self.from_msc+self.page_seconds*1000-1)//(self.page_seconds*1000)>10000):
            raise CaptureError('capture_plan_invalid')
        return self


class Tick(Frozen):
    time_msc: int = Field(ge=0, strict=True)
    source_time_msc: int = Field(ge=0, strict=True)
    bid: float = Field(gt=0, strict=True)
    ask: float = Field(gt=0, strict=True)
    flags: int = Field(ge=0, strict=True)


class Page(Frozen):
    schema_version: Literal['mt5-tick-range-v1']
    status: Literal['ready']
    binding: Binding
    symbol: str
    from_msc: int = Field(ge=0, strict=True)
    to_msc: int = Field(ge=0, strict=True)
    observed_at_msc: int = Field(ge=0, strict=True)
    clock: dict
    coverage: Literal['broker_history_unverified']
    execution_capability: Literal[False]
    sdk_version: str = Field(min_length=1,max_length=64,strict=True)
    source_sha256: dict[str, str]
    rows: tuple[Tick, ...] = Field(max_length=5000)

    @model_validator(mode='after')
    def valid_ticks(self):
        if (self.observed_at_msc < self.to_msc+2000 or not 0<self.to_msc-self.from_msc<=60000 or
                self.from_msc%1000 or self.to_msc%1000 or
                set(self.source_sha256)!={'mt5_tick_capture.py','mt5_clock.py'} or
                any(len(v)!=64 or any(c not in '0123456789abcdef' for c in v) for v in self.source_sha256.values())):
            raise CaptureError('capture_page_invalid')
        previous = self.from_msc
        for tick in self.rows:
            if (not previous<=tick.time_msc<self.to_msc or tick.ask<tick.bid):
                raise CaptureError('capture_tick_invalid')
            previous = tick.time_msc
        return self


def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()


def checksum(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def read_json(path):
    with Path(path).open('rb') as stream:
        raw = stream.read(LIMIT+1)
    if len(raw)>LIMIT:
        raise CaptureError('capture_file_too_large')
    return json.loads(raw)


def store(path, value):
    data = encoded(dict(value=value,sha256=checksum(value)))
    if len(data)>LIMIT:
        raise CaptureError('capture_file_too_large')
    fd, name = tempfile.mkstemp(prefix='.capture-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name,path)
    finally:
        Path(name).unlink(missing_ok=True)


def checked(path):
    require_local_tree(path)
    record = read_json(path)
    if set(record)!={'value','sha256'} or checksum(record['value'])!=record['sha256']:
        raise CaptureError('capture_checksum_mismatch')
    return record['value']


def validate_page(value, plan, start, end):
    page = Page.model_validate(value)
    if (page.binding!=plan.binding or page.symbol!=plan.symbol or
            page.from_msc!=start or page.to_msc!=end):
        raise CaptureError('capture_binding_changed')
    return page.model_dump(mode='json')


def economic(page):
    # A re-read has a new observation time; all source data and lineage must match.
    return {k:v for k,v in page.items() if k!='observed_at_msc'}


def load(directory, plan=None):
    state = checked(directory/'state.json')
    saved_plan = Plan.model_validate(state['plan'])
    if (state.get('schema_version')!='mt5-observed-state-v1' or
            (plan is not None and plan!=saved_plan) or
            state['client_sha256']!=hashlib.sha256(Path(__file__).read_bytes()).hexdigest() or
            len(state['pages'])>10000):
        raise CaptureError('capture_plan_or_client_changed')
    cursor, count, last = saved_plan.from_msc, 0, None
    for index, digest in enumerate(state['pages']):
        end = min(cursor+saved_plan.page_seconds*1000,saved_plan.to_msc)
        page = validate_page(checked(directory/f'{index:05d}.json'),saved_plan,cursor,end)
        if checksum(page)!=digest or (last and any(last[k]!=page[k] for k in ('clock','source_sha256','sdk_version'))):
            raise CaptureError('capture_prefix_changed')
        cursor, count, last = end, count+len(page['rows']), page
    if cursor!=state['next_from_msc'] or count!=state['tick_count'] or cursor>saved_plan.to_msc:
        raise CaptureError('capture_cursor_invalid')
    return state, saved_plan, last


def record(plan, directory, *, resume, fetch, max_batches=12, now_msc=None):
    if type(max_batches) is not int or not 1<=max_batches<=360:
        raise CaptureError('capture_batch_limit_invalid')
    directory = Path(directory).absolute()
    require_local_tree(directory)
    if not resume:
        directory.mkdir()
        private_directory(directory)
    require_local_tree(directory/'writer.lock')
    with _exclusive_file_lock(directory/'writer.lock'):
        if resume:
            state, _, last = load(directory,plan)
        else:
            state = dict(schema_version='mt5-observed-state-v1',plan=plan.model_dump(mode='json'),
                client_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                pages=[],next_from_msc=plan.from_msc,tick_count=0)
            store(directory/'state.json',state)
            last = None
        if (directory/'STOP').exists():
            return summary(state,plan,'stopped')
        # A late/backfilled or revised broker page cannot silently change an
        # already consumed prefix. Keep the original and require review.
        if last:
            reread = validate_page(fetch(last['from_msc'],last['to_msc']),plan,last['from_msc'],last['to_msc'])
            if economic(last)!=economic(reread):
                raise CaptureError('capture_committed_window_changed')
        for _ in range(max_batches):
            if (directory/'STOP').exists():
                return summary(state,plan,'stopped')
            start = state['next_from_msc']
            if start==plan.to_msc:
                break
            end = min(start+plan.page_seconds*1000,plan.to_msc)
            now = int(time.time()*1000) if now_msc is None else now_msc
            if end>now-2000:
                return summary(state,plan,'waiting')
            page = validate_page(fetch(start,end),plan,start,end)
            if last and any(page[k]!=last[k] for k in ('clock','source_sha256','sdk_version')):
                raise CaptureError('capture_source_changed')
            path = directory/f'{len(state["pages"]):05d}.json'
            if path.exists():
                # Crash after page fsync but before cursor commit: re-read and
                # adopt exactly that durable page, never append its ticks twice.
                orphan = validate_page(checked(path),plan,start,end)
                if economic(page)!=economic(orphan):
                    raise CaptureError('capture_uncommitted_window_changed')
                page = orphan
            else:
                store(path,page)
            state['pages'].append(checksum(page))
            state['next_from_msc'],state['tick_count'] = end,state['tick_count']+len(page['rows'])
            store(directory/'state.json',state)
            last = page
        return summary(state,plan,'complete' if state['next_from_msc']==plan.to_msc else 'capturing')


def summary(state, plan, status):
    return dict(status=status,pages=len(state['pages']),ticks=state['tick_count'],
        requested_through_msc=state['next_from_msc'],planned_to_msc=plan.to_msc,
        coverage='broker_history_unverified',execution_capability=False,strategy_qualified=False)


class NativeReader:
    def __init__(self, plan, token):
        self.plan, self.token = plan, token
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):
                return None
        self.opener = request.build_opener(request.ProxyHandler({}),NoRedirect())

    def __call__(self,start,end):
        query = urlencode(dict(connection_id=str(self.plan.binding.connection_id),
            generation=self.plan.binding.generation,symbol=self.plan.symbol,from_msc=start,to_msc=end))
        req = request.Request(self.plan.api_origin+'/api/v2/live/trading/ticks?'+query,
            headers={'Authorization':'Bearer '+self.token,'X-Workspace-Id':self.plan.binding.workspace_id})
        with self.opener.open(req,timeout=85) as response:
            raw = response.read(LIMIT+1)
        if len(raw)>LIMIT:
            raise CaptureError('capture_response_too_large')
        return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('start','resume','status'))
    parser.add_argument('--state-dir',type=Path,required=True)
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--owner-secret-file',type=Path)
    parser.add_argument('--max-batches',type=int,default=12)
    args = parser.parse_args()
    try:
        if args.action=='status':
            state,plan,_ = load(args.state_dir)
            result = summary(state,plan,'complete' if state['next_from_msc']==plan.to_msc else 'capturing')
        else:
            if args.manifest is None or args.owner_secret_file is None:
                raise CaptureError('capture_private_inputs_required')
            directory = args.state_dir.resolve()
            if any(p.resolve().is_relative_to(directory) for p in (args.manifest,args.owner_secret_file)):
                raise CaptureError('capture_inputs_must_be_outside_output')
            plan = Plan.model_validate(read_json(args.manifest))
            token = read_json(args.owner_secret_file)['owner_bearer']
            if not isinstance(token,str) or not token or any(ord(c)<32 for c in token):
                raise CaptureError('capture_owner_credential_invalid')
            result = record(plan,args.state_dir,resume=args.action=='resume',
                fetch=NativeReader(plan,token),max_batches=args.max_batches)
        print(json.dumps(result))
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error,CaptureError) else 'capture_failed'
        print(json.dumps(dict(status='error',reason=reason,error_type=type(error).__name__,execution_capability=False)),file=sys.stderr)
        return 2


if __name__=='__main__':
    raise SystemExit(main())
