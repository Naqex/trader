import { matchesSearch } from './searchText.js'
import SearchInput from './SearchInput.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import { FilterIcon } from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './ledger-controls.css'

// Practice and Live share interaction/layout; each owns its filter semantics.
export default function FilterDrawer({ initialTab = 'Basic', sections, tags, note, basicControls, onClose, onClear, onApply, invalid = false }) {
  const { t, locale } = useTestingLocale()
  const dialog = useRef(null), id = useId()
  const tabs = tags ? ['Basic', 'Tags'] : ['Basic']
  const [tab, setTab] = useState(tabs.includes(initialTab) ? initialTab : 'Basic'), [search, setSearch] = useState('')
  useEffect(() => {
    const opener = document.activeElement, element = dialog.current
    element.showModal()
    return () => { element.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={dialog} className="fxl-filter-drawer" aria-label={t('Filters')} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
  }}>
    <header><h2><FilterIcon kind="filter" />{t('Filters')}</h2><button type="button" className="fxl-close wm-dialog-close" onClick={onClose} aria-label={t('Đóng Filters')}>×</button></header>
    <div className="fxl-tabs" role="tablist" aria-label={t('Filter type')}>{tabs.map((name, index) => <button key={name} type="button" role="tab" aria-selected={tab === name} aria-controls={`${id}-${name}`} id={`${id}-tab-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      setTab(next); document.getElementById(`${id}-tab-${next}`)?.focus()
    }}>{t(name)}</button>)}</div>
    <div className="fxl-drawer-body"><section role="tabpanel" id={`${id}-${tab}`} aria-labelledby={`${id}-tab-${tab}`}>
      {tab === 'Basic' ? <><label className="fxl-filter-search"><span className="sr-only">{t('Search filter')}</span><SearchInput type="search" aria-label={t('Search filter')} placeholder={t('Search filter')} value={search} onChange={event => setSearch(event.target.value)} /></label>{basicControls}{sections.filter(([name]) => matchesSearch(t(name), search)).map(([name, content]) => <details key={name}><summary>{t(name)}</summary>{content}</details>)}{note}</> : tags}
    </section></div>
    <footer><button type="button" className="fxl-clear" onClick={onClear}>{t('Clear All')}</button><button type="button" className="fxa-button is-primary" disabled={invalid} onClick={onApply}>{t('Apply Filters')}</button></footer>
  </dialog>
}
