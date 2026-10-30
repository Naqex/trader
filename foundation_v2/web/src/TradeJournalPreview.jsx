import FxSelect from './FxSelect.jsx'
import ChartIcon from './ChartIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { lazy, Suspense, useRef, useState } from 'react'
import { useNoteTemplateLibrary } from './noteTemplatesApi.js'
import './trade-journal-preview.css'

const NoteTemplatesDialog = lazy(() => import('./NoteTemplatesDialog.jsx'))

function BulkTemplates({ workspace, count, context, onClose }) {
  const library = useNoteTemplateLibrary(workspace)
  return <Suspense fallback={null}><NoteTemplatesDialog workspace={workspace} library={library} context={context} bulkSelectionCount={count} onClose={onClose}/></Suspense>
}

export function TradeJournalToolbar({sourceKind,view,onView,checkedCount=0,onAction,inline=false,showBulkActions=false}) {
  const {t}=useTestingLocale()
  return <div className={`wm-trade-journal-toolbar${inline?' is-inline':''}`} role="group" aria-label={t('Công cụ nhật ký giao dịch')}>
    <div><FxSelect label={t('Nguồn giao dịch')} value="source" onChange={()=>{}} options={[{value:'source',label:sourceKind==='broker'?t('Dữ liệu broker'):sourceKind==='manual'?t('Giao dịch thủ công'):t('Kết quả luyện tập')},{value:'journal',label:t('Nhật ký'),disabled:true,detail:t('Nguồn này chưa bật.')},{value:'research',label:t('Bản nghiên cứu'),disabled:true,detail:t('Nguồn này chưa bật.')}]}/>
    <FxSelect label={t('Phạm vi nhật ký')} value={view} onChange={onView} options={[{value:'active',label:t('Đang dùng')},{value:'deleted',label:t('Đã xóa')},{value:'all',label:t('Tất cả')}]}/></div>
    {showBulkActions && checkedCount>0 && <div className="wm-trade-journal-bulk"><span>{t('{count} giao dịch đã chọn',{count:checkedCount})}</span><button type="button" className="fxa-button" onClick={()=>onAction(view==='deleted'?'restore':'delete',checkedCount)}><ChartIcon name={view==='deleted'?'history-restore':'trash'}/>{t(view==='deleted'?'Khôi phục':'Xóa khỏi nhật ký')}</button></div>}
  </div>
}

export function TradeJournalActionDialog({action,count,onClose}) {
  const {t}=useTestingLocale(),restore=action==='restore'
  return <LegacyModal theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={t(restore?'Khôi phục giao dịch':'Xóa khỏi nhật ký')} onClose={onClose} className="wm-trade-journal-dialog">
    <div className="wm-trade-journal-dialog-body"><p>{t(restore?'Khôi phục {count} giao dịch vào nhật ký.':'Xóa {count} giao dịch khỏi nhật ký; giữ lại ghi chú, nhãn và ảnh.',{count})}</p>
    <p>{t('Thao tác này không đóng lệnh hoặc thay đổi tài khoản broker.')}</p>
    <p role="status">{t('Xóa/khôi phục nhật ký chưa được bật.')}</p>
    <footer><button type="button" className="fxa-button" onClick={onClose}>{t('Cancel')}</button><button type="button" className={`fxa-button ${restore?'is-primary':'is-danger'}`} disabled>{t(restore?'Khôi phục':'Xóa khỏi nhật ký')}</button></footer></div>
  </LegacyModal>
}

export function TradeBulkSelectionBar({ count, onClose, onSelectAll, onTags, workspace, context='testing-trades' }) {
  const { t } = useTestingLocale()
  const [templatesOpen,setTemplatesOpen] = useState(false)
  return <><div className="wm-trade-selection-bar" role="region" aria-label={t('{count} giao dịch đã chọn',{count})}>
    <div className="wm-trade-selection-head">
      <button type="button" className="wm-trade-selection-close" aria-label={t('Bỏ chọn')} onClick={onClose}>×</button>
      <strong aria-live="polite">({count}) {t('giao dịch đã chọn')}</strong>
      <button type="button" className="wm-trade-selection-all" data-tooltip={t('Chọn các lệnh trên trang')} onClick={onSelectAll}>{t('Chọn tất cả')}</button>
    </div>
    <div className="wm-trade-selection-actions">
      <button type="button" className="wm-trade-selection-action" disabled={!workspace} onClick={()=>setTemplatesOpen(true)}><ChartIcon name="note-edit"/>{t('Mẫu')}</button>
      <span aria-hidden="true" />
      <button type="button" className="wm-trade-selection-action" disabled>{t('Gộp')}</button>
      {count > 1 && <><span aria-hidden="true" /><button type="button" className="wm-trade-selection-action" onClick={onTags}><ChartIcon name="tag"/>{t('Thêm/xóa nhãn')}</button></>}
      <span aria-hidden="true" />
      <button type="button" className="wm-trade-selection-action is-danger" disabled><ChartIcon name="trash"/>{t('Xoá')}</button>
    </div>
  </div>{templatesOpen && <BulkTemplates workspace={workspace} count={count} context={context} onClose={()=>setTemplatesOpen(false)}/>}</>
}

export function TradeBulkTagsDialog({ count, labels = [], groups = [], onClose }) {
  const { t } = useTestingLocale(), nextId=useRef(1), [rows,setRows] = useState([{id:0,group:'',tags:[]}]),[operation,setOperation]=useState('add')
  const groupOptions=[{value:'ungrouped',label:t('Chưa phân nhóm'),localize:false},...groups.filter(item=>!item.archived).map(item=>({value:item.id,label:item.name,localize:false}))]
  const updateRow=(id,patch)=>setRows(current=>current.map(row=>row.id===id?{...row,...patch}:row))
  const visibleFor=group=>labels.filter(item=>!item.archived && (group==='ungrouped'?!item.group_id:group && item.group_id===group))
  return <LegacyModal theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={t('Thêm/xóa nhãn')} onClose={onClose} className="wm-trade-bulk-tags-dialog">
    <div className="wm-trade-bulk-tags-body"><p className="wm-trade-bulk-tags-count">{t('Áp dụng cho {count} giao dịch',{count})}</p>
      <FxSelect label={t('Thao tác nhãn')} value={operation} onChange={setOperation} options={[{value:'add',label:t('Thêm nhãn')},{value:'remove',label:t('Gỡ nhãn')}]}/>
      <div className="wm-trade-bulk-tags-rows">{rows.map(row=><div className="wm-trade-bulk-tags-row" key={row.id}>
        <label>{t('Tag group')}<FxSelect label="Tag group" value={row.group} onChange={value=>updateRow(row.id,{group:value,tags:[]})} options={groupOptions} triggerContent={!row.group?t('Chọn nhóm nhãn'):undefined} /></label>
        <label>{t('Tags')}<FxSelect label="Tags" multiple searchable disabled={!row.group} value={row.tags} onChange={value=>updateRow(row.id,{tags:value})} options={visibleFor(row.group).map(item=>({value:item.id,label:item.name,localize:false}))} triggerContent={row.tags.length?labels.filter(item=>row.tags.includes(item.id)).map(item=>item.name).join(', '):t('Chọn nhãn')} localizeOptions={false}/></label>
        {rows.length>1 && <button type="button" className="wm-trade-bulk-tags-remove" aria-label={t('Bỏ nhóm nhãn')} onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}><ChartIcon name="trash"/></button>}
      </div>)}</div>
      <button type="button" className="fxa-button wm-trade-bulk-tags-add" onClick={()=>{const id=nextId.current++;setRows(current=>[...current,{id,group:'',tags:[]}])}}><ChartIcon name="order"/>{t('Thêm nhóm nhãn')}</button>
      <p className="wm-trade-bulk-tags-note">{t('Bản xem trước giao diện. Chưa áp dụng thay đổi vào giao dịch.')}</p>
      <footer><button type="button" className="fxa-button" onClick={onClose}>{t('Hủy')}</button><button type="button" className="fxa-button is-primary" disabled>{t('Áp dụng cho {count} giao dịch',{count})}</button></footer>
    </div>
  </LegacyModal>
}
