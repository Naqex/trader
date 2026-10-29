import { brokerTradeRows } from './liveBrokerTrades.js'
import { dealNet } from './liveWorkspaceModel.js'
import { calendarParts, filterAnalyticsRows } from './tradingAnalyticsModel.js'

// Adapt Live facts to the Training filter contract; keep the original table row.
export function liveLedgerRows(payload, timeBasis = 'market') {
  const manual = Boolean(payload?.manual)
  return (manual ? payload.deals : brokerTradeRows(payload)).map(sourceRow => {
    const trade = sourceRow.record?.payload
    const status = manual ? 'closed' : sourceRow.status.toLowerCase()
    const marketTime = manual ? trade.closed_at_utc : status === 'closed' ? sourceRow.close_time_utc : sourceRow.open_time_utc
    // Broker executions happen in real time. Snapshot polling is not trade activity.
    const activityTime = manual ? sourceRow.record.created_at_utc : marketTime
    return {
      sourceRow, symbol: sourceRow.symbol,
      side: sourceRow.type === 0 ? 'buy' : sourceRow.type === 1 ? 'sell' : null,
      status, net_pnl: status === 'open' ? null : manual ? dealNet(sourceRow) : sourceRow.net_pnl,
      table_time_utc: timeBasis === 'activity' ? activityTime : marketTime,
      tags: manual ? trade.tags || [] : [],
      notes: manual ? trade.note || '' : '',
      has_notes: manual ? Boolean(trade.note?.trim()) : null,
    }
  })
}

export function liveLedgerFacets(rows, timezone) {
  const dates = rows.map(row => calendarParts(row.table_time_utc, timezone)?.key).filter(Boolean).sort()
  return { years: [...new Set(dates.map(date => date.slice(0, 4)))], date_range: { from: dates[0], to: dates.at(-1) } }
}

export function filterLiveLedgerRows(rows, filters, extra) {
  return filterAnalyticsRows(rows, extra).filter(row => {
    if (!filters.from && !filters.to) return true
    const date = calendarParts(row.table_time_utc, extra.timezone)?.key
    return date && (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
  }).map(row => row.sourceRow)
}
