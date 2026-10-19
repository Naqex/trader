import { canUseReplayMutationView } from './replayMutationView.js'

const SCHEMA = 'replay-step-v1'
const MAX_ROWS = 1000
const WINDOW_ROWS = 2000
const IDENTITY = ['session_kind', 'prop_session_id', 'prop_attempt_id']
const integer = value => Number.isSafeInteger(value) && value >= 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const cursorOf = replay => replay?.view_cursor_index ?? replay?.payload?.cursor_index
const identityOf = (replay, key) => replay[key] ?? replay.payload?.[key] ?? null
const barSchema = schema => ['replay-execution-v1', 'replay-execution-v2'].includes(schema)

function invalid() {
  return Object.assign(new Error('Phản hồi bước replay không khớp phiên. Nạp lại phiên trước khi tiếp tục.'), { code: 'replay_step_invalid' })
}

export function validRow(row) {
  return object(row) && integer(row.timestamp)
    && ['open', 'high', 'low', 'close'].every(key => Number.isFinite(row[key]))
    && row.high >= Math.max(row.open, row.close, row.low) && row.low <= Math.min(row.open, row.close)
    && ['volume', 'tick_volume'].every(key => row[key] == null || (Number.isFinite(row[key]) && row[key] >= 0))
}

export function sameValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
  if (!object(left) || !object(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
}

export function validBaseWindow(replay) {
  const cursor = cursorOf(replay), start = Math.max(0, cursor - WINDOW_ROWS + 1)
  return integer(replay.total_row_count) && cursor < replay.total_row_count
    && replay.visible_row_start === start && replay.visible_row_count === cursor - start + 1
    && Array.isArray(replay.visible_rows) && replay.visible_rows.length === replay.visible_row_count
    && replay.visible_rows.at(-1)?.timestamp === replay.cutoff_timestamp
}

export function canUseReplayStepView(replay) {
  return replay?.step_view_version === SCHEMA && canUseReplayMutationView(replay) && validBaseWindow(replay)
    && (replay.payload.execution == null || barSchema(replay.payload.execution.schema_version))
}

function assertIdentity(current, response, { workspace, sessionId, expectedRevision }) {
  if (!object(current?.payload) || !object(response) || current.record_id !== sessionId
      || current.revision !== expectedRevision || !integer(expectedRevision)
      || response.record_id !== sessionId || (response.workspace_id != null && response.workspace_id !== workspace)
      || response.revision !== expectedRevision + 1
      || IDENTITY.some(key => identityOf(response, key) !== identityOf(current, key))) throw invalid()
}

function assertForwardWindow(current, response, rows) {
  const cursor = cursorOf(response), baseCursor = cursorOf(current)
  if (!integer(cursor) || cursor < baseCursor || cursor - baseCursor > MAX_ROWS
      || response.payload?.cursor_index !== cursor || response.canonical_cursor_index !== cursor
      || response.historical_view !== false || response.total_row_count !== current.total_row_count
      || cursor >= response.total_row_count || !integer(response.cutoff_timestamp)
      || (cursor === baseCursor ? response.cutoff_timestamp !== current.cutoff_timestamp : response.cutoff_timestamp <= current.cutoff_timestamp)
      || response.visible_row_start !== Math.max(0, cursor - WINDOW_ROWS + 1)
      || response.visible_row_count !== cursor - response.visible_row_start + 1
      || !Array.isArray(rows) || rows.length !== response.visible_row_count) throw invalid()
  let previous = -Infinity
  for (const row of rows) {
    if (!validRow(row) || row.timestamp <= previous || row.timestamp > response.cutoff_timestamp) throw invalid()
    previous = row.timestamp
  }
  if (previous !== response.cutoff_timestamp) throw invalid()
}

export function mergeReplayStepView(current, response, scope) {
  assertIdentity(current, response, scope)
  const baseSequence = current.payload.execution?.event_sequence ?? 0
  const baseLedger = current.payload.execution?.ledger || []
  if (response.schema_version === undefined) {
    // A full response is a compatibility result, never a reason to repeat the command.
    if (!object(response.payload) || response.payload.dataset_id !== current.payload.dataset_id
        || response.payload.branch_id !== current.payload.branch_id
        || (current.dataset_sha256 != null && response.dataset_sha256 !== current.dataset_sha256)) throw invalid()
    assertForwardWindow(current, response, response.visible_rows)
    const execution = response.payload.execution, ledger = execution?.ledger || []
    if (!canUseReplayMutationView(response) || (execution == null) !== (current.payload.execution == null)
        || (execution && (execution.schema_version !== current.payload.execution.schema_version
          || ledger.length < baseLedger.length || !baseLedger.every((event, index) => sameValue(event, ledger[index]))))) throw invalid()
    const appendedEvents = ledger.slice(baseLedger.length)
    if (appendedEvents.some((event, index) => !object(event) || event.sequence !== baseSequence + index + 1
        || event.replay_session_id !== current.record_id || event.branch_id !== current.payload.branch_id
        || event.dataset_id !== current.payload.dataset_id || event.dataset_sha256 !== current.dataset_sha256
        || !integer(event.cursor_index) || event.cursor_index <= cursorOf(current) || event.cursor_index > cursorOf(response))) throw invalid()
    return { replay: response, appendedEvents, compact: false, stepTail: null }
  }
  if (response.schema_version !== SCHEMA || !canUseReplayStepView(current)) throw invalid()
  const patch = response.payload_patch, head = patch?.execution, baseCursor = cursorOf(current)
  const cursor = response.cursor_index, rows = response.appended_rows, events = response.appended_events
  if (response.workspace_id !== scope.workspace || response.dataset_id !== current.payload.dataset_id
      || response.dataset_sha256 !== current.dataset_sha256 || response.branch_id !== current.payload.branch_id
      || response.base_revision !== current.revision || response.base_event_sequence !== baseSequence
      || response.base_cursor_index !== baseCursor || response.base_cutoff_timestamp !== current.cutoff_timestamp
      || !integer(cursor) || cursor < baseCursor || cursor - baseCursor > MAX_ROWS
      || response.view_cursor_index !== cursor || response.canonical_cursor_index !== cursor
      || response.historical_view !== false || response.total_row_count !== current.total_row_count
      || !Array.isArray(rows) || rows.length !== cursor - baseCursor
      || !Array.isArray(events) || events.length > rows.length * 3
      || !integer(response.execution_event_sequence) || response.execution_event_sequence !== baseSequence + events.length
      || !object(patch) || Object.keys(patch).some(key => !['execution', 'cursor_index', 'status', 'timing'].includes(key))
      || !['execution', 'cursor_index', 'status', 'timing'].every(key => Object.hasOwn(patch, key))
      || patch.cursor_index !== cursor || !['paused', 'completed'].includes(patch.status)
      || typeof response.has_future_rows !== 'boolean' || response.has_future_rows !== (patch.status !== 'completed')
      || typeof response.updated_at_utc !== 'string') throw invalid()
  const end = current.session_period?.end_cursor_index ?? current.total_row_count - 1
  if (cursor > end || response.has_future_rows !== (cursor < end)
      || (cursor === baseCursor && (cursor !== end || events.length))) throw invalid()
  let timestamp = current.cutoff_timestamp
  for (const row of rows) {
    if (!validRow(row) || row.timestamp <= timestamp) throw invalid()
    timestamp = row.timestamp
  }
  if (response.cutoff_timestamp !== timestamp) throw invalid()
  const executionWasInitialized = current.payload.execution != null
  if (!executionWasInitialized) {
    if (head !== null || events.length || response.execution_event_sequence !== 0 || response.execution_view_status !== 'not_initialized') throw invalid()
  } else {
    if (!object(head) || Object.hasOwn(head, 'ledger') || !barSchema(head.schema_version)
        || head.schema_version !== current.payload.execution.schema_version || head.replay_session_id !== current.record_id
        || head.branch_id !== current.payload.branch_id || head.dataset_id !== current.payload.dataset_id
        || head.dataset_sha256 !== current.dataset_sha256 || head.cursor_index !== cursor
        || head.event_sequence !== response.execution_event_sequence || response.execution_view_status !== 'current') throw invalid()
  }
  let eventCursor = baseCursor + 1
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (!object(event) || event.sequence !== baseSequence + index + 1 || event.replay_session_id !== current.record_id
        || event.branch_id !== current.payload.branch_id || event.dataset_id !== current.payload.dataset_id
        || event.dataset_sha256 !== current.dataset_sha256 || event.cursor_index !== eventCursor
        || !['market_fill', 'order_rejected', 'protective_fill', 'price_mark'].includes(event.kind)) throw invalid()
    const row = rows[eventCursor - baseCursor - 1], frame = head.timeframe_seconds
    if (!row || !integer(frame) || frame < 1 || !integer(event.virtual_time_utc)
        || event.virtual_time_utc < row.timestamp || event.virtual_time_utc > row.timestamp + frame
        || (event.kind === 'price_mark' && event.virtual_time_utc !== row.timestamp + frame)
        || (head.schema_version === 'replay-execution-v2' && event.schema_version !== 'replay-execution-event-v2')) throw invalid()
    if (event.kind === 'price_mark') eventCursor += 1
  }
  if (executionWasInitialized && eventCursor !== cursor + 1) throw invalid()
  const visibleRows = current.visible_rows.concat(rows).slice(-WINDOW_ROWS)
  let execution = null
  if (executionWasInitialized) {
    execution = { ...head, ledger: baseLedger.concat(events) }
    for (const key of ['instrument_spec', 'cost_model']) {
      const previous = current.payload.execution[key]
      if (previous !== undefined && sameValue(previous, execution[key])) execution[key] = previous
    }
  }
  const replay = { ...current, revision: response.revision, updated_at_utc: response.updated_at_utc,
    execution_capabilities: response.execution_capabilities ?? current.execution_capabilities,
    view_cursor_index: cursor, canonical_cursor_index: cursor, cutoff_timestamp: timestamp,
    historical_view: false, has_future_rows: response.has_future_rows, execution_view_status: response.execution_view_status,
    visible_row_start: response.visible_row_start, visible_row_count: response.visible_row_count,
    visible_rows: visibleRows, execution_events: events,
    payload: { ...current.payload, ...patch, execution } }
  assertForwardWindow(current, replay, visibleRows)
  return { replay, appendedEvents: events, compact: true,
    stepTail: { baseCutoff: current.cutoff_timestamp, cutoff: timestamp, rows } }
}
