import { useEffect, useId, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { DEMO_TIMEFRAMES } from './liveTradingModel.js'
import Mt5TradingConditions from './Mt5TradingConditions.jsx'
import './quick-session.css'

export default function Mt5ChartSetup({ snapshot, status, reason, symbol, timeframe, onSelect, onOpen, onClose, onResetSymbol }) {
  const { t,fmt }=useTestingLocale(), id=useId(), dialog=useRef(null), opener=useRef(document.activeElement)
  const [advanced,setAdvanced]=useState(false)
  const available=status==='ready' && snapshot?.status==='ready' && snapshot?.symbols?.includes(symbol) && snapshot?.account
  useEffect(()=>{
    const panel=dialog.current
    panel.showModal()
    return ()=>{panel.close();if(opener.current?.isConnected)opener.current.focus({preventScroll:true})}
  },[])
  return <dialog ref={dialog} className="quick-session-dialog mt5-chart-setup" aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose()}}}>
    <header className="quick-session-header"><h2 id={`${id}-title`}>{t('Mở biểu đồ MT5')}</h2><button type="button" className="quick-session-close wm-dialog-close" aria-label={t('Đóng thiết lập biểu đồ')} onClick={onClose}><TestingIcon kind="close" size={18}/></button></header>
    <form className="quick-session-form" onSubmit={event=>{event.preventDefault();if(available)onOpen()}}>
      <div className="quick-session-layout"><nav className="quick-session-sections" aria-label={t('Thiết lập biểu đồ')}>
        <button type="button" aria-pressed={!advanced} aria-controls={`${id}-panel`} onClick={()=>setAdvanced(false)}><strong>{t('Cơ bản')}</strong><span>{t('Tài khoản và mã giao dịch')}</span></button>
        <button type="button" aria-pressed={advanced} aria-controls={`${id}-panel`} onClick={()=>setAdvanced(true)}><strong>{t('Điều kiện giao dịch')}</strong><span>{t('Thông số từ broker')}</span></button>
      </nav><div className="quick-session-body"><div id={`${id}-panel`} className="quick-session-fields">
        {advanced ? <Mt5TradingConditions snapshot={snapshot} stale={status!=='ready'}/> : <>
          <div className="quick-session-field"><span>{t('Tài khoản MT5')}</span><FxSelect label={t('Tài khoản MT5')} className="is-field" value={String(snapshot?.account?.login || '')} disabled options={snapshot?.account ? [{value:String(snapshot.account.login),label:`#${snapshot.account.login} · ${snapshot.account.server}`,localize:false}] : [{value:'',label:t('Chưa kết nối terminal giao dịch')}]} onChange={()=>{}}/></div>
          <div className="quick-session-field"><span>{t('Account Balance')}</span><output>{snapshot?.account ? fmt(snapshot.account.balance,` ${snapshot.account.currency}`):t('Chưa có dữ liệu')}</output></div>
          <div className="quick-session-field"><span>{t('Assets')}</span><FxSelect className="is-field" label={t('Mã giao dịch MT5')} searchable disabled={!snapshot?.symbols?.length || status!=='ready'} value={symbol} triggerContent={symbol || t('Chọn mã')} options={(snapshot?.symbols||[]).map(value=>({value,label:value,localize:false}))} onChange={value=>onSelect({mt5_symbol:value})}/></div>
          <div className="quick-session-field"><span>{t('Khung thời gian')}</span><FxSelect className="is-field" label={t('Khung thời gian MT5')} value={timeframe} options={Object.keys(DEMO_TIMEFRAMES).map(value=>({value,label:value,localize:false}))} onChange={value=>onSelect({mt5_timeframe:value})}/></div>
          <p className="live-muted">{t('Danh sách mã thuộc terminal và phạm vi được phép giao dịch. Số dư cập nhật từ tài khoản MT5.')}</p>
        </>}
        {reason && <p className="live-muted" role="status">{t(reason)}</p>}{onResetSymbol && <button type="button" className="quick-session-text-action" onClick={onResetSymbol}>{t('Tải lại danh sách mã')}</button>}
      </div></div></div>
      <footer className="quick-session-footer"><button type="button" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="quick-session-submit" disabled={!available}>{t('Mở biểu đồ')}</button></footer>
    </form>
  </dialog>
}
