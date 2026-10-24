import { useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function AccountActionDialog({ action, onClose, onConfirm }) {
  const { t } = useTestingLocale()
  const [name,setName]=useState(action.row?.connection?.name || action.row?.name || ''), [pending,setPending]=useState(false), [error,setError]=useState(''), [uncertain,setUncertain]=useState(false)
  const lock=useRef(false), removing=action.kind==='remove'
  return <LegacyModal className="live-record-dialog is-account" label={t(removing?'Xóa tài khoản':'Sửa tài khoản')} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={()=>{if(!lock.current)onClose()}}>
    <form className="live-record-form" aria-busy={pending} onSubmit={async event=>{
      event.preventDefault();if(lock.current || uncertain)return;lock.current=true;setPending(true);setError('')
      try{await onConfirm(name.trim());onClose()}catch(problem){setError(problem.message);setUncertain(problem.outcomeKnown===false || problem.uncertain===true)}finally{lock.current=false;setPending(false)}
    }}>
      {removing?<div className="live-account-action-copy">{action.rows ? <><p>{t('Xóa {count} tài khoản đã chọn?',{count:action.rows.length})}</p><ul>{action.rows.map(row=><li key={row.id}>{row.name}</li>)}</ul><p>{t('Kết nối MT5 và dữ liệu đồng bộ sẽ bị gỡ khỏi ứng dụng. Tài khoản thủ công được lưu trữ cùng lịch sử. Tài khoản tại broker không thay đổi.')}</p></> : action.row.record ? <>{t('Archive account {name} and its trades and notes? Record history is retained.',{name:action.row.name})}</> : <>{t('Remove connection {name}, saved credentials and synced data? Your broker account is unchanged.',{name:action.row.name})}</>}</div>:<label>{t('Tên tài khoản')}<input required maxLength={160} value={name} disabled={pending} onChange={event=>setName(event.target.value)}/></label>}
      {error&&<p role="alert" className="live-record-error">{t(error)}{uncertain?` ${t('Tải lại danh sách để kiểm tra kết quả trước khi thao tác tiếp.')}`:''}</p>}
      <footer className="live-dialog-footer"><button type="button" className="fxa-button" disabled={pending} onClick={onClose}>{t('Hủy')}</button><button className={`fxa-button ${removing?'is-danger':'is-primary'}`} disabled={pending || uncertain || !removing && !name.trim()}>{t(pending?'Đang xử lý…':removing?'Xóa tài khoản':'Lưu thay đổi')}</button></footer>
    </form>
  </LegacyModal>
}
