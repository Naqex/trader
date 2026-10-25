import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'

function model(values, times = values.map((_, index) => `2024-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`)) {
  let balance = 1000, peak = balance
  const curve = [{ index: 0, value: balance }], drawdown = []
  const ledger = values.map((net_pnl, index) => {
    balance += net_pnl; peak = Math.max(peak, balance)
    const tradeId = `trade-${index}`
    curve.push({ index: index + 1, value: balance, tradeId })
    drawdown.push({ index: index + 1, drawdown: peak - balance, drawdownPct: (peak - balance) / peak * 100 })
    return { tradeId, net_pnl, report_time_utc: times[index] }
  })
  return { ledger, curve, drawdown, startBalance: 1000, endingBalance: balance }
}

test('average streak counts each run once and breakeven closes a run', () => {
  const data = advancedAnalytics(model([10, 20, -1, -2, -3, 0, 4, -1, 5, 6, 7]))
  assert.equal(data.averageWinStreak, 2)
  assert.equal(data.averageLossStreak, 2)
  assert.equal(data.maxWinStreak, 3)
  assert.equal(data.maxLossStreak, 3)
  assert.equal(advancedAnalytics(model([1, 2])).averageLossStreak, null)
  const missing = model([1, 2]); missing.ledger[1].net_pnl = null
  assert.equal(advancedAnalytics(missing).averageWinStreak, null)
})

test('net R uses supplied realized R or a positive original account risk budget', () => {
  const source = model([20, 30, 40, 50, 60])
  source.ledger[0].realized_r = 2
  source.ledger[1].planned_risk_budget = 10
  source.ledger[2].planned_risk_budget = 0
  source.ledger[3].planned_risk_budget = -5
  source.ledger[4].stop_loss = 1; source.ledger[4].take_profit = 10
  const data = advancedAnalytics(source)
  assert.deepEqual(data.riskReward, { average: 2.5, max: 3, knownCount: 2, totalCount: 5, basis: 'net_realized_r', idealAverage: null, idealMax: null })
  assert.equal(data.averageR, 2.5)
  assert.equal(data.rCount, 2)
  source.ledger[0].realized_r = null; source.ledger[0].net_pnl = 1e308; source.ledger[0].planned_risk_budget = 1e-308
  assert.equal(advancedAnalytics(source).rCount, 1, 'overflow is unavailable')
})

test('price excursions and configured-stop experiments cannot become actual MAE R', () => {
  const source = model([10])
  Object.assign(source.ledger[0], { mae_price: 0.1, mae_r: 1, r_basis: 'configured_stop_distance', ideal_r: 5 })
  const data = advancedAnalytics(source)
  assert.deepEqual(data.excursion, { maeHistogram: [], winningAdverseR: null, knownCount: 0, basis: 'unavailable' })
  assert.equal(data.riskReward.idealAverage, null)
})

test('frequency series fills civil days, Monday weeks and months across DST', () => {
  const data = advancedAnalytics(model([1, 2, 3], ['2024-03-09T23:30:00Z', '2024-03-11T03:30:00Z', '2024-03-12T04:30:00Z']), { timezone: 'America/New_York' })
  assert.deepEqual(data.frequencySeries.day, [{ label: '2024-03-09', count: 1 }, { label: '2024-03-10', count: 1 }, { label: '2024-03-11', count: 0 }, { label: '2024-03-12', count: 1 }])
  assert.deepEqual(data.frequencySeries.week, [{ label: '2024-03-04', count: 2 }, { label: '2024-03-11', count: 1 }])
  assert.deepEqual(data.frequencySeries.month, [{ label: '2024-03', count: 3 }])
  assert.equal(data.frequency[0].count, 0.75)
  const sparse = advancedAnalytics(model([1, 2], ['2023-12-31T12:00:00Z', '2024-02-01T12:00:00Z']))
  assert.deepEqual(sparse.frequencySeries.month, [{ label: '2023-12', count: 1 }, { label: '2024-01', count: 0 }, { label: '2024-02', count: 1 }])
})

test('frequency does not substitute chart or entry time for missing close observations', () => {
  const source = model([1, 2], [null, null])
  Object.assign(source.ledger[0], { recorded_at_utc: '2024-01-01T12:00:00Z', close_time_utc: '2003-01-01T12:00:00Z' })
  assert.deepEqual(advancedAnalytics(source).frequencySeries, { day: [], week: [], month: [] })
})

test('recovery uses elapsed 24-hour days from the last balance peak, including DST', () => {
  const data = advancedAnalytics(model([100, -20, 20], ['2024-03-09T17:00:00Z', '2024-03-10T16:00:00Z', '2024-03-11T16:00:00Z']), { timezone: 'America/New_York' })
  assert.equal(data.recoveryDays, 47 / 24)
  assert.equal(data.longestRecoveryDays, 47 / 24)
  assert.equal(data.recoveryDaysKnownCount, 1)
  assert.equal(data.recoveryEpisodes[0].peakTimeUtc, '2024-03-09T17:00:00.000Z')
  assert.equal(data.recoveryEpisodes[0].recovered, true)
  assert.match(data.recoveryBasis, /closed_trade_balance/)
  const sameInstant = advancedAnalytics(model([1, -1, 1], Array(3).fill('2024-01-01T12:00:00Z')))
  assert.equal(sameInstant.recoveryDays, 0)
})

test('initial-baseline, unknown-time and unfinished recovery durations stay unavailable', () => {
  assert.equal(advancedAnalytics(model([-10, 10])).recoveryDays, null)
  assert.equal(advancedAnalytics(model([10, -5, 5], ['2024-01-01T12:00:00Z', null, null])).recoveryDays, null)
  const ongoing = advancedAnalytics(model([10, -5]))
  assert.equal(ongoing.recoveryDays, null)
  assert.equal(ongoing.recoveryEpisodes[0].recovered, false)
  assert.equal(ongoing.recoveryEpisodes[0].recoveryTimeUtc, null)
})

test('session bands own local close hours and provide all four radar dimensions', () => {
  const source = model([20, -10], ['2024-03-09T12:30:00Z', '2024-03-10T12:30:00Z'])
  source.ledger.forEach(row => { row.planned_risk_budget = 10 })
  const data = advancedAnalytics(source, { timezone: 'America/New_York' })
  assert.deepEqual(data.sessionGrouping, { basis: 'fixed_close_hour_bands', timezone: 'America/New_York', timeField: 'report_time_utc' })
  const before = data.sessions.find(item => item.label === '00–08'), after = data.sessions.find(item => item.label === '08–13')
  assert.equal(before.count, 1); assert.equal(before.net, 20); assert.equal(before.winRate, 100); assert.equal(before.averageR, 2)
  assert.equal(after.count, 1); assert.equal(after.net, -10); assert.equal(after.winRate, 0); assert.equal(after.averageR, -1)
})

test('breakeven threshold reclassifies outcomes and runs consistently without changing money', () => {
  const source = model([10, 1, 20, -1, -5, -10])
  source.ledger.forEach(row => { row.side = 'BUY' })
  const original = advancedAnalytics(source), data = advancedAnalytics(source, {}, { breakevenThreshold: 1 })
  assert.equal(data.wins, 2); assert.equal(data.losses, 2); assert.equal(data.breakeven, 2)
  assert.equal(data.winRate, 2 / 6 * 100)
  assert.equal(data.averageWin, 15); assert.equal(data.averageLoss, -7.5)
  assert.equal(data.averageWinStreak, 1); assert.equal(data.averageLossStreak, 2)
  assert.equal(data.maxWinStreak, 1); assert.equal(data.maxLossStreak, 2)
  assert.equal(data.side[0].breakeven, 2); assert.equal(data.side[0].winRate, data.winRate)
  assert.equal(data.sessions.reduce((sum, item) => sum + item.breakeven, 0), 2)
  assert.equal(data.months[0].breakeven, 2)
  assert.deepEqual(data.rows.map(row => row.outcome), ['win', 'breakeven', 'win', 'breakeven', 'loss', 'loss'])
  assert.equal(data.net, original.net); assert.deepEqual(data.curve, original.curve); assert.deepEqual(data.drawdown, original.drawdown)
  assert.equal(data.endingBalance, original.endingBalance)
  assert.deepEqual(data.classification, { breakevenThreshold: 1, winRateBasis: 'wins_over_all_closed_trades_including_breakeven' })
  assert.equal(advancedAnalytics(source, { outcomes: '["breakeven"]' }, { breakevenThreshold: 1 }).count, 2)
  assert.deepEqual(advancedAnalytics(source, {}, { breakevenThreshold: -1 }).classification, original.classification)
})

test('default threshold preserves epsilon and never classifies missing money as breakeven', () => {
  const source = model([1e-13, -1e-13, 1])
  const data = advancedAnalytics(source, {}, { breakevenThreshold: 0 })
  assert.equal(data.breakeven, 2)
  source.ledger[0].net_pnl = null
  assert.equal(advancedAnalytics(source).rows[0].outcome, 'unknown')
})
