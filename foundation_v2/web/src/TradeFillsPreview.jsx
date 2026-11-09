import { useId, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import ChartIcon from './ChartIcon.jsx'

export default function TradeFillsPreview({deal,time,onClose}) {
  const {t,fmt}=useTestingLocale(),id=useId(),[tab,setTab]=useState('entries')
  const fills=(deal.fills || []).filter(fill=>tab==='entries'?fill.entry===0:[1,3].includes(fill.entry))
  const value=(amount,digits=6)=>Number.isFinite(amount)?fmt(amount,'',digits):'N/A'
  const remaining=deal.status==='Closed'?0:deal.status==='Open'?deal.fills.reduce((sum,fill)=>sum+(fill.entry===0?fill.volume:-fill.volume),0):null
  const help=t('Chỉnh sửa nhật ký chưa được bật.')
  return <div className="wm-trade-fills-preview">
    <div role="tablist" aria-label={t('Các lần khớp')} className="wm-trade-fills-tabs">{[['entries','Vào lệnh'],['exits','Thoát lệnh']].map(([key,label])=><button key={key} type="button" id={`${id}-${key}`} aria-selected={tab===key} aria-controls={`${id}-panel`} role="tab" tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'entries':event.key==='End'?'exits':tab==='entries'?'exits':'entries';setTab(next);document.getElementById(`${id}-${next}`)?.focus()}}}>{t(label)}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="wm-trade-fill-fields">{fills.map(fill=><div className="wm-trade-fill-row" key={fill.ticket} title={time(fill.time_msc)}>
      <label><span>{t('Price')}</span><input readOnly value={value(fill.price)}/></label><label><span>{t('Size')}</span><input readOnly value={value(fill.volume,4)}/></label><label><span>{t(tab==='entries'?'Entry type':'Gross PnL')}</span><input readOnly value={tab==='entries'?t(deal.entry_type || '-'):value(fill.profit,2)}/></label>
    </div>)}{!fills.length && <p>{t('Chưa có lần khớp trong mục này.')}</p>}</div>
    <button type="button" className="wm-trade-add-fill" disabled title={help}><ChartIcon name="order"/>{t(tab==='entries'?'Thêm lần vào':'Thêm lần thoát')}</button>
    <dl className="wm-trade-fills-summary">{[['Giá vào TB',deal.price_open,6],['Giá thoát TB',deal.price_close,6],['Gross PnL',deal.status==='Closed'?deal.gross_pnl:null,2],['Khối lượng còn mở',remaining,4]].map(([label,amount,digits])=><div key={label}><dd>{value(amount,digits)}</dd><dt>{t(label)}</dt></div>)}</dl>
    <footer><button type="button" className="fxa-button" onClick={onClose}>{t('Cancel')}</button><button type="button" className="fxa-button is-primary" disabled title={help}>{t('Save')}</button></footer>
  </div>
}
