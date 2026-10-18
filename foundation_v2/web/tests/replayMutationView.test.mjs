import test from 'node:test'
import assert from 'node:assert/strict'
import { canUseReplayMutationView, mergeReplayMutationView, replayMutationEventsAfter } from '../src/replayMutationView.js'
import { propPriceMarkEvents } from '../src/propReplayModel.js'

const sha = 'a'.repeat(64)
const scope = { workspace: 'tenant-a', sessionId: 'session', expectedRevision: 10 }
const identity = { replay_session_id: 'session', branch_id: 'branch', dataset_id: 'dataset', dataset_sha256: sha, cursor_index: 42 }
const event = (sequence, kind = 'price_mark') => ({ ...identity, sequence, kind })
function snapshot(initialized = true) {
  return { record_id: 'session', revision: 10, dataset_sha256: sha, view_cursor_index: 42, canonical_cursor_index: 42,
    cutoff_timestamp: 1700000000, has_future_rows: true, historical_view: false,
    execution_view_status: initialized ? 'current' : 'not_initialized', visible_rows: [{ close: 1.2 }],
    payload: { dataset_id: 'dataset', branch_id: 'branch', cursor_index: 42, status: 'paused', timing: { total_seconds: 60 },
      execution: initialized ? { ...identity, event_sequence: 2, ledger: [event(1), event(2)],
        instrument_spec: { instrument_id: 'EURUSD', tick_size: '.00001' }, cost_model: { account_ccy: 'USD' }, position: { side: 'SELL', stop_loss: null } } : null } }
}
function mutation(current = snapshot(), events = [event(3, 'protection_changed')]) {
  const baseSequence = current.payload.execution?.event_sequence || 0
  return { schema_version: 'replay-mutation-v1', workspace_id: scope.workspace, record_id: current.record_id,
    dataset_id: current.payload.dataset_id, dataset_sha256: current.dataset_sha256, branch_id: current.payload.branch_id,
    base_revision: current.revision, base_event_sequence: baseSequence, revision: current.revision + 1,
    execution_event_sequence: baseSequence + events.length, appended_events: events,
    cursor_index: 42, view_cursor_index: 42, canonical_cursor_index: 42, cutoff_timestamp: current.cutoff_timestamp,
    has_future_rows: true, historical_view: false, execution_view_status: 'current', updated_at_utc: '2026-10-18T01:00:00Z',
    payload_patch: { cursor_index: 42, status: 'paused', timing: { total_seconds: 60 },
      execution: { ...identity, event_sequence: baseSequence + events.length,
        instrument_spec: { tick_size: '.00001', instrument_id: 'EURUSD' }, cost_model: { account_ccy: 'USD' },
        position: { side: 'SELL', stop_loss: '1.21' } } } }
}
const merge = (current, response) => mergeReplayMutationView(current, response, { ...scope, expectedRevision: current.revision })
const reject = (current, response) => assert.throws(() => merge(current, response), error => error.code === 'replay_mutation_invalid')

test('protection confirmation updates financial state without replacing chart or unchanged configuration', () => {
  const current = snapshot(), response = mutation(current), before = structuredClone(current)
  const { replay, appendedEvents, compact } = merge(current, response)
  assert.equal(compact, true)
  assert.equal(replay.payload.execution.position.stop_loss, '1.21')
  assert.equal(replay.revision, 11)
  assert.equal(replay.visible_rows, current.visible_rows)
  assert.equal(replay.payload.execution.instrument_spec, current.payload.execution.instrument_spec)
  assert.equal(replay.payload.execution.cost_model, current.payload.execution.cost_model)
  assert.deepEqual(replay.payload.execution.ledger, [...current.payload.execution.ledger, ...response.appended_events])
  assert.equal(replay.payload.execution.ledger[0], current.payload.execution.ledger[0])
  assert.equal(appendedEvents, response.appended_events)
  assert.deepEqual(current, before)
  assert.equal(Object.hasOwn(response.payload_patch.execution, 'ledger'), false)
})

test('changed configuration is retained rather than hidden behind previous references', () => {
  const current = snapshot(), response = mutation(current)
  response.payload_patch.execution.cost_model.account_ccy = 'EUR'
  response.payload_patch.execution.instrument_spec.tick_size = '.001'
  const { replay } = merge(current, response)
  assert.equal(replay.payload.execution.cost_model.account_ccy, 'EUR')
  assert.equal(replay.payload.execution.instrument_spec.tick_size, '.001')
  assert.notEqual(replay.payload.execution.instrument_spec, current.payload.execution.instrument_spec)
})

test('uninitialized quick sell can advance two revisions and immediately expose its filled position', () => {
  const current = snapshot(false), response = mutation(current, [event(1, 'market_order'), event(2, 'price_mark')])
  response.revision = 12
  const { replay } = merge(current, response)
  assert.equal(replay.revision, 12)
  assert.equal(replay.execution_view_status, 'current')
  assert.equal(replay.payload.execution.position.side, 'SELL')
  assert.equal(replay.payload.execution.ledger.length, 2)
  assert.equal(replay.visible_rows, current.visible_rows)
})

test('initialization then market can merge sequentially before a render without losing the initialized head', () => {
  const initial = snapshot(false), initialized = merge(initial, mutation(initial, [])).replay
  const response = mutation(initialized, [event(1, 'order_fill'), event(2, 'price_mark')])
  const result = merge(initialized, response)
  assert.equal(result.replay.revision, 12)
  assert.equal(result.replay.payload.execution.event_sequence, 2)
  reject(initial, response)
})

test('Prop receives only newly appended price/close events, never the retained ledger', () => {
  const current = snapshot(), response = mutation(current, [event(3, 'protection_changed'), event(4), event(5, 'manual_close')])
  const result = merge(current, response)
  assert.equal(replayMutationEventsAfter(result, 2), result.appendedEvents)
  assert.deepEqual(propPriceMarkEvents(replayMutationEventsAfter(result, 2), 2).map(item => item.sequence), [4, 5])
  assert.deepEqual(propPriceMarkEvents(replayMutationEventsAfter(result, 4), 4).map(item => item.sequence), [5])
})

test('Prop recovers unacknowledged base marks after reload before new mutation marks, exactly once', () => {
  const current = snapshot()
  current.payload.execution.event_sequence = 4
  current.payload.execution.ledger = [event(1), event(2, 'manual_close'), event(3, 'order_cancel'), event(4, 'protection_changed')]
  const result = merge(current, mutation(current, [event(5), event(6, 'manual_close')]))
  const pending = bound => propPriceMarkEvents(replayMutationEventsAfter(result, bound), bound).map(item => item.sequence)
  assert.deepEqual(pending(0), [1, 2, 3, 5, 6])
  assert.deepEqual(pending(1), [2, 3, 5, 6])
  assert.deepEqual(pending(3), [5, 6])
  assert.deepEqual(pending(4), [5, 6])
  assert.deepEqual(pending(5), [6])
  assert.deepEqual(pending(6), [])
  assert.equal(replayMutationEventsAfter(result, 4), result.appendedEvents)
})

test('Prop recovery also works with empty new suffix and legacy full-response ledgers', () => {
  const current = snapshot(), response = mutation(current, [])
  const emptySuffix = merge(current, response)
  assert.deepEqual(propPriceMarkEvents(replayMutationEventsAfter(emptySuffix, 0), 0).map(item => item.sequence), [1, 2])
  const legacy = structuredClone(current)
  legacy.revision = 11
  legacy.payload.execution.ledger.push(event(3, 'manual_close'))
  legacy.payload.execution.event_sequence = 3
  const full = merge(current, legacy)
  assert.deepEqual(propPriceMarkEvents(replayMutationEventsAfter(full, 1), 1).map(item => item.sequence), [2, 3])
  delete full.replay.payload.execution.event_sequence
  assert.equal(replayMutationEventsAfter(full, 1), full.replay.payload.execution.ledger)
})

test('long ledgers stay complete and immutable while unchanged chart references survive', () => {
  const current = snapshot()
  current.payload.execution.event_sequence = 5000
  current.payload.execution.ledger = Array.from({ length: 5000 }, (_, index) => event(index + 1))
  const result = merge(current, mutation(current, [event(5001)]))
  assert.equal(result.replay.payload.execution.ledger.length, 5001)
  assert.equal(current.payload.execution.ledger.length, 5000)
  assert.equal(result.replay.visible_rows, current.visible_rows)
})

test('portfolio, historical, missing checksum and inconsistent local ledger choose full responses before sending', () => {
  assert.equal(canUseReplayMutationView(snapshot()), true)
  assert.equal(canUseReplayMutationView(snapshot(false)), true)
  for (const change of [value => { value.payload.asset_states = {} }, value => { value.historical_view = true },
    value => { value.dataset_sha256 = null }, value => { value.payload.execution.ledger.pop() },
    value => { value.view_cursor_index = 41 }, value => { value.canonical_cursor_index = 43 }]) {
    const current = snapshot(); change(current)
    assert.equal(canUseReplayMutationView(current), false)
    reject(current, mutation(current))
  }
})

test('foreign context, unknown schema and changed cursor are rejected without applying a head', () => {
  for (const [field, value] of [['workspace_id', 'tenant-b'], ['record_id', 'other'], ['dataset_id', 'other'],
    ['dataset_sha256', 'b'.repeat(64)], ['branch_id', 'other'], ['schema_version', 'replay-mutation-v2'],
    ['cursor_index', 41], ['view_cursor_index', 41], ['canonical_cursor_index', 43], ['cutoff_timestamp', 1700000001],
    ['historical_view', true], ['has_future_rows', false], ['execution_view_status', 'not_initialized']]) {
    const current = snapshot(), response = mutation(current); response[field] = value
    reject(current, response)
  }
})

test('stale retries, future base, missing fields and invalid revision increments fail closed', () => {
  for (const change of [value => { value.base_revision = 9 }, value => { value.base_revision = 11 },
    value => { value.revision = 10 }, value => { value.revision = 12 }, value => { delete value.base_event_sequence },
    value => { delete value.updated_at_utc }, value => { delete value.payload_patch.timing },
    value => { value.payload_patch.dataset_id = 'other' }, value => { value.payload_patch.execution.ledger = [] }]) {
    const current = snapshot(), response = mutation(current); change(response); reject(current, response)
  }
  const current = snapshot(), response = mutation(current), applied = merge(current, response).replay
  reject(applied, response)
  assert.throws(() => mergeReplayMutationView(current, response, { ...scope, expectedRevision: 9 }), { code: 'replay_mutation_invalid' })
})

test('missing, duplicated, reordered, overflowing or foreign event sequences never corrupt the ledger', () => {
  for (const change of [value => { value.base_event_sequence = 1 }, value => { value.appended_events = [] },
    value => { value.appended_events[0].sequence = 2 }, value => { value.appended_events[0].sequence = 4 },
    value => { value.payload_patch.execution.event_sequence = 4 }, value => { value.appended_events[0].dataset_id = 'other' },
    value => { value.payload_patch.execution.replay_session_id = 'other' },
    value => { value.appended_events = [event(4), event(3)]; value.execution_event_sequence = 4; value.payload_patch.execution.event_sequence = 4 },
    value => { value.appended_events = Array.from({ length: 17 }, (_, i) => event(i + 3)); value.execution_event_sequence = 19; value.payload_patch.execution.event_sequence = 19 }]) {
    const current = snapshot(), response = mutation(current); change(response); reject(current, response)
    assert.equal(current.payload.execution.ledger.length, 2)
  }
})

test('Prop attempt identity cannot be silently changed by an otherwise valid mutation', () => {
  const current = snapshot()
  Object.assign(current, { session_kind: 'prop', prop_session_id: 'challenge', prop_attempt_id: 'attempt' })
  const response = mutation(current)
  reject(current, response)
  Object.assign(response, { session_kind: 'prop', prop_session_id: 'challenge', prop_attempt_id: 'attempt' })
  assert.equal(merge(current, response).replay.prop_attempt_id, 'attempt')
  response.prop_attempt_id = 'other'
  reject(current, response)
})

test('older servers returning full snapshots remain compatible and emit only their event suffix', () => {
  const current = snapshot(), response = structuredClone(current)
  response.revision = 11
  response.payload.execution.event_sequence = 3
  response.payload.execution.ledger.push(event(3))
  const result = merge(current, response)
  assert.equal(result.compact, false)
  assert.equal(result.replay, response)
  assert.deepEqual(result.appendedEvents.map(item => item.sequence), [3])
  for (const change of [value => { value.record_id = 'other' }, value => { value.workspace_id = 'tenant-b' },
    value => { value.payload.dataset_id = 'other' }, value => { value.revision = 10 }, value => { value.view_cursor_index = 43 }]) {
    const invalid = structuredClone(response); change(invalid); reject(current, invalid)
  }
})
