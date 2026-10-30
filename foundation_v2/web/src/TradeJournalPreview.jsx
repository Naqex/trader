import FxSelect from './FxSelect.jsx'
import ChartIcon from './ChartIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useState } from 'react'
import './trade-journal-preview.css'

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

export function TradeBulkSelectionBar({ count, onClose, onTags }) {
  const { t } = useTestingLocale()
  return <div className="wm-trade-selection-bar" role="dialog" aria-label={t('{count} giao dịch đã chọn',{count})}>
    <button type="button" className="wm-trade-selection-close" aria-label={t('Bỏ chọn')} onClick={onClose}>×</button>
    <strong>{t('({count}) giao dịch đã chọn',{count})}</strong>
    <span className="wm-trade-selection-spacer" />
    <button type="button" className="wm-trade-selection-action" disabled>{t('Mẫu')}</button>
    <button type="button" className="wm-trade-selection-action" disabled>{t('Gộp')}</button>
    <button type="button" className="wm-trade-selection-action" onClick={onTags}>{t('Thêm/xóa nhãn')}</button>
    <button type="button" className="wm-trade-selection-action is-danger" disabled>{t('Xóa')}</button>
  </div>
}

export function TradeBulkTagsDialog({ count, labels = [], onClose }) {
  const { t } = useTestingLocale(), [rows,setRows] = useState([{group:'',tags:[]}])
  const groups=[...new Set(labels.map(item=>item.group_name || item.group || 'Nhóm nhãn'))]
  const updateRow=(index,patch)=>setRows(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,...patch}:row))
  const visibleFor=group=>labels.filter(item=>(!group || (item.group_name || item.group || 'Nhóm nhãn')===group) && !item.archived)
  return <LegacyModal label={t('Thêm/xóa nhãn')} onClose={onClose} className="wm-trade-bulk-tags-dialog">
    <div className="wm-trade-bulk-tags-body"><p className="wm-trade-bulk-tags-count">{t('Áp dụng cho {count} giao dịch',{count})}</p>
      <div className="wm-trade-bulk-tags-rows">{rows.map((row,index)=><div className="wm-trade-bulk-tags-row" key={index}>
        <label>{t('Nhóm nhãn')}<FxSelect label={t('Nhóm nhãn')} value={row.group} onChange={value=>updateRow(index,{group:value,tags:[]})} options={groups.map(value=>({value,label:value,localize:false}))} emptySelectionLabel={t('Chọn nhóm nhãn')} /></label>
        <label>{t('Nhãn')}<FxSelect label={t('Nhãn')} multiple searchable value={row.tags} onChange={value=>updateRow(index,{tags:value})} options={visibleFor(row.group).map(item=>({value:item.name,label:item.name,localize:false}))} emptySelectionLabel={t('Chọn nhãn')} /></label>
        {rows.length>1 && <button type="button" className="wm-trade-bulk-tags-remove" aria-label={t('Xóa nhóm nhãn')} onClick={()=>setRows(current=>current.filter((_,rowIndex)=>rowIndex!==index))}><ChartIcon name="trash"/></button>}
      </div>)}</div>
      <button type="button" className="fxa-button wm-trade-bulk-tags-add" onClick={()=>setRows(current=>[...current,{group:'',tags:[]}])}><ChartIcon name="order"/>{t('Thêm nhóm nhãn')}</button>
      <p className="wm-trade-bulk-tags-note">{t('Bản xem trước giao diện. Chưa áp dụng thay đổi vào giao dịch.')}</p>
      <footer><button type="button" className="fxa-button" onClick={onClose}>{t('Hủy')}</button><button type="button" className="fxa-button is-primary" disabled>{t('Áp dụng cho {count} giao dịch',{count})}</button></footer>
    </div>
  </LegacyModal>
}
