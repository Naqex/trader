import { matchesSearch } from './searchText.js'
import { retryAfterMs } from './researchDataApi.js'
import { scopedMutation } from './scopedMutation.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { scopedRead } from './scopedRead.js'

export function readLastSession(workspace) {
  try { return window.localStorage.getItem(`tw:replay:last:${workspace}`) || '' } catch { return '' }
}

export function rememberSession(workspace, id) {
  try {
    if (id) window.localStorage.setItem(`tw:replay:last:${workspace}`, id)
    else window.localStorage.removeItem(`tw:replay:last:${workspace}`)
  } catch { /* URL navigation still works when storage is unavailable. */ }
}

export function defaultSession(items, explicit = '', remembered = '') {
  if (explicit) return explicit
  const active = items.filter(item => !item.archived)
  if (active.some(item => item.record_id === remembered)) return remembered
  return [...active].sort((a, b) => (Date.parse(b.created_at_utc) || 0) - (Date.parse(a.created_at_utc) || 0)
    || (Date.parse(b.updated_at_utc) || 0) - (Date.parse(a.updated_at_utc) || 0)
    || a.record_id.localeCompare(b.record_id))[0]?.record_id || ''
}

export function reportSessions(query) {
  if (query.has('sessions')) {
    const ids = query.getAll('sessions')
    return ids.includes('all') ? null : ids.includes('none') ? [] : [...new Set(ids)]
  }
  const explicit = query.get('session') || query.get('replay_session')
  return explicit ? [explicit] : null
}

export function canResumeSession(item) {
  return Boolean(item && !item.archived && item.dataset_available === true)
}

export function recentSessions(items, { search = '', archived = false, sort = 'newest' } = {}) {
  const needle = search.trim().toLocaleLowerCase('vi')
  const timestamp = item => Number.isFinite(Date.parse(item.updated_at_utc)) ? Date.parse(item.updated_at_utc) : 0
  return items.filter(item => (archived || !item.archived) && (!needle || matchesSearch(`${item.name || item.record_id} ${item.instrument_id || ''} ${item.timeframe || ''}`, search)))
    .sort((left, right) => (sort === 'oldest' ? 1 : -1) * (timestamp(left) - timestamp(right)) || left.record_id.localeCompare(right.record_id))
}

export function normalizeSessionCatalog(payload) {
  if (!Array.isArray(payload?.items) || payload.items.some((item) => !item || typeof item.record_id !== 'string' || !item.record_id || !Number.isInteger(item.revision) || item.revision < 1)) {
    throw new Error('Danh mục phiên không đúng định dạng.')
  }
  return payload.items
}

async function request(path, workspace, options = {}) {
  const response = !options.method || options.method === 'GET'
    ? await scopedRead(path, workspace, options.signal)
    : await scopedMutation(path, workspace, { ...options, headers: { 'X-Workspace-Id': workspace, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(typeof payload?.detail === 'string' ? payload.detail : `HTTP ${response.status}`)
    error.status = response.status
    error.retryAfterMs = retryAfterMs(response)
    throw error
  }
  if (!payload || typeof payload !== 'object') throw new Error('Phản hồi phiên không đúng định dạng.')
  return payload
}

export async function fetchReplaySessions(workspace, signal) {
  return normalizeSessionCatalog(await request('/api/v2/replay/sessions', workspace, { signal }))
}

export function createReplaySession(workspace, configuration) {
  return request('/api/v2/replay/sessions', workspace, { method: 'POST', body: JSON.stringify(configuration) })
}

export function updateSessionMetadata(workspace, session, changes) {
  return request(`/api/v2/replay/sessions/${encodeURIComponent(session.record_id)}`, workspace, {
    method: 'PATCH', body: JSON.stringify({ ...changes, expected_revision: session.revision }),
  })
}

export function cleanSessionConfiguration(record) {
  const source = record?.payload
  if (!source || typeof source.dataset_id !== 'string' || !source.dataset_id) throw Object.assign(new Error('Không đọc được cấu hình tài sản của phiên.'), { status: 422 })
  const executions = source.asset_states ? Object.values(source.asset_states).map(asset => asset.execution) : [source.execution]
  if (!source.trading_options && executions.some(execution => execution && (execution.ledger || execution.cost_model || execution.spread_price != null))) {
    throw Object.assign(new Error('Phiên cũ chưa lưu cấu hình chi phí để tạo bản sao trống. Tạo phiên mới để chọn lại chi phí, hoặc giữ dữ liệu giao dịch.'), { status: 422 })
  }
  const configuration = { dataset_id: source.dataset_id, name: `${source.name || 'Phiên'} (bản sao)`.slice(0, 160) }
  // Only creation settings cross into a fresh session; execution, timing and Prop authority do not.
  for (const key of ['dataset_ids', 'description', 'starting_balance', 'playbook_id', 'playbook_revision', 'trading_options']) {
    if (source[key] !== undefined && source[key] !== null) configuration[key] = source[key]
  }
  if (configuration.starting_balance == null && source.execution?.starting_balance != null) configuration.starting_balance = source.execution.starting_balance
  const period = record.session_period || source.session_period
  if (period) {
    const start = period.requested_start_timestamp ?? period.start_timestamp
    const end = period.requested_end_timestamp ?? period.end_timestamp
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Object.assign(new Error('Không đọc được khoảng thời gian của phiên.'), { status: 422 })
    configuration.start_timestamp = start
    configuration.end_timestamp = end
  }
  return configuration
}

export async function duplicateSession(workspace, session, { history = 'clean' } = {}) {
  if (history === 'keep') {
    if (session.session_kind === 'prop' || session.prop_attempt_id) throw Object.assign(new Error('Chưa hỗ trợ giữ lịch sử khi sao chép phiên Prop Firm. Chọn bản sao Backtest không có giao dịch.'), { status: 422 })
    return request(`/api/v2/replay/sessions/${encodeURIComponent(session.record_id)}/branch`, workspace, {
      method: 'POST', body: JSON.stringify({ expected_revision: session.revision, cursor_index: session.cursor_index }),
    })
  }
  if (history !== 'clean') throw Object.assign(new Error('Lựa chọn sao chép không hợp lệ.'), { status: 422 })
  const record = await request(`/api/v2/replay/sessions/${encodeURIComponent(session.record_id)}`, workspace)
  if (record.record_id !== session.record_id || record.revision !== session.revision) throw Object.assign(new Error('Phiên đã thay đổi; tải lại danh mục trước khi tạo bản sao.'), { status: 409 })
  return createReplaySession(workspace, cleanSessionConfiguration(record))
}

export async function deleteSession(workspace, session, confirmationName) {
  const result = await request(`/api/v2/replay/sessions/${encodeURIComponent(session.record_id)}/delete`, workspace, {
    method: 'POST', body: JSON.stringify({ expected_revision: session.revision, confirmation_name: confirmationName }),
  })
  if (result.deleted !== true || result.record_id !== session.record_id || result.revision !== session.revision + 1) throw new Error('Phản hồi xóa phiên không đúng định dạng.')
  return result
}

export function sessionMutationError(error) {
  if (error.message === 'replay_linked_to_prop_attempt') return 'Không thể xóa phiên đang được dùng trong Prop Firm. Báo cáo và lịch sử challenge vẫn được giữ.'
  if (error.message === 'session_delete_confirmation_mismatch') return 'Tên xác nhận không khớp tên phiên hiện tại.'
  return 'Không lưu được thao tác: ' + error.message
}

export function sessionNavigationHref(kind, workspace, query, item, overrides = {}) {
  return buildWorkspaceHref(kind, workspace, query, {
    select: '1', session: item?.record_id || null, dataset: item?.dataset_id || null,
    prop_session: item?.prop_session_id || null, prop_attempt: item?.prop_attempt_id || null,
    ...(kind === 'analytics' && item?.session_kind === 'prop' ? { analytics_source: 'prop', attempt: item.prop_attempt_id } : {}),
    cursor: null, cutoff: null, playbook: null, playbook_revision: null, mode: 'Practice', ...overrides,
  })
}

export function sessionAnalyticsQuery(query, item, { summary = false } = {}) {
  const next = new URLSearchParams(query)
  const sameSession = (next.get('session') || next.get('replay_session')) === item.record_id
  for (const key of ['job', 'job_id', 'replay_session']) next.delete(key)
  // Keep explicit same-session drilldown context while switching sessions starts a new scope.
  if (!sameSession || summary) for (const key of ['trade', 'trade_id', 'cursor', 'cutoff', 'cursor_index', 'decision_cutoff', 'event_sequence']) next.delete(key)
  if (summary) for (const key of ['side', 'outcome', 'from', 'to', 'from_close_utc', 'to_close_utc']) next.delete(key)
  next.set('session', item.record_id)
  if (item.dataset_id) next.set('dataset', item.dataset_id)
  else next.delete('dataset')
  return next
}
