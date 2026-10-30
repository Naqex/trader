import { useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import FxSelect from './FxSelect.jsx'
import { fetchLiveRecords, saveLiveRecord } from './liveLedgerApi.js'
import useAutosave, { AutosaveBoundaryContext, AutosaveStatus, useAutosaveBoundary } from './useAutosave.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { mt5AccountName } from './liveAccountModel.js'

function NoteFields({ workspace, record, seed, folderId, accountId, accounts, connections, strategies, onSaved }) {
  const { t } = useTestingLocale()
  const [tagsText,setTagsText] = useState(null)
  const key = useRef(record?.record_id || `new:${folderId || 'all'}`).current
  const notified = useRef(onSaved); notified.current = onSaved
  const initial = { title:'', note:'', tags:[], account_id:accountId?.startsWith('broker:') ? null : accountId || null, connection_id:accountId?.startsWith('broker:') ? accountId.slice(7) : null, playbook_id:null, playbook_revision:null, ...(record?.payload || seed || {}) }
  const save = useAutosave({ identity:JSON.stringify(['live-note',workspace,key]), initialValue:initial, adapter:{
    validate: value => !value.title.trim() || !value.note.trim() ? 'Điền tiêu đề và nội dung để tự động lưu ghi chú.' : null,
    async load(recoveryRecord) {
      const target = record || recoveryRecord
      if (!target) return {value:initial,record:null,savedAt:null}
      const latest = (await fetchLiveRecords(workspace)).find(item=>item.record_id === target.record_id && item.kind === 'note')
      if (!latest) throw new Error('Không tìm thấy ghi chú đã lưu.')
      return {value:{...initial,...latest.payload},record:latest,savedAt:latest.updated_at_utc}
    },
    async save(value,current) {
      const result = await saveLiveRecord(workspace,'note',value,current,folderId)
      if (!Number.isFinite(Date.parse(result.updated_at_utc)) || current && (result.record_id !== current.record_id || result.revision <= current.revision) || result.payload.note !== value.note || result.payload.title !== value.title.trim()) throw Object.assign(new Error('Chưa xác nhận nội dung đã lưu.'),{outcomeKnown:false})
      notified.current(result,false)
      return {value:{...value,...result.payload},record:result,savedAt:result.updated_at_utc}
    },
  } })
  const draft=save.value, disabled=!save.ready || save.phase === 'conflict'
  const change=(field,value)=>save.change({...draft,[field]:value})
  const selectedAccount=draft.connection_id ? `broker:${draft.connection_id}` : draft.account_id || ''
  return <div className="live-record-form" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))void save.flush()}}>
    <div className="live-record-grid">
      <label>{t('Account')}<FxSelect className="is-field" label="Account" localizeOptions={false} disabled={disabled} value={selectedAccount} onChange={value=>save.change({...draft,account_id:value.startsWith('broker:') ? null : value || null,connection_id:value.startsWith('broker:') ? value.slice(7) : null})} options={[{value:'',label:t('Ghi chú chung'),localize:false},...accounts.map(item=>({value:item.record_id,label:item.payload.name,localize:false})),...connections.map(item=>({value:`broker:${item.id}`,label:mt5AccountName(item),localize:false}))]}/></label>
      <label>{t('Strategy')}<FxSelect className="is-field" label="Strategy" localizeOptions={false} disabled={disabled} value={draft.playbook_id ? `${draft.playbook_id}:${draft.playbook_revision}` : ''} onChange={value=>{const [id,revision]=value.split(':');save.change({...draft,playbook_id:id || null,playbook_revision:id ? Number(revision) : null})}} options={[{value:'',label:t('Không gắn chiến lược'),localize:false},...strategies.map(item=>({value:`${item.record_id}:${item.revision}`,label:`${item.payload.name} · v${item.revision}`,localize:false}))]}/></label>
    </div>
    <label>{t('Tiêu đề')}<input value={draft.title} maxLength={160} disabled={disabled} onChange={event=>change('title',event.target.value)} onBlur={()=>void save.flush()}/></label>
    <label>{t('Nhãn')}<input value={tagsText ?? draft.tags.join(', ')} maxLength={2000} disabled={disabled} onChange={event=>{setTagsText(event.target.value);change('tags',[...new Set(event.target.value.split(',').map(value=>value.trim()).filter(Boolean))])}} onBlur={()=>{setTagsText(null);void save.flush()}}/></label>
    <label>{t('Ghi chú')}<textarea value={draft.note} rows={12} maxLength={10000} disabled={disabled} onChange={event=>change('note',event.target.value)} onBlur={()=>void save.flush()}/></label>
    <AutosaveStatus save={save}/>
  </div>
}

export default function LiveNoteEditor({ onClose, ...props }) {
  const {t}=useTestingLocale(), {boundary,requestClose}=useAutosaveBoundary(onClose)
  return <AutosaveBoundaryContext.Provider value={boundary}><LegacyModal overlayClassName="is-drawer-overlay" className="live-record-dialog is-drawer" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={t(props.record ? 'Chỉnh sửa ghi chú' : 'Note')} onClose={()=>void requestClose()}>
    <NoteFields {...props}/>
  </LegacyModal></AutosaveBoundaryContext.Provider>
}
