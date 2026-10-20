import { displayDate } from './dateFormat.js'
import { known as finite, outcomeOf } from './tradingAnalyticsModel.js'

function firstKnown(...values) {
  return values.find((value) => finite(value))
}


export function dateFromValue(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null
  const numericInput = typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))
  if (numericInput && finite(value)) {
    const numeric = Number(value)
    const milliseconds = Math.abs(numeric) >= 100000000000 ? numeric : numeric * 1000
    const parsed = new Date(milliseconds)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatNumber(value, digits = 2, suffix = '') {
  if (!finite(value)) return 'N/A'
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}`
}


function netFromLedger(ledger) {
  if (!Array.isArray(ledger) || !ledger.length || !ledger.every((trade) => finite(trade?.net_pnl))) return null
  return ledger.reduce((total, trade) => total + Number(trade.net_pnl), 0)
}

export function buildAnalyticsModel(result, reportKind = 'app') {
  const metrics = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {}
  const ledger = Array.isArray(result?.ledger) ? result.ledger : []
  const providedNet = firstKnown(metrics.net_pnl, metrics.net_profit, result?.net_pnl)
  const netPnl = result?.multi_session ? null : providedNet ?? netFromLedger(ledger)
  const providedTradeCount = firstKnown(result?.trade_count, metrics.trade_count, metrics.closed_trade_count)
  const tradeCount = providedTradeCount ?? (Array.isArray(result?.ledger) ? ledger.length : null)
  const ledgerHasCompletePnl = ledger.length > 0 && ledger.every((trade) => finite(trade?.net_pnl))
  const providedWins = firstKnown(metrics.wins, metrics.winning_trades)
  const providedLosses = firstKnown(metrics.losses, metrics.losing_trades)
  const providedBreakeven = firstKnown(metrics.breakeven, metrics.breakeven_trades)
  const wins = finite(providedWins) ? Number(providedWins) : (ledgerHasCompletePnl ? ledger.filter((trade) => outcomeOf(trade.net_pnl) === 'win').length : null)
  const losses = finite(providedLosses) ? Number(providedLosses) : (ledgerHasCompletePnl ? ledger.filter((trade) => outcomeOf(trade.net_pnl) === 'loss').length : null)
  const breakeven = finite(providedBreakeven) ? Number(providedBreakeven) : (ledgerHasCompletePnl ? ledger.filter((trade) => outcomeOf(trade.net_pnl) === 'breakeven').length : null)
  const providedWinRate = firstKnown(metrics.win_rate_pct, metrics.win_rate, result?.win_rate_pct)
  const winRate = providedWinRate ?? (ledgerHasCompletePnl ? (wins / ledger.length) * 100 : null)
  const providedExpectancy = firstKnown(metrics.expectancy, metrics.expectancy_account, metrics.expectancy_net_per_trade)
  const expectancy = providedExpectancy ?? (finite(netPnl) && finite(tradeCount) && Number(tradeCount) > 0 ? Number(netPnl) / Number(tradeCount) : null)
  const rawCurve = Array.isArray(metrics.closed_trade_balance_curve) ? metrics.closed_trade_balance_curve : Array.isArray(metrics.equity_curve) ? metrics.equity_curve : []
  const curve = rawCurve.map((point, index) => ({ index, value: finite(point?.closed_trade_balance ?? point?.balance ?? point?.value ?? point) ? Number(point?.closed_trade_balance ?? point?.balance ?? point?.value ?? point) : null, tradeId: point?.trade_id || null })).filter((point) => point.value !== null)
  const rawDrawdown = Array.isArray(metrics.closed_trade_balance_drawdown_curve) ? metrics.closed_trade_balance_drawdown_curve : []
  let peak = null
  const drawdown = rawDrawdown.length ? rawDrawdown.map((point, index) => ({ index, drawdown: finite(point?.drawdown) ? Number(point.drawdown) : null, drawdownPct: finite(point?.drawdown_pct) ? Number(point.drawdown_pct) : null })) : curve.map((point, index) => { peak = peak === null ? point.value : Math.max(peak, point.value); const value = Math.max(0, peak - point.value); return { index, drawdown: value, drawdownPct: peak ? (value / peak) * 100 : null } })
  const knownDrawdown = drawdown.map((point) => point.drawdown).filter(Number.isFinite)
  const maxDrawdown = firstKnown(metrics.closed_trade_balance_max_drawdown, metrics.max_drawdown, metrics.max_dd) ?? (knownDrawdown.length ? Math.max(...knownDrawdown) : null)
  const observedRange = result?.observed_range || result?.range || {}
  const observedStart = observedRange.start_utc || observedRange.start || observedRange.from_utc || observedRange.from
  const observedEnd = observedRange.end_utc || observedRange.end || observedRange.to_utc || observedRange.to
  const ledgerDates = ledger.flatMap((trade) => [trade?.open_time_utc, trade?.close_time_utc]).map(dateFromValue).filter(Boolean).sort((a, b) => a - b)
  const dateLabel = (value) => { const date = dateFromValue(value); return !date ? 'N/A' : displayDate(date) }
  const rows = ledger.map((trade, index) => { const pnl = finite(trade?.net_pnl) ? Number(trade.net_pnl) : null; const date = dateFromValue(trade?.close_time_utc); return { ...trade, report_kind: reportKind, rowIndex: index, tradeId: trade?.trade_id || `trade-${index + 1}`, pnl, outcome: outcomeOf(pnl), source: trade?.source?.session_id || trade?.session_id || trade?.source_id || 'research ledger', closeDate: date ? displayDate(date, { timeStyle: 'medium' }) : 'N/A' } })
  const realizedRValues = (Array.isArray(metrics.realized_r_values) ? metrics.realized_r_values : rows.map((trade) => trade.realized_r)).filter(finite).map(Number)
  const metricDefinitions = metrics.definitions && typeof metrics.definitions === 'object'
    ? Object.entries(metrics.definitions).slice(0, 16).reduce((out, [key, value]) => {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 240)
      else if (value && typeof value === 'object') {
        const detail = [value.question, value.unit && `unit=${value.unit}`, value.formula && `formula=${value.formula}`, value.source && `source=${value.source}`, value.version && `v=${value.version}`].filter((item) => typeof item === 'string' && item.trim()).join(' · ')
        if (detail) out[key] = detail.slice(0, 240)
      }
      return out
    }, {})
    : {}
  const startBalance = firstKnown(metrics.starting_balance, result?.starting_balance, curve[0]?.value)
  const endingBalance = firstKnown(metrics.ending_closed_trade_balance, metrics.ending_balance, curve[curve.length - 1]?.value)
  const strategy = result?.strategy_version || result?.playbook_id || result?.engine_version || 'N/A'
  const range = { start: dateLabel(observedStart || ledgerDates[0]?.toISOString()), end: dateLabel(observedEnd || ledgerDates[ledgerDates.length - 1]?.toISOString()) }
  const takeaway = !tradeCount ? 'Chưa có giao dịch đóng.' : !finite(netPnl) ? `${formatNumber(tradeCount, 0)} giao dịch đóng · Net PnL chưa có dữ liệu.` : `${formatNumber(tradeCount, 0)} giao dịch đóng · Net PnL ${formatNumber(netPnl, 2, result?.account_currency || 'account units')}`
  return {
    result: result || null,
    metrics,
    ledger: rows,
    tradeCount,
    netPnl,
    winRate,
    expectancy,
    maxDrawdown,
    profitFactor: firstKnown(metrics.profit_factor, metrics.profit_factor_after_cost),
    payoffRatio: firstKnown(metrics.payoff_ratio_after_cost, metrics.payoff_ratio),
    wins,
    losses,
    breakeven,
    curve,
    drawdown,
    realizedRValues,
    metricDefinitions,
    startBalance,
    endingBalance,
    observed: range,
    strategy,
    sourceHash: result?.artifact_sha256 || 'N/A',
    derivedNet: !finite(providedNet) && finite(netPnl),
    derivedWinRate: !finite(providedWinRate) && finite(winRate),
    derivedExpectancy: !finite(providedExpectancy) && finite(expectancy),
    takeaway,
  }
}

export function readAnalyticsFilters(query) {
  const from = query?.get('from_close_utc') || query?.get('from') || ''
  const to = query?.get('to_close_utc') || query?.get('to') || ''
  return {
    side: (query?.get('side') || 'all').toLowerCase(),
    outcome: (query?.get('outcome') || 'all').toLowerCase(),
    from: from ? String(from).slice(0, 10) : '',
    to: to ? String(to).slice(0, 10) : '',
  }
}

function dateBoundary(value, endOfDay = false) {
  if (!value) return ''
  return `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
}

export function analyticsQuery(filters) {
  const params = new URLSearchParams()
  if (filters.side && filters.side !== 'all') params.set('side', filters.side)
  if (filters.outcome && filters.outcome !== 'all') params.set('outcome', filters.outcome)
  if (filters.from) params.set('from_close_utc', dateBoundary(filters.from))
  if (filters.to) params.set('to_close_utc', dateBoundary(filters.to, true))
  return params
}

export function analyticsViewResult(view) {
  if (!view || typeof view !== 'object') return null
  const provenance = view.provenance && typeof view.provenance === 'object' ? view.provenance : {}
  const scope = view.scope && typeof view.scope === 'object' ? view.scope : {}
  const observed = scope.observed_range && typeof scope.observed_range === 'object' ? scope.observed_range : {}
  return {
    ...provenance,
    partial: view.partial === true || view.freshness === 'partial' || provenance.status === 'partial',
    dataset_id: provenance.dataset_id,
    dataset_sha256: provenance.dataset_sha256,
    protocol_sha256: provenance.protocol_sha256,
    metrics_schema_version: provenance.metrics_schema_version,
    split: provenance.split,
    playbook_id: provenance.playbook_id,
    strategy_version: provenance.playbook_id || provenance.playbook_revision || 'N/A',
    observed_range: { start_utc: observed.first_close_utc, end_utc: observed.last_close_utc },
    metrics: view.metrics && typeof view.metrics === 'object' ? view.metrics : {},
    ledger: Array.isArray(view.ledger) ? view.ledger : [],
    analytics_available: view.analytics_available,
    blocked_by_data: Array.isArray(view.blocked_by_data) ? view.blocked_by_data : [],
    filters: view.filters && typeof view.filters === 'object' ? view.filters : {},
    scope,
  }
}

