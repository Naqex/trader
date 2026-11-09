"""Durable, offline quote-stream coordinator for fixed EURUSD H4 candidates.

Quotes are buffered until their hour has closed. A later quote or an explicit
source watermark closes that hour; neither an unfinished bar nor its future
close can inform a decision. This is historical quote replay, not broker or
observed-market forward execution. The existing pilot reducer owns fills/risk.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Iterable, Literal, Mapping
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .experiment_forward_binding import ArtifactContent, ExperimentForwardBinding, validate_forward_binding
from .forex_financing import FinancingTerms, apply_forex_financing
from .forex_h4 import (HOUR, H4, TICK, Candle, CandleState, FixedH4Candidate,
                       H4Builder, H4BuilderState, H4CandidateState, size_for_stop)
from .forex_prop_candidates import PropH4Candidate, PropH4State, UTC_RANGE
from .forex_pilot_risk import (ForexPilotSnapshot, advance_forex_pilot,
    queue_forex_pilot_order, queue_forex_pilot_exit, _stop_at_fill)
from .owner_absence_journal import _exclusive_file_lock
from .replay_tick_execution import BrokerReplayTick


HOUR_MSC = HOUR * 1000
MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024


def forward_artifact_json(value: object) -> bytes:
    """Canonical bytes for binding the exact execution spec/cost/warmup/calendar."""
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode('utf-8')


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _key(tick: BrokerReplayTick):
    return tick.time_msc, tick.sequence


class ForexForwardDecision(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    time_msc: int = Field(ge=0, strict=True)
    operation_id: str
    signal: Literal['BUY', 'SELL', 'EXIT']
    status: Literal['queued', 'skipped_risk_halt', 'skipped_minimum_lot']
    stop_distance: str
    quantity: str | None = None


class ForexForwardSnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    schema_version: Literal['forex-forward-session-v1'] = 'forex-forward-session-v1'
    qualification: Literal['offline_historical_quote_replay'] = 'offline_historical_quote_replay'
    execution_capability: Literal[False] = False
    strategy_qualified: Literal[False] = False
    binding: ExperimentForwardBinding
    pilot: ForexPilotSnapshot
    builder: H4BuilderState
    candidate: H4CandidateState | PropH4State
    buffer_ticks: tuple[BrokerReplayTick, ...] = ()
    last_received: BrokerReplayTick | None = None
    received_ticks: int = Field(default=0, ge=0, strict=True)
    watermark_msc: int = Field(default=0, ge=0, strict=True)
    committed_hours: int = Field(default=0, ge=0, strict=True)
    max_buffer_ticks: int = Field(default=100000, ge=1, le=1000000, strict=True)
    max_committed_hours: int = Field(default=10000, ge=1, le=10000, strict=True)
    financing: tuple[FinancingTerms, ...] = ()
    financing_cursor: int = Field(default=0, ge=0, strict=True)
    decisions: tuple[ForexForwardDecision, ...] = ()

    @model_validator(mode='after')
    def coherent_stream(self):
        if isinstance(self.candidate, PropH4State):
            if (self.candidate.candidate != UTC_RANGE or self.binding.candidate_id != UTC_RANGE
                    or self.binding.purpose != 'research'):
                raise ValueError('UTC range state requires its research binding')
        elif self.binding.candidate_id not in ('fixed-h4', 'fixed-eurusd-h4'):
            raise ValueError('fixed H4 state requires its fixed candidate binding')
        e = self.pilot.execution
        if e.timeframe_seconds != HOUR or e.cursor_index != self.committed_hours:
            raise ValueError('forward coordinator requires an hourly execution cursor')
        if (self.binding.artifact_sha256('data') != e.dataset_sha256 or
                e.tick_snapshot_sha256 != e.dataset_sha256 or
                self.binding.artifact_sha256('instrument_spec') != _digest(forward_artifact_json(e.instrument_spec)) or
                self.binding.artifact_sha256('cost_model') != _digest(forward_artifact_json(e.cost_model))):
            raise ValueError('forward binding differs from execution data/spec/cost')
        if self.committed_hours > self.max_committed_hours or len(self.buffer_ticks) > self.max_buffer_ticks:
            raise ValueError('forward resource bound exceeded')
        if self.received_ticks != self.pilot.risk.observed_ticks + len(self.buffer_ticks):
            raise ValueError('received quote count differs from committed/buffered quotes')
        if (self.last_received is None) != (self.received_ticks == 0):
            raise ValueError('forward receive cursor is missing')
        previous = None
        for tick in self.buffer_ticks:
            if (tick.time_msc // HOUR_MSC != self.buffer_ticks[0].time_msc // HOUR_MSC or
                    (previous is not None and _key(tick) <= _key(previous)) or
                    tick.bid % TICK or tick.ask % TICK):
                raise ValueError('invalid buffered quote order/hour/price')
            previous = tick
        if (self.buffer_ticks and
                (self.buffer_ticks[0].time_msc // HOUR_MSC + 1) * HOUR_MSC <= self.watermark_msc):
            raise ValueError('buffer retains an hour already closed by watermark')
        expected_last = self.buffer_ticks[-1] if self.buffer_ticks else self.pilot.risk.last_tick
        if self.last_received != expected_last:
            raise ValueError('receive cursor differs from its retained quote')
        if (self.buffer_ticks and self.pilot.risk.last_tick and
                _key(self.buffer_ticks[0]) <= _key(self.pilot.risk.last_tick)):
            raise ValueError('buffer precedes committed quote')
        if (e.ledger and self.buffer_ticks and
                self.buffer_ticks[0].time_msc // HOUR_MSC * HOUR < e.ledger[-1]['virtual_time_utc']):
            raise ValueError('buffer precedes committed event clock')
        times = [f.scheduled_time_msc for f in self.financing]
        if (self.financing_cursor > len(self.financing) or
                any(t % HOUR_MSC for t in times) or
                any(b <= a for a, b in zip(times, times[1:])) or
                len({f.event_id for f in self.financing}) != len(times)):
            raise ValueError('financing calendar must have unique increasing hourly events')
        applied = [raw['details']['financing_terms']['event_id'] for raw in e.ledger if raw['kind'] == 'financing']
        if applied != [f.event_id for f in self.financing[:self.financing_cursor]]:
            raise ValueError('financing cursor differs from canonical cash events')
        if self.financing and self.binding.artifact_sha256('financing') != _digest(
                forward_artifact_json([f.model_dump(mode='json') for f in self.financing])):
            raise ValueError('financing calendar differs from frozen artifact')
        return self


class ForexForwardCheckpointCorrupt(ValueError):
    """A missing, truncated, incompatible or changed checkpoint cannot resume."""


class ForexForwardCheckpointConflict(RuntimeError):
    """A stale session must reload rather than overwrite another writer."""


def _read_checkpoint(path: Path):
    if not path.is_file() or path.stat().st_size > MAX_CHECKPOINT_BYTES:
        raise ForexForwardCheckpointCorrupt('checkpoint missing or exceeds resource bound')
    raw = path.read_bytes()
    try:
        if not raw.endswith(b'\n'):
            raise ValueError('truncated record')
        record = json.loads(raw)
        if set(record) != {'schema_version', 'generation', 'snapshot', 'sha256'} or (
                record['schema_version'] != 'forex-forward-checkpoint-v1' or
                type(record['generation']) is not int or record['generation'] < 1):
            raise ValueError('invalid checkpoint envelope')
        payload = {k: v for k, v in record.items() if k != 'sha256'}
        if record['sha256'] != _digest(forward_artifact_json(payload)):
            raise ValueError('checkpoint checksum mismatch')
        snapshot = ForexForwardSnapshot.model_validate(record['snapshot'])
        return snapshot, record['generation'], record['sha256']
    except (UnicodeDecodeError, TypeError, KeyError, ValueError) as exc:
        raise ForexForwardCheckpointCorrupt('checkpoint integrity/structure failed') from exc


class ForexForwardSession:
    """One offline stream, with bounded quote buffering and restartable H4 state.

    Only the most recently accepted quote may be repeated idempotently. An older
    quote is rejected, so adapters must resume after the retained source cursor.
    Checkpoint checksums detect damage, not a malicious writer with disk access.
    Artifact pins must come from a trusted registration, not the checkpoint.
    """

    def __init__(self, snapshot: ForexForwardSnapshot):
        self._state = snapshot
        self._buffer = list(snapshot.buffer_ticks)
        self._path = None
        self._generation = 0
        self._saved_hash = None

    @classmethod
    def create(cls, pilot: ForexPilotSnapshot, *, binding: ExperimentForwardBinding,
               artifacts: Mapping[str, ArtifactContent], expected_sha256: Mapping[str, str],
               warmup: Iterable[Candle] = (), financing: Iterable[FinancingTerms] = (),
               max_buffer_ticks: int = 100000, max_committed_hours: int = 10000):
        validate_forward_binding(binding, candidate_id=binding.candidate_id,
            strategy_revision=binding.strategy_revision, purpose=binding.purpose,
            artifacts=artifacts, expected_sha256=expected_sha256)
        if pilot.execution.ledger or pilot.execution.cursor_index or pilot.risk.observed_ticks:
            raise ValueError('create requires an unconsumed pilot; use resume for existing state')
        # The existing fixed candidate sizes with $5/lot round trip and 100k EURUSD.
        # Refuse a different cost shape rather than silently mis-sizing it.
        from decimal import Decimal
        cost = pilot.execution.cost_model
        if (Decimal(str(cost.get('commission_per_side_account', 0))) != 0 or
                Decimal(str(cost.get('commission_per_side_per_quantity_account', 0))) != Decimal('2.50') or
                Decimal(str(cost.get('minimum_fee_account', 0))) != 0 or
                Decimal(str(cost.get('financing_account', 0))) != 0):
            raise ValueError('fixed H4 sizing requires explicit $2.50/lot/side and timed financing')
        if Decimal(str(pilot.execution.instrument_spec['contract_size'])) != 100000:
            raise ValueError('fixed H4 sizing requires the EURUSD 100000 contract')
        spec = pilot.execution.instrument_spec
        if any(Decimal(str(spec[key])) != expected for key, expected in
               (('tick_size', TICK), ('quantity_min', Decimal('0.01')), ('quantity_step', Decimal('0.01')))):
            raise ValueError('fixed H4 sizing requires its declared tick and lot grid')
        if binding.candidate_id == UTC_RANGE and binding.purpose == 'research':
            candidate = PropH4Candidate(UTC_RANGE)
        elif binding.candidate_id in ('fixed-h4', 'fixed-eurusd-h4'):
            candidate = FixedH4Candidate()
        else:
            raise ValueError('unsupported offline forward candidate or purpose')
        warmup_values = tuple(warmup)
        if warmup_values:
            encoded = forward_artifact_json([CandleState(**vars(p)).model_dump(mode='json') for p in warmup_values])
            if binding.artifact_sha256('warmup') != _digest(encoded):
                raise ValueError('warmup differs from frozen artifact')
            for candle in warmup_values:
                if (candle.timestamp + H4) * 1000 > pilot.risk.start_time_msc:
                    raise ValueError('warmup candle closes after session start')
                candidate.observe(candle)
        return cls(ForexForwardSnapshot(binding=binding, pilot=pilot, builder=H4BuilderState(),
            candidate=candidate.export_state(), financing=tuple(financing),
            max_buffer_ticks=max_buffer_ticks, max_committed_hours=max_committed_hours))

    @classmethod
    def resume(cls, path: str | Path, *, artifacts: Mapping[str, ArtifactContent],
               expected_sha256: Mapping[str, str], candidate_id: str,
               strategy_revision: str, purpose: Literal['system_fixture', 'research'] = 'system_fixture'):
        path = Path(path).expanduser().resolve()
        with _exclusive_file_lock(path.with_name(path.name + '.lock')):
            snapshot, generation, checksum = _read_checkpoint(path)
            validate_forward_binding(snapshot.binding, candidate_id=candidate_id,
                strategy_revision=strategy_revision, purpose=purpose,
                artifacts=artifacts, expected_sha256=expected_sha256)
        result = cls(snapshot)
        result._path, result._generation, result._saved_hash = path, generation, checksum
        return result

    def snapshot(self) -> ForexForwardSnapshot:
        raw = self._state.model_dump(mode='python')
        raw['buffer_ticks'] = tuple(self._buffer)
        return ForexForwardSnapshot.model_validate(raw)

    def observe_quote(self, quote: BrokerReplayTick | dict) -> bool:
        quote = BrokerReplayTick.model_validate(quote)
        previous = self._state.last_received
        if previous is not None and _key(quote) <= _key(previous):
            if quote == previous:
                return False
            raise ValueError('quote is out of order or conflicts with received cursor')
        if (quote.time_msc < max(self._state.watermark_msc, self._state.pilot.risk.start_time_msc) or
                quote.bid % TICK or quote.ask % TICK):
            raise ValueError('quote precedes watermark/session or is off tick grid')
        new_hour = bool(self._buffer and quote.time_msc // HOUR_MSC != self._buffer[0].time_msc // HOUR_MSC)
        if not new_hour and len(self._buffer) >= self._state.max_buffer_ticks:
            raise ValueError('hour quote buffer resource bound reached')
        if new_hour:
            self._commit_buffer()
        self._buffer.append(quote)
        self._state = self._state.model_copy(update={'last_received': quote,
            'received_ticks': self._state.received_ticks + 1})
        return True

    def close_before(self, watermark_msc: int) -> bool:
        """Assert a source watermark; never pass unprocessed scheduled cash.

        Financing is posted only while committing an observed hour. A watermark
        beyond a later pending fee is rejected before committing anything; it
        cannot advance the published clock with a stale pre-fee balance.
        """
        if type(watermark_msc) is not int or watermark_msc < self._state.watermark_msc:
            raise ValueError('watermark must be a nondecreasing integer')
        closes = bool(self._buffer and (self._buffer[0].time_msc // HOUR_MSC + 1) * HOUR_MSC <= watermark_msc)
        commit_boundary = (self._buffer[0].time_msc // HOUR_MSC + 1) * HOUR_MSC if closes else -1
        if any(commit_boundary < fee.scheduled_time_msc <= watermark_msc
               for fee in self._state.financing[self._state.financing_cursor:]):
            raise ValueError('watermark would pass unapplied financing outside the observed closed hour')
        if closes:
            self._commit_buffer()
        self._state = self._state.model_copy(update={'watermark_msc': watermark_msc})
        return closes

    def _commit_buffer(self):
        if self._state.committed_hours >= self._state.max_committed_hours:
            raise ValueError('committed hour resource bound reached')
        from decimal import Decimal
        state = self._state
        pilot = state.pilot
        builder = H4Builder.from_state(state.builder)
        candidate = (PropH4Candidate.from_state(state.candidate) if isinstance(state.candidate, PropH4State)
                     else FixedH4Candidate.from_state(state.candidate))
        mids = [(q.bid + q.ask) / 2 for q in self._buffer]
        hour = Candle(self._buffer[0].time_msc // HOUR_MSC * HOUR,
                      mids[0], max(mids), min(mids), mids[-1])
        financing_cursor = state.financing_cursor

        def due(boundary):
            nonlocal pilot, financing_cursor
            while financing_cursor < len(state.financing) and state.financing[financing_cursor].scheduled_time_msc <= boundary:
                pilot = apply_forex_financing(pilot, state.financing[financing_cursor])
                financing_cursor += 1

        due(hour.timestamp * 1000)
        pilot = advance_forex_pilot(pilot, ticks=self._buffer, bar=vars(hour),
            cursor_index=pilot.execution.cursor_index + 1)
        due((hour.timestamp + HOUR) * 1000)
        candle = builder.add(hour)
        decisions = list(state.decisions)
        if candle is not None:
            position = pilot.execution.position
            position_args = dict(side=position.side if position else None)
            if isinstance(candidate, PropH4Candidate):
                position_args['position_id'] = position.position_id if position else None
            signal, distance = candidate.observe(candle, **position_args)
            if signal and pilot.risk.exit_pending is None and pilot.execution.pending_market_order is None:
                operation_id = f'h4-{candle.timestamp}-{signal}'
                status, quantity = 'queued', None
                if signal == 'EXIT':
                    pilot = queue_forex_pilot_exit(pilot, operation_id=operation_id)
                elif pilot.risk.daily_stopped or pilot.risk.overall_stopped or pilot.risk.close_pending:
                    status = 'skipped_risk_halt'
                else:
                    quantity = size_for_stop(distance,
                        slippage=Decimal(str(pilot.execution.cost_model['slippage_price_per_side'])),
                        budget=pilot.limits.per_trade_loss)
                    if quantity is None:
                        status = 'skipped_minimum_lot'
                    elif quantity > Decimal('50'):
                        raise ValueError('candidate quantity exceeds supported maximum')
                    else:
                        reference = pilot.execution.last_ask if signal == 'BUY' else pilot.execution.last_bid
                        stop = _stop_at_fill(signal, reference, distance, TICK)
                        pilot = queue_forex_pilot_order(pilot, operation_id=operation_id, side=signal,
                            quantity=quantity, stop_loss=stop, stop_distance=distance, take_profit=None)
                decisions.append(ForexForwardDecision(time_msc=(candle.timestamp + H4) * 1000,
                    operation_id=operation_id, signal=signal, stop_distance=str(distance),
                    status=status, quantity=str(quantity) if quantity is not None else None))
        # Publish only after every reducer and cash event succeeds.
        self._state = state.model_copy(update={'pilot': pilot, 'builder': builder.export_state(),
            'candidate': candidate.export_state(), 'financing_cursor': financing_cursor,
            'decisions': tuple(decisions), 'committed_hours': state.committed_hours + 1,
            'buffer_ticks': (), 'watermark_msc': (hour.timestamp + HOUR) * 1000})
        self._buffer.clear()

    def save(self, path: str | Path) -> int:
        path = Path(path).expanduser().resolve()
        if self._path is not None and path != self._path:
            raise ForexForwardCheckpointConflict('session is already bound to another checkpoint path')
        snapshot = self.snapshot()
        path.parent.mkdir(parents=True, exist_ok=True)
        with _exclusive_file_lock(path.with_name(path.name + '.lock')):
            if path.exists():
                _, generation, checksum = _read_checkpoint(path)
                if generation != self._generation or checksum != self._saved_hash:
                    raise ForexForwardCheckpointConflict('checkpoint changed; reload before writing')
            elif self._generation:
                raise ForexForwardCheckpointConflict('checkpoint disappeared; refusing to reset')
            generation = self._generation + 1
            record = dict(schema_version='forex-forward-checkpoint-v1', generation=generation,
                          snapshot=snapshot.model_dump(mode='json'))
            checksum = _digest(forward_artifact_json(record))
            raw = forward_artifact_json({**record, 'sha256': checksum})
            if len(raw) > MAX_CHECKPOINT_BYTES:
                raise ValueError('checkpoint resource bound reached')
            temporary = path.with_name(f'.{path.name}.{os.getpid()}.{uuid4().hex}.tmp')
            try:
                with temporary.open('xb') as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
            self._path, self._generation, self._saved_hash = path, generation, checksum
            return generation
