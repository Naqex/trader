import { getTimezone, zonedDateKey } from './timezone.js'

// Presentation groups calendar months across years; the dated source buckets stay intact.
export function groupPerformanceMonths(items) {
  const months = new Map()
  for (const item of items) {
    const label = item.label.slice(5), bucket = months.get(label) || { label, value: 0, profit: 0, loss: 0, count: 0 }
    for (const field of ['value', 'profit', 'loss', 'count']) bucket[field] = Number.isFinite(bucket[field]) && Number.isFinite(item[field]) ? bucket[field] + item[field] : null
    months.set(label, bucket)
  }
  return [...months.values()].sort((a, b) => a.label.localeCompare(b.label))
}
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
  let month = 0, week = 0, day = 0
  for (const row of rows) {
    const localKey = zonedDateKey(row.date, timezone), localDate = new Date(`${localKey}T00:00:00Z`)
    const key = localKey.slice(0, 7)
    grouped.set(key, (grouped.get(key) || 0) + row.pnl)
    const weekday = (localDate.getUTCDay() + 6) % 7
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
    performance: { months: [...performanceMonths.values()].sort((a,b) => a.label.localeCompare(b.label)), weekdays: performanceDays } }
}
