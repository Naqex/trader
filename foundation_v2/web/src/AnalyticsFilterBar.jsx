import { navigate } from './clientNavigation.js'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import React, { useEffect, useMemo, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { chartTimezones, setTimezone, timezoneLabel, timezoneOptionsAt } from './timezone.js'
import { DEFAULT_EXTRA_FILTERS, filterValues } from './tradingAnalyticsModel.js'
import { DateFilter, TimeFilter } from './AnalyticsFilterControls.jsx'
import './trade-labels.css'

const DAYS = [1, 2, 3, 4, 5, 6, 0].map(value => ({ value: String(value), label: value ? `Thứ ${value + 1}` : 'Chủ nhật' }))
const KINDS = { app: 'Backtesting', prop: 'Prop Firm', research: 'Research' }
const OUTCOMES = { win: 'Thắng', loss: 'Thua', breakeven: 'Hòa vốn' }

export default function AnalyticsFilterBar({ filters, onChange, extra, onExtra, rows, labels = [], onExport, pending, sessionControl, persistInUrl = true, sourceType = 'Backtesting', statusControl, disabled = false }) {
  const { t, timezone } = useTestingLocale()
  const live = sourceType === 'Live'
  const fixedPropSource = sourceType === 'Prop firm' || live
  const [draft, setDraft] = useState({ ...filters }), [draftExtra, setDraftExtra] = useState({ ...extra })
  const [timezoneNotice, setTimezoneNotice] = useState('')
  const sessionProps = sessionControl?.props
  const [draftSession, setDraftSession] = useState(sessionProps?.value)
  const appliedFilters = JSON.stringify(filters), appliedExtra = JSON.stringify(extra)
  const appliedSession = JSON.stringify(sessionProps?.value)
  // A refreshed report can recreate equal props while the user is still choosing.
  useEffect(() => setDraft(JSON.parse(appliedFilters)), [appliedFilters])
  useEffect(() => setDraftExtra(JSON.parse(appliedExtra)), [appliedExtra])
  useEffect(() => setDraftSession(appliedSession === undefined ? undefined : JSON.parse(appliedSession)), [appliedSession])
  const timezoneOptions = useMemo(() => timezoneOptionsAt(new Date(), [...new Set([...chartTimezones, timezone])]), [timezone])
  const unique = key => [...new Set(rows.flatMap(row => key === 'tags' ? row.tags || [] : row[key] ? [row[key]] : []))].sort()
  const change = patch => setDraft(value => ({ ...value, ...patch }))
  const changeExtra = patch => setDraftExtra(value => ({ ...value, ...patch }))
  const allKinds = sourceType === 'Research' ? ['app', 'prop', 'research'] : ['app', 'prop']
  const kindValues = draftExtra.reportKinds === '' ? allKinds : filterValues(draftExtra.reportKinds)
  const labelNames = [...new Set([...labels.filter(item => item.active !== false).map(item => item.name), ...unique('tags'), ...filterValues(draftExtra.tagInclude), ...(extra.tag !== 'all' ? [extra.tag] : [])])]
  const choices = values => values.map(value => ({ value, label: value, localize: false }))
  const apply = (next = draft, nextExtra = draftExtra, nextSession = draftSession) => {
    setDraft(next); setDraftExtra(nextExtra); setDraftSession(nextSession)
    // Persist the complete scope before a session change remounts its report.
    if (persistInUrl) {
      const url = new URL(window.location.href)
      url.searchParams.delete('analytics_timezone')
      url.searchParams.delete('from_close_utc'); url.searchParams.delete('to_close_utc')
      for (const key of ['side', 'outcome', 'from', 'to']) next[key] && next[key] !== 'all' ? url.searchParams.set(key, next[key]) : url.searchParams.delete(key)
      for (const [key, value] of Object.entries(nextExtra)) {
        if (key === 'timezone') continue
        const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
        value !== DEFAULT_EXTRA_FILTERS[key] ? url.searchParams.set(param, value) : url.searchParams.delete(param)
      }
      navigate(url, { replace: true })
    }
    onChange(next); onExtra(nextExtra)
    if (nextExtra.timezone !== timezone) setTimezoneNotice(setTimezone(nextExtra.timezone) ? '' : t('Đã áp dụng trong phiên này. Trình duyệt đang chặn lưu tùy chọn; bạn có thể thử lưu lại.'))
    if (sessionProps && nextSession !== sessionProps.value) sessionProps.onChange(nextSession)
  }
  const multi = (label, key, values, legacy, server = false, renderOption) => {
    const chosen = filterValues(draftExtra[key]), old = (server ? draft : draftExtra)[legacy]
    const selected = chosen.length ? chosen : old && old !== 'all' ? [old] : []
    return <FxSelect key={key} label={label} triggerContent={t(label)} searchable multiple value={selected} options={values} renderOption={renderOption} onChange={next => {
      changeExtra({ [key]: JSON.stringify(next), ...(!server && legacy ? { [legacy]: 'all' } : {}), ...(key === 'tagInclude' ? { tagIncludeMode: 'OR' } : {}) })
      if (server) change({ [legacy]: 'all' })
    }} />
  }
  const describe = (key, value) => {
    const values = ['assets', 'sides', 'outcomes', 'tagInclude', 'days', 'reportKinds'].includes(key) ? filterValues(value) : [value]
    return values.map(item => key === 'side' || key === 'sides' ? t(item === 'buy' ? 'Buy' : 'Sell')
      : key === 'outcome' || key === 'outcomes' ? t(OUTCOMES[item] || 'Chưa rõ')
      : key === 'weekday' || key === 'days' ? t(DAYS.find(day => day.value === String(item))?.label || item)
      : key === 'reportKinds' ? t(KINDS[item] || item) : item).join(', ') || t('None')
  }
  const chips = [
    ['asset', 'Assets', extra.asset], ['side', 'Side', filters.side, true], ['outcome', 'Outcome', filters.outcome, true],
    ['tag', 'Tags', extra.tag], ['strategy', 'Strategy', extra.strategy], ['weekday', 'Ngày', extra.weekday],
    ['hour', 'Time', extra.hour === 'all' ? 'all' : `${String(extra.hour).padStart(2, '0')}:00–${String(extra.hour).padStart(2, '0')}:59`],
    ['search', 'Search', extra.search],
    ...[['assets', 'Assets'], ['sides', 'Side'], ['outcomes', 'Outcome'], ['tagInclude', 'Tags'], ['days', 'Ngày']].map(([key, label]) => [key, label, filterValues(extra[key]).length ? extra[key] : 'all']),
    ['reportKinds', 'Type', extra.reportKinds === '' || allKinds.every(kind => filterValues(extra.reportKinds).includes(kind)) ? 'all' : extra.reportKinds],
  ].filter(([, , value]) => value !== '' && value != null && value !== 'all')
  const hasDates = Boolean(filters.from || filters.to), hasTime = Boolean(extra.timeStart || extra.timeEnd)
  const activeFilters = chips.length > 0 || hasDates || hasTime
  const sessionName = sessionProps?.items?.find(item => item.record_id === sessionProps.value)?.name
  const invalidDates = draft.from && draft.to && draft.from > draft.to
  return <section className="fxa-filters fxa-analytics-filters" inert={disabled || undefined} aria-disabled={disabled || undefined} aria-label={t('Bộ lọc analytics')} data-testid="analytics-filters">
    <div className="fxa-analytics-filter-row">
      {!fixedPropSource && <FxSelect className="is-filter" label="Type" triggerContent="Type" menuTitle="Type filter" searchable multiple selectAllLabel="All" value={kindValues} options={[{ value: 'app', label: 'Backtesting' }, { value: 'battles', label: 'Battles', disabled: true, detail: 'Chưa có nguồn dữ liệu Battles' }, { value: 'prop', label: 'Prop Firm' }, ...(sourceType === 'Research' ? [{ value: 'research', label: 'Research' }] : [])]} onChange={values => changeExtra({ reportKinds: allKinds.every(kind => values.includes(kind)) ? '' : JSON.stringify(values) })} />}
      {multi('Assets', 'assets', choices(unique('symbol')), 'asset')}
      {multi('Side', 'sides', [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }], 'side', true)}
      {multi('Outcome', 'outcomes', Object.entries(OUTCOMES).map(([value, label]) => ({ value, label })), 'outcome', true)}
      {multi('Tags', 'tagInclude', choices(labelNames), 'tag', false, option => <span className="wm-trade-label" data-color={labels.find(item => item.name === option.value)?.color || 'gray'}>{option.label}</span>)}
      {sessionControl && React.cloneElement(sessionControl, { value: draftSession, onChange: setDraftSession, triggerContent: live ? t('Accounts') + (draftSession?.length ? ` · ${draftSession.length}` : '') : 'Session', compact: true })}
      {!fixedPropSource && <FxSelect label="Strategy" triggerContent="Strategy" value={draftExtra.strategy} options={[{ value: 'all', label: 'Tất cả strategies' }, ...choices(unique('playbook_id'))]} searchable onChange={value => changeExtra({ strategy: value })} />}
      {multi('Ngày', 'days', DAYS, 'weekday')}
      {!live && <TimeFilter value={draftExtra} onChange={changeExtra} />}
      <FxSelect className="fxa-timezone-filter" label="Múi giờ" triggerContent={`${t('Múi giờ')} (${timezoneLabel(draftExtra.timezone)})`} value={draftExtra.timezone} localizeOptions={false} searchable options={timezoneOptions} onChange={value => changeExtra({ timezone: value })} />
      <DateFilter value={draft} onChange={change} label={live ? 'Date range' : 'Ngày đóng lệnh'} title="Lọc ngày đóng lệnh" calendarLabel="Chọn khoảng ngày đóng" />
      <button type="button" className="fxa-button fxa-apply-button" disabled={Boolean(invalidDates)} onClick={() => apply()}>{t('Apply')}</button>
      <span className="fxa-analytics-filter-status">{statusControl}</span>
      {onExport && <button className="fxa-button fxa-icon-button fxa-export-button" type="button" aria-label={t('Xuất CSV')} disabled={pending} onClick={onExport}><TestingIcon kind="download" size={16} /></button>}
    </div>
    {invalidDates && <p role="alert" className="fxa-error">{t('Ngày kết thúc phải từ ngày bắt đầu trở đi.')}</p>}
    {timezoneNotice && <p role="status">{timezoneNotice}</p>}
    {(sessionName || activeFilters) && <div className="fxa-filter-chips" aria-label={t('Bộ lọc đã áp dụng')}>
      {sessionName && <span className="fxa-filter-chip" data-tooltip={sessionName}>{t('Session')} · {sessionName}</span>}
      {chips.map(([key, label, value, server]) => <button key={key} type="button" className="fxa-filter-chip" aria-label={t('Bỏ lọc {label}', { label: t(label) })} onClick={() => apply(server ? { ...filters, [key]: 'all' } : filters, server ? extra : { ...extra, [key]: DEFAULT_EXTRA_FILTERS[key] }, sessionProps?.value)}><span>{t(label)} · {describe(key, value)}</span><span aria-hidden="true">×</span></button>)}
      {hasTime && <button type="button" className="fxa-filter-chip" aria-label={t('Bỏ lọc Giờ')} onClick={() => apply(filters, { ...extra, timeStart: '', timeEnd: '', hour: 'all' }, sessionProps?.value)}>{t('Time')} · {extra.timeStart || '00:00'}–{extra.timeEnd || '23:59'}<span aria-hidden="true">×</span></button>}
      {hasDates && <button type="button" className="fxa-filter-chip" aria-label={t('Bỏ lọc ngày đóng lệnh')} onClick={() => apply({ ...filters, from: '', to: '' }, extra, sessionProps?.value)}>{filters.from ? displayDate(filters.from) : '…'} → {filters.to ? displayDate(filters.to) : '…'}<span aria-hidden="true">×</span></button>}
      {activeFilters && <button type="button" className="fxa-clear-filters" onClick={() => apply({ ...filters, side: 'all', outcome: 'all', from: '', to: '' }, { ...DEFAULT_EXTRA_FILTERS, timezone }, sessionProps?.value)}><TestingIcon kind="delete" size={16} />{t('Clear filters')}</button>}
    </div>}
  </section>
}
