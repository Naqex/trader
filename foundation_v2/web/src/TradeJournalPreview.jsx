import FxSelect from './FxSelect.jsx'
import ChartIcon from './ChartIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './trade-journal-preview.css'

export function TradeJournalToolbar({sourceKind,view,onView,checkedCount=0,onAction,inline=false,showBulkActions=false}) {
  const {t}=useTestingLocale()
  return <div className={`wm-trade-journal-toolbar${inline?' is-inline':''}`} role="group" aria-label={t('Công cụ nhật ký giao dịch')}>
    <div><FxSelect label="Bộ dữ liệu" value="source" onChange={()=>{}} options={[{value:'source',label:sourceKind==='broker'?'Broker gốc':sourceKind==='manual'?'Giao dịch thủ công':'Kết quả luyện tập'},{value:'journal',label:'Nhật ký',disabled:true,detail:'Chưa bật bộ dữ liệu này.'},{value:'research',label:'Bản nghiên cứu',disabled:true,detail:'Chưa bật bộ dữ liệu này.'}]}/>
    <FxSelect label="Trạng thái nhật ký" value={view} onChange={onView} options={[{value:'active',label:'Đang dùng'},{value:'deleted',label:'Đã xóa'},{value:'all',label:'Tất cả'}]}/></div>
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
