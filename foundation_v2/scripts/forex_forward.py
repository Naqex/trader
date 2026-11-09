"""Consume a pinned QDM CSV in bounded, restartable offline batches. No broker IO."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import sys

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

from trading_workspace_v2.experiment_forward_binding import bind_experiment_artifacts
from trading_workspace_v2.forex_financing import FinancingTerms
from trading_workspace_v2.forex_forward import ForexForwardSession
from trading_workspace_v2.forex_h4 import CandleState, read_qdm_ticks
from trading_workspace_v2.forex_pilot_risk import ForexPilotSnapshot
from trading_workspace_v2.forex_prop_candidates import UTC_RANGE


SOURCE_FILES = {
    'source': 'trading_workspace_v2/forex_h4.py',
    'source:forward': 'trading_workspace_v2/forex_forward.py',
    'source:risk': 'trading_workspace_v2/forex_pilot_risk.py',
    'source:financing': 'trading_workspace_v2/forex_financing.py',
    'source:tick': 'trading_workspace_v2/replay_tick_execution.py',
    'source:execution': 'trading_workspace_v2/replay_execution.py',
    'source:semantics': 'trading_workspace_v2/execution_semantics.py',
    'source:binding': 'trading_workspace_v2/experiment_forward_binding.py',
    'source:retained': 'trading_workspace_v2/retained.py',
    'source:data-contracts': 'trading_workspace_v2/semantics/data_contracts.py',
    'source:data-costs': 'trading_workspace_v2/semantics/data_costs.py',
    'source:cli': 'scripts/forex_forward.py',
}
RESEARCH_SOURCE_FILES = {'source:candidate': 'trading_workspace_v2/forex_prop_candidates.py'}


class ArtifactFile(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    path: str = Field(min_length=1, strict=True)
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$', strict=True)


class Registration(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    schema_version: Literal['forex-forward-cli-v1']
    candidate_id: Literal['fixed-eurusd-h4', 'eurusd-h4-utc-range00-08-atr14-r025-v1']
    strategy_revision: str = Field(min_length=1, strict=True)
    purpose: Literal['system_fixture', 'research']
    first_day: str = Field(pattern=r'^\d{8}$', strict=True)
    last_day: str = Field(pattern=r'^\d{8}$', strict=True)
    artifacts: dict[str, ArtifactFile]

    @model_validator(mode='after')
    def valid_registration(self):
        from datetime import datetime
        for day in (self.first_day, self.last_day):
            datetime.strptime(day, '%Y%m%d')
        if self.first_day > self.last_day:
            raise ValueError('registered dates must be ordered')
        required = {'data', 'instrument_spec', 'cost_model', 'seed', *SOURCE_FILES}
        if self.candidate_id == UTC_RANGE:
            if self.purpose != 'research':
                raise ValueError('UTC range is supported only for offline research')
            required.update(RESEARCH_SOURCE_FILES)
        if not required <= self.artifacts.keys():
            raise ValueError('registration requires data/spec/cost/seed and all executed source pins')
        if self.artifacts.keys() - required - {'warmup', 'financing'}:
            raise ValueError('unknown registration artifact')
        return self


def read_small_json(path: Path):
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('registration/config JSON exceeds 1 MiB')
    return json.loads(path.read_text(encoding='utf-8'))


def consume(manifest: Path, checkpoint: Path, *, resume: bool, max_quotes: int = 100000,
            checkpoint_every: int = 10000, close_before_msc: int | None = None):
    """Return a summary; EOF alone does not assert that the final hour is closed."""
    if (type(max_quotes) is not int or not 1 <= max_quotes <= 1000000 or
            type(checkpoint_every) is not int or not 1 <= checkpoint_every <= max_quotes):
        raise ValueError('batch/checkpoint bounds must be positive, checkpoint <= batch <= 1000000')
    if close_before_msc is not None and (type(close_before_msc) is not int or close_before_msc < 0):
        raise ValueError('close-before must be a nonnegative source watermark')
    manifest, checkpoint = Path(manifest).resolve(), Path(checkpoint).resolve()
    registration = Registration.model_validate(read_small_json(manifest))
    paths = {name: (manifest.parent / entry.path).resolve()
             for name, entry in registration.artifacts.items()}
    outputs = {checkpoint, checkpoint.with_name(checkpoint.name + '.lock').resolve()}
    if outputs & {manifest, *paths.values()}:
        raise ValueError('checkpoint must not replace an input artifact')
    if not resume and checkpoint.exists():
        raise ValueError('checkpoint already exists; explicitly resume it')
    sources = SOURCE_FILES | (RESEARCH_SOURCE_FILES if registration.candidate_id == UTC_RANGE else {})
    for role, filename in sources.items():
        if paths[role] != (V2 / filename).resolve():
            raise ValueError('source pin must reference executed module: ' + role)
    pins = {name: entry.sha256 for name, entry in registration.artifacts.items()}
    identity = dict(candidate_id=registration.candidate_id,
                    strategy_revision=registration.strategy_revision, purpose=registration.purpose)
    with ExitStack() as stack:
        artifacts = {name: stack.enter_context(path.open('rb')) for name, path in paths.items()}
        if resume:
            session = ForexForwardSession.resume(checkpoint, artifacts=artifacts,
                expected_sha256=pins, **identity)
        else:
            binding = bind_experiment_artifacts(artifacts=artifacts, expected_sha256=pins, **identity)
            pilot = ForexPilotSnapshot.model_validate(read_small_json(paths['seed']))
            warmup = [CandleState.model_validate(c).candle() for c in read_small_json(paths['warmup'])] if 'warmup' in paths else ()
            financing = [FinancingTerms.model_validate(f) for f in read_small_json(paths['financing'])] if 'financing' in paths else ()
            session = ForexForwardSession.create(pilot, binding=binding, artifacts=artifacts,
                expected_sha256=pins, warmup=warmup, financing=financing)
        previous = session.snapshot()
        rows_seen = processed = 0
        eof = True
        ticks = read_qdm_ticks(paths['data'], sha256=pins['data'],
            first_day=registration.first_day, last_day=registration.last_day)
        try:
            for tick in ticks:
                rows_seen += 1
                if rows_seen <= previous.received_ticks:
                    if rows_seen == previous.received_ticks and tick != previous.last_received:
                        raise ValueError('QDM row cursor differs from the saved source cursor')
                    continue
                if processed == max_quotes:
                    eof = False
                    break
                session.observe_quote(tick)
                processed += 1
                if processed % checkpoint_every == 0:
                    session.save(checkpoint)
        finally:
            ticks.close()
        if rows_seen < previous.received_ticks:
            raise ValueError('source ends before saved source cursor')
        # A caller watermark is meaningful only after the entire registered source
        # is consumed. A short invocation must not advance beyond unread quotes.
        if close_before_msc is not None:
            if not eof:
                session.save(checkpoint)
                raise ValueError('watermark refused before EOF; progress saved, resume without it')
            session.close_before(close_before_msc)
        generation = session.save(checkpoint)
        state = session.snapshot()
        return dict(schema_version='forex-forward-cli-result-v1',
            qualification=state.qualification, execution_capability=False, strategy_qualified=False,
            binding_sha256=state.binding.fingerprint(), checkpoint=str(checkpoint),
            generation=generation, processed_quotes=processed, received_quotes=state.received_ticks,
            committed_hours=state.committed_hours, buffered_quotes=len(state.buffer_ticks),
            source_eof=eof, watermark_msc=state.watermark_msc,
            candidate_decisions=len(state.decisions), balance=str(state.pilot.execution.balance),
            source_watermark_asserted=close_before_msc is not None,
            cost_qualification='declared_scenario_not_broker_cost_certification')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['start', 'resume'])
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--max-quotes', type=int, default=100000)
    parser.add_argument('--checkpoint-every', type=int, default=10000)
    parser.add_argument('--close-before-msc', type=int)
    args = parser.parse_args(argv)
    try:
        result = consume(args.manifest, args.checkpoint, resume=args.operation == 'resume',
            max_quotes=args.max_quotes, checkpoint_every=args.checkpoint_every,
            close_before_msc=args.close_before_msc)
    except (ValueError, OSError, RuntimeError) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error), 'execution_capability': False}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
