import ProjectDateInput from './ProjectDateInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import { FilterIcon, SelectChevron } from './FxSelect.jsx'
import './analytics-filter-controls.css'

function FilterPopover({ label, title, icon, children, inline = false, triggerContent }) {
  const { t } = useTestingLocale()

  const [open, setOpen] = useState(false)
  const root = useRef(null), trigger = useRef(null), id = useId()
  useEffect(() => {
    if (!open) return
    const position = () => {
      if (inline) return
      const menu = root.current?.querySelector('.fx-filter-popover')
      if (!menu) return
      const container = root.current.closest('.fx-content')
      const clip = container?.getBoundingClientRect()
      const left = Math.max(12, (clip?.left || 0) + 12), right = Math.min(window.innerWidth - 12, (clip ? clip.left + container.clientWidth : window.innerWidth) - 12)
      menu.style.maxWidth = `${right - left}px`; menu.style.transform = ''; menu.style.top = 'calc(100% + 8px)'; menu.style.bottom = 'auto'; menu.style.maxHeight = ''
      const bounds = menu.getBoundingClientRect()
      menu.style.transform = `translateX(${bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0}px)`
      const anchor = trigger.current.getBoundingClientRect()
      const below = Math.min(window.innerHeight, clip?.bottom || window.innerHeight) - anchor.bottom - 20
      const above = anchor.top - Math.max(0, clip?.top || 0) - 20
      const upwards = bounds.height > below && above > below
      if (upwards) { menu.style.top = 'auto'; menu.style.bottom = 'calc(100% + 8px)' }
      menu.style.maxHeight = `${Math.max(44, upwards ? above : below)}px`
    }
    if (!inline) position()
    root.current.querySelector('.fx-filter-popover input')?.focus({ preventScroll: true })
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', position)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position) }
  }, [open,inline])
  return <div className={`fx-filter-control${inline ? ' is-inline' : ''}`} ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); trigger.current?.focus() } }}>
    <button ref={trigger} type="button" className="fxa-button fxa-filter-pill" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{inline ? <><span>{triggerContent || '\u00a0'}</span>{icon && <FilterIcon kind={icon}/>}</> : <>{icon && <FilterIcon kind={icon} />}{t(label)}<SelectChevron /></>}</button>
    {open && <div id={id} role="dialog" tabIndex={-1} aria-label={title} className={`fx-filter-popover${inline ? ' is-inline' : ''}`}>{!inline && <h3 className="fx-filter-title">{t(title)}</h3>}{children}</div>}
  </div>
}

export function TimeFilter({ value, onChange }) {
  const { t } = useTestingLocale()

  return <FilterPopover label={t("Time")} title={t("Time filter")}><div className="fx-time-range">{[['timeStart', 'Start'], ['timeEnd', 'End']].map(([key, label]) => <label key={key}>{t(label)}<ProjectDateInput type="time" step="60" aria-label={t(`Time ${label}`)} value={value[key] || ''} onChange={event => onChange({ [key]: event.target.value, hour: 'all' })} /></label>)}</div><button type="button" className="fx-filter-clear" onClick={() => onChange({ timeStart: '', timeEnd: '', hour: 'all' })}>{t("Clear")}</button></FilterPopover>
}

export function DateFilter({ value, onChange, onValidityChange, label = 'Backtesting Date', inline = false, compact = false, disabled = false, clearable = true, timezone }) {
  const { t } = useTestingLocale()
  return <div className={`fx-filter-control project-date-range-filter${inline ? ' is-inline' : ' is-dropdown'}${compact ? ' is-compact' : ''}`}><ProjectDateInput range presentation={inline ? 'input' : 'dropdown'} value={{from:value.from || '',to:value.to || ''}} timezone={timezone} disabled={disabled} clearable={clearable} onValidityChange={onValidityChange} aria-label={t(label)} onChange={event=>onChange(event.target.value)} /></div>
}
