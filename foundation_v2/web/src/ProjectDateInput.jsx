import AppIcon from './AppIcon.jsx'
import { zonedDateKey } from './timezone.js'
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { dateFieldDisplay, parseDateField } from './dateFormat.js'
import { boundedDateTimeValue, rangeDisplay, parseRange, wallTimeAllowed } from './projectDateInputModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import './project-date-input.css'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function stripZone(value = '') { return String(value).replace(/Z$/, '') }
function datePart(value = '') { return value ? stripZone(value).split('T')[0] : '' }
function timePart(value = '') { return stripZone(value).split('T')[1]?.split('.')[0] || '' }
function monthKey(value) { return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}` }
function monthDate(month) { return new Date(`${month}-01T00:00:00Z`) }
function shiftMonth(month, delta) { const date = monthDate(month); date.setUTCMonth(date.getUTCMonth() + delta); return monthKey(date) }
function lastDayOfMonth(month) { const date = monthDate(month); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() }
function shiftYear(month, delta) { const date = monthDate(month); date.setUTCFullYear(date.getUTCFullYear() + delta); return monthKey(date) }
function yearStart(month) { return Math.floor(monthDate(month).getUTCFullYear() / 10) * 10 }
function monthAllowed(month, min, max) { const first = `${month}-01`, last = `${month}-${String(lastDayOfMonth(month)).padStart(2, '0')}`; return (!max || first <= datePart(max)) && (!min || last >= datePart(min)) }
function yearAllowed(year, min, max) { const first = `${year}-01-01`, last = `${year}-12-31`; return (!max || first <= datePart(max)) && (!min || last >= datePart(min)) }
function formatPickerValue(date, time, type) { const display = date.split('-').reverse().join('/'); return type === 'date' ? display : `${display} ${time || '00:00'}` }
function isDateAllowed(date, min, max) { const lower = datePart(min), upper = datePart(max); return (!lower || date >= lower) && (!upper || date <= upper) }
const isDateTimeAllowed = wallTimeAllowed

function Chevron({ direction }) { return <AppIcon name={direction === 'prev' ? 'chevron-left' : 'chevron-right'} size={16} /> }

function TimeSpinner({ value, onChange, seconds = false }) {
  const { t } = useTestingLocale()
  const read = value => Array.from({length:seconds?3:2},(_,i)=>String(value || '').split(':')[i] || '00')
  const [parts, setParts] = useState(() => read(value))
  const emitted = useRef(value)
  useEffect(() => { emitted.current = value; setParts(read(value)) }, [value, seconds])
  const publish = next => {
    if (next.some(part => part === '')) return
    const time = next.map(part => String(Number(part)).padStart(2, '0')).join(':')
    emitted.current = time
    onChange({ target: { value: time } })
  }
  const edit = (index, raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2), limit = index ? 59 : 23
    const next = parts.map((part, i) => i === index ? digits !== '' && Number(digits) > limit ? String(limit) : digits : part)
    setParts(next)
    // Outside pointerdown can unmount the popup before blur, so publish each edit.
    publish(next)
  }
  const commit = (index, delta = 0) => {
    const limit = index ? 60 : 24
    const next = parts.map((part, i) => {
      const number = Number(part) || 0
      return String(i === index && delta ? (number + delta + limit) % limit : Math.min(i ? 59 : 23, number)).padStart(2, '0')
    })
    setParts(next)
    publish(next)
  }
  return <div className="project-time-spinner" role="group" aria-label={t('Chọn giờ')}>{parts.map((part, index) => <React.Fragment key={index}>
    {index > 0 && <span aria-hidden="true">:</span>}
    <div className="project-time-spinner-column">
      <button type="button" aria-label={t(index===2?'Tăng giây':index ? 'Tăng phút' : 'Tăng giờ')} onClick={() => commit(index, 1)}><AppIcon name="up" size={16} /></button>
      <input type="text" inputMode="numeric" role="spinbutton" aria-label={t(index===2?'Giây':index ? 'Phút' : 'Giờ')} aria-valuemin={0} aria-valuemax={index ? 59 : 23} aria-valuenow={Number(part) || 0} value={part} maxLength={2} onFocus={event => event.target.select()} onChange={event => edit(index, event.target.value)} onBlur={() => commit(index)} onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); commit(index, event.key === 'ArrowUp' ? 1 : -1) } }} />
      <button type="button" aria-label={t(index===2?'Giảm giây':index ? 'Giảm phút' : 'Giảm giờ')} onClick={() => commit(index, -1)}><AppIcon name="down" size={16} /></button>
    </div>
  </React.Fragment>)}</div>
}

// Keep ISO at the form boundary while the editable text is independent of OS locale.
export default function ProjectDateInput({ value = '', onChange, onValidityChange, type = 'date', min, max, step, utc = false, clearable = false, todayTime = 'preserve', validationError = '', range = false, timezone, presentation = 'input', ...props }) {
  const { t, locale } = useTestingLocale()
  const today = () => zonedDateKey(new Date(), timezone || (utc ? 'UTC' : undefined))
  const display = value => range ? rangeDisplay(value) : dateFieldDisplay(value, type)
  const sourceDate = range ? value.from : datePart(value)
  const [draft, setDraft] = useState(() => display(value))
  const [pendingStart, setPendingStart] = useState(null)
  const [inputError, setInputError] = useState('')
  const initialDate = sourceDate || today()
  const [viewMonth, setViewMonth] = useState(initialDate.slice(0, 7))
  const [pickerDate, setPickerDate] = useState(initialDate)
  const [pickerTime, setPickerTime] = useState(timePart(range ? '' : value) || (type === 'datetime-local' ? '00:00' : ''))
  const [pickerView, setPickerView] = useState('day')
  const [open, setOpen] = useState(false)
  const emitted = useRef(value), root = useRef(null), text = useRef(null), trigger = useRef(null), popover = useRef(null)
  const popoverId = useId()
  const dropdown = presentation === 'dropdown'
  const focusField = () => (dropdown ? trigger : text).current?.focus({preventScroll:true})
  useEffect(() => { onValidityChange?.(!inputError && !validationError) }, [inputError, validationError, onValidityChange])

  useEffect(() => { if (props.disabled) setOpen(false) }, [props.disabled])

  useEffect(() => {
    if (range ? rangeDisplay(value) !== rangeDisplay(emitted.current) : value !== emitted.current) {
      emitted.current = value
      setDraft(display(value))
      if (sourceDate) { setPickerDate(sourceDate); setViewMonth(sourceDate.slice(0, 7)) }
      if (type === 'datetime-local' || type === 'time') setPickerTime(timePart(range ? '' : value) || (type === 'datetime-local' ? '00:00' : ''))
      setInputError('')
      text.current?.setCustomValidity(validationError)
    }
  }, [value, type])

  useEffect(() => {
    const parsed = range ? parseRange(draft) : parseDateField(draft, type)
    if (parsed !== null) {
      const valid = !parsed || (range ? (!parsed.from || isDateAllowed(parsed.from,min,max)) && (!parsed.to || isDateAllowed(parsed.to,min,max)) : type === 'date' ? isDateAllowed(parsed, min, max) : isDateTimeAllowed(parsed,min,max))
      text.current?.setCustomValidity(validationError || (valid ? '' : t('Ngày giờ không hợp lệ')))
      setInputError(valid ? '' : t('Ngày giờ không hợp lệ'))
    }
  }, [min, max, draft, type, range, t, validationError])

  useEffect(() => {
    if (!open || props.disabled) return undefined
    const closeOnOutside = event => { if (!root.current?.contains(event.target)) { setOpen(false) } }
    const closeOnEscape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }) } }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('focusin', closeOnOutside)
    const field = root.current
    field.addEventListener('keydown', closeOnEscape)
    const panel=popover.current
    ;(panel?.querySelector('[role=gridcell][tabindex="0"]:not(:disabled),input:not(:disabled)') || panel?.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true })
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('focusin', closeOnOutside); field.removeEventListener('keydown', closeOnEscape) }
  }, [open, props.disabled])

  useLayoutEffect(() => {
    if (!open || props.disabled) return undefined
    const panel = popover.current
    // The top layer keeps the calendar out of scrolling forms and sticky footers.
    panel.showPopover()
    const position = () => {
      const anchor = root.current.getBoundingClientRect()
      const boundary = root.current.closest('dialog')?.getBoundingClientRect() || {left:0, top:0, right:window.innerWidth, bottom:window.innerHeight}
      const left = Math.max(8, boundary.left + 8), right = Math.min(window.innerWidth - 8, boundary.right - 8)
      const top = Math.max(8, boundary.top + 8), bottom = Math.min(window.innerHeight - 8, boundary.bottom - 8)
      panel.style.maxWidth = `${right - left}px`
      panel.style.maxHeight = `${bottom - top}px`
      const bounds = panel.getBoundingClientRect()
      const below = anchor.bottom + 8
      const y = below + bounds.height <= bottom ? below : anchor.top - 8 - bounds.height
      panel.style.left = `${Math.max(left, Math.min(anchor.left, right - bounds.width))}px`
      panel.style.top = `${Math.max(top, Math.min(y, bottom - bounds.height))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); if (panel.matches(':popover-open')) panel.hidePopover() }
  }, [open, props.disabled])

  const publish = (event, raw) => {
    if (range) {
      const next = parseRange(raw)
      const valid = next && (!next.from || isDateAllowed(next.from,min,max)) && (!next.to || isDateAllowed(next.to,min,max))
      text.current?.setCustomValidity(valid ? '' : t('Khoảng ngày không hợp lệ.'))
      setInputError(valid ? '' : t('Khoảng ngày không hợp lệ.'))
      if (valid && JSON.stringify(next)!==JSON.stringify(emitted.current)) { emitted.current=next; onChange?.({target:{value:next},currentTarget:{value:next}}) }
      return
    }
    const parsed = parseDateField(raw, type)
    const valid = parsed !== null && (!parsed || (type === 'datetime-local' ? isDateTimeAllowed(parsed, min, max) : type === 'date' ? isDateAllowed(parsed, min, max) : isDateTimeAllowed(parsed,min,max)))
    text.current?.setCustomValidity(validationError || (valid ? '' : t('Ngày giờ không hợp lệ')))
    if (!valid) { setInputError(t('Ngày giờ không hợp lệ')); return }
    setInputError('')
    const next = parsed ? `${parsed}${utc ? 'Z' : ''}` : ''
    if (next === emitted.current) return
    emitted.current = next
    onChange?.({ ...event, target: { name: props.name, value: next }, currentTarget: { name: props.name, value: next } })
  }

  const openPicker = () => {
    const selected = sourceDate || (!range && datePart(parseDateField(draft, type))) || today()
    const lowerBounded = datePart(min) && selected < datePart(min) ? datePart(min) : selected
    const bounded = datePart(max) && lowerBounded > datePart(max) ? datePart(max) : lowerBounded
    setPickerDate(bounded)
    setPickerTime(timePart(range ? '' : value) || (type === 'datetime-local' ? '00:00' : ''))
    setViewMonth(bounded.slice(0, 7))
    setPickerView('day')
    setPendingStart(null)
    setOpen(current => !current)
  }

  const chooseDate = (date, timeOverride = null) => {
    if (!isDateAllowed(date, min, max)) return
    if (range) {
      if (!pendingStart) { setPendingStart(date); setPickerDate(date); return }
      const next = date < pendingStart ? {from:date,to:pendingStart} : {from:pendingStart,to:date}
      setDraft(rangeDisplay(next)); publish({type:'change'},rangeDisplay(next)); setPendingStart(null); setOpen(false); focusField(); return
    }
    setPickerDate(date)
    setViewMonth(date.slice(0, 7))
    setPickerView('day')
    const nextTime = timeOverride || pickerTime || (type === 'datetime-local' ? '00:00' : '')
    const raw = type === 'datetime-local' ? boundedDateTimeValue(date, nextTime, min, max) : formatPickerValue(date, nextTime, type)
    if (type === 'datetime-local') setPickerTime(timePart(parseDateField(raw, type)))
    setDraft(raw)
    publish({ type: 'change' }, raw)
    if (type === 'date') { setOpen(false); focusField() }
  }

  const chooseTime = event => {
    const time = event.target.value
    const raw = type === 'time' ? time : formatPickerValue(pickerDate, time, type)
    setPickerTime(time)
    setDraft(type === 'time' ? time : raw)
    publish({ type: 'change' }, raw)
  }

  const parsedMonth = monthDate(viewMonth)
  const selectedMonth = monthKey(monthDate(pickerDate))
  const selectedYear = monthDate(pickerDate).getUTCFullYear()
  const decadeStart = yearStart(viewMonth)
  const monthDays = lastDayOfMonth(viewMonth)
  const firstWeekday = parsedMonth.getUTCDay()
  const minDate = datePart(min), maxDate = datePart(max)
  const tabDate = pickerDate.startsWith(viewMonth) && isDateAllowed(pickerDate, min, max) ? pickerDate : minDate?.startsWith(viewMonth) ? minDate : `${viewMonth}-01`
  const firstTabMonth = Math.max(0, Number((minDate?.startsWith(viewMonth.slice(0,4)) ? minDate : `${viewMonth.slice(0,4)}-01-01`).slice(5,7)) - 1)
  const firstTabYear = Math.max(decadeStart, Number(minDate?.slice(0,4)) || decadeStart)
  const gridKeys = event => {
    if (pickerView==='day' && event.target.dataset.date && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) {
      event.preventDefault()
      const date=new Date(`${event.target.dataset.date}T00:00:00Z`), day=date.getUTCDay()
      if(event.key==='PageUp'||event.key==='PageDown') {
        const month=shiftMonth(event.target.dataset.date.slice(0,7),event.key==='PageUp'?-1:1)
        date.setTime(Date.parse(`${month}-${String(Math.min(date.getUTCDate(),lastDayOfMonth(month))).padStart(2,'0')}T00:00:00Z`))
      } else date.setUTCDate(date.getUTCDate()+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-day,End:6-day})[event.key])
      const next=date.toISOString().slice(0,10)
      if(!isDateAllowed(next,min,max))return
      setPickerDate(next);setViewMonth(next.slice(0,7))
      requestAnimationFrame(()=>popover.current?.querySelector(`[data-date="${next}"]`)?.focus({preventScroll:true}))
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.target.getAttribute('role') !== 'gridcell') return
    event.preventDefault()
    const cells = [...event.currentTarget.querySelectorAll('[role=gridcell]')], index = cells.indexOf(event.target)
    const columns = pickerView === 'day' ? 7 : pickerView === 'month' ? 3 : 2
    const offset = pickerView === 'day' ? firstWeekday : 0
    const column = (index + offset) % columns
    let next = event.key === 'Home' ? Math.max(0, index - column) : event.key === 'End' ? Math.min(cells.length - 1, index + columns - column - 1)
      : index + ({ ArrowLeft:-1, ArrowRight:1, ArrowUp:-columns, ArrowDown:columns })[event.key]
    const direction = next < index ? -1 : 1
    while (cells[next]?.disabled) next += direction
    if (!cells[next]) return
    event.target.tabIndex = -1
    cells[next].tabIndex = 0
    cells[next].focus({ preventScroll: true })
  }
  const prevDisabled = pickerView === 'day'
    ? Boolean(minDate && viewMonth <= minDate.slice(0, 7))
    : pickerView === 'month'
      ? Boolean(minDate && Number(viewMonth.slice(0, 4)) <= Number(minDate.slice(0, 4)))
      : Boolean(minDate && decadeStart - 1 < Number(minDate.slice(0, 4)))
  const nextDisabled = pickerView === 'day'
    ? Boolean(maxDate && viewMonth >= maxDate.slice(0, 7))
    : pickerView === 'month'
      ? Boolean(maxDate && Number(viewMonth.slice(0, 4)) >= Number(maxDate.slice(0, 4)))
      : Boolean(maxDate && decadeStart + 10 > Number(maxDate.slice(0, 4)))
  const selectedTime = pickerTime || (type === 'datetime-local' ? '00:00' : '')
  const pickerLabel = range ? t('Chọn khoảng ngày') : type === 'time' ? t('Chọn giờ') : t('Chọn ngày')
  const movePrevious = () => setViewMonth(current => pickerView === 'day' ? shiftMonth(current, -1) : pickerView === 'month' ? shiftYear(current, -1) : shiftYear(current, -10))
  const moveNext = () => setViewMonth(current => pickerView === 'day' ? shiftMonth(current, 1) : pickerView === 'month' ? shiftYear(current, 1) : shiftYear(current, 10))
  const chooseMonth = month => { if (!monthAllowed(month, min, max)) return; setViewMonth(month); setPickerDate(`${month}-${String(Math.min(monthDate(pickerDate).getUTCDate(), lastDayOfMonth(month))).padStart(2, '0')}`); setPickerView('day') }
  const chooseYear = year => { if (!yearAllowed(year, min, max)) return; const month = `${year}-${String(monthDate(pickerDate).getUTCMonth() + 1).padStart(2, '0')}`; setViewMonth(month); setPickerDate(`${month}-${String(Math.min(monthDate(pickerDate).getUTCDate(), lastDayOfMonth(month))).padStart(2, '0')}`); setPickerView('month') }

  const heading = pickerView === 'year'
    ? <strong aria-live="polite">{decadeStart} – {decadeStart + 9}</strong>
    : pickerView === 'month'
      ? <button type="button" className="project-date-heading-button" onClick={() => setPickerView('year')}>{parsedMonth.getUTCFullYear()}</button>
      : <><button type="button" className="project-date-heading-button" onClick={() => setPickerView('month')}>{parsedMonth.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })}</button><button type="button" className="project-date-heading-button" onClick={() => setPickerView('year')}>{parsedMonth.getUTCFullYear()}</button></>

  const field = <input {...props} ref={text} type="text" inputMode="text" value={draft} aria-invalid={Boolean(inputError || validationError || props['aria-invalid']) || undefined} aria-describedby={[props['aria-describedby'],(inputError||validationError)?`${popoverId}-error`:null].filter(Boolean).join(' ') || undefined} placeholder={range ? 'dd/mm/yyyy – dd/mm/yyyy' : type === 'date' ? 'dd/mm/yyyy' : type === 'time' ? 'HH:mm' : 'dd/mm/yyyy HH:mm'} aria-expanded={open} aria-controls={open ? popoverId : undefined} onChange={event => { setDraft(event.target.value); publish(event, event.target.value) }} onBlur={event => {
      const parsed = range ? parseRange(draft) : parseDateField(draft, type)
      if (parsed && !inputError) setDraft(display(parsed))
      props.onBlur?.(event)
    }} onKeyDown={event=>{ props.onKeyDown?.(event); if(event.key==='ArrowDown' && event.altKey){event.preventDefault();if(!open)openPicker()} }} />
  const error = (inputError || validationError) && <span id={`${popoverId}-error`} className="project-date-validation" role="alert">{inputError || validationError}</span>
  return <span className={`project-date-input${dropdown ? ' is-dropdown' : ''}${range ? ' is-range' : ''}${clearable ? ' is-clearable' : ''}${open ? ' is-open' : ''}`} ref={root}>
    {!dropdown && <>{field}{error}{clearable && <button type="button" className="project-date-clear" aria-label={`${t('Xóa ngày')} · ${props['aria-label'] || ''}`} disabled={props.disabled || !draft} onClick={event => { setDraft(''); publish(event, ''); focusField() }}><AppIcon name="close" size={16} /></button>}</>}
    <button ref={trigger} type="button" className={dropdown ? 'fxa-button project-date-trigger' : 'project-date-picker'} aria-label={dropdown ? props['aria-label'] || pickerLabel : pickerLabel} aria-invalid={dropdown && Boolean(inputError || validationError) || undefined} aria-describedby={dropdown && (inputError || validationError) ? `${popoverId}-error` : undefined} title={dropdown ? display(value) || undefined : undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined} disabled={props.disabled} onClick={openPicker}><AppIcon name={type==='time'?'clock':'calendar'} size={16}/>{dropdown && <><span>{display(value) || props['aria-label'] || pickerLabel}</span><AppIcon name="chevron-down" size={16}/></>}</button>
    {dropdown && error}
    {open && !props.disabled && <div ref={popover} id={popoverId} className={`project-date-popover${type==='time'?' is-time-only':''}`} popover="manual" role="dialog" aria-label={pickerLabel}>
      {dropdown && <div className="project-date-popup-field">{field}</div>}
      {type === 'time' ? <TimeSpinner value={parseDateField(draft,'time') || value} seconds={Number(step || 60)<60 || value.split(':').length>2} onChange={chooseTime} /> : <>
        <div className="project-date-popover-heading"><button type="button" aria-label={t(pickerView === 'day' ? 'Previous month' : pickerView === 'month' ? 'Previous year' : 'Previous decade')} disabled={prevDisabled} onClick={movePrevious}><Chevron direction="prev" /></button><div className="project-date-heading-content">{heading}</div><button type="button" aria-label={t(pickerView === 'day' ? 'Next month' : pickerView === 'month' ? 'Next year' : 'Next decade')} disabled={nextDisabled} onClick={moveNext}><Chevron direction="next" /></button></div>
        {pickerView === 'day' && <div className="project-date-calendar" role="grid" aria-label={pickerLabel} onKeyDown={gridKeys}>{WEEKDAYS.map(day => <span key={day} role="columnheader">{t(day)}</span>)}{Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}{Array.from({ length: monthDays }, (_, index) => {
          const date = `${viewMonth}-${String(index + 1).padStart(2, '0')}`, disabled = !isDateAllowed(date, min, max), selected = range ? date === (pendingStart || value.from) || !pendingStart && date===value.to : date === datePart(value), inRange = range && !pendingStart && date>value.from && date<value.to, current = date === today()
          return <button key={date} type="button" role="gridcell" data-date={date} tabIndex={date === tabDate ? 0 : -1} aria-label={dateFieldDisplay(date, 'date')} aria-selected={selected} aria-current={current ? 'date' : undefined} disabled={disabled} className={`${selected ? 'is-selected' : ''}${inRange ? ' is-in-range' : ''}${current ? ' is-today' : ''}`} onClick={() => chooseDate(date)}>{index + 1}</button>
        })}</div>}
        {pickerView === 'month' && <div className="project-date-month-grid" onKeyDown={gridKeys} role="grid" aria-label={t('Chọn tháng')}>{Array.from({ length: 12 }, (_, index) => { const month = `${viewMonth.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`, selected = month === selectedMonth; return <button key={month} type="button" role="gridcell" tabIndex={index === firstTabMonth ? 0 : -1} aria-pressed={selected} disabled={!monthAllowed(month, min, max)} className={selected ? 'is-selected' : ''} onClick={() => chooseMonth(month)}>{monthDate(month).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })}</button> })}</div>}
        {pickerView === 'year' && <div className="project-date-year-grid" onKeyDown={gridKeys} role="grid" aria-label={t('Chọn năm')}>{Array.from({ length: 10 }, (_, index) => { const year = decadeStart + index, selected = year === selectedYear; return <button key={year} type="button" role="gridcell" tabIndex={year === firstTabYear ? 0 : -1} aria-pressed={selected} disabled={!yearAllowed(year, min, max)} className={selected ? 'is-selected' : ''} onClick={() => chooseYear(year)}>{year}</button> })}</div>}
        {type === 'datetime-local' && <div className="project-date-time-field"><TimeSpinner value={selectedTime} seconds={Number(step || 60)<60 || selectedTime.split(':').length>2} onChange={chooseTime}/></div>}
      </>}
      {range && <p className="project-date-range-hint" role="status">{t(pendingStart?'Chọn ngày kết thúc':'Chọn ngày bắt đầu')}</p>}
      <footer className="project-date-popover-footer">{type !== 'time' && <button type="button" onClick={() => { if(range){ const raw=rangeDisplay({from:today(),to:today()});setDraft(raw);publish({type:'change'},raw);setPendingStart(null);setOpen(false);focusField();return } chooseDate(today(), type === 'datetime-local' && todayTime === 'end-of-day' ? '23:59' : null) }} disabled={!isDateAllowed(today(), min, max)}>{t('Hôm nay')}</button>}<span />{clearable && <button type="button" onClick={event => { setDraft(''); publish(event, ''); setOpen(false); focusField() }}>{t('Clear')}</button>}<button type="button" className="is-primary" disabled={Boolean(inputError || validationError)} onClick={() => { setOpen(false); focusField() }}>{t('Xong')}</button></footer>
    </div>}
  </span>
}
