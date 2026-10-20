import { scopedMutation } from './scopedMutation.js'
/**
 * Playbook catalog and manual draft helpers.
 *
 * The Playbook backend owns revisions and lineage.
 * Quick session creation can add a needs-definition draft. Manual editing,
 * freeze and fork preserve backend revision authority; execution is separate.
 */

function requestHeaders(workspace) {
  return { 'X-Workspace-Id': workspace }
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(payload.detail || `HTTP ${response.status}`))
    error.status = response.status
    throw error
  }
  return payload
}

export async function fetchPlaybooks(workspace, signal) {
  const response = await fetch('/api/v2/playbooks', {
    headers: requestHeaders(workspace),
    signal,
  })
  const payload = await readJson(response)
  if (!Array.isArray(payload?.items)) throw new Error('Dữ liệu chiến lược không hợp lệ. Tải lại để kiểm tra.')
  return payload.items
}

export async function createPlaybookDraft(workspace, name, payload = {}) {
  return readJson(await scopedMutation('/api/v2/playbooks', workspace, {
    method: 'POST', headers: { ...requestHeaders(workspace), 'Content-Type': 'application/json' },
    body: JSON.stringify({ execution_capability: 'needs-definition', rules: {}, ...payload, name, status: 'draft' }),
  }))
}

async function playbookCommand(workspace, record, action, body = {}) {
  return readJson(await scopedMutation(`/api/v2/playbooks/${encodeURIComponent(record.record_id)}/${action}`, workspace, {
    method: 'POST', headers: { ...requestHeaders(workspace), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, expected_revision: record.revision }),
  }))
}

export const revisePlaybook = (workspace, record, payload) => playbookCommand(workspace, record, 'revisions', { payload })
export const freezePlaybook = (workspace, record) => playbookCommand(workspace, record, 'freeze')
export const forkPlaybook = (workspace, record, name) => playbookCommand(workspace, record, 'fork', { name })

export const MANUAL_STRATEGY_FIELDS = Object.freeze([
  ['context', 'Bối cảnh thị trường'], ['entry', 'Điều kiện vào lệnh'],
  ['exit', 'Điều kiện thoát lệnh'], ['risk', 'Quản trị rủi ro'], ['notes', 'Ghi chú'],
])

export function manualStrategyForm(record) {
  const payload = record?.payload || {}, notes = payload.rules?.manual_notes || {}
  return Object.fromEntries([['name', String(payload.name || '')], ...MANUAL_STRATEGY_FIELDS.map(([key]) => [key, typeof notes[key] === 'string' ? notes[key] : ''])])
}

export function manualStrategyPayload(record, form) {
  const name = String(form.name || '').trim()
  if (!name || name.length > 160) throw new Error('Tên chiến lược cần từ 1 đến 160 ký tự.')
  const notes = { ...record?.payload?.rules?.manual_notes }
  for (const [key] of MANUAL_STRATEGY_FIELDS) {
    const value = String(form[key] || '').trim()
    if (value.length > 4000) throw new Error('Mỗi nội dung chiến lược tối đa 4.000 ký tự.')
    notes[key] = value
  }
  return { ...record?.payload, name, status: 'draft',
    execution_capability: record?.payload?.execution_capability || 'manual-only',
    rules: { ...record?.payload?.rules, manual_notes: notes } }
}

export async function fetchPlaybookRevisions(workspace, playbookId, signal) {
  if (!playbookId) return []
  const response = await fetch(`/api/v2/playbooks/${encodeURIComponent(playbookId)}/revisions`, {
    headers: requestHeaders(workspace),
    signal,
  })
  const payload = await readJson(response)
  if (!Array.isArray(payload?.items)) throw new Error('Dữ liệu chiến lược không hợp lệ. Tải lại để kiểm tra.')
  return payload.items
}

export async function resolvePlaybookSelection(workspace, items, id, revision, signal) {
  if (!id) return null
  const current = items.find(item => item.record_id === id)
  if (!current) throw new Error('Chiến lược trong liên kết không còn khả dụng.')
  if (revision === null || revision === undefined || revision === '') return current
  const version = Number(revision)
  if (!Number.isInteger(version) || version < 1) throw new Error('Phiên bản chiến lược không hợp lệ.')
  if (current.revision === version) return current
  const history = await fetchPlaybookRevisions(workspace, id, signal)
  const exact = history.find(item => item.revision === version && item.payload)
  if (!exact) throw new Error('Không tìm thấy phiên bản chiến lược đã chọn. Chọn lại hoặc bỏ chọn chiến lược.')
  return { ...current, ...exact, record_id: id, updated_at_utc: exact.created_at_utc }
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]))
}

export function stableStringify(value) {
  return JSON.stringify(sortedObject(value))
}

function leafPaths(value, prefix = '') {
  if (!isObject(value) || (Array.isArray(value) && value.length === 0)) return [prefix || '$']
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child])
    : Object.entries(value)
  if (entries.length === 0) return [prefix || '$']
  return entries.flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key))
}

function valueAtPath(value, path) {
  if (path === '$') return value
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), value)
}

function displayValue(value) {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  return stableStringify(value)
}

/**
 * Return a small deterministic leaf-level diff for the human review surface.
 * Values remain structured in the returned object; the UI decides how much
 * to display, keeping raw payload JSON out of the normal workflow.
 */
export function diffPayloads(leftPayload = {}, rightPayload = {}) {
  const paths = [...new Set([...leafPaths(leftPayload), ...leafPaths(rightPayload)])].sort()
  return paths
    .map((path) => {
      const left = valueAtPath(leftPayload, path)
      const right = valueAtPath(rightPayload, path)
      return {
        path,
        left,
        right,
        leftDisplay: displayValue(left),
        rightDisplay: displayValue(right),
        changed: stableStringify(left) !== stableStringify(right),
      }
    })
    .filter((item) => item.changed)
}

