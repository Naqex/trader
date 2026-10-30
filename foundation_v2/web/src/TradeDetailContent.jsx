import { useContext, useId, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import useAutosave, { AutosaveBoundaryContext, AutosaveStatus } from './useAutosave.jsx'
import { tradeNoteAdapter } from './tradeNoteApi.js'
import { dateFromValue } from './analyticsViewModel.js'

const TABS = [['details', 'Details'], ['tags', 'Tag groups'], ['media', 'Media']]

export function TradeDetailHeading({ title, subtitle, net, currency, entryAt, exitAt, timeBasis = 'Chart' }) {
  const { t, fmt, timezone } = useTestingLocale()
  const entryDate = dateFromValue(entryAt), exitDate = dateFromValue(exitAt)
  const entry = entryDate?.getTime(), exit = exitDate?.getTime()
  const minutes = Number.isFinite(entry) && Number.isFinite(exit) && exit >= entry ? Math.floor((exit-entry)/60000) : null
  const duration = minutes == null ? null : `${Math.floor(minutes/60)}h ${minutes%60}m`
  const time = Number.isFinite(entry) ? displayDate(entryDate,{timeStyle:'medium',timeZone:timezone}).split(' ')[1] : null
  return <div className="fx-live-trade-heading"><div className="fx-trade-title-line"><h2>{title}</h2>{Number.isFinite(net) && <span className={net > 0 ? 'is-positive' : net < 0 ? 'is-negative' : ''}>{fmt(net,currency ? ` ${currency}` : '')} <small>({t('Net PnL')})</small></span>}</div>{time && <p title={`${t('Entry date')} · ${timeBasis} · ${timezone}${subtitle ? ` · ${subtitle}` : ''}`}><time dateTime={entryDate.toISOString()}>{time}</time>{duration && <> · <span title={t('Thời gian giữ lệnh')}>{duration}</span></>}</p>}</div>
}

function SavedTradeNote({ workspace, session, trade }) {
  const { t } = useTestingLocale()
  const boundary = useContext(AutosaveBoundaryContext)
  const save = useAutosave({ identity:JSON.stringify(['trade-note',workspace,session,trade]), initialValue:'', adapter:tradeNoteAdapter({workspace,session,trade}) })
  return <section className="fx-trade-note-draft" aria-label={t('Ghi chú giao dịch')}>
    <label><span className="sr-only">{t('Nội dung ghi chú giao dịch')}</span><textarea aria-label={t('Nội dung ghi chú giao dịch')} placeholder={t('Viết ghi chú…')} value={save.value} onChange={event=>save.change(event.target.value)} onBlur={()=>void save.flush()} disabled={!save.ready || save.phase === 'conflict'} rows={6} maxLength={10000}/></label>
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

export default function TradeDetailContent({ children, tags, provenance, noteScope }) {
  const { t } = useTestingLocale(), id = useId()
  const [tab, setTab] = useState('details')
  return <div className="fx-trade-detail-content">
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
      {tab === 'details' ? children : tab === 'tags' ? <div className="fx-trade-drawer-placeholder">{tags}</div> : <div className="fx-trade-drawer-placeholder"><h3>{t('Media')}</h3><p>{t('Chưa hỗ trợ tệp đính kèm cho giao dịch này.')}</p></div>}
    </section>
    {provenance}
    </aside>
    <TradeNoteDraft {...noteScope}/>
  </div>
}
