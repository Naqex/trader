import { useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import ProjectDateInput from './ProjectDateInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { mt5Request } from './mt5Connections.js'

export default function MetaTraderConnect({ workspace, connection, onBack, onSaved }) {
  const {t}=useTestingLocale()
  const [draft,setDraft]=useState({name:connection?.name || 'MetaTrader 5',server:connection?.server || '',login:'',password:'',start_date:connection?.start_date || new Date().toISOString().slice(0,10)})
  const [pending,setPending]=useState(false), [error,setError]=useState(''), [visible,setVisible]=useState(false), [uncertain,setUncertain]=useState(false)
  const attempt=useRef(null), lock=useRef(false)
  const change=(key,value)=>setDraft(current=>({...current,[key]:value}))
  async function submit(event) {
    event.preventDefault()
    if(lock.current)return
    lock.current=true;setPending(true);setError('')
    if(!attempt.current)attempt.current={...draft,name:draft.name.trim(),server:draft.server.trim(),request_id:crypto.randomUUID()}
    setDraft(current=>({...current,password:''}));setVisible(false)
    try {
      const value=await mt5Request(workspace,'',attempt.current)
      attempt.current=null;setUncertain(false);onSaved(value)
    } catch(error) {
      setError(error.message);setUncertain(Boolean(error.uncertain))
      if(!error.uncertain)attempt.current=null
    } finally {lock.current=false;setPending(false)}
  }
  const disabled=pending||uncertain
  return <form className="live-mt5-form" onSubmit={submit}>
    <button type="button" className="live-text-action" disabled={pending} onClick={onBack}>{t('← Quay lại')}</button>
    <label>{t('Nền tảng')}<FxSelect className="is-field" label="Nền tảng" value="mt5" options={[{value:'mt5',label:'MetaTrader 5',localize:false}]} disabled /></label>
    <label>{t('Tên tài khoản')}<input required maxLength={160} value={draft.name} disabled={disabled} onChange={e=>change('name',e.target.value)} /></label>
    <label>{t('Đồng bộ từ ngày (UTC)')}<ProjectDateInput required min="2000-01-01" max={new Date().toISOString().slice(0,10)} value={draft.start_date} disabled={disabled} onChange={e=>change('start_date',e.target.value)} /></label>
    <label>{t('Server')}<input required maxLength={160} placeholder="Ví dụ: Broker-MT5Demo" autoComplete="off" spellCheck={false} value={draft.server} disabled={disabled} onChange={e=>change('server',e.target.value)} /></label>
    <label>{t('Số tài khoản')}<input required pattern="[1-9][0-9]{0,19}" inputMode="numeric" autoComplete="off" placeholder={connection?.login_hint || 'Login MT5'} value={draft.login} disabled={disabled} onChange={e=>change('login',e.target.value)} /></label>
    <label>{t('Mật khẩu investor (chỉ đọc)')}<span className="live-password-field"><input required={!uncertain} maxLength={512} type={visible?'text':'password'} autoComplete="new-password" value={draft.password} disabled={disabled} onChange={e=>change('password',e.target.value)} /><button type="button" className="live-text-action" aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(!visible)}>{t(visible?'Ẩn':'Hiện')}</button></span></label>
    <p className="live-muted">{t('Dùng mật khẩu investor do broker cung cấp. Kết nối đọc dữ liệu qua terminal riêng trên máy chạy WMREPLAY và tự đồng bộ mỗi phút. Không gửi lệnh giao dịch.')}</p>
    {error&&<p role="alert" className="live-connection-error">{t(error)}</p>}
    <button type="submit" className="fxa-button is-primary" disabled={pending}>{t(pending?'Đang lưu kết nối…':uncertain?'Thử lại cùng yêu cầu':connection?'Kết nối lại':'Kết nối MetaTrader 5')}</button>
  </form>
}
