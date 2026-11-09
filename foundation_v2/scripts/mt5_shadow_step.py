"""One bounded read/reduce step for the Rust-owned observed shadow session."""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
from pathlib import Path
import sys
import time
import re
from typing import Literal
from urllib.error import HTTPError

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from pydantic import Field, model_validator
from pydantic.version import VERSION as PYDANTIC_VERSION
from scripts import mt5_observed_capture as capture
from trading_workspace_v2.forex_h4 import (Candle, FixedH4Candidate, H4Builder,
    H4BuilderState, H4CandidateState, HOUR, H4, TICK, sdk_tick_price)

HOUR_MS = HOUR * 1000
SOURCES = {
    'step': Path(__file__),
    'capture': V2/'scripts/mt5_observed_capture.py',
    'candidate': V2/'trading_workspace_v2/forex_h4.py',
    'tick_contract': V2/'trading_workspace_v2/replay_tick_execution.py',
    'file_lock': V2/'trading_workspace_v2/owner_absence_journal.py',
    'local_paths': V2/'scripts/local_owner_access.py',
    'private_acl': V2/'scripts/mt5_connector.py',
    'dependencies': V2/'uv.lock',
}


def source_pins():
    return {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in SOURCES.items()}


class DataQualityError(capture.CaptureError):
    def __init__(self, reason, **details):
        super().__init__(reason)
        self.details = details


class ShadowReader(capture.NativeReader):
    def __call__(self, start, end):
        try:
            return super().__call__(start, end)
        except HTTPError as error:
            try:
                detail = capture.json.loads(error.read(4096)).get('detail')
            except (ValueError, AttributeError):
                detail = None
            safe = detail if isinstance(detail, str) and re.fullmatch(r'[a-z0-9_]{1,100}', detail) else 'unavailable'
            raise capture.CaptureError(f'shadow_native_http_{error.code}_{safe}') from None


class Continuation(capture.Frozen):
    state_dir: str = Field(min_length=1, max_length=1024, strict=True)
    report_sha256: str = Field(pattern=r'^[0-9a-f]{64}$', strict=True)


class Plan(capture.Frozen):
    schema_version: Literal['mt5-shadow-session-v2']
    capture: capture.Plan
    deadline_msc: int = Field(ge=0, strict=True)
    settle_seconds: int = Field(default=30, ge=30, le=120, strict=True)
    source_sha256: dict[str, str]
    stability_policy: capture.ComparisonPolicy = 'raw_ticks_v1'
    projection_policy: Literal['strict_v1', 'quarantine_v1'] = 'strict_v1'
    continuation: Continuation | None = None

    @model_validator(mode='after')
    def valid(self):
        if (self.capture.symbol not in ('EURUSD', 'EURUSDm') or
                not self.capture.to_msc + self.settle_seconds*1000 + 2000 <= self.deadline_msc <= self.capture.to_msc + 180000 or
                self.source_sha256 != source_pins()):
            raise capture.CaptureError('shadow_registration_or_source_invalid')
        return self


def page_at(directory, state, plan, index):
    start = plan.from_msc + index*plan.page_seconds*1000
    end = min(start+plan.page_seconds*1000, plan.to_msc)
    page = capture.validate_page(capture.checked(directory/f'{index:05d}.json'), plan, start, end)
    if capture.checksum(page) != state['pages'][index]:
        raise capture.CaptureError('shadow_capture_changed')
    return page


def audit(page, plan, fetch, evidence_directory, policy='raw_ticks_v1'):
    reread = capture.validate_page(fetch(page['from_msc'], page['to_msc']), plan,
                                  page['from_msc'], page['to_msc'])
    if not capture.compare_pages(page, reread, policy, evidence_directory):
        if any(page[k] != reread[k] for k in ('clock', 'source_sha256', 'sdk_version')):
            raise capture.CaptureError('shadow_observed_window_revised')
        raise DataQualityError('shadow_observed_window_revised',
            from_msc=page['from_msc'], to_msc=page['to_msc'],
            observed_at_msc=reread['observed_at_msc'],
            original_sha256=capture.checksum(page), reread_sha256=capture.checksum(reread))
    return reread['observed_at_msc']


def warmup(plan, directory, *, verify_pages=False):
    """Import a frozen predecessor, never arbitrary bars or an active session.

    Whole-hour handoff keeps each H1 owned by exactly one session. Partial H1
    recovery belongs to resume, not to a new session that drops its prefix.
    """
    if plan.continuation is None:
        return None
    predecessor = Path(plan.continuation.state_dir)
    directory = Path(directory).absolute()
    capture.require_local_tree(predecessor)
    predecessor = predecessor.resolve() if predecessor.is_absolute() else predecessor
    directory = directory.resolve()
    if (not predecessor.is_absolute() or directory.is_relative_to(predecessor) or
            predecessor.is_relative_to(directory)):
        raise capture.CaptureError('shadow_predecessor_path_invalid')
    if (predecessor/'quality-hold.json').exists():
        raise capture.CaptureError('shadow_predecessor_quality_hold')
    report = capture.checked(predecessor/'shadow.json')
    if (capture.checksum(report) != plan.continuation.report_sha256 or
            report.get('schema_version') != 'mt5-shadow-report-v2'):
        raise capture.CaptureError('shadow_predecessor_report_changed')
    previous_plan = Plan.model_validate(report['plan'])
    previous_capture = previous_plan.capture
    capture.require_local_tree(predecessor/'lifecycle.json')
    lifecycle = capture.read_json(predecessor/'lifecycle.json')
    state = lifecycle.get('state', {})
    raw = capture.json.dumps(state, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    if (set(lifecycle) != {'state', 'sha256'} or
            hashlib.sha256(raw).hexdigest() != lifecycle['sha256'] or
            state.get('schema_version') != 'mt5-shadow-lifecycle-v1' or
            state.get('status') != 'complete' or state.get('execution_capability') is not False or
            state.get('manifest_sha256') != report['registration_sha256']):
        raise capture.CaptureError('shadow_predecessor_not_complete')
    if (plan.capture.binding != previous_capture.binding or plan.capture.symbol != previous_capture.symbol or
            plan.capture.api_origin != previous_capture.api_origin or plan.settle_seconds != previous_plan.settle_seconds or
            plan.stability_policy != previous_plan.stability_policy or
            plan.projection_policy != previous_plan.projection_policy or
            plan.capture.from_msc != previous_capture.to_msc or plan.capture.from_msc % HOUR_MS or
            report['consumed_through_msc'] != plan.capture.from_msc or
            report['python_version'] != sys.version or report['pydantic_version'] != PYDANTIC_VERSION or
            report.get('stability_policy', 'raw_ticks_v1') != plan.stability_policy or
            report['source_sha256'] != plan.source_sha256 or report['execution_capability'] is not False):
        raise capture.CaptureError('shadow_predecessor_continuity_invalid')
    # Depth zero is the first session; admit at most 32 sessions in one chain.
    for key, maximum in (('chain_depth', 30), ('cumulative_hours', 32*24), ('cumulative_h4_bars', 32*6)):
        if type(report[key]) is not int or not 0 <= report[key] <= maximum:
            raise capture.CaptureError('shadow_predecessor_bound_invalid')
    candidate = H4CandidateState.model_validate(report['candidate_state'])
    builder = H4BuilderState.model_validate(report['builder_state'])
    if (any((bar.timestamp+H4)*1000 > plan.capture.from_msc for bar in candidate.history) or
            any((bar.timestamp+HOUR)*1000 > plan.capture.from_msc for bar in builder.parts)):
        raise capture.CaptureError('shadow_predecessor_future_bar')
    capture_dir = predecessor/'capture'
    captured = capture.checked(capture_dir/'state.json')
    if (capture.checksum(captured) != report['capture_state_sha256'] or
            captured['plan'] != previous_capture.model_dump(mode='json') or
            captured['next_from_msc'] != previous_capture.to_msc or not captured['pages'] or
            captured.get('comparison_policy', 'raw_ticks_v1') != plan.stability_policy or
            len(captured['pages']) > 10000 or
            captured['client_sha256'] != plan.source_sha256['capture']):
        raise capture.CaptureError('shadow_predecessor_capture_changed')
    observation = state.get('observation', {})
    expected = dict(status='complete', requested_through_msc=previous_capture.to_msc,
        pages=len(captured['pages']), ticks=captured['tick_count'],
        closed_hours=len(report['hours']), h4_bars=len(report['decisions']))
    if any(observation.get(key) != value for key, value in expected.items()) or any(
            report[key] != value for key, value in expected.items() if key in ('requested_through_msc', 'pages', 'ticks')):
        raise capture.CaptureError('shadow_predecessor_receipt_mismatch')
    if verify_pages:
        capture.load(capture_dir, previous_capture)
    last = page_at(capture_dir, captured, previous_capture, len(captured['pages'])-1)
    return dict(candidate_state=candidate, builder_state=builder,
        cumulative_hours=report['cumulative_hours'], cumulative_h4_bars=report['cumulative_h4_bars'],
        chain_depth=report['chain_depth']+1, series_from_msc=report['series_from_msc'],
        lineage={key:last[key] for key in ('clock', 'source_sha256', 'sdk_version')})


def _tick_price(value):
    try:
        return sdk_tick_price(value)
    except ValueError:
        raise capture.CaptureError('shadow_tick_grid_invalid') from None


def reduce_capture(directory, plan, previous, fetch, now_msc, *, recover=False, seed=None,
                   registration_sha256=None):
    """Replay immutable observations; only stable, fully requested hours feed H4.

    Stability and the gap bound are sample-quality policies, not a complete-tick
    watermark. This adapter deliberately has no fill, sizing, P&L or send path.
    """
    state, captured_plan, last = capture.load(directory, plan.capture)
    if (captured_plan != plan.capture or
            state.get('comparison_policy', 'raw_ticks_v1') != plan.stability_policy):
        raise capture.CaptureError('shadow_capture_changed')
    if seed and last and any(last[key] != value for key, value in seed['lineage'].items()):
        raise capture.CaptureError('shadow_predecessor_source_changed')
    previous = previous or {'audited_pages': {}, 'hours': [], 'decisions': []}
    audited = dict(previous['audited_pages'])
    evidence_directory = Path(directory).parent/('audit-failures' if plan.stability_policy == 'raw_ticks_v1'
                                               else 'audit-observations')
    if len(audited) > len(state['pages']):
        raise capture.CaptureError('shadow_audit_cursor_invalid')
    for key, digest in audited.items():
        index = int(key)
        if not 0 <= index < len(state['pages']) or state['pages'][index] != digest:
            raise capture.CaptureError('shadow_audit_cursor_invalid')
        if recover:
            audit(page_at(directory, state, plan.capture, index), plan.capture, fetch, evidence_directory, plan.stability_policy)
    if recover:
        for index in range(len(state['pages'])):
            if str(index) not in audited:
                audit(page_at(directory, state, plan.capture, index), plan.capture, fetch, evidence_directory, plan.stability_policy)

    builder = H4Builder.from_state(seed['builder_state']) if seed else H4Builder()
    candidate = FixedH4Candidate.from_state(seed['candidate_state']) if seed else FixedH4Candidate()
    verified_at = now_msc
    hours, decisions = [], []
    first = (plan.capture.from_msc + HOUR_MS-1)//HOUR_MS*HOUR_MS
    through = state['next_from_msc']
    limit = min(through, now_msc-plan.settle_seconds*1000)//HOUR_MS*HOUR_MS
    for hour in range(first, limit, HOUR_MS):
        end = hour+HOUR_MS
        # All pages that overlap this hour are independently re-read after the
        # settlement delay, even when a page straddles the hour boundary.
        a = (hour-plan.capture.from_msc)//(plan.capture.page_seconds*1000)
        b = (end-1-plan.capture.from_msc)//(plan.capture.page_seconds*1000)
        mids, stamps = [], []
        for index in range(a, b+1):
            page = page_at(directory, state, plan.capture, index)
            key = str(index)
            if key not in audited:
                verified_at = max(verified_at, audit(page, plan.capture, fetch, evidence_directory, plan.stability_policy))
                audited[key] = state['pages'][index]
            for tick in page['rows']:
                if hour <= tick['time_msc'] < end:
                    bid, ask = (_tick_price(tick[side]) for side in ('bid', 'ask'))
                    mids.append((bid+ask)/2)
                    stamps.append(tick['time_msc'])
        # Includes the leading/trailing silence. Missing/quiet windows block;
        # no synthetic bars, skipping hours or implicit candidate resets.
        gaps = [b-a for a, b in zip([hour]+stamps, stamps+[end])]
        if not stamps or max(gaps) > 60000:
            raise DataQualityError('shadow_hour_gap_requires_review', from_msc=hour,
                to_msc=end, ticks=len(stamps), maximum_gap_msc=max(gaps), observed_at_msc=verified_at)
        bar = Candle(hour//1000, mids[0], max(mids), min(mids), mids[-1])
        hours.append({'time_msc': hour, 'ticks': len(stamps), 'maximum_gap_msc': max(gaps),
                      'ohlc_mid': [str(bar.open), str(bar.high), str(bar.low), str(bar.close)]})
        h4 = builder.add(bar)
        if h4 is not None:
            signal, distance = candidate.observe(h4)
            ordinal = len(decisions)
            known_at = (previous['decisions'][ordinal]['observed_at_msc']
                        if ordinal < len(previous['decisions']) else verified_at)
            decisions.append({'bar_start_msc': h4.timestamp*1000,
                'known_not_before_msc': (h4.timestamp+4*HOUR)*1000+plan.settle_seconds*1000,
                'observed_at_msc': known_at,
                'signal': signal, 'stop_distance': str(distance) if distance is not None else None,
                'status': 'advisory_only' if signal else 'warmup_or_no_signal'})
    if hours[:len(previous['hours'])] != previous['hours'] or decisions[:len(previous['decisions'])] != previous['decisions']:
        raise capture.CaptureError('shadow_reducer_prefix_changed')
    return dict(schema_version='mt5-shadow-report-v2', execution_capability=False,
        strategy_qualified=False, qualification='observed_market_shadow',
        coverage='broker_history_unverified', bar_policy='stable_observed_sample_max_gap_60s',
        price_basis='bid_ask_mid', candidate='fixed-eurusd-h4-donchian20-10-atr14',
        stability_policy=plan.stability_policy,
        raw_flags_stability='required' if plan.stability_policy == 'raw_ticks_v1' else 'not_asserted',
        pnl=None, cost_status='not_modeled', fill_status='not_modeled',
        requested_through_msc=through, ticks=state['tick_count'], pages=len(state['pages']),
        source_sha256=plan.source_sha256, binding=plan.capture.binding.model_dump(mode='json'),
        plan=plan.model_dump(mode='json'), registration_sha256=registration_sha256 or capture.checksum(plan.model_dump(mode='json')),
        capture_state_sha256=capture.checksum(state), consumed_through_msc=limit,
        series_from_msc=seed['series_from_msc'] if seed else plan.capture.from_msc,
        chain_depth=seed['chain_depth'] if seed else 0,
        cumulative_hours=(seed['cumulative_hours'] if seed else 0)+len(hours),
        cumulative_h4_bars=(seed['cumulative_h4_bars'] if seed else 0)+len(decisions),
        python_version=sys.version, pydantic_version=PYDANTIC_VERSION,
        audited_pages=audited, hours=hours, decisions=decisions,
        candidate_state=candidate.export_state().model_dump(mode='json'),
        builder_state=builder.export_state().model_dump(mode='json'),
        excluded_leading_partial=plan.capture.from_msc < first,
        open_partial_hour=through % HOUR_MS != 0,
        indicator_ready=len(candidate.history) == 20,
        # Does not assert that a future bar will yield an entry.
        data_status='warming_up' if len(candidate.history) < 20 else 'advisory_ready')


def step(plan, directory, fetch, now_msc, *, recover=False, registration_sha256=None):
    if now_msc >= plan.deadline_msc:
        return {'status': 'expired', 'execution_capability': False}
    if (directory/'STOP').exists():
        return {'status': 'stopped', 'execution_capability': False}
    seed = warmup(plan, directory, verify_pages=recover or not (directory/'shadow.json').exists())
    original_fetch = fetch
    def fetch(start, end):
        page = original_fetch(start, end)
        if seed and any(page.get(key) != value for key, value in seed['lineage'].items()):
            raise capture.CaptureError('shadow_predecessor_source_changed')
        return page
    capture_dir = directory/'capture'
    report_path = directory/'shadow.json'
    previous = capture.checked(report_path) if report_path.exists() else None
    if previous and (previous['source_sha256'] != plan.source_sha256 or
                     previous.get('plan') != plan.model_dump(mode='json') or
                     previous['binding'] != plan.capture.binding.model_dump(mode='json') or
                     previous['python_version'] != sys.version or previous['pydantic_version'] != PYDANTIC_VERSION):
        raise capture.CaptureError('shadow_registration_or_source_invalid')
    hold_path = directory/'quality-hold.json'
    hold = capture.checked(hold_path) if hold_path.exists() else None
    plan_hash = capture.checksum(plan.model_dump(mode='json'))
    previous_hash = capture.checksum(previous) if previous else None
    if hold and (plan.projection_policy != 'quarantine_v1' or
                 hold.get('plan_sha256') != plan_hash or
                 hold.get('last_valid_report_sha256') != previous_hash):
        raise capture.CaptureError('shadow_quality_hold_changed')
    result = capture.record(plan.capture, capture_dir, resume=capture_dir.exists(),
                            fetch=fetch, max_batches=1, now_msc=now_msc,
                            comparison_policy=plan.stability_policy)
    report = previous
    if hold is None:
        try:
            report = reduce_capture(capture_dir, plan, previous, fetch, now_msc, recover=recover,
                                    seed=seed, registration_sha256=registration_sha256)
        except DataQualityError as error:
            if plan.projection_policy != 'quarantine_v1':
                raise
            hold = dict(schema_version='mt5-shadow-quality-hold-v1', execution_capability=False,
                plan_sha256=plan_hash, observed_at_msc=max(now_msc,error.details.get('observed_at_msc',now_msc)), reason=str(error),
                details=error.details, last_valid_report_sha256=previous_hash)
            capture.store(hold_path, hold)
        else:
            capture.store(report_path, report)
    # A quality hold freezes projection, not raw collection. Never retry the
    # same suspect hour on every poll or publish its decisions as current.
    report = report or dict(hours=[], decisions=[], cumulative_hours=seed['cumulative_hours'] if seed else 0,
        cumulative_h4_bars=seed['cumulative_h4_bars'] if seed else 0, data_status='quality_hold')
    done = result['status'] == 'complete' and now_msc >= plan.capture.to_msc+plan.settle_seconds*1000
    next_poll = (min(result['requested_through_msc']+plan.capture.page_seconds*1000,
                     plan.capture.to_msc)+2000 if result['status'] != 'complete'
                 else plan.capture.to_msc+plan.settle_seconds*1000)
    first_hour = (plan.capture.from_msc+HOUR_MS-1)//HOUR_MS*HOUR_MS
    next_close = first_hour+(len(report['hours'])+1)*HOUR_MS
    if hold is None and next_close <= result['requested_through_msc']:
        next_poll = min(next_poll, next_close+plan.settle_seconds*1000)
    return dict(status='complete' if done else 'waiting' if result['status'] == 'complete' else result['status'],
        execution_capability=False, strategy_qualified=False, ticks=result['ticks'], pages=result['pages'],
        closed_hours=len(report['hours']), h4_bars=len(report['decisions']),
        cumulative_hours=report['cumulative_hours'], cumulative_h4_bars=report['cumulative_h4_bars'],
        data_status='quality_hold' if hold else report['data_status'],
        projection_status='held' if hold else 'ready', quality_reason=hold['reason'] if hold else None,
        quality_details=hold['details'] if hold else None,
        requested_through_msc=result['requested_through_msc'],
        next_poll_msc=next_poll)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('init', 'step'))
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--owner-secret-file', type=Path)
    parser.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    try:
        directory = args.state_dir.absolute()
        for path in (directory, args.manifest, args.owner_secret_file):
            if path is not None:
                capture.require_local_tree(path.absolute())
                if path != directory and path.resolve().is_relative_to(directory.resolve()):
                    raise capture.CaptureError('shadow_inputs_must_be_outside_output')
        plan = Plan.model_validate(capture.read_json(args.manifest))
        if args.action == 'init':
            warmup(plan, directory, verify_pages=True)
            directory.mkdir()
            capture.private_directory(directory)
            print(capture.encoded({'status': 'initialized', 'execution_capability': False}).decode(), end='')
            return 0
        if args.owner_secret_file is None:
            raise capture.CaptureError('shadow_private_input_required')
        token = capture.read_json(args.owner_secret_file)['owner_bearer']
        if not isinstance(token, str) or not token or any(ord(c)<32 for c in token):
            raise capture.CaptureError('shadow_credential_invalid')
        # Rust also owns a session lock. This lock prevents direct worker calls
        # from overlapping a capture/reducer transaction.
        with capture._exclusive_file_lock(directory/'step.lock'):
            result = step(plan, directory, ShadowReader(plan.capture, token),
                          int(time.time()*1000), recover=args.recover,
                          registration_sha256=hashlib.sha256(args.manifest.read_bytes()).hexdigest())
        print(capture.encoded(result).decode(), end='')
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error, capture.CaptureError) else 'shadow_step_failed_'+type(error).__name__
        print(capture.encoded({'status': 'error', 'reason': reason, 'error_type': type(error).__name__,
                              'execution_capability': False}).decode(), end='')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
