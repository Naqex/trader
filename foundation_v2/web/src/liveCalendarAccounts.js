import { liveAccountCapital } from './liveAccountModel.js'
import { completedLiveTrades } from './liveBrokerTrades.js'

export function calendarAccountSelection(query) {
  const value = query.get('live_accounts')
  if (value === 'none') return []
  if (value === 'all') return null
  if (value !== null) return [...new Set(value.split(',').filter(Boolean))]
  return query.get('live_account') ? [query.get('live_account')] : null
}

export function combineCalendarAccounts(sources) {
  if (!sources.length) return { payload: null, issue: '' }
  if (sources.some(({ payload }) => !payload?.account || !Array.isArray(payload.deals))) return { payload: null, issue: 'Chưa đủ dữ liệu cho các tài khoản đã chọn.' }
  const currencies = new Set(sources.map(({ payload }) => payload.account.currency))
  if (currencies.size !== 1 || ![...currencies][0]) return { payload: null, issue: 'Các tài khoản khác tiền tệ chưa thể cộng PnL. Chọn các tài khoản cùng tiền tệ.' }
  if (sources.length === 1) return { payload: sources[0].payload, issue: sources[0].payload.stale ? 'Dữ liệu tài khoản đã cũ. Đồng bộ tài khoản để cập nhật.' : '' }
  const capitals = sources.map(({ payload }) => liveAccountCapital(payload))
  const sum = key => sources.every(({ payload }) => typeof payload.account[key] === 'number' && Number.isFinite(payload.account[key])) ? sources.reduce((total, { payload }) => total + payload.account[key], 0) : null
  const boundary = (key, operation) => {
    const times = sources.map(({ payload }) => Date.parse(payload[key]))
    return times.every(Number.isFinite) ? new Date(operation(...times)).toISOString() : null
  }
  return { payload: {
    account: { account_ref: sources.map(source => source.id).join(','), currency: [...currencies][0], balance: sum('balance'), opening_balance: capitals.every(value => value > 0) ? capitals.reduce((total, value) => total + value, 0) : null },
    manual: sources.every(({ payload }) => payload.manual), aggregate: true,
    stale: sources.some(({ payload }) => payload.stale === true),
    coverage: sources.map(({ id, payload }) => ({ id, history_from_utc: payload.history_from_utc, captured_at_utc: payload.captured_at_utc })),
    // Only the intersection can prove a day has complete data across accounts.
    history_from_utc: boundary('history_from_utc', Math.max), captured_at_utc: boundary('captured_at_utc', Math.min),
    deals: sources.flatMap(({ id, payload }) => payload.deals.map(deal => ({ ...deal, source_account: id }))),
    completed_trades: sources.flatMap(({ id, payload }) => completedLiveTrades(payload).map(trade => ({ ...trade, ticket: `${id}:${trade.ticket}`, source_account: id }))),
  }, issue: sources.some(({ payload }) => payload.stale) ? 'Dữ liệu tài khoản đã cũ. Đồng bộ tài khoản để cập nhật.' : '' }
}
