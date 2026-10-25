import { getTimezone, zonedDateKey } from './timezone.js'

function averagePeriod(item) {
  const periods = item.period_count
  return { ...item, ...Object.fromEntries(['value', 'profit', 'loss'].map(field => [field,
    Number.isSafeInteger(periods) && periods > 0 && Number.isFinite(item[field]) ? item[field] / periods : null])) }
}

// Average dated month totals across years, not individual trades or absent months.
export function averagePerformanceMonths(items) {
  const months = new Map()
  for (const item of items) {
    const label = item.label.slice(5), bucket = months.get(label) || { label, value: 0, profit: 0, loss: 0, count: 0, period_count: 0 }
    for (const field of ['value', 'profit', 'loss', 'count']) bucket[field] = Number.isFinite(bucket[field]) && Number.isFinite(item[field]) ? bucket[field] + item[field] : null
    bucket.period_count += 1
    months.set(label, bucket)
  }
  return [...months.values()].sort((a, b) => a.label.localeCompare(b.label)).map(averagePeriod)
}
export const averagePerformanceDays = items => items.map(averagePeriod)
export function closeTime(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))
  const date = new Date(numeric ? Number(value) * (Number(value) < 1e11 ? 1000 : 1) : value)
  return Number.isNaN(date.getTime()) ? null : date
}

// Aggregate reports use activity; a session summary follows its backtest calendar.
export function sessionPeriods(ledger, timezone = getTimezone(), now = new Date(), timeBasis = 'activity') {
  if (!ledger.length) return { months: [], weekdays: [], anchor: null, month: null, week: null, day: null, incomplete: false }
  const observed = ledger.map(trade => ({ date: closeTime(timeBasis === 'market' ? trade.close_time_utc : trade.report_time_utc), pnl: trade.net_pnl }))
  const rows = observed.filter(row => row.date && typeof row.pnl === 'number' && Number.isFinite(row.pnl))
  const incomplete = rows.length !== ledger.length
  const anchor = timeBasis === 'market' && rows.length ? new Date(rows.reduce((latest, row) => Math.max(latest, row.date.getTime()), -Infinity)) : closeTime(now)
  if (!rows.length || !anchor) return { months: [], weekdays: [], anchor, month: null, week: null, day: null, incomplete: true }
  const anchorKey = zonedDateKey(anchor, timezone)
  const dayStart = new Date(`${anchorKey}T00:00:00Z`)
  const weekStart = new Date(dayStart)
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7)
  const monthKey = anchorKey.slice(0, 7)
  const grouped = new Map()
  const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(label => ({ label, value: 0 }))
  const performanceMonths = new Map()
  const performanceDays = weekdays.map(item => ({ ...item, profit: 0, loss: 0, count: 0 }))
  const observedDays = weekdays.map(() => new Set())
  let month = 0, week = 0, day = 0
  for (const row of rows) {
    const localKey = zonedDateKey(row.date, timezone), localDate = new Date(`${localKey}T00:00:00Z`)
    const key = localKey.slice(0, 7)
    grouped.set(key, (grouped.get(key) || 0) + row.pnl)
    const weekday = (localDate.getUTCDay() + 6) % 7
    observedDays[weekday].add(localKey)
    weekdays[weekday].value += row.pnl
    const bucket = performanceMonths.get(key) || { label: key, value: 0, profit: 0, loss: 0, count: 0 }
    for (const group of [bucket, performanceDays[weekday]]) {
      group.value += row.pnl; group.profit += Math.max(0, row.pnl); group.loss += Math.min(0, row.pnl); group.count += 1
    }
    performanceMonths.set(key, bucket)
    if (key === monthKey) month += row.pnl
    if (localDate >= weekStart && localDate <= dayStart) week += row.pnl
    if (localKey === anchorKey) day += row.pnl
  }
  return { months: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })), weekdays, anchor, month, week, day, incomplete,
    performance: { months: [...performanceMonths.values()].sort((a,b) => a.label.localeCompare(b.label)), weekdays: performanceDays.map((item, index) => ({ ...item, period_count: observedDays[index].size })) } }
}
