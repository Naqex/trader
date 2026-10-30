import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { documentError, emptyNote, readNoteValue } from './noteDocument.js'
import same from 'fast-deep-equal'

function checked(record, session, trade, structured) {
  const source = record?.payload?.source
  if (!record?.record_id || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.deleted || typeof record.payload?.note !== 'string'
    || !source || (source.session_id !== session && source.replay_session_id !== session) || (source.trade_id || source.id) !== trade
    || !Number.isFinite(Date.parse(record.updated_at_utc))) throw new Error('Dữ liệu ghi chú không hợp lệ.')
  return { value: structured ? readNoteValue(record.payload) : record.payload.note, record, savedAt: record.updated_at_utc }
}

export function tradeNoteAdapter({ workspace, session, trade, structured = false }) {
  const sourceId = JSON.stringify([session, trade])
  const normalize = value => typeof value === 'string' ? {text:value,document:null} : value
  const adapter = {
    migrateRecovery(recovery) {
      if (!structured) return recovery
      return {...recovery,value:normalize(recovery.value),base:normalize(recovery.base),attempt:recovery.attempt ? {...recovery.attempt,value:normalize(recovery.attempt.value),legacyPlain:typeof recovery.attempt.value === 'string' || recovery.attempt.legacyPlain} : null}
    },
    validate: value => {
      const text = structured ? value?.text : value
      return typeof text !== 'string' || !text.trim() ? 'Ghi chú trống chưa được lưu. Bản đã lưu vẫn được giữ.' : text.length > 10000 ? 'Ghi chú tối đa 10.000 ký tự.' : structured ? documentError(value.document) : null
    },
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
      return record ? checked(record, session, trade, structured) : { value: structured ? emptyNote() : '', record: null, savedAt: null }
    },
    async save(value, record, attempt) {
      const note = structured ? value.text : value
      const payload = record ? { ...record.payload, note } : { entry_type: 'observation', note, tags: [], source: { kind: 'trade-note', id: sourceId, session_id: session, trade_id: trade } }
      // A retained pre-editor request must keep its original body on retry.
      if (structured && !attempt?.legacyPlain) payload.note_document = value.document
      const path = record ? `/api/v2/journal/${encodeURIComponent(record.record_id)}/revisions` : '/api/v2/journal'
      const response = await scopedMutation(path, workspace, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record ? { expected_revision: record.revision, payload } : payload) })
      let result
      try { result = await readJson(response) } catch (error) { if (response.status >= 500 || response.ok) error.outcomeKnown = false; throw error }
      try {
        const confirmed = checked(result, session, trade, structured)
        const expected = structured ? {text:value.text,document:value.document} : value
        if (!same(confirmed.value,expected) || record && (result.record_id !== record.record_id || result.revision <= record.revision)) throw new Error('invalid_note_receipt')
        return confirmed
      } catch (cause) { throw Object.assign(new Error('Chưa xác nhận được nội dung đã lưu.', { cause }), { outcomeKnown: false }) }
    },
    async reconcile(attempt) {
      const remote = await adapter.load()
      const expected = structured ? {text:attempt.value.text,document:attempt.value.document} : attempt.value
      if (same(remote.value,expected) && remote.record && (!attempt.record || remote.record.record_id === attempt.record.record_id && remote.record.revision > attempt.record.revision)) return remote
      return null
    },
  }
  return adapter
}
