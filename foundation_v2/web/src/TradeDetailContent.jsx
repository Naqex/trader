import { lazy, Suspense, useContext, useId, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import useAutosave, { AutosaveBoundaryContext, AutosaveStatus } from './useAutosave.jsx'
import { tradeNoteAdapter } from './tradeNoteApi.js'
import { dateFromValue } from './analyticsViewModel.js'
import { emptyNote } from './noteDocument.js'
import TradeMedia from './TradeMedia.jsx'

const NoteBlockEditor = lazy(()=>import('./NoteBlockEditor.jsx'))

const TABS = [['details', 'Details'], ['tags', 'Tag groups'], ['media', 'Media']]

export function TradeDetailHeading({ title, subtitle, net, currency, entryAt, exitAt, timeBasis = 'Chart' }) {
  const { t, fmt, timezone, locale } = useTestingLocale()
  const entryDate = dateFromValue(entryAt), exitDate = dateFromValue(exitAt)
  const entry = entryDate?.getTime(), exit = exitDate?.getTime()
  const minutes = Number.isFinite(entry) && Number.isFinite(exit) && exit >= entry ? Math.floor((exit-entry)/60000) : null
  const duration = minutes == null ? null : `${Math.floor(minutes/60)}h ${minutes%60}m`
  const time = Number.isFinite(entry) ? new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit',timeZone:timezone}).format(entryDate) : null
  return <div className="fx-live-trade-heading"><div className="fx-trade-title-line"><h2>{title}</h2>{Number.isFinite(net) && <span className={net > 0 ? 'is-positive' : net < 0 ? 'is-negative' : ''}>{fmt(net,currency ? ` ${currency}` : '')} <small>({t('Net PnL')})</small></span>}</div>{time && <p title={`${t('Entry date')} · ${timeBasis} · ${timezone}${subtitle ? ` · ${subtitle}` : ''}`}><time dateTime={entryDate.toISOString()}>{time}</time>{duration && <> · <span title={t('Thời gian giữ lệnh')}>{duration}</span></>}</p>}</div>
}

function SavedTradeNote({ workspace, session, trade }) {
  const { t } = useTestingLocale()
  const boundary = useContext(AutosaveBoundaryContext)
  const save = useAutosave({ identity:JSON.stringify(['trade-note',workspace,session,trade]), initialValue:emptyNote(), adapter:tradeNoteAdapter({workspace,session,trade,structured:true}) })
  return <section className="fx-trade-note-draft" aria-label={t('Ghi chú giao dịch')}>
    {save.ready ? <Suspense fallback={<span role="status">{t('Đang tải trình soạn thảo…')}</span>}><NoteBlockEditor workspace={workspace} context={session.startsWith('live:')?'live-trades':'testing-trades'} allowDefault={!save.record && save.phase==='idle'} value={save.value} onChange={save.change} onBlur={()=>void save.flush()} disabled={save.phase === 'conflict'} label={t('Nội dung ghi chú giao dịch')}/></Suspense> : boundary && <AutosaveStatus save={save}/>}
    {!boundary && <AutosaveStatus save={save}/>}
  </section>
}

export function TradeNoteDraft({ workspace, session, trade }) {
  const { t } = useTestingLocale()
  if (workspace && session && trade) return <SavedTradeNote workspace={workspace} session={String(session)} trade={String(trade)}/>
  return <section className="fx-trade-note-draft" aria-label={t('Ghi chú giao dịch')}>
    <h3 className="sr-only">{t('Notes')}</h3>
    <label><span className="sr-only">{t('Nội dung ghi chú giao dịch')}</span><textarea aria-label={t('Nội dung ghi chú giao dịch')} placeholder={t('Viết ghi chú…')} rows={6} maxLength={10000}/></label>
    <footer><small>{t('Bản nháp giao diện · chưa hỗ trợ lưu theo giao dịch.')}</small><button type="button" className="fxa-button is-primary" disabled>{t('Lưu')}</button></footer>
  </section>
}

export default function TradeDetailContent({ children, tags, noteScope }) {
  const { t } = useTestingLocale(), id = useId()
  const [tab, setTab] = useState('details')
  const pane=useRef(null),drag=useRef(null)
  const [ratio,setRatio]=useState(()=>{try{const stored=Number(localStorage.getItem('tw:trade-details-ratio'));return stored>=.2 && stored<=.65?stored:1/3}catch{return 1/3}})
  const resize=value=>{
    const width=pane.current.getBoundingClientRect().width
    const next=Math.max(260/width,Math.min(Math.min(.65,(width-300)/width),value))
    setRatio(next);try{localStorage.setItem('tw:trade-details-ratio',String(next))}catch{ /* Width is only a display preference. */ }
  }
  return <div ref={pane} className="fx-trade-detail-content" style={{'--trade-details-ratio':`${ratio*100}%`}}>
    <aside className="fx-trade-detail-sidebar">
    <nav className="fx-trade-detail-tabs" role="tablist" aria-label={t('Trade detail tabs')}>
      {TABS.map(([key, label], index) => <button key={key} id={`${id}-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = TABS[event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]
        setTab(next); document.getElementById(`${id}-${next}`)?.focus()
      }}>{t(label)}</button>)}
    </nav>
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
      {tab === 'details' ? children : tab === 'tags' ? tags : noteScope?.session && noteScope?.trade ? <TradeMedia workspace={noteScope.workspace} session={String(noteScope.session)} trade={String(noteScope.trade)}/> : <p>{t('Chưa chọn giao dịch.')}</p>}
    </section>
    </aside>
    <div className="wm-trade-details-resize" role="separator" tabIndex={0} aria-label={t('Độ rộng chi tiết giao dịch')} aria-orientation="vertical" aria-valuemin={20} aria-valuemax={65} aria-valuenow={Math.round(ratio*100)} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current=true}} onPointerMove={event=>{if(drag.current){const bounds=pane.current.getBoundingClientRect();resize((event.clientX-bounds.left)/bounds.width)}}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onLostPointerCapture={()=>{drag.current=null}} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();resize(event.key==='Home'?.2:event.key==='End'?.65:ratio+(event.key==='ArrowLeft'?-.025:.025))}}/>
    <TradeNoteDraft {...noteScope}/>
  </div>
}
