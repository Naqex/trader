import { known, number, realizedRiskValue } from './tradingAnalyticsModel.js'
import { closeTime } from './sessionPerformanceModel.js'

export function profitFactorGauge(rows) {
  if (!rows.every(row => known(row.net_pnl))) return { status: 'unavailable', value: null, fraction: null }
  const profit = rows.reduce((sum, row) => sum + Math.max(0, Number(row.net_pnl)), 0)
  const loss = rows.reduce((sum, row) => sum + Math.max(0, -Number(row.net_pnl)), 0)
  if (!Number.isFinite(profit) || !Number.isFinite(loss)) return { status: 'unavailable', value: null, fraction: null }
  if (!loss && profit) return { status: 'unbounded', value: null, fraction: 1 }
  const value = loss ? profit / loss : 0
  // Four is an owner-selected display cap, not a performance rating.
  return { status: 'finite', value, fraction: Math.min(value / 4, 1) }
}

export function excursionSummary(experiments, trades) {
  const selected = new Map(trades.map(row => [row.tradeId, row]))
  const rows = (experiments?.rows || []).filter(row => selected.has(row.trade_id))
  const observed = rows.filter(row => row.excursion?.r_basis === 'initial_stop_distance' && known(row.excursion.mae_r) && Number(row.excursion.mae_r) >= 0)
  const values = observed.map(row => Number(row.excursion.mae_r)).filter(value => value >= 0)
  const isWinner = trade => trade.outcome ? trade.outcome === 'win' : known(trade.net_pnl) && Number(trade.net_pnl) > 1e-12
  const winners = observed.filter(row => isWinner(selected.get(row.trade_id))).map(row => Number(row.excursion.mae_r))
  const winnerCount = trades.filter(isWinner).length
  const completeWinners = winnerCount > 0 && winners.length === winnerCount && !trades.some(trade => trade.outcome === 'unknown')
  const maximum = values.length ? Math.max(...values) : 0
  const limit = Math.min(3, Math.max(1, Math.ceil(maximum * 10) / 10)), width = limit > 2.5 ? .2 : .1
  const bins = Array.from({ length: Math.ceil(limit / width) }, (_, index) => ({ start: Number((index * width).toFixed(1)), end: Math.min(limit, Number(((index + 1) * width).toFixed(1))), count: 0 }))
  bins.push({ start: limit, end: null, count: 0 })
  // Exact boundaries belong to the next bucket, including the overflow bucket.
  values.forEach(value => bins[value >= limit ? bins.length - 1 : Math.min(bins.length - 2, Math.floor(Number((value / width).toFixed(10))))].count++)
  return { rows, observed, values, bins: values.length ? bins : [], winners, winnerCount, completeWinners,
    average: completeWinners ? winners.reduce((a,b) => a+b,0) / winners.length : null,
    min: completeWinners ? Math.min(...winners) : null, max: completeWinners ? Math.max(...winners) : null }
}

export function realizedRiskSeries(experiments, trades) {
  const observed = new Map((experiments?.rows || []).map(row => [row.trade_id, row]))
  return trades.map(row => ({ value: realizedRiskValue(row, observed.get(row.tradeId)), tradeId: row.tradeId }))
}

export function idealRiskSummary(experiments, trades) {
  const source = new Map((experiments?.rows || []).map(row => [row.trade_id, row]))
  const eligible = trades.flatMap(trade => {
    const ideal = source.get(trade.tradeId)?.ideal
    return ideal?.status === 'complete_week' && known(ideal.value_r) ? [{ ...ideal, tradeId: trade.tradeId, outcome: trade.outcome }] : []
  })
  const values = eligible.map(item => Number(item.value_r)), losers = eligible.filter(item => item.outcome === 'loss')
  const byId = new Map(eligible.map(item => [item.tradeId, item]))
  return { eligible, series: trades.map(trade => ({ value: number(byId.get(trade.tradeId)?.value_r), tradeId: trade.tradeId })), average: values.length ? values.reduce((a,b)=>a+b,0)/values.length : null, max: values.length ? Math.max(...values) : null,
    recoveryCount: losers.length ? losers.filter(item => item.could_have_profit_or_breakeven === true).length : null, lossKnownCount: losers.length }
}

export function scenarioComparison(rows, trades, key, startBalance) {
  const byId = new Map(trades.map(row => [row.tradeId, row]))
  const source = new Map(rows.map(row => [row.trade_id, row]))
  // Both curves must use the same eligible trades; unresolved rows never become zero.
  const eligible = trades.map(trade => source.get(trade.tradeId)).filter(row => row?.[key]?.status === 'ready' && known(row[key].net_pnl) && known(byId.get(row.trade_id)?.net_pnl))
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

export function scenarioRiskCurve(rows, trades, key) {
  const source = new Map(rows.map(row => [row.trade_id, row]))
  const eligible = trades.flatMap((trade, index) => {
    const observation = source.get(trade.tradeId), outcome = observation?.[key]
    const actualR = realizedRiskValue(trade, observation), net = number(trade.net_pnl)
    // Recover the same original-risk denominator used by canonical R; 0/0
    // needs a declared original risk budget, never an account-balance fallback.
    const inferredRisk = net !== null && actualR !== null && actualR !== 0 ? number(net / actualR) : null
    const risk = inferredRisk > 0 ? inferredRisk : net === 0 && actualR === 0 ? number(trade.planned_risk_budget) : null
    const ms = closeTime(trade.close_time_utc)?.getTime() ?? NaN
    const simulatedR = risk > 0 && known(outcome?.net_pnl) ? number(Number(outcome.net_pnl) / risk) : null
    return outcome?.status === 'ready' && actualR !== null && simulatedR !== null && net !== null && Number.isFinite(ms)
      ? [{ tradeId: trade.tradeId, actualR, simulatedR, ms, index }] : []
  }).sort((a, b) => a.ms - b.ms || a.index - b.index)
  let actual = 0, simulated = 0
  const baseline = [], scenario = []
  for (const row of eligible) {
    actual = actual === null ? null : number(actual + row.actualR)
    simulated = simulated === null ? null : number(simulated + row.simulatedR)
    baseline.push({ tradeId: row.tradeId, value: actual })
    scenario.push({ tradeId: row.tradeId, value: simulated })
  }
  return { eligible, baseline, scenario, timestamps: eligible.map(row => row.ms) }
}

function scenarioRunSample(runs, activeValues) {
  const curves = activeValues.flatMap(value => runs[value] ? [{ value, curve: runs[value], byId: new Map(runs[value].eligible.map(row => [row.tradeId, row])) }] : [])
  const common = curves.length ? curves[0].curve.eligible.filter(row => curves.every(item => item.byId.has(row.tradeId))) : []
  return { curves, common }
}

export function scenarioChartSeries(runs, activeValues) {
  const { curves, common } = scenarioRunSample(runs, activeValues)
  return { values: curves.map(item => item.value), timestamps: common.map(row => row.ms),
    series: curves.map(item => {
      let total = 0
      return common.map(row => {
        total = total === null ? null : number(total + item.byId.get(row.tradeId).simulatedR)
        return { tradeId: row.tradeId, value: total }
      })
    }) }
}

export function scenarioResults(runs, activeValues, trades, key) {
  const { curves, common } = scenarioRunSample(runs, activeValues)
  const source = new Map(trades.map(trade => [trade.tradeId, trade]))
  const currencies = new Set(common.map(row => source.get(row.tradeId)?.account_currency).filter(Boolean))
  const currency = currencies.size === 1 && common.every(row => source.get(row.tradeId)?.account_currency) ? [...currencies][0] : null
  const round = (value, digits = 2) => Number.isFinite(value) ? (Math.abs(value) < Number.MAX_SAFE_INTEGER / 10 ** digits ? Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits : value) : value === Infinity ? Infinity : null
  const entries = curves.map(item => {
    let total = 0, peak = 0, depth = 0, grossWin = 0, grossLoss = 0, wins = 0, losses = 0
    const drawdowns = [], outcomes = new Map((item.curve.rows || []).map(row => [row.trade_id, row[key]]))
    const profits = []
    for (const row of common) {
      const r = item.byId.get(row.tradeId).simulatedR
      total += r
      if (r > 0) { wins++; grossWin += r }
      if (r < 0) { losses++; grossLoss -= r }
      // A drawdown episode ends at a new high, matching the reference's R path.
      if (total > peak) { if (depth > 0) drawdowns.push(depth); depth = 0; peak = total }
      else depth = Math.max(depth, peak - total)
      profits.push(number(outcomes.get(row.tradeId)?.net_pnl))
    }
    if (depth > 0) drawdowns.push(depth)
    const hasSample = common.length > 0 && Number.isFinite(total) && Number.isFinite(grossWin) && Number.isFinite(grossLoss)
    return { value: item.value, totalR: hasSample ? round(total) : null,
      winRate: hasSample && wins + losses ? round(wins / (wins + losses) * 100, 2) : null,
      profitFactor: hasSample ? round(grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0) : null,
      averageDrawdown: hasSample ? round(drawdowns.length ? drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length : 0) : null,
      profit: hasSample && currency && profits.every(value => value !== null) ? round(number(profits.reduce((sum, value) => sum + value, 0))) : null,
      averageWinR: hasSample ? round(wins ? grossWin / wins : 0) : null }
  })
  const ranking = key === 'risk_reward' ? [['profitFactor', -1], ['averageDrawdown', 1], ['profit', -1], ['winRate', -1], ['averageWinR', -1]]
    : [['profitFactor', -1], ['averageDrawdown', 1], ['totalR', -1], ['winRate', -1]]
  const candidates = entries.filter(entry => ranking.every(([metric]) => entry[metric] !== null))
  const belowCutoff = key === 'stop_loss' ? candidates.filter(entry => entry.value < 80) : []
  const compare = (a, b) => {
    for (const [metric, direction] of ranking) {
      if (a[metric] !== b[metric]) return (a[metric] > b[metric] ? 1 : -1) * direction
    }
    return 0
  }
  const ranked = (belowCutoff.length ? belowCutoff : candidates).sort(compare)
  const bestValue = candidates.length >= 2 && ranked.length ? ranked[0].value : null
  const bestCells = Object.fromEntries(['winRate', 'totalR', 'profit', 'profitFactor', 'averageDrawdown'].map(metric => {
    const values = (belowCutoff.length ? belowCutoff : entries).filter(entry => entry[metric] !== null)
    const best = values.length ? (metric === 'averageDrawdown' ? Math.min : Math.max)(...values.map(entry => entry[metric])) : null
    return [metric, best]
  }))
  return { entries, currency, commonCount: common.length, bestValue, bestCells,
    sourceWins: common.filter(row => row.actualR > 0).length, sourceLosses: common.filter(row => row.actualR < 0).length }
}

export function bucketCurve(curve, rows, interval, timezone = 'UTC') {
  const observation = row => row?.analytics_time_utc !== undefined ? row.analytics_time_utc : row?.report_time_utc
  const rowMap = new Map(rows.map(row => [row.tradeId,row]))
  const timestamps = curve.map((point,index) => index === 0 ? null : observation(rowMap.get(point.tradeId)) ?? null)
  // The origin is an initial-state anchor at the first report observation,
  // not a fabricated timestamp before the known data.
  timestamps[0] = timestamps[1] ?? null
  if (interval === 'all') return { points: curve, labels: timestamps.map((time,index) => index ? time || '' : ''), timestamps }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit' })
  const groups = new Map()
  for (const point of curve.slice(1)) {
    const instant = observation(rowMap.get(point.tradeId))
    if (!instant) return { points: [], labels: [] }
    const numeric = typeof instant === 'number' || /^\d+(\.\d+)?$/.test(String(instant))
    const ms = numeric ? Number(instant) * (Number(instant) < 1e11 ? 1000 : 1) : Date.parse(instant)
    if (!Number.isFinite(ms)) return { points: [], labels: [] }
    const key = interval === 'day' ? formatter.format(new Date(ms)) : Math.floor(ms / (interval === 'hour' ? 3600000 : 900000))
    const previous = groups.get(key)
    groups.set(key, { end: { ...point, instant }, gap: previous?.gap || (!known(point.value) ? { ...point, instant } : null) })
  }
  const endpoints = [...groups.values()].flatMap(({ end, gap }) => gap && known(end.value) ? [gap, end] : [end])
  return { points: curve.length ? [curve[0], ...endpoints] : [], labels: ['', ...endpoints.map(point => point.instant)], timestamps: curve.length ? [timestamps[0], ...endpoints.map(point => point.instant)] : [] }
}
