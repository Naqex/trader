"""Finite, decision-driven Demo session; broker inventory is never simulated.

The runner receives only a bounded native Automation credential. Historical
closed Bid bars seed indicators; they never cause retrospective entry orders.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
import hashlib
from pathlib import Path
import sys
import time
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID, uuid5

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from pydantic import Field, model_validator
from scripts import mt5_demo_session as durable
from trading_workspace_v2.forex_h4 import CandleState, FixedH4Candidate, H4Builder, H4CandidateState, H4BuilderState, HOUR, H4, TICK

SCHEMA = 'mt5-forward-session-state-v1'
BASIS = 'mt5_native_bid_h1_utc_v1'
TERMINAL = {'completed', 'stopped', 'blocked', 'attention_required'}


def source_pins():
    return {name: hashlib.sha256((V2 / name).read_bytes()).hexdigest() for name in (
        'scripts/mt5_forward_session.py', 'scripts/mt5_demo_session.py',
        'trading_workspace_v2/forex_h4.py', 'uv.lock')}


class Plan(durable.FrozenModel):
    schema_version: Literal['mt5-forward-session-v1']
    session_id: UUID
    api_origin: str
    workspace_id: str = Field(min_length=1, max_length=160)
    connection_id: UUID
    connection_generation: int = Field(ge=1, strict=True)
    account_id: str = Field(pattern=r'^[1-9][0-9]{0,17}$')
    server: str = Field(min_length=1, max_length=160)
    symbol: Literal['EURUSD', 'EURUSDm']
    artifact_path: str
    artifact_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    starts_at: datetime
    finish_at: datetime
    expires_at: datetime
    volume: Literal[0.01] = 0.01
    max_risk_amount: Decimal = Field(gt=0, le=2)
    cost_buffer_per_lot: Decimal = Field(ge=20)
    source_sha256: dict[str, str]
    adapter_sha256: dict[str, str]
    sdk_version: str = Field(min_length=1, max_length=80)
    clock: dict
    basis: Literal['mt5_native_bid_h1_utc_v1'] = BASIS

    @model_validator(mode='after')
    def valid(self):
        durable.exact_origins([self.api_origin])
        if (any(d.tzinfo is None or d.utcoffset() is None for d in (self.starts_at, self.finish_at, self.expires_at))
                or not 0 < (self.finish_at-self.starts_at).total_seconds() <= 900
                or not 30 <= (self.expires_at-self.finish_at).total_seconds() <= 120
                or set(self.source_sha256) != set(source_pins()) or not self.clock
                or set(self.adapter_sha256) != {'mt5_broker_worker.py', 'mt5_demo_trading.py', 'mt5_clock.py'}
                or any(len(v) != 64 or any(c not in '0123456789abcdef' for c in v) for v in self.adapter_sha256.values())
                or any(ord(c)<32 for c in self.workspace_id+self.server)):
            raise ValueError('invalid forward scope, source or finite deadline')
        return self


def binding(plan):
    return dict(workspace_id=plan.workspace_id, connection_id=str(plan.connection_id),
        generation=plan.connection_generation, login=plan.account_id, server=plan.server, environment='demo')


def verify_snapshot(plan, credential, value, now):
    stamp = int(now.timestamp()*1000)
    quality, account = value.get('data_quality', {}), value.get('account', {})
    auto = value.get('automation', {})
    observed = quality.get('observed_at_msc')
    quote = value.get('quote', {})
    if (value.get('status') != 'ready' or value.get('mode') != 'demo'
            or value.get('symbol') != plan.symbol or value.get('timeframe') != 'H1'
            or value.get('binding') != binding(plan) or value.get('basis') != plan.basis
            or value.get('source_sha256') != plan.adapter_sha256 or value.get('clock') != plan.clock
            or value.get('sdk_version') != plan.sdk_version
            or auto.get('grant_id') != str(credential.grant_id) or auto.get('credential_id') != str(credential.credential_id)
            or auto.get('artifact_sha256') != plan.artifact_sha256
            or account.get('login') != plan.account_id or account.get('server') != plan.server
            or account.get('currency') != 'USD' or account.get('trade_mode') != 'demo'
            or type(observed) is not int or not -1000 <= stamp-observed <= 5000
            or quality.get('quote_status') != 'fresh' or type(quote.get('time_msc')) is not int
            or not -1000 <= stamp-quote['time_msc'] <= 5000
            or not isinstance(value.get('positions'), list) or not isinstance(value.get('orders'), list)):
        raise ValueError('snapshot_identity_source_or_freshness_invalid')
    bid, ask = Decimal(str(quote.get('bid'))), Decimal(str(quote.get('ask')))
    if not bid.is_finite() or not ask.is_finite() or not 0 < bid <= ask:
        raise ValueError('snapshot_quote_invalid')
    bars = value.get('bars')
    if not isinstance(bars, list) or not 1 <= len(bars) <= 300:
        raise ValueError('snapshot_bars_unavailable')
    closed, previous = [], None
    for raw in bars:
        dt = datetime.fromisoformat(raw['timestamp'].replace('Z', '+00:00'))
        if dt.tzinfo is None:
            raise ValueError('bar_timezone_missing')
        t = int(dt.timestamp())
        if dt.microsecond or t % HOUR or (previous is not None and t <= previous):
            raise ValueError('bar_order_or_alignment_invalid')
        previous = t
        candle = CandleState(timestamp=t, **{k:raw[k] for k in ('open','high','low','close')})
        if any(v % TICK for k,v in candle.model_dump().items() if k != 'timestamp'):
            raise ValueError('bar_tick_grid_invalid')
        # The currently forming native bar is never consumed or used as warmup.
        if (t+HOUR)*1000 <= min(stamp, observed)-30000:
            closed.append(candle)
    if not closed or now.timestamp()-(closed[-1].timestamp+HOUR)>HOUR+60:
        raise ValueError('closed_bar_tail_stale')
    return closed


def finish(state, path, status, reason, *, attention=False):
    state.update(status=status, reason=reason, requires_owner_attention=attention)
    durable.save(path, state)
    return state


def command(plan, label, **fields):
    return dict(request_id=str(uuid5(plan.session_id, label)), connection_id=str(plan.connection_id),
        mode='demo', account_id=plan.account_id, server=plan.server, symbol=plan.symbol,
        volume=plan.volume, **fields)


def close(plan, credential, state, path, client, now, position, reason):
    state['exit_reason'] = reason
    cmd = command(plan, 'close', action='close', ticket=position['ticket'])
    durable.save(path, state)
    result = durable.submit_once(plan, credential, state, path, client, 'closing', cmd,
        reconcile_only=False, now=now)
    if result is None or not durable.complete(result, plan.volume):
        return finish(state, path, 'attention_required', 'close_not_proven', attention=True)
    return finish(state, path, 'running', 'awaiting_flat_inventory')


def step(plan, credential, state, path, client, *, now, reconcile_only=False):
    # Reconcile a persisted intent first, even when expiry/STOP/source failure
    # subsequently prevents market reads. Never turn a 404 into another POST.
    for label in ('opening', 'closing'):
        attempt = state.get(label)
        if attempt is not None:
            result = durable.submit_once(plan, credential, state, path, client, label, attempt['command'],
                reconcile_only=True, now=now)
            if not durable.settled(result, plan.volume):
                return finish(state, path, 'attention_required', label+'_unresolved', attention=True)
            if result.get('status') == 'rejected':
                return finish(state, path, 'blocked' if label=='opening' else 'attention_required',
                    result.get('reason', label+'_rejected'), attention=label=='closing')
    if plan.source_sha256 != source_pins():
        return finish(state, path, 'attention_required' if state.get('opening') else 'blocked',
            'runner_source_changed', attention=bool(state.get('opening')))
    try:
        code, value = client.call('/api/v2/automation/trading/snapshot?'+urlencode({'symbol':plan.symbol}))
        if code != 200:
            raise ValueError('native_snapshot_unavailable')
        bars = verify_snapshot(plan, credential, value, now())
    except (OSError, ValueError, KeyError, TypeError):
        return finish(state, path, 'attention_required' if state.get('opening') else 'blocked',
            'snapshot_unverified', attention=bool(state.get('opening')))
    sha = durable.digest(durable.encoded(value))
    evidence = path.parent/'observations'
    evidence.mkdir(exist_ok=True)
    target = evidence/(sha+'.json')
    if not target.exists():
        # Preserve the exact native observation used before any send.
        with target.open('xb') as stream:
            stream.write(durable.encoded(value)); stream.flush(); durable.os.fsync(stream.fileno())
    state.update(snapshot_sha256=sha, observed_at_msc=value['data_quality']['observed_at_msc'],
        exposure=value['positions'], orders=value['orders'], status='running', requires_owner_attention=False)
    positions = value['positions']
    if value.get('foreign_exposure') is not False or value.get('unknown_submission') is not False or value['orders']:
        return finish(state, path, 'attention_required', 'foreign_pending_or_unknown_exposure', attention=True)
    if len(positions)>1:
        return finish(state, path, 'attention_required', 'unexpected_position_count', attention=True)
    position = positions[0] if positions else None
    if position:
        opening = (state.get('opening') or {}).get('result', {})
        if (not durable.complete(opening, plan.volume) or position.get('ticket') != opening['order']
                or position.get('volume') != plan.volume or position.get('symbol') != plan.symbol
                or position.get('side') != state['opening']['command']['side']
                or not Decimal(str(position.get('sl', 0))) > 0):
            return finish(state, path, 'attention_required', 'position_ownership_or_protection_changed', attention=True)
        if state.get('closing'):
            return finish(state, path, 'attention_required', 'filled_close_inventory_not_flat', attention=True)
    elif state.get('opening'):
        return finish(state, path, 'completed', 'broker_inventory_flat')
    stopped = ((path.parent/'STOP').exists() or now() >= plan.expires_at
        or value['automation'].get('status') != 'active')
    if stopped or reconcile_only:
        return finish(state, path, 'attention_required' if position else 'stopped',
            'read_only_stop_with_exposure' if position else 'no_new_send_authority', attention=bool(position))
    if now() < plan.starts_at:
        return finish(state, path, 'blocked', 'session_not_started')
    if value.get('paused') is not False:
        return finish(state, path, 'attention_required' if position else 'blocked',
            'native_pause', attention=bool(position))
    if now() >= plan.finish_at:
        if position:
            return close(plan, credential, state, path, client, now, position, 'bounded_session_end')
        if state['last_hour'] is None:
            return finish(state,path,'stopped','session_window_missed')
        return finish(state, path, 'completed', 'session_finished_flat_no_entry')
    hashes = {str(bar.timestamp):durable.digest(durable.encoded(bar.model_dump(mode='json'))) for bar in bars}
    if any(hashes[k] != v for k,v in state['bar_hashes'].items() if k in hashes):
        return finish(state, path, 'attention_required' if position else 'blocked', 'closed_bar_revised', attention=bool(position))
    if state['last_hour'] is not None and str(state['last_hour']) not in hashes:
        return finish(state, path, 'attention_required' if position else 'blocked', 'bar_cursor_gap', attention=bool(position))
    candidate = FixedH4Candidate.from_state(H4CandidateState.model_validate(state['candidate']))
    builder = H4Builder.from_state(H4BuilderState.model_validate(state['builder']))
    bootstrap = state['last_hour'] is None
    decisions = []
    for bar in bars:
        if state['last_hour'] is not None and bar.timestamp <= state['last_hour']:
            continue
        h4 = builder.add(bar.candle())
        state['last_hour'] = bar.timestamp
        if h4:
            signal, distance = candidate.observe(h4, side=position['side'] if position else None)
            closed_at = h4.timestamp+H4
            if not bootstrap and closed_at >= plan.starts_at.timestamp():
                decisions.append(dict(time=closed_at, signal=signal, stop_distance=str(distance),
                    snapshot_sha256=sha, known_at_msc=value['data_quality']['observed_at_msc']))
    state.update(candidate=candidate.export_state().model_dump(mode='json'),
        builder=builder.export_state().model_dump(mode='json'), bar_hashes=hashes)
    # An interruption cannot silently skip several live decisions/positions.
    if len(decisions)>1:
        return finish(state, path, 'attention_required' if position else 'blocked', 'multiple_unprocessed_decisions', attention=bool(position))
    pending = state.get('decision')
    if pending and pending.get('handled') is False:
        if decisions:
            return finish(state,path,'attention_required' if position else 'blocked',
                'unhandled_decision_before_next_bar',attention=bool(position))
        decisions=[pending]
    if not decisions:
        if len(candidate.history)<20:
            return finish(state,path,'blocked','insufficient_closed_h4_warmup')
        return finish(state, path, 'running', 'waiting_for_new_closed_h4')
    decision = decisions[0]
    decision['handled'] = False
    state['decision'] = decision
    durable.save(path, state)
    if now().timestamp()-decision['time'] > 60:
        return finish(state, path, 'attention_required' if position else 'blocked', 'decision_stale', attention=bool(position))
    signal = decision['signal']
    if signal == 'EXIT' and position:
        return close(plan, credential, state, path, client, now, position, 'candidate_exit')
    if signal not in ('BUY', 'SELL') or position or state.get('opening'):
        decision['handled'] = True
        return finish(state, path, 'running', 'no_entry_signal')
    distance = Decimal(decision['stop_distance'])
    # Fixed candidate's USD FX contract. Native SDK recomputes actual fill-side
    # risk, margin, spread and stop constraints immediately before sending.
    risk = (distance*100000+plan.cost_buffer_per_lot)*Decimal(str(plan.volume))
    if risk>plan.max_risk_amount:
        decision['handled'] = True
        return finish(state, path, 'running', 'minimum_lot_exceeds_budget')
    price = Decimal(str(value['quote']['ask' if signal=='BUY' else 'bid']))
    stop = (price-distance if signal=='BUY' else price+distance).quantize(TICK,
        rounding=ROUND_FLOOR if signal=='BUY' else ROUND_CEILING)
    cmd = command(plan, 'open', action='place', side=signal, order_type='market', stop_loss=float(stop))
    result = durable.submit_once(plan, credential, state, path, client, 'opening', cmd,
        reconcile_only=False, now=now)
    if result is None or not durable.complete(result, plan.volume):
        rejected = result is not None and durable.settled(result, plan.volume)
        return finish(state, path, 'blocked' if rejected else 'attention_required',
            (result or {}).get('reason', 'entry_unproven'), attention=not rejected)
    decision['handled'] = True
    return finish(state, path, 'running', 'entry_filled_awaiting_inventory')


def run(manifest, credential_file, state_dir, *, resume=False, reconcile_only=False,
        client_factory=durable.NativeClient, now=lambda:datetime.now(timezone.utc)):
    manifest, credential_file, directory = map(Path, (manifest, credential_file, state_dir))
    for item in (manifest, credential_file, directory):
        durable.require_local_tree(item.absolute())
    plan = Plan.model_validate(durable.read_json(manifest))
    credential = durable.Credential.model_validate(durable.read_json(credential_file))
    artifact = manifest.resolve().parent/plan.artifact_path
    durable.require_local_tree(artifact.absolute())
    with artifact.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest() != plan.artifact_sha256:
            raise ValueError('forward_artifact_changed')
    identity = dict(manifest_sha256=durable.digest(durable.encoded(plan.model_dump(mode='json'))),
        credential_sha256=durable.digest(credential.credential.encode()), grant_id=str(credential.grant_id),
        credential_id=str(credential.credential_id))
    if not resume:
        directory.mkdir(exist_ok=False)
        durable.private_directory(directory)
    path=directory/'state.json'
    with durable._exclusive_file_lock(directory/'state.lock'):
        if resume:
            state=durable.load(path, SCHEMA)
            if any(state.get(k)!=v for k,v in identity.items()):
                raise ValueError('forward_manifest_or_credential_changed')
        else:
            state=dict(schema_version=SCHEMA, **identity, opening=None, closing=None, bar_hashes={},
                candidate=H4CandidateState().model_dump(mode='json'), builder=H4BuilderState().model_dump(mode='json'),
                last_hour=None, status='prepared', requires_owner_attention=False, exposure=None)
            durable.save(path,state)
        if state['status']=='completed':
            return state
        return step(plan, credential, state, path, client_factory(plan,credential), now=now, reconcile_only=reconcile_only)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=('start','resume','watch','reconcile','status'))
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--credential-file',type=Path)
    parser.add_argument('--state-dir',type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        resume=args.operation!='start'
        if args.operation=='watch':
            resume=(args.state_dir/'state.json').exists()
        for _ in range(600 if args.operation=='watch' else 1):
            if args.operation=='status':
                state=durable.load(args.state_dir/'state.json',SCHEMA)
            else:
                if args.manifest is None or args.credential_file is None:
                    raise ValueError('manifest_and_runner_credential_required')
                state=run(args.manifest,args.credential_file,args.state_dir,resume=resume,
                    reconcile_only=args.operation=='reconcile')
            print(durable.encoded({k:state.get(k) for k in ('status','reason','last_hour','observed_at_msc',
                'requires_owner_attention','updated_at_utc')}).decode().strip(),flush=True)
            if args.operation!='watch' or state['status'] in TERMINAL:
                break
            resume=True
            time.sleep(2)
        return 0 if state['status']=='completed' else 3
    except (OSError,ValueError,RuntimeError):
        print('{"status":"failed","reason":"inspect_checkpoint_before_resume"}',file=sys.stderr)
        return 2


if __name__=='__main__':
    raise SystemExit(main())
