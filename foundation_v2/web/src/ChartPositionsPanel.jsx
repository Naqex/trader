import { useTestingLocale } from './testingLocale.jsx'

export default function ChartPositionsPanel({ tabs, tab, onTab, label, prefix = 'position', panelId = 'legacy-position-panel', children }) {
  const { t } = useTestingLocale()
  return <section className="legacy-positions" aria-label={t(label)}>
    <div className="legacy-position-tabs" role="tablist" aria-label={t('Trạng thái lệnh')}>
      {tabs.map(([key, caption]) => <button type="button" key={key} id={`${prefix}-tab-${key}`} role="tab" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={panelId} onClick={() => onTab(key)} onKeyDown={event => {
        if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return
        event.preventDefault()
        const keys = tabs.map(([value]) => value), index = keys.indexOf(key)
        const next = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys.at(-1) : keys[(index + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]
        onTab(next); document.getElementById(`${prefix}-tab-${next}`)?.focus()
      }}>{t(caption)}</button>)}
    </div>
    <div id={panelId} role="tabpanel" aria-labelledby={`${prefix}-tab-${tab}`}>{children}</div>
  </section>
}
