export function shiftCalendarMonth(month, delta) {
  const [year, value] = month.split('-').map(Number)
  const index = Math.min(9999 * 12 + 11, Math.max(12, year * 12 + value - 1 + delta))
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`
}

export function civilMonthWeeks(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const first = new Date(`${month}-01T00:00:00Z`)
  const end = new Date(first); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0)
  const offset = (first.getUTCDay() + 6) % 7
  return Array.from({ length: Math.ceil((offset + end.getUTCDate()) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(first); date.setUTCDate(week * 7 + weekday - offset + 1)
      const key = date.toISOString().slice(0, 10)
      return { key, date, inMonth: key.startsWith(month) }
    }))
}

// Ratios aggregate their underlying observations, not the displayed daily ratios.
export function calendarPeriodSummary(items, unassignedCount = 0, sourcePartial = false) {
  const sum = key => items.reduce((total, item) => total + item[key], 0)
  const complete = items.every(item => item.complete) && unassignedCount === 0 && !sourcePartial
  const count = sum('count'), rCount = sum('rCount')
  return { observedCount: count, count: unassignedCount || sourcePartial ? null : count, rCount,
    partial: !complete, net: complete && count ? sum('net') : null,
    winRate: complete && count ? sum('wins') / count * 100 : null,
    averageR: !unassignedCount && !sourcePartial && rCount ? items.reduce((total, item) => total + (item.averageR ?? 0) * item.rCount, 0) / rCount : null }
}
