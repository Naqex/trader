import { scopedMutation } from './scopedMutation.js'

export async function fetchLiveRecords(workspace, signal) {
  let response
  try { response = await fetch('/api/v2/live/records', { headers: { 'X-Workspace-Id': workspace }, signal }) }
  catch (cause) { if (signal?.aborted) throw cause; throw new Error('Mất kết nối với sổ giao dịch. Thử lại sau.',{cause}) }
  if (!response.ok) { const error = new Error(response.status === 403 ? 'Không có quyền đọc sổ giao dịch.' : 'Không đọc được sổ giao dịch. Thử lại sau.'); error.status = response.status; throw error }
  const data = await response.json()
  if (data.version !== 'live-records-v1' || !Array.isArray(data.items)) throw new Error('Dữ liệu sổ giao dịch không hợp lệ.')
  return data.items
}

export async function saveLiveRecord(workspace, kind, payload, record) {
  const path = record ? `/api/v2/live/records/${encodeURIComponent(record.record_id)}/revisions` : '/api/v2/live/records'
  const response = await scopedMutation(path, workspace, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, payload, ...(record ? { expected_revision: record.revision } : {}) }) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(response.status === 409 ? 'Bản ghi đã thay đổi. Đóng form và tải lại trước khi sửa.' : `Không lưu được. Kiểm tra dữ liệu (${body.detail || response.status}).`)
    error.status = response.status
    if (response.status >= 500) error.outcomeKnown = false
    throw error
  }
  try {
    const record = await response.json()
    if (!record?.record_id || record.kind !== kind || !Number.isInteger(record.revision) || !record.payload) throw new Error('Invalid live record')
    return record
  } catch (cause) { const error = new Error('Chưa xác nhận kết quả lưu.',{cause}); error.outcomeKnown = false; throw error }
}
