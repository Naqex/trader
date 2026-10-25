import { known, number } from './tradingAnalyticsModel.js'

export function excursionSummary(experiments, trades) {
  const selected = new Map(trades.map(row => [row.tradeId, row]))
  const rows = (experiments?.rows || []).filter(row => selected.has(row.trade_id))
  const observed = rows.filter(row => row.excursion?.r_basis === 'initial_stop_distance' && known(row.excursion.mae_r) && Number(row.excursion.mae_r) >= 0)
  const values = observed.map(row => Number(row.excursion.mae_r)).filter(value => value >= 0)
  const winners = observed.filter(row => Number(selected.get(row.trade_id).net_pnl) > 1e-12).map(row => Number(row.excursion.mae_r))
  const maximum = values.length ? Math.max(...values) : 0
  const width = maximum ? 10 ** Math.floor(Math.log10(maximum)) * ([1,2,5,10].find(step => step * 10 ** Math.floor(Math.log10(maximum)) >= maximum / 8) || 10) : .25
  const bins = Array.from({ length: Math.max(1, Math.ceil(maximum / width)) }, (_, index) => ({ start: index * width, end: (index + 1) * width, count: 0 }))
  values.forEach(value => bins[Math.min(bins.length - 1, Math.floor(value / width))].count++)
  return { rows, observed, values, bins: values.length ? bins : [], winners, average: winners.length ? winners.reduce((a,b) => a+b,0) / winners.length : null, min: winners.length ? Math.min(...winners) : null, max: winners.length ? Math.max(...winners) : null }
}

export function realizedRiskSeries(experiments, trades) {
  const observed = new Map((experiments?.rows || []).filter(row => row.excursion?.r_basis === 'initial_stop_distance').map(row => [row.trade_id, row.realized_r]))
  return trades.flatMap(row => {
    const fromRisk = number(row.planned_risk_budget) > 0 && known(row.net_pnl) ? Number(row.net_pnl) / Number(row.planned_risk_budget) : null
    const value = number(observed.get(row.tradeId)) ?? number(row.realized_r) ?? (Number.isFinite(fromRisk) ? fromRisk : null)
    return value === null ? [] : [{ value, tradeId: row.tradeId }]
  })
}

export function idealRiskSummary(experiments, trades) {
  const source = new Map((experiments?.rows || []).map(row => [row.trade_id, row]))
  const eligible = trades.flatMap(trade => {
    const ideal = source.get(trade.tradeId)?.ideal
    return ideal?.status === 'complete_week' && known(ideal.value_r) ? [{ ...ideal, tradeId: trade.tradeId, outcome: trade.outcome }] : []
  })
  const values = eligible.map(item => Number(item.value_r)), losers = eligible.filter(item => item.outcome === 'loss')
  return { eligible, series: eligible.map(item => ({ value: Number(item.value_r), tradeId: item.tradeId })), average: values.length ? values.reduce((a,b)=>a+b,0)/values.length : null, max: values.length ? Math.max(...values) : null,
    recoveryCount: losers.length ? losers.filter(item => item.could_have_profit_or_breakeven === true).length : null, lossKnownCount: losers.length }
}

export function scenarioComparison(rows, trades, key, startBalance) {
  const byId = new Map(trades.map(row => [row.tradeId, row]))
  const source = new Map(rows.map(row => [row.trade_id, row]))
  // Both curves must use the same eligible trades; unresolved rows never become zero.
  const eligible = trades.map(trade => source.get(trade.tradeId)).filter(row => row && known(row[key]?.net_pnl) && known(byId.get(row.trade_id)?.net_pnl))
  const baseline = [{ value: number(startBalance) }], scenario = [{ value: number(startBalance) }]
  let actual = number(startBalance), simulated = number(startBalance)
  eligible.forEach(row => { actual = actual === null ? null : actual + Number(byId.get(row.trade_id).net_pnl); simulated = simulated === null ? null : simulated + Number(row[key].net_pnl); baseline.push({ value: actual }); scenario.push({ value: simulated }) })
  const values = eligible.map(row => Number(row[key].net_pnl)), positive = values.filter(value => value > 1e-12), negative = values.filter(value => value < -1e-12)
  const rateCount = key === 'risk_reward' ? positive.length + negative.length : eligible.length
  let peak = number(startBalance)
  const drawdowns = peak === null ? [] : scenario.slice(1).map(point => { peak = Math.max(peak, point.value); return peak - point.value }).filter(value => value > 1e-12)
  return { eligible, baseline, scenario, net: eligible.length ? values.reduce((a,b)=>a+b,0) : null, winRate: rateCount ? positive.length / rateCount * 100 : null, profitFactor: negative.length ? positive.reduce((a,b)=>a+b,0) / Math.abs(negative.reduce((a,b)=>a+b,0)) : null,
    averageDrawdown: peak !== null && eligible.length ? drawdowns.length ? drawdowns.reduce((a,b)=>a+b,0)/drawdowns.length : 0 : null }
}

export function bucketCurve(curve, rows, interval, timezone = 'UTC') {
  const observation = row => row?.analytics_time_utc !== undefined ? row.analytics_time_utc : row?.report_time_utc
  if (interval === 'all') return { points: curve, labels: curve.map((point,index) => index === 0 ? '' : observation(rows.find(row => row.tradeId === point.tradeId)) || '') }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit' })
  const groups = new Map(), rowMap = new Map(rows.map(row => [row.tradeId,row]))
  for (const point of curve.slice(1)) {
    const instant = observation(rowMap.get(point.tradeId))
    if (!instant) return { points: [], labels: [] }
    const numeric = typeof instant === 'number' || /^\d+(\.\d+)?$/.test(String(instant))
    const ms = numeric ? Number(instant) * (Number(instant) < 1e11 ? 1000 : 1) : Date.parse(instant)
    if (!Number.isFinite(ms)) return { points: [], labels: [] }
    const key = interval === 'day' ? formatter.format(new Date(ms)) : Math.floor(ms / (interval === 'hour' ? 3600000 : 900000))
    groups.set(key, { ...point, instant })
  }
  return { points: curve.length ? [curve[0], ...groups.values()] : [], labels: ['', ...[...groups.values()].map(point => point.instant)] }
}
