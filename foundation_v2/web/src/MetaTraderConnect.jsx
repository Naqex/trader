import { useId, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import ProjectDateInput from './ProjectDateInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { mt5Request } from './mt5Connections.js'
import ChartIcon from './ChartIcon.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import MetaTraderMark from './MetaTraderMark.jsx'

function ConnectionHelp({ label, children }) {
  const { t } = useTestingLocale(), [anchor,setAnchor] = useState(null)
  return <><button type="button" className="live-connection-help" title={t(label)} aria-label={t(label)} aria-expanded={Boolean(anchor)} onKeyDown={event=>{if(anchor && event.key==='Escape'){event.preventDefault();event.stopPropagation();setAnchor(null)}}} onClick={event=>setAnchor(anchor ? null : event.currentTarget)}><span aria-hidden="true">?</span></button>{anchor && <LegacyPopover anchor={anchor} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={t(label)} onClose={()=>setAnchor(null)}><p className="live-connection-help-copy">{t(children)}</p></LegacyPopover>}</>
}

export default function MetaTraderConnect({ workspace, connection, onBack, onSaved }) {
  const {t}=useTestingLocale()
  const id=useId(), [platform,setPlatform]=useState('mt5')
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
  return <form className="live-mt5-form" onSubmit={submit} aria-busy={pending}>
    <div className="live-connect-nav"><button type="button" className="live-back-action" disabled={pending} onClick={onBack}><ChartIcon name="arrow-left" />{t('Quay lại')}</button><span className="live-sync-help">{t('Hướng dẫn đồng bộ')}<ConnectionHelp label="Hướng dẫn đồng bộ">Dùng server, số tài khoản và mật khẩu investor từ terminal hoặc cổng broker. WMREPLAY đọc dữ liệu qua terminal MT5 riêng trên máy chạy API, tự đồng bộ mỗi phút và không gửi lệnh giao dịch.</ConnectionHelp></span></div>
    <div className="live-mt5-provider"><MetaTraderMark /><span>MetaTrader</span></div>
    <div className="live-mt5-fields">
      <label>{t('Ngày bắt đầu (UTC)')}<ProjectDateInput aria-label={t('Ngày bắt đầu (UTC)')} required min="2000-01-01" max={new Date().toISOString().slice(0,10)} value={draft.start_date} disabled={disabled} onChange={e=>change('start_date',e.target.value)} /></label>
      <div className="live-mt5-field"><span>{t('Nền tảng')}</span><FxSelect className="is-field" label="Nền tảng" value={platform} onChange={setPlatform} options={[{value:'mt5',label:'MetaTrader 5',localize:false}]} disabled={disabled} /></div>
      <div className="live-mt5-field"><label htmlFor={`${id}-server`}>{t('Server')}</label><div className="live-connect-input"><input id={`${id}-server`} required maxLength={160} placeholder="Server" autoComplete="off" spellCheck={false} value={draft.server} disabled={disabled} onChange={e=>change('server',e.target.value)} /><ConnectionHelp label="Tìm server">Nhập đúng tên server trong terminal MT5 hoặc cổng broker, ví dụ Broker-MT5Demo.</ConnectionHelp></div></div>
      <div className="live-mt5-field"><label htmlFor={`${id}-login`}>{t('Số tài khoản')}</label><div className="live-connect-input"><input id={`${id}-login`} required pattern="[1-9][0-9]{0,19}" inputMode="numeric" autoComplete="off" placeholder={connection?.login_hint || t('Số tài khoản')} value={draft.login} disabled={disabled} onChange={e=>change('login',e.target.value)} /><ConnectionHelp label="Tìm số tài khoản">Số đăng nhập MT5 do broker cấp, không phải email đăng nhập cổng broker.</ConnectionHelp></div></div>
      <div className="live-mt5-field"><label htmlFor={`${id}-password`}>{t('Mật khẩu investor')}</label><div className="live-connect-input"><input id={`${id}-password`} required={!uncertain} maxLength={512} type={visible?'text':'password'} autoComplete="new-password" value={draft.password} disabled={disabled} onChange={e=>change('password',e.target.value)} /><button type="button" className="live-password-toggle" aria-label={t(visible?'Ẩn mật khẩu':'Hiện mật khẩu')} aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(!visible)}><ChartIcon name={visible?'eye-off':'eye'} /></button></div></div>
    </div>
    {error&&<p role="alert" className="live-connection-error">{t(error)}</p>}
    <footer className="live-connect-footer"><button type="submit" className="fxa-button is-primary" disabled={pending}>{t(pending?'Đang lưu kết nối…':uncertain?'Thử lại cùng yêu cầu':connection?'Kết nối lại':'Kết nối broker')}</button><button type="button" className="live-back-action" disabled={pending} onClick={onBack}>{t('Hủy')}</button></footer>
  </form>
}
