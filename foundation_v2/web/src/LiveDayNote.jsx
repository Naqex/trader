import { useEffect, useRef, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { dealNet } from './liveWorkspaceModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import TestingIcon from './TestingIcon.jsx'
import './live-day-note.css'

export default function LiveDayNote({ date, endDate, period = 'day', partial, timezone, currency, deals, onClose }) {
  const { t, fmt } = useTestingLocale(), dialog = useRef(null)
  const [title,setTitle] = useState(''), [body,setBody] = useState(''), [expanded,setExpanded] = useState(false)
  const isWeek = period === 'week', rangeLabel = endDate ? `${displayDate(date)} – ${displayDate(endDate)}` : displayDate(date)
  useEffect(() => {
    const element = dialog.current, opener = document.activeElement, overflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = overflow; if(opener?.isConnected)opener.focus({preventScroll:true}) }
  }, [])
  return <dialog ref={dialog} className={`live-day-note${expanded ? ' is-expanded' : ''}`} aria-label={t(isWeek ? 'Ghi chú tuần {date}' : 'Ghi chú ngày {date}',{date:rangeLabel})} onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{
    if(event.target!==event.currentTarget)return
    const box=event.currentTarget.getBoundingClientRect()
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose()
  }}>
    <header><div><button type="button" className="wm-dialog-close" aria-label={t('Đóng ghi chú')} onClick={onClose}><TestingIcon kind="close"/></button><button type="button" className="fxa-icon-button" aria-label={t(expanded ? 'Thu gọn ghi chú' : 'Mở rộng ghi chú')} aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}><TestingIcon kind="zoom-area"/></button></div><span>{t('Bản nháp')}</span></header>
    <input className="live-day-note-title" aria-label={t('Tiêu đề ghi chú')} placeholder={t('Tiêu đề ghi chú')} value={title} onChange={event=>setTitle(event.target.value)}/>
    <div className="live-day-note-layout"><section className="live-day-note-facts" aria-label={t('Thông tin ghi chú')}>
      <dl><div><dt><TestingIcon kind="clock"/>{t(isWeek ? 'Khoảng thời gian' : 'Ngày')}</dt><dd><time dateTime={date}>{rangeLabel}</time></dd></div><div><dt><TestingIcon kind="tags"/>{t('Loại ghi chú')}</dt><dd><span className="live-day-note-type">{t(isWeek ? 'Đánh giá tuần' : 'Đánh giá ngày')}</span></dd></div></dl>
      <div className="live-day-note-trades-heading"><TestingIcon kind="trades"/><h3>{t('Giao dịch')}</h3><span>{partial && !deals.length ? '—' : deals.length}</span></div>
      {partial && <p className="live-muted">{t('Chỉ cộng phần dữ liệu đã ghi nhận; chưa đủ dữ liệu cho toàn bộ phạm vi.')}</p>}
      {deals.length ? <ul>{deals.map(deal=><li key={`${deal.source_account || ''}:${deal.ticket}`}><span>{deal.symbol} · #{deal.position_id ?? deal.ticket}</span><strong>{fmt(dealNet(deal),currency ? ` ${currency}` : '')}</strong></li>)}</ul> : !partial && <p className="live-muted">{t('Chưa có giao dịch trong bộ lọc này.')}</p>}
      <small className="live-muted">{timezone}</small>
    </section><section className="live-day-note-editor"><label className="sr-only" htmlFor="live-day-note-body">{t('Nội dung ghi chú')}</label><textarea id="live-day-note-body" placeholder={t('Viết ghi chú…')} value={body} onChange={event=>setBody(event.target.value)}/></section></div>
  </dialog>
}
