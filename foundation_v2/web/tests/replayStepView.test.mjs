import test from 'node:test'
import assert from 'node:assert/strict'
import { canUseReplayStepView, mergeReplayStepView } from '../src/replayStepView.js'
import { replayMutationEventsAfter } from '../src/replayMutationView.js'
import { propPriceMarkEvents } from '../src/propReplayModel.js'

const sha = 'a'.repeat(64), scope = { workspace: 'tenant-a', sessionId: 's', expectedRevision: 10 }
const row = index => ({ timestamp: 1700000000 + index * 60, open: 1, high: 3, low: .5, close: 2, volume: index })
const identity = { replay_session_id: 's', branch_id: 'b', dataset_id: 'd', dataset_sha256: sha }
function base(cursor = 2, initialized = true) {
  return { record_id: 's', revision: 10, dataset_sha256: sha, step_view_version: 'replay-step-v1',
    view_cursor_index: cursor, canonical_cursor_index: cursor, historical_view: false, has_future_rows: true,
    cutoff_timestamp: row(cursor).timestamp, visible_row_start: Math.max(0, cursor - 1999),
    visible_row_count: Math.min(cursor + 1, 2000), total_row_count: 10000,
    visible_rows: Array.from({ length: Math.min(cursor + 1, 2000) }, (_, i) => row(Math.max(0, cursor - 1999) + i)),
    payload: { branch_id: 'b', dataset_id: 'd', cursor_index: cursor, status: 'paused',
      execution: initialized ? { ...identity, schema_version: 'replay-execution-v1', cursor_index: cursor,
        event_sequence: 1, timeframe_seconds: 60, instrument_spec: { instrument_id: 'EURUSD' }, cost_model: { account_ccy: 'USD' },
        ledger: [{ ...identity, sequence: 1, cursor_index: cursor, kind: 'manual_close' }] } : null } }
}
function step(current = base(), count = 1) {
  const start = current.payload.cursor_index, cursor = start + count, seq = current.payload.execution?.event_sequence || 0
  const rows = Array.from({ length: count }, (_, i) => row(start + i + 1))
  const events = current.payload.execution ? rows.map((item, i) => ({ ...identity, sequence: seq + i + 1,
    cursor_index: start + i + 1, kind: 'price_mark', virtual_time_utc: item.timestamp + 60 })) : []
  const { ledger, ...head } = current.payload.execution || {}
  return { schema_version: 'replay-step-v1', workspace_id: scope.workspace, record_id: 's', dataset_id: 'd', dataset_sha256: sha,
    branch_id: 'b', base_revision: current.revision, base_event_sequence: seq, base_cursor_index: start,
    base_cutoff_timestamp: current.cutoff_timestamp, revision: current.revision + 1, execution_event_sequence: seq + events.length,
    appended_rows: rows, appended_events: events, cursor_index: cursor, view_cursor_index: cursor, canonical_cursor_index: cursor,
    cutoff_timestamp: rows.at(-1)?.timestamp ?? current.cutoff_timestamp, historical_view: false, has_future_rows: true,
    execution_view_status: current.payload.execution ? 'current' : 'not_initialized', updated_at_utc: '2026-10-18T01:00:00Z',
    visible_row_start: Math.max(0, cursor - 1999), visible_row_count: Math.min(cursor + 1, 2000), total_row_count: current.total_row_count,
    payload_patch: { cursor_index: cursor, status: 'paused', timing: { replayed_seconds: count * 60 },
      execution: current.payload.execution ? { ...head, cursor_index: cursor, event_sequence: seq + events.length,
        instrument_spec: structuredClone(head.instrument_spec), cost_model: structuredClone(head.cost_model) } : null } }
}
const merge = (current, value) => mergeReplayStepView(current, value, { ...scope, expectedRevision: current.revision })
const reject = (current, value) => assert.throws(() => merge(current, value), { code: 'replay_step_invalid' })

test('one step hydrates exact new state while preserving retained candles and configuration references', () => {
  const current = base()
  current.payload.execution.instrument_spec.allowed_order_types = ['market', 'limit']
  const value = step(current), before = structuredClone(current)
  current.execution_events = [{ sequence: 999 }]
  const result = merge(current, value), next = result.replay
  assert.equal(next.revision, 11)
  assert.equal(next.payload.cursor_index, 3)
  assert.equal(next.visible_rows[0], current.visible_rows[0])
  assert.equal(next.visible_rows.at(-1), value.appended_rows[0])
  assert.equal(next.payload.execution.instrument_spec, current.payload.execution.instrument_spec)
  assert.equal(next.payload.execution.cost_model, current.payload.execution.cost_model)
  assert.equal(next.execution_events, value.appended_events)
  assert.deepEqual(result.stepTail, { baseCutoff: current.cutoff_timestamp, cutoff: value.cutoff_timestamp, rows: value.appended_rows })
  assert.equal(next.payload.execution.ledger.length, 2)
  delete current.execution_events
  assert.deepEqual(current, before)
})

test('1000-step rolling window retains exactly 2000 candles without losing ledger history', () => {
  const current = base(2500), value = step(current, 1000), result = merge(current, value)
  assert.equal(result.replay.visible_rows.length, 2000)
  assert.equal(result.replay.visible_row_start, 1501)
  assert.equal(result.replay.visible_rows[0], current.visible_rows[1000])
  assert.equal(result.replay.payload.execution.ledger.length, 1001)
  assert.equal(result.replay.payload.execution.ledger[0], current.payload.execution.ledger[0])
})

test('uninitialized replay advances candles without fabricating an execution', () => {
  const current = base(2, false), value = step(current, 5), result = merge(current, value)
  assert.equal(result.replay.payload.execution, null)
  assert.deepEqual(result.appendedEvents, [])
  const invalid = structuredClone(value); invalid.payload_patch.execution = {}
  reject(current, invalid)
})

test('session-period completion and compatible final no-advance revision are explicit', () => {
  const current = base(); current.session_period = { end_cursor_index: 4 }
  const value = step(current, 2); value.has_future_rows = false; value.payload_patch.status = 'completed'
  const completed = merge(current, value).replay
  assert.equal(completed.has_future_rows, false)
  const final = base(9999), noAdvance = step(final, 0)
  noAdvance.has_future_rows = false; noAdvance.payload_patch.status = 'completed'
  assert.equal(merge(final, noAdvance).replay.revision, 11)
  reject(current, step(current, 0))
})

test('gapped native timestamps and protective-fill then mark preserve causal ordering', () => {
  const current = base(), value = step(current, 2)
  value.appended_rows[1].timestamp += 86400
  value.cutoff_timestamp = value.appended_rows[1].timestamp
  value.appended_events[1].virtual_time_utc = value.cutoff_timestamp + 60
  value.appended_events.unshift({ ...identity, sequence: 2, kind: 'protective_fill', cursor_index: 3, virtual_time_utc: value.appended_rows[0].timestamp })
  value.appended_events.forEach((event, i) => { event.sequence = i + 2 })
  value.execution_event_sequence = 4; value.payload_patch.execution.event_sequence = 4
  const result = merge(current, value)
  assert.deepEqual(result.appendedEvents.map(event => event.kind), ['protective_fill', 'price_mark', 'price_mark'])
  assert.deepEqual(propPriceMarkEvents(replayMutationEventsAfter(result, 0), 0).map(event => event.sequence), [1, 3, 4])
})

test('eligibility requires advertised native canonical BAR scope and complete visible base window', () => {
  assert.equal(canUseReplayStepView(base()), true)
  assert.equal(canUseReplayStepView(base(2, false)), true)
  for (const change of [v => { delete v.step_view_version }, v => { v.historical_view = true },
    v => { v.payload.asset_states = {} }, v => { v.dataset_sha256 = null }, v => { v.visible_rows.pop() },
    v => { v.payload.execution.schema_version = 'replay-execution-tick-v1' }, v => { v.visible_row_start = 1 }]) {
    const current = base(); change(current); assert.equal(canUseReplayStepView(current), false); reject(current, step(current))
  }
})

test('foreign scope, stale base and missing or future cursor metadata fail closed', () => {
  for (const [key, invalid] of [['workspace_id', 'other'], ['record_id', 'other'], ['dataset_id', 'other'], ['dataset_sha256', 'b'.repeat(64)],
    ['branch_id', 'other'], ['base_revision', 9], ['base_event_sequence', 0], ['base_cursor_index', 1], ['base_cutoff_timestamp', 1],
    ['revision', 12], ['view_cursor_index', 4], ['canonical_cursor_index', 4], ['total_row_count', 9999], ['visible_row_count', 3],
    ['historical_view', true], ['schema_version', 'replay-step-v2']]) {
    const current = base(), value = step(current); value[key] = invalid; reject(current, value)
  }
  const current = base(), value = step(current), next = merge(current, value).replay
  reject(next, value)
})

test('malformed, missing, duplicate, unordered and overflowing bars are rejected', () => {
  for (const change of [v => { v.appended_rows = [] }, v => { v.appended_rows[0].timestamp = row(2).timestamp },
    v => { v.appended_rows[0].close = NaN }, v => { v.appended_rows[0].high = .1 },
    v => { v.appended_rows[0].volume = -1 }, v => { v.appended_rows[0].open = '1' },
    v => { v.cutoff_timestamp += 1 }, v => { v.appended_rows.push(v.appended_rows[0]) }]) {
    const current = base(), value = step(current); change(value); reject(current, value)
  }
  const current = base(); reject(current, step(current, 1001))
})

test('events require contiguous sequence, valid head, each advanced bar mark and no future data', () => {
  for (const change of [v => { v.appended_events = [] }, v => { v.appended_events[0].sequence = 3 },
    v => { v.appended_events[0].cursor_index = 2 }, v => { v.appended_events[0].dataset_id = 'other' },
    v => { v.appended_events[0].kind = 'manual_close' }, v => { v.appended_events[0].virtual_time_utc += 1 },
    v => { v.payload_patch.execution.ledger = [] }, v => { v.payload_patch.execution.event_sequence += 1 },
    v => { v.payload_patch.execution.cursor_index += 1 }, v => { delete v.payload_patch.timing },
    v => { v.payload_patch.asset_states = {} }, v => { v.execution_view_status = 'not_initialized' }]) {
    const current = base(), value = step(current); change(value); reject(current, value)
  }
})

test('Prop identity is retained and unknown attempts are rejected', () => {
  const current = base(); Object.assign(current, { session_kind: 'prop', prop_session_id: 'p', prop_attempt_id: 'a' })
  const value = step(current); reject(current, value)
  Object.assign(value, { session_kind: 'prop', prop_session_id: 'p', prop_attempt_id: 'a' })
  assert.equal(merge(current, value).replay.prop_attempt_id, 'a')
  value.prop_attempt_id = 'other'; reject(current, value)
})

test('older full-response runtime is accepted only for the exact forward revision and scope', () => {
  const current = base(), value = step(current), full = merge(current, value).replay
  const result = merge(current, full)
  assert.equal(result.compact, false); assert.equal(result.stepTail, null)
  assert.deepEqual(result.appendedEvents, value.appended_events)
  for (const change of [v => { v.revision += 1 }, v => { v.payload.dataset_id = 'other' },
    v => { v.visible_rows.at(-1).timestamp += 1 }, v => { v.prop_attempt_id = 'other' },
    v => { v.payload.execution = null }, v => { v.payload.execution.ledger.pop() },
    v => { v.payload.execution.ledger[0].kind = 'price_mark' },
    v => { v.payload.execution.ledger.at(-1).dataset_id = 'other' },
    v => { v.payload.execution.ledger.at(-1).cursor_index = 2 },
    v => { v.payload.execution.ledger.at(-1).sequence = 1 }]) {
    const invalid = structuredClone(full); change(invalid); reject(current, invalid)
  }
})
