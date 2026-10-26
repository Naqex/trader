import { DEFAULT_EXTRA_FILTERS, filterValues } from './tradingAnalyticsModel.js'

export const LEDGER_BASE_FILTERS = { side: 'all', outcome: 'all', from: '', to: '' }
const GROUPS = [
  ['side', 'Side', true], ['outcome', 'Outcome', true],
  ['asset', 'Assets'], ['tag', 'Tags'], ['strategy', 'Strategy'], ['source', 'Source'],
  ['search', 'Search'], ['notesPresence', 'Notes', false, true], ['statuses', 'Type', false, true],
  ['assets', 'Assets', false, true], ['sides', 'Side', false, true], ['outcomes', 'Outcome', false, true],
  ['years', 'Year', false, true], ['months', 'Month', false, true], ['hours', 'Hour of the day', false, true],
  ['reportKinds', 'Type', false, true], ['tagInclude', 'Include', false, true], ['tagExclude', 'Exclude', false, true],
  ['hour', 'Hour of the day'],
]

export function ledgerFilterChips(filters, extra) {
  const chips = GROUPS.flatMap(([key, label, base, multiple]) => {
    const value = (base ? filters : extra)[key]
    const values = multiple ? filterValues(value) : value && value !== 'all' ? [value] : []
    return values.length ? [{ key, label, base: Boolean(base), values }] : []
  })
  if (filters.from || filters.to) chips.push({ key: 'dates', label: 'Date range', values: [filters.from, filters.to] })
  if (extra.timeStart || extra.timeEnd) chips.push({ key: 'time', label: 'Time', values: [extra.timeStart, extra.timeEnd] })
  return chips
}

export function removeLedgerFilter(filters, extra, chip) {
  if (chip.key === 'dates') return [{ ...filters, from: '', to: '' }, extra]
  if (chip.key === 'time') return [filters, { ...extra, timeStart: '', timeEnd: '' }]
  return chip.base ? [{ ...filters, [chip.key]: LEDGER_BASE_FILTERS[chip.key] }, extra]
    : [filters, { ...extra, [chip.key]: DEFAULT_EXTRA_FILTERS[chip.key] }]
}

// Write a complete scope once: drawer apply and chip removal must not race two navigations.
export function ledgerFilterUrl(href, filters, extra, timeBasis) {
  const url = new URL(href)
  for (const key of ['from_close_utc', 'to_close_utc', 'analytics_timezone']) url.searchParams.delete(key)
  for (const key of Object.keys(LEDGER_BASE_FILTERS)) filters[key] && filters[key] !== 'all' ? url.searchParams.set(key, filters[key]) : url.searchParams.delete(key)
  for (const [key, fallback] of Object.entries(DEFAULT_EXTRA_FILTERS)) {
    if (key === 'timezone') continue
    const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
    const value = extra[key] ?? fallback
    value !== fallback ? url.searchParams.set(param, value) : url.searchParams.delete(param)
  }
  url.searchParams.set('trades_time_basis', timeBasis === 'activity' ? 'activity' : 'market')
  return url
}
