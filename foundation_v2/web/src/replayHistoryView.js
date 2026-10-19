import { validRow, validBaseWindow, sameValue } from './replayStepView.js'

const SCHEMA = 'replay-history-v1'
const integer = value => Number.isSafeInteger(value) && value >= 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const cursorOf = value => value?.view_cursor_index ?? value?.payload?.cursor_index
const escape = key => key.replaceAll('~', '~0').replaceAll('/', '~1')

function invalid() {
  return Object.assign(new Error('Dữ liệu lịch sử không khớp phiên. Hãy nạp lại phiên.'), { code: 'replay_history_invalid' })
}
function snapshots(payload) {
  const result = [['/execution', payload?.execution], ['/portfolio_execution', payload?.portfolio_execution]]
  for (const [id, asset] of Object.entries(payload?.asset_states || {})) result.push([`/asset_states/${escape(id)}/execution`, asset.execution])
  return result.filter(([, head]) => head != null)
}
export function historyEventSequences(replay) {
  return Object.fromEntries(snapshots(replay.payload).map(([path, head]) => [path, head.event_sequence]))
}
export function canUseReplayHistoryView(replay) {
  return replay?.history_view_version === SCHEMA && replay.historical_view === true
    && ['checkpoint', 'not_initialized'].includes(replay.execution_view_status) && validBaseWindow(replay)
    && integer(replay.revision) && object(replay.payload)
    && snapshots(replay.payload).every(([, head]) => object(head) && integer(head.event_sequence)
      && Array.isArray(head.ledger) && head.ledger.length === head.event_sequence)
}

export function mergeReplayHistoryView(current, response, { workspace, sessionId }) {
  if (!canUseReplayHistoryView(current) || !object(response) || response.record_id !== sessionId
      || current.record_id !== sessionId || response.revision !== current.revision
      || response.dataset_sha256 !== current.dataset_sha256 || !object(response.payload)
      || response.payload.dataset_id !== current.payload.dataset_id || response.payload.branch_id !== current.payload.branch_id
      || response.canonical_cursor_index !== current.canonical_cursor_index
      || ['session_kind', 'prop_session_id', 'prop_attempt_id'].some(key => (response[key] ?? response.payload[key] ?? null) !== (current[key] ?? current.payload[key] ?? null))) throw invalid()
  const base = cursorOf(current), cursor = cursorOf(response)
  // Uninitialized single-asset views retain the stored cursor in payload; the
  // selected chart cutoff lives in view_cursor_index in the full API as well.
  const payloadCursor = response.payload.execution == null && !response.payload.asset_states
    ? current.canonical_cursor_index : cursor
  if (!integer(cursor) || cursor <= base || cursor > current.canonical_cursor_index
      || response.payload.cursor_index !== payloadCursor || response.total_row_count !== current.total_row_count
      || response.historical_view !== (cursor < current.canonical_cursor_index)
      || !integer(response.cutoff_timestamp) || response.cutoff_timestamp <= current.cutoff_timestamp
      || response.visible_row_start !== Math.max(0, cursor - 1999)
      || response.visible_row_count !== cursor - response.visible_row_start + 1) throw invalid()
  if (response.schema_version === undefined) {
    if (!validBaseWindow(response)) throw invalid()
    return response
  }
  if (response.schema_version !== SCHEMA || response.workspace_id !== workspace
      || response.base_revision !== current.revision || response.base_cursor_index !== base
      || response.base_cutoff_timestamp !== current.cutoff_timestamp || cursor - base > 1000
      || !Array.isArray(response.appended_rows) || response.appended_rows.length !== cursor - base
      || !Array.isArray(response.ledger_deltas)) throw invalid()
  let timestamp = current.cutoff_timestamp
  for (const row of response.appended_rows) {
    if (!validRow(row) || row.timestamp <= timestamp) throw invalid()
    timestamp = row.timestamp
  }
  if (timestamp !== response.cutoff_timestamp) throw invalid()
  const old = new Map(snapshots(current.payload)), heads = snapshots(response.payload)
  if (heads.length !== old.size || response.ledger_deltas.length !== heads.length) throw invalid()
  const deltas = new Map(response.ledger_deltas.map(delta => [delta.path, delta]))
  if (deltas.size !== heads.length) throw invalid()
  const payload = structuredClone(response.payload)
  const mergedHeads = new Map(snapshots(payload))
  for (const [path, head] of heads) {
    const before = old.get(path), delta = deltas.get(path)
    if (!object(before) || !object(head) || !delta || Object.hasOwn(head, 'ledger')
        || delta.base_event_sequence !== before.event_sequence || !Array.isArray(delta.appended_events)
        || delta.appended_events.length > 3000 || head.event_sequence !== before.event_sequence + delta.appended_events.length
        || !integer(head.cursor_index) || head.cursor_index < before.cursor_index
        || ['schema_version', 'replay_session_id', 'branch_id', 'dataset_id', 'dataset_sha256', 'instrument_spec', 'cost_model', 'timeframe_seconds', 'starting_balance', 'dataset_pins'].some(key => !sameValue(head[key], before[key]))) throw invalid()
    const events = delta.appended_events
    let previousTime = before.ledger.at(-1)?.virtual_time_utc ?? 0
    let previousCursor = before.ledger.at(-1)?.cursor_index ?? 0
    const frame = current.payload.execution?.timeframe_seconds
    const visibleClock = response.payload.replay_clock_utc ?? (integer(frame) && frame > 0 ? timestamp + frame : null)
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      if (!object(event) || event.sequence !== before.event_sequence + index + 1
          || ['replay_session_id', 'branch_id', 'dataset_id', 'dataset_sha256'].some(key => event[key] !== head[key])
          || !integer(event.cursor_index) || event.cursor_index < previousCursor || event.cursor_index > head.cursor_index
          || !integer(event.virtual_time_utc) || event.virtual_time_utc < previousTime
          || !integer(visibleClock) || event.virtual_time_utc > visibleClock) throw invalid()
      previousTime = event.virtual_time_utc
      previousCursor = event.cursor_index
    }
    mergedHeads.get(path).ledger = before.ledger.concat(events)
  }
  const replay = { ...response, payload, visible_rows: current.visible_rows.concat(response.appended_rows).slice(-2000) }
  for (const key of ['schema_version', 'workspace_id', 'base_revision', 'base_cursor_index', 'base_cutoff_timestamp', 'ledger_deltas', 'appended_rows']) delete replay[key]
  if (!validBaseWindow(replay)) throw invalid()
  return replay
}
