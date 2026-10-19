import test from 'node:test'
import assert from 'node:assert/strict'
import { canUseReplayHistoryView, historyEventSequences, mergeReplayHistoryView } from '../src/replayHistoryView.js'

const scope = { workspace: 'tenant-a', sessionId: 's' }
const row = i => ({ timestamp: 1700000000 + i * 60, open: 1, high: 3, low: .5, close: 2 })
const identity = { schema_version: 'replay-execution-v1', replay_session_id: 's', branch_id: 'b', dataset_id: 'd', dataset_sha256: 'sha', timeframe_seconds: 60 }
const event = i => ({ ...identity, kind: 'price_mark', sequence: i, cursor_index: i, virtual_time_utc: row(i).timestamp + 60 })
function base(cursor = 2) {
  return { record_id: 's', revision: 10, dataset_sha256: 'sha', history_view_version: 'replay-history-v1',
    historical_view: true, execution_view_status: 'checkpoint', canonical_cursor_index: 9000, view_cursor_index: cursor,
    cutoff_timestamp: row(cursor).timestamp, total_row_count: 10000, visible_row_start: Math.max(0, cursor - 1999),
    visible_row_count: Math.min(cursor + 1, 2000), visible_rows: Array.from({ length: Math.min(cursor + 1, 2000) }, (_, i) => row(Math.max(0, cursor - 1999) + i)),
    payload: { dataset_id: 'd', branch_id: 'b', cursor_index: cursor,
      execution: { ...identity, cursor_index: cursor, event_sequence: cursor, ledger: Array.from({ length: cursor }, (_, i) => event(i + 1)) } } }
}
function delta(current = base(), count = 1) {
  const start = current.view_cursor_index, cursor = start + count
  const response = structuredClone(current)
  delete response.visible_rows
  delete response.payload.execution.ledger
  return { ...response, schema_version: 'replay-history-v1', workspace_id: 'tenant-a', base_revision: current.revision,
    base_cursor_index: start, base_cutoff_timestamp: current.cutoff_timestamp, cutoff_timestamp: row(cursor).timestamp,
    view_cursor_index: cursor, visible_row_start: Math.max(0, cursor - 1999), visible_row_count: Math.min(cursor + 1, 2000),
    appended_rows: Array.from({ length: count }, (_, i) => row(start + i + 1)),
    payload: { ...response.payload, cursor_index: cursor, execution: { ...response.payload.execution, cursor_index: cursor, event_sequence: cursor } },
    ledger_deltas: [{ path: '/execution', base_event_sequence: start, appended_events: Array.from({ length: count }, (_, i) => event(start + i + 1)) }] }
}
test('same revision forward read retains exact ledger/window and does not mutate its base', () => {
  const current = base(), before = structuredClone(current), response = delta(current)
  const result = mergeReplayHistoryView(current, response, scope)
  assert.equal(result.revision, 10)
  assert.equal(result.payload.execution.ledger.length, 3)
  assert.equal(result.payload.execution.ledger[0], current.payload.execution.ledger[0])
  assert.equal(result.visible_rows[0], current.visible_rows[0])
  assert.equal(result.schema_version, undefined)
  assert.deepEqual(current, before)
  assert.deepEqual(historyEventSequences(result), { '/execution': 3 })
  assert.equal(canUseReplayHistoryView(result), true)
})
test('rolling window and large interval retain 2000 bars without truncating execution history', () => {
  const current = base(2500), result = mergeReplayHistoryView(current, delta(current, 1000), scope)
  assert.equal(result.visible_rows.length, 2000)
  assert.equal(result.visible_row_start, 1501)
  assert.equal(result.payload.execution.ledger.length, 3500)
})
test('portfolio, local asset and active chart copies are merged independently', () => {
  const current = base()
  current.payload.asset_states = { d: { cursor_index: 2, execution: structuredClone(current.payload.execution) }, empty: { cursor_index: 0, execution: null } }
  current.payload.portfolio_execution = { ...structuredClone(current.payload.execution), schema_version: 'replay-portfolio-v1', dataset_sha256: 'pins' }
  const response = delta(current)
  response.payload.asset_states.d = { cursor_index: 3, execution: structuredClone(response.payload.execution) }
  response.payload.portfolio_execution = { ...structuredClone(response.payload.execution), schema_version: 'replay-portfolio-v1', dataset_sha256: 'pins' }
  response.ledger_deltas.push({ ...structuredClone(response.ledger_deltas[0]), path: '/asset_states/d/execution' },
    { path: '/portfolio_execution', base_event_sequence: 2, appended_events: [{ ...event(3), dataset_sha256: 'pins' }] })
  const result = mergeReplayHistoryView(current, response, scope)
  assert.equal(result.payload.asset_states.d.execution.ledger.length, 3)
  assert.equal(result.payload.portfolio_execution.ledger.length, 3)
  assert.equal(result.payload.asset_states.empty.execution, null)
})
test('unsupported wire can return a full view without another request', () => {
  const current = base(), full = base(3)
  assert.equal(mergeReplayHistoryView(current, full, scope), full)
})
test('uninitialized history preserves the full API stored-cursor semantics', () => {
  const current = base(), response = delta(current)
  current.payload.execution = null
  current.payload.cursor_index = current.canonical_cursor_index
  current.execution_view_status = 'not_initialized'
  response.payload.execution = null
  response.payload.cursor_index = current.canonical_cursor_index
  response.execution_view_status = 'not_initialized'
  response.ledger_deltas = []
  assert.equal(mergeReplayHistoryView(current, response, scope).payload.cursor_index, current.canonical_cursor_index)
})
const invalidCases = {
  tenant: v => { v.workspace_id = 'tenant-b' },
  session: v => { v.record_id = 'other' },
  revision: v => { v.revision++ },
  base: v => { v.base_cursor_index-- },
  cutoff: v => { v.base_cutoff_timestamp-- },
  lineage: v => { v.payload.execution.dataset_sha256 = 'other' },
  canonical: v => { v.canonical_cursor_index++ },
  missingLedger: v => { v.ledger_deltas = [] },
  duplicateLedger: v => { v.ledger_deltas.push(v.ledger_deltas[0]) },
  unknownPath: v => { v.ledger_deltas[0].path = '/__proto__' },
  baseSequence: v => { v.ledger_deltas[0].base_event_sequence-- },
  sequenceHole: v => { v.ledger_deltas[0].appended_events[0].sequence++ },
  futureCursor: v => { v.ledger_deltas[0].appended_events[0].cursor_index++ },
  futureTime: v => { v.ledger_deltas[0].appended_events[0].virtual_time_utc += 600 },
  eventBranch: v => { v.ledger_deltas[0].appended_events[0].branch_id = 'other' },
  truncatedRows: v => { v.appended_rows = [] },
  duplicateCandle: v => { v.appended_rows[0] = row(2) },
  ledgerInHead: v => { v.payload.execution.ledger = [] },
}
for (const [name, change] of Object.entries(invalidCases)) test(`rejects ${name} without accepting a partial merge`, () => {
  const current = base(), response = delta(current)
  change(response)
  assert.throws(() => mergeReplayHistoryView(current, response, scope), { code: 'replay_history_invalid' })
  assert.equal(current.payload.execution.ledger.length, 2)
})
