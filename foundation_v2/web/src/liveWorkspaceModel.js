import { dayBoundary } from './timezone.js'
import { civilMonthWeeks } from './calendarViewModel.js'

export const LIVE_FILTERS = Object.freeze({ asset: 'all', side: 'all', outcome: 'all', account: 'all', day: 'all', timezone: 'UTC', from: '', to: '' })

export function dealNet(deal) {
  const values = [deal.profit, deal.commission, deal.swap, deal.fee]
  return values.every(value => typeof value === 'number' && Number.isFinite(value)) ? values.reduce((sum, value) => sum + value, 0) : null
}

export function dayKey(timestamp, timezone = 'UTC') {
  if (!Number.isFinite(timestamp)) return ''
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
  const part = type => parts.find(part => part.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function filterLiveDeals(payload, filters = LIVE_FILTERS) {
  if (!payload?.account || filters.account !== 'all' && filters.account !== payload.account.account_ref) return []
  return (payload.deals || []).filter(deal => {
    if (![0, 1].includes(deal.type)) return false
    if (filters.tags?.length && !filters.tags.some(tag => deal.record?.payload?.tags?.includes(tag))) return false
    const day = dayKey(deal.time_msc, filters.timezone), net = dealNet(deal)
    return (filters.asset === 'all' || deal.symbol === filters.asset)
      && (filters.side === 'all' || deal.type === Number(filters.side))
      && (filters.outcome === 'all' || net !== null && (filters.outcome === 'gain' ? net > 1e-12 : filters.outcome === 'loss' ? net < -1e-12 : Math.abs(net) <= 1e-12))
      && (filters.day === 'all' || day && new Date(`${day}T00:00:00Z`).getUTCDay() === Number(filters.day))
      && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
  })
}

export function summarizeDeals(deals, available = true) {
  return { count: available ? deals.length : null, net: available && deals.every(deal => dealNet(deal) !== null) ? deals.reduce((sum, deal) => sum + dealNet(deal), 0) : null }
}

export function calendarWeeks(month, payload, deals, filters = LIVE_FILTERS) {
  const available = Boolean(payload?.account && Array.isArray(payload.deals))
  const coverage = (payload?.coverage?.length ? payload.coverage : [payload]).map(source => ({ history: Date.parse(source?.history_from_utc), cutoff: Date.parse(source?.captured_at_utc) }))
  const boundaries = new Map()
  const boundary = key => {
    if (!boundaries.has(key)) boundaries.set(key, dayBoundary(key, filters.timezone))
    return boundaries.get(key)
  }
  const buckets = new Map()
  deals.forEach(deal => { const key = dayKey(deal.time_msc, filters.timezone); if (key) buckets.set(key, [...(buckets.get(key) || []), deal]) })
  return civilMonthWeeks(month).map(week => week.map(({ date, key, inMonth }) => {
    const rows = buckets.get(key) || []
    const eligible = Boolean(inMonth && (filters.account === 'all' || filters.account === payload?.account?.account_ref)
      && (!filters.from || key >= filters.from) && (!filters.to || key <= filters.to)
      && (filters.day === 'all' || date.getUTCDay() === Number(filters.day)))
    // A zero is proven only for an entire local day, including DST boundaries.
    const coveredAccounts = available && eligible ? coverage.filter(({ history, cutoff }) => {
      if (!Number.isFinite(history) || !Number.isFinite(cutoff) || history >= cutoff) return false
      const start = boundary(key), end = boundary(new Date(date.getTime() + 86400000).toISOString().slice(0, 10))
      return history <= start && cutoff >= end && start < end
    }).length : 0
    const covered = eligible && coveredAccounts === coverage.length && coveredAccounts > 0
    const summary = summarizeDeals(rows, eligible && (covered || rows.length > 0))
    return { key, date, inMonth, eligible, covered, partial: eligible && (!covered || summary.net === null), ...summary }
  }))
}

export function cumulativeDealSeries(deals) {
  let total = 0, unknown = false
  return [...deals].filter(deal => Number.isFinite(deal.time_msc)).sort((a, b) => a.time_msc - b.time_msc).map(deal => {
    const net = dealNet(deal)
    if (net === null) unknown = true
    else total += net
    return { time: deal.time_msc, value: unknown ? null : total }
  })
}

export function calendarWeekSummary(week, empty = false) {
  // Zero is the empty calendar scaffold, not a substitute for missing account data.
  if (empty) return { count: 0, net: 0, partial: false }
  const days = week.filter(day => day.eligible ?? day.inMonth)
  const known = days.filter(day => day.count !== null)
  return {
    count: known.length ? known.reduce((sum, day) => sum + day.count, 0) : null,
    net: known.length && known.every(day => day.net !== null) ? known.reduce((sum, day) => sum + day.net, 0) : null,
    partial: days.some(day => day.partial || day.count === null || day.net === null),
  }
}
