import { useTestingLocale } from './testingLocale.jsx'
import TestingIcon from './TestingIcon.jsx'
import { civilMonthWeeks, shiftCalendarMonth } from './calendarViewModel.js'
import './calendar-view.css'

export function CalendarNavigation({ month, onChange, view = 'month', onViewChange, children }) {
  const { t, locale } = useTestingLocale()
  const first = new Date(`${month}-01T00:00:00Z`)
  const step = (delta, label, icon) => <button type="button" className="fxa-button fxa-icon-button" aria-label={t(label)} disabled={shiftCalendarMonth(month, delta) === month} onClick={() => onChange(shiftCalendarMonth(month, delta))}><TestingIcon kind={icon}/></button>
  return <div className="wm-calendar-toolbar"><div className="wm-calendar-navigation">
    {view === 'month' && <div className="wm-calendar-step">{step(-1, 'Previous month', 'chevron-left')}<span aria-live="polite">{first.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })}</span>{step(1, 'Next month', 'chevron-right')}</div>}
    <div className="wm-calendar-step">{step(-12, 'Previous year', 'chevron-left')}<span aria-live="polite">{first.getUTCFullYear()}</span>{step(12, 'Next year', 'chevron-right')}</div>
  </div><div className="wm-calendar-actions">{children}{onViewChange && <div className="fxa-segmented" role="group" aria-label={t('Chế độ xem lịch')}>{[['month','Tháng'],['year','Năm']].map(([key,label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => onViewChange(key)}>{t(label)}</button>)}</div>}</div></div>
}

export function CalendarDay({ day, value, count, note, selected, onClick, disabled, label, tooltip, showAdd = false, tone = '', compact = false, className = '', numberClassName = '' }) {
  const Element = onClick ? 'button' : 'div'
  return <Element type={onClick ? 'button' : undefined} role={onClick ? undefined : 'group'} className={`wm-calendar-day ${className}${!day.inMonth ? ' is-outside' : ''}${tone ? ` is-${tone}` : ''}${compact ? ' is-compact' : ''}`} data-date={day.key} disabled={onClick ? disabled || !day.inMonth : undefined} aria-pressed={onClick ? selected : undefined} aria-label={label} data-tooltip={tooltip} onClick={onClick}>
    <span className="wm-calendar-cell-top">{!compact && count && <small>{count}</small>}<span className={`wm-calendar-date ${numberClassName}`}>{day.date.getUTCDate()}</span></span>
    {!compact && <span className="wm-calendar-result">{value !== undefined && <strong>{value}</strong>}{note && <small>{note}</small>}</span>}
    {showAdd && day.inMonth && !disabled && <span className="wm-calendar-add" aria-hidden="true"><TestingIcon kind="zoom-in" size={20}/></span>}
  </Element>
}

export function CalendarMonth({ month, weeks = civilMonthWeeks(month), label, renderDay, renderWeekTotal, compact = false, classes = {} }) {
  const { t } = useTestingLocale()
  return <div className={`wm-calendar-scroll ${classes.scroll || ''}${compact ? ' is-compact' : ''}`} role="region" aria-label={label} tabIndex={compact ? undefined : 0}><div className={`wm-calendar-grid ${classes.grid || ''}${renderWeekTotal ? ' has-week-totals' : ''}`} style={{ '--live-calendar-weeks': weeks.length }}>
    {['Mo','Tu','We','Th','Fr','Sa','Su',...(renderWeekTotal ? ['Total'] : [])].map(day => <div className={`wm-calendar-dayname ${classes.weekday || ''}${day === 'Total' ? ' is-total' : ''}`} key={day}>{t(day)}</div>)}
    {weeks.map((week,index) => <div className={`wm-calendar-week ${classes.week || ''}`} key={week[0].key}>{week.map(day => renderDay(day, compact))}{renderWeekTotal?.(week,index)}</div>)}
  </div></div>
}
