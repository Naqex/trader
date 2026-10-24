import ProjectDateInput from './ProjectDateInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import React, { useEffect, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { calendarParts, DEFAULT_EXTRA_FILTERS, filterValues } from './tradingAnalyticsModel.js'
import FilterDrawer from './FilterDrawer.jsx'

const baseFilters = { side: 'all', outcome: 'all', from: '', to: '' }
function Choices({ label, options, value, onChange, rawLabels = false }) {
  const { t, locale } = useTestingLocale()

  const selected = filterValues(value)
  return <div className="fxl-choices" role="group" aria-label={label}>{options.length ? options.map(([key, name, disabled = false]) => <label key={key}><input type="checkbox" disabled={disabled} checked={selected.includes(String(key))} onChange={() => { const next = selected.includes(String(key)) ? selected.filter(item => item !== String(key)) : [...selected, String(key)]; onChange(next.length ? JSON.stringify(next) : '') }} />{rawLabels ? name : t(name)}</label>) : <p>{t('Chưa có lựa chọn cho {label}.', { label: t(label).toLocaleLowerCase(locale) })}</p>}</div>
}
function CalendarChoices({ label, options, value, onChange }) {
  const { t } = useTestingLocale()
  const selected = filterValues(value)
  return <FxSelect label={label} multiple searchable localizeOptions={false} value={selected} disabled={!options.length} triggerContent={selected.length ? options.filter(([key]) => selected.includes(String(key))).map(([, name]) => name).join(', ') : t('Chọn {label}', { label: label.toLocaleLowerCase() })} options={options.map(([key, name]) => ({ value: String(key), label: name }))} onChange={next => onChange(next.length ? JSON.stringify(next) : '')} />
}
export default function LedgerFilterDrawer({ initialTab, filters, extra, rows, facets, onApply, onClose }) {
  const { t, timezone } = useTestingLocale()

  const [draft, setDraft] = useState({ ...baseFilters, ...filters })
  const [draftExtra, setDraftExtra] = useState(() => ({ ...DEFAULT_EXTRA_FILTERS, ...extra,
    assets: extra.assets || (extra.asset !== 'all' ? JSON.stringify([extra.asset]) : ''),
    sides: extra.sides || (filters.side !== 'all' ? JSON.stringify([filters.side]) : ''),
    outcomes: extra.outcomes || (filters.outcome !== 'all' ? JSON.stringify([filters.outcome]) : ''),
    tagInclude: extra.tagInclude || (extra.tag !== 'all' ? JSON.stringify([extra.tag]) : ''),
    days: '', weekday: 'all',
    hours: extra.hours || (extra.hour !== 'all' ? JSON.stringify([extra.hour]) : ''),
  }))
  useEffect(() => setDraftExtra(value => ({ ...value, timezone })), [timezone])
  const change = patch => setDraftExtra(value => ({ ...value, ...patch }))
  const unique = key => (facets?.[{ symbol: 'assets', tags: 'tags', playbook_id: 'strategies', entry_type: 'types' }[key]] || [...new Set(rows.flatMap(row => key === 'tags' ? row.tags || [] : row[key] ? [row[key]] : []))].sort())
  const years = facets?.years || [...new Set(rows.map(row => calendarParts(row.report_time_utc, timezone)?.key.slice(0, 4)).filter(Boolean))].sort()
  const dates = rows.map(row => calendarParts(row.report_time_utc, timezone)?.key).filter(Boolean).sort()
  const dateRange = facets?.date_range || { from: dates[0], to: dates.at(-1) }
  const clear = () => { setDraft(baseFilters); setDraftExtra({ ...DEFAULT_EXTRA_FILTERS, timezone }) }
  const apply = () => {
    onApply({ ...draft, side: 'all', outcome: 'all' }, { ...draftExtra, timezone, notes: '', types: '', days: '', asset: 'all', tag: 'all', weekday: 'all', hour: 'all' })
    onClose()
  }
  const sections = [
    ['Notes', <Choices label={t('Notes')} value={draftExtra.notesPresence} options={[['with', 'Có ghi chú'], ['without', 'Không có ghi chú']]} onChange={notesPresence => change({ notesPresence })} />],
    ['Assets', <Choices rawLabels label={t("Assets")} value={draftExtra.assets} options={unique('symbol').map(value => [value, value])} onChange={assets => change({ assets })} />],
    ['Side', <Choices label={t("Side")} value={draftExtra.sides} options={[["buy", 'Buy'], ["sell", 'Sell']]} onChange={sides => change({ sides })} />],
    ['Outcome', <Choices label={t("Outcome")} value={draftExtra.outcomes} options={[["win", 'Win'], ["loss", 'Loss'], ["breakeven", 'Breakeven'], ["unknown", 'Unknown']]} onChange={outcomes => change({ outcomes })} />],
    ['Type', <><Choices label={t('Type')} value={draftExtra.statuses} options={[["pending", 'Lệnh chờ', true], ["canceled", 'Đã hủy', true], ["open", 'Đang mở', true], ["closed", 'Closed']]} onChange={statuses => change({ statuses })} /><small className="fxl-timezone">{t('Bảng giao dịch hiện chỉ hỗ trợ lệnh đã đóng.')}</small></>],
    ['Date range', <div className="fxl-fields"><label className="fxl-field">{t("From · close date (UTC)").replace(/UTC(?:[+-]\d+(?::\d+)?)?/, timezone)}<ProjectDateInput clearable type="date" aria-label={t("Analytics from date")} value={draft.from} min={dateRange.from} max={draft.to || dateRange.to} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label><label className="fxl-field">{t("To · close date (UTC)").replace(/UTC(?:[+-]\d+(?::\d+)?)?/, timezone)}<ProjectDateInput clearable type="date" aria-label={t("Analytics to date")} value={draft.to} min={draft.from || dateRange.from} max={dateRange.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label></div>],
    ['Year', <CalendarChoices label={t('Year')} value={draftExtra.years} options={years.map(value => [value, value])} onChange={years => change({ years })} />],
    ['Month', <CalendarChoices label={t('Month')} value={draftExtra.months} options={Array.from({ length: 12 }, (_, i) => [i + 1, t('Tháng {month}', { month: i + 1 })])} onChange={months => change({ months })} />],
    ['Hour of the day', <CalendarChoices label={t('Hour of the day')} value={draftExtra.hours} options={Array.from({ length: 24 }, (_, i) => [i, `${String(i).padStart(2, '0')}:00`])} onChange={hours => change({ hours })} />],
  ]
  const calendarActive = ['years', 'months', 'hours'].some(key => filterValues(draftExtra[key]).length)
  return <FilterDrawer initialTab={initialTab} sections={sections} onClose={onClose} onClear={clear} onApply={apply} invalid={Boolean(draft.from && draft.to && draft.from > draft.to)}
    note={calendarActive ? <small className="fxl-timezone">{t("Năm, tháng và giờ theo")} {timezone}.</small> : null}
    tags={<>{['Include', 'Exclude'].map((name, index) => {
        const key = name === 'Include' ? 'tagInclude' : 'tagExclude', mode = `${key}Mode`
        return <React.Fragment key={key}>{index > 0 && <div className="fxl-tag-separator">{t("AND")}</div>}<div className="fxl-tag-heading"><span>{t(name)}</span><div role="group" aria-label={t('Cách kết hợp {name}', { name: t(name) })}>{['AND', 'OR'].map(value => <button type="button" key={value} aria-pressed={draftExtra[mode] === value} onClick={() => change({ [mode]: value })}>{value}</button>)}</div></div><FxSelect localizeOptions={false} label={`${t(name)} ${t("Tags")}`} triggerContent={filterValues(draftExtra[key]).length ? filterValues(draftExtra[key]).join(', ') : t("Select tags")} multiple searchable value={filterValues(draftExtra[key])} options={unique('tags').map(value => ({ value, label: value }))} onChange={value => change({ [key]: value.length ? JSON.stringify(value) : '' })} /></React.Fragment>
      })}</>} />
}
