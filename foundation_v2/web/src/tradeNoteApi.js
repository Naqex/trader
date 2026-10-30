import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'

function checked(record, session, trade) {
  const source = record?.payload?.source
  if (!record?.record_id || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.deleted || typeof record.payload?.note !== 'string'
    || !source || (source.session_id !== session && source.replay_session_id !== session) || (source.trade_id || source.id) !== trade
    || !Number.isFinite(Date.parse(record.updated_at_utc))) throw new Error('Dữ liệu ghi chú không hợp lệ.')
  return { value: record.payload.note, record, savedAt: record.updated_at_utc }
}

export function tradeNoteAdapter({ workspace, session, trade }) {
  const sourceId = JSON.stringify([session, trade])
  const adapter = {
    validate: value => typeof value !== 'string' || !value.trim() ? 'Ghi chú trống chưa được lưu. Bản đã lưu vẫn được giữ.' : value.length > 10000 ? 'Ghi chú tối đa 10.000 ký tự.' : null,
    async load() {
      const payload = await readJson(await scopedRead('/api/v2/journal', workspace))
      if (!Array.isArray(payload.items)) throw new Error('Không đọc được danh sách ghi chú.')
      const matches = payload.items.filter(record => {
        const source = record.payload?.source
        return !record.deleted && source && (source.session_id === session || source.replay_session_id === session) && (source.trade_id || source.id) === trade
      })
      const owned = matches.filter(record => record.payload.source.kind === 'trade-note' && record.payload.source.id === sourceId)
      if (owned.length > 1 || !owned.length && matches.length > 1) throw new Error('Giao dịch có nhiều ghi chú. Chưa xác định được bản cần chỉnh sửa.')
      const record = owned[0] || matches[0]
      return record ? checked(record, session, trade) : { value: '', record: null, savedAt: null }
    },
    async save(note, record) {
      const payload = record ? { ...record.payload, note } : { entry_type: 'observation', note, tags: [], source: { kind: 'trade-note', id: sourceId, session_id: session, trade_id: trade } }
      const path = record ? `/api/v2/journal/${encodeURIComponent(record.record_id)}/revisions` : '/api/v2/journal'
      const response = await scopedMutation(path, workspace, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record ? { expected_revision: record.revision, payload } : payload) })
      let result
      try { result = await readJson(response) } catch (error) { if (response.status >= 500 || response.ok) error.outcomeKnown = false; throw error }
      try {
        const confirmed = checked(result, session, trade)
        if (confirmed.value !== note || record && (result.record_id !== record.record_id || result.revision <= record.revision)) throw new Error('invalid_note_receipt')
        return confirmed
      } catch (cause) { throw Object.assign(new Error('Chưa xác nhận được nội dung đã lưu.', { cause }), { outcomeKnown: false }) }
    },
    async reconcile(attempt) {
      const remote = await adapter.load()
      if (remote.value === attempt.value && remote.record && (!attempt.record || remote.record.record_id === attempt.record.record_id && remote.record.revision > attempt.record.revision)) return remote
      return null
    },
  }
  return adapter
}
