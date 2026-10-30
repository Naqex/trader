import { useId, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'

const TABS = [['details', 'Details'], ['tags', 'Tag groups'], ['media', 'Media']]

export function TradeNoteDraft() {
  const { t } = useTestingLocale()
  return <section className="fx-trade-note-draft" aria-label={t('Ghi chú giao dịch')}>
    <h3>{t('Notes')}</h3>
    <label><span className="sr-only">{t('Nội dung ghi chú giao dịch')}</span><textarea aria-label={t('Nội dung ghi chú giao dịch')} placeholder={t('Viết ghi chú…')} rows={6} maxLength={10000}/></label>
    <footer><small>{t('Bản nháp giao diện · chưa hỗ trợ lưu theo giao dịch.')}</small><button type="button" className="fxa-button is-primary" disabled>{t('Lưu')}</button></footer>
  </section>
}

export default function TradeDetailContent({ children, tags, provenance }) {
  const { t } = useTestingLocale(), id = useId()
  const [tab, setTab] = useState('details')
  return <div className="fx-trade-detail-content">
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
    <TradeNoteDraft/>
  </div>
}
