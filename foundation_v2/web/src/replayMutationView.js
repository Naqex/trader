const COMPACT_SCHEMA = 'replay-mutation-v1'
const MAX_APPENDED_EVENTS = 16
const IDENTITY_FIELDS = ['session_kind', 'prop_session_id', 'prop_attempt_id']
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sequence = value => Number.isSafeInteger(value) && value >= 0
const cursorOf = replay => replay?.view_cursor_index ?? replay?.payload?.cursor_index

function invalid() {
  return Object.assign(new Error('Phản hồi lệnh không khớp trạng thái phiên. Nạp lại phiên trước khi tiếp tục.'), { code: 'replay_mutation_invalid' })
}

function executionBase(replay) {
  const execution = replay?.payload?.execution
  if (execution == null) return { sequence: 0, ledger: [] }
  if (!isObject(execution) || !sequence(execution.event_sequence) || !Array.isArray(execution.ledger)
      || execution.ledger.length !== execution.event_sequence
      || (execution.event_sequence > 0 && execution.ledger.at(-1)?.sequence !== execution.event_sequence)) return null
  return { sequence: execution.event_sequence, ledger: execution.ledger }
}

// Portfolio snapshots and older runtimes retain their full-response contract.
export function canUseReplayMutationView(replay) {
  return Boolean(isObject(replay?.payload) && !replay.payload.asset_states && !replay.historical_view
    && typeof replay.record_id === 'string' && replay.record_id
    && typeof replay.payload.dataset_id === 'string' && replay.payload.dataset_id
    && typeof replay.payload.branch_id === 'string' && replay.payload.branch_id
    && typeof replay.dataset_sha256 === 'string' && /^[a-f0-9]{64}$/.test(replay.dataset_sha256)
    && sequence(replay.revision) && sequence(cursorOf(replay))
    && cursorOf(replay) === replay.payload.cursor_index
    && (replay.canonical_cursor_index ?? cursorOf(replay)) === cursorOf(replay)
    && Number.isFinite(replay.cutoff_timestamp) && typeof replay.has_future_rows === 'boolean' && executionBase(replay)
    && (replay.payload.execution == null || (replay.payload.execution.replay_session_id === replay.record_id
      && replay.payload.execution.branch_id === replay.payload.branch_id
      && replay.payload.execution.dataset_id === replay.payload.dataset_id
      && replay.payload.execution.dataset_sha256 === replay.dataset_sha256
      && replay.payload.execution.cursor_index === cursorOf(replay))))
}

function sameValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
  if (!isObject(left) || !isObject(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
}

function assertEventScope(event, replay) {
  if (!isObject(event) || event.replay_session_id !== replay.record_id || event.branch_id !== replay.payload.branch_id
      || event.dataset_id !== replay.payload.dataset_id || event.dataset_sha256 !== replay.dataset_sha256
      || event.cursor_index !== cursorOf(replay)) throw invalid()
}

export function replayMutationEventsAfter({ replay, appendedEvents }, afterSequence) {
  const execution = executionBase(replay)
  const ledger = replay?.payload?.execution?.ledger || []
  if (!execution || !sequence(afterSequence)) return ledger
  const baseSequence = execution.sequence - appendedEvents.length
  // A failed Prop feed can leave the binding behind the mutation's base ledger.
  // Contiguous event sequences let recovery skip the acknowledged prefix directly.
  return afterSequence >= baseSequence ? appendedEvents : ledger.slice(afterSequence)
}

export function mergeReplayMutationView(current, response, { workspace, sessionId, expectedRevision }) {
  if (!isObject(current?.payload) || !isObject(response) || current.record_id !== sessionId
      || current.revision !== expectedRevision || !sequence(expectedRevision)) throw invalid()
  if (response.schema_version !== undefined && response.schema_version !== COMPACT_SCHEMA) throw invalid()
  if (response.schema_version === undefined) {
    // An older server may ignore the opt-in query. Never retry an already committed command.
    if (response.record_id !== sessionId || !isObject(response.payload)
        || (response.workspace_id != null && response.workspace_id !== workspace)
        || response.payload.dataset_id !== current.payload.dataset_id
        || response.payload.branch_id !== current.payload.branch_id
        || (current.dataset_sha256 != null && response.dataset_sha256 !== current.dataset_sha256)
        || !sequence(response.revision) || response.revision <= expectedRevision
        || response.revision > expectedRevision + (current.payload.execution ? 1 : 2)
        || cursorOf(response) !== cursorOf(current)) throw invalid()
    const previous = current.payload.execution?.ledger || []
    const ledger = response.payload.execution?.ledger
    return { replay: response, appendedEvents: Array.isArray(ledger) ? ledger.slice(previous.length) : [], compact: false }
  }
  if (!canUseReplayMutationView(current)) throw invalid()
  const base = executionBase(current), patch = response.payload_patch, head = patch?.execution
  if (response.workspace_id !== workspace || response.record_id !== sessionId
      || response.dataset_id !== current.payload.dataset_id || response.dataset_sha256 !== current.dataset_sha256
      || response.branch_id !== current.payload.branch_id || response.base_revision !== expectedRevision
      || response.base_event_sequence !== base.sequence || !sequence(response.revision)
      || response.revision <= expectedRevision || response.revision > expectedRevision + (current.payload.execution ? 1 : 2)
      || !sequence(response.execution_event_sequence) || !Array.isArray(response.appended_events)
      || response.appended_events.length > MAX_APPENDED_EVENTS
      || response.execution_event_sequence !== base.sequence + response.appended_events.length
      || !isObject(patch) || !isObject(head) || Object.hasOwn(head, 'ledger')
      || Object.keys(patch).some(key => !['execution', 'cursor_index', 'status', 'timing'].includes(key))
      || !['cursor_index', 'status', 'timing'].every(key => Object.hasOwn(patch, key))
      || head.event_sequence !== response.execution_event_sequence
      || response.cursor_index !== cursorOf(current) || patch.cursor_index !== cursorOf(current)
      || response.view_cursor_index !== cursorOf(current) || response.canonical_cursor_index !== cursorOf(current)
      || response.cutoff_timestamp !== current.cutoff_timestamp || response.historical_view !== false
      || typeof response.has_future_rows !== 'boolean' || response.has_future_rows !== current.has_future_rows
      || response.execution_view_status !== 'current' || typeof response.updated_at_utc !== 'string'
      || IDENTITY_FIELDS.some(key => (response[key] ?? null) !== (current[key] ?? current.payload[key] ?? null))) throw invalid()
  assertEventScope(head, current)
  for (let index = 0; index < response.appended_events.length; index += 1) {
    const event = response.appended_events[index]
    if (event?.sequence !== base.sequence + index + 1) throw invalid()
    assertEventScope(event, current)
  }
  const execution = { ...head, ledger: base.ledger.concat(response.appended_events) }
  // Stable configuration references keep a protection-only edit from rebuilding chart/datafeed state.
  for (const key of ['instrument_spec', 'cost_model']) {
    const previous = current.payload.execution?.[key]
    if (previous !== undefined && sameValue(previous, execution[key])) execution[key] = previous
  }
  const replay = { ...current, revision: response.revision, updated_at_utc: response.updated_at_utc,
    execution_view_status: response.execution_view_status,
    payload: { ...current.payload, ...patch, execution } }
  return { replay, appendedEvents: response.appended_events, compact: true }
}
