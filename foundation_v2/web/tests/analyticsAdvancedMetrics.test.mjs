import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics, accountEquityDrawdown } from '../src/tradingAnalyticsModel.js'
import { buildAnalyticsModel } from '../src/analyticsViewModel.js'

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

test('frequency averages active civil dates, ISO weeks and months across DST', () => {
  const data = advancedAnalytics(model([1, 2, 3], ['2024-03-09T23:30:00Z', '2024-03-11T03:30:00Z', '2024-03-12T04:30:00Z']), { timezone: 'America/New_York' })
  assert.deepEqual(data.frequencySeries.day.filter(row => row.periodCount).map(row => [row.label, row.average]), [['T3', 1], ['T7', 1], ['CN', 1]])
  assert.deepEqual(data.frequencySeries.week, [{ label: '10', tradeCount: 2, periodCount: 1, average: 2 }, { label: '11', tradeCount: 1, periodCount: 1, average: 1 }])
  assert.deepEqual(data.frequencySeries.month.find(row => row.label === '03'), { label: '03', tradeCount: 3, periodCount: 1, average: 3 })
  assert.equal(data.frequency[0].average, 1)
  const sparse = advancedAnalytics(model([1, 2], ['2023-12-31T12:00:00Z', '2024-02-01T12:00:00Z']))
  assert.deepEqual(sparse.frequencySeries.month.filter(row => row.periodCount).map(row => row.label), ['02', '12'])
  assert.equal(sparse.frequencySeries.month[0].average, null, 'an inactive month is not an observed zero')
  assert.equal(sparse.frequency[2].average, 1, 'empty intervening months do not enter the active-period denominator')
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

test('published UTC sessions overlap and stay independent of display zone and DST', () => {
  const source = model([20, -10, 30, 5], ['2024-03-09T07:00:00Z', '2024-03-10T13:00:00Z', '2024-03-10T22:00:00Z', '2024-03-10T09:00:00Z'])
  source.ledger.forEach(row => { row.planned_risk_budget = 10 })
  const data = advancedAnalytics(source, { timezone: 'America/New_York' })
  assert.deepEqual(data.sessionGrouping, { basis: 'fixed_utc_market_windows_overlapping', timezone: 'UTC', timeField: 'report_time_utc' })
  assert.deepEqual(data.sessions.map(item => [item.label,item.count,item.net]), [['Out of session',1,30],['Asia',1,20],['New York',1,-10],['London',3,15]])
  assert.equal(data.sessions.find(item => item.label === 'London').profitPct, 1.5)
  assert.deepEqual(data.sessions, advancedAnalytics(source, { timezone: 'Asia/Ho_Chi_Minh' }).sessions)
})

test('breakeven threshold reclassifies outcomes and runs consistently without changing money', () => {
  const source = model([10, 1, 20, -1, -5, -10])
  source.ledger.forEach(row => { row.side = 'BUY'; row.planned_risk_budget = 1 })
  const original = advancedAnalytics(source), data = advancedAnalytics(source, {}, { breakevenThreshold: 1 })
  assert.equal(data.wins, 2); assert.equal(data.losses, 2); assert.equal(data.breakeven, 2)
  assert.equal(data.winRate, 2 / 6 * 100)
  assert.equal(data.averageWin, 15); assert.equal(data.averageLoss, -7.5)
  assert.equal(data.averageWinStreak, 1); assert.equal(data.averageLossStreak, 2)
  assert.equal(data.maxWinStreak, 1); assert.equal(data.maxLossStreak, 2)
  assert.equal(data.side[0].breakeven, 2); assert.equal(data.side[0].winRate, data.winRate)
  assert.equal(data.sessions.find(item => item.label === 'London').breakeven, 2)
  assert.equal(data.months[0].breakeven, 2)
  assert.deepEqual(data.rows.map(row => row.outcome), ['win', 'breakeven', 'win', 'breakeven', 'loss', 'loss'])
  assert.equal(data.net, original.net); assert.deepEqual(data.curve, original.curve); assert.deepEqual(data.drawdown, original.drawdown)
  assert.equal(data.endingBalance, original.endingBalance)
  assert.deepEqual(data.classification, { breakevenThreshold: 1, thresholdUnit: 'R', winRateBasis: 'wins_over_all_closed_trades_including_breakeven' })
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

const equitySource = points => ({ points, value_basis: 'account_equity_including_floating_pnl', scope: 'account', time_basis: 'market',
  trade_filters_apply: false, partial: false, sampled: false, total_points: points.length, unknown_event_count: 0 })
const equityPoint = (equity, day, segment = 0) => ({ equity, time_utc: `2024-01-${String(day).padStart(2, '0')}T12:00:00Z`, segment })

test('declared market analytics time drives filters, calendar, sessions and balance recovery', () => {
  const ledger = [10, -5, 5].map((net_pnl, index) => ({ trade_id: String(index), net_pnl, report_time_utc: null,
    close_time_utc: `2003-01-0${index + 1}T12:00:00Z` }))
  const source = { ledger, scope: { time_basis: 'market' }, metrics: { starting_balance: 1000,
    closed_trade_balance_curve: [1000, 1010, 1005, 1010].map(closed_trade_balance => ({ closed_trade_balance })) } }
  const built = buildAnalyticsModel(source)
  assert.equal(built.ledger[0].analytics_time_utc, ledger[0].close_time_utc)
  assert.equal(built.ledger[0].report_time_utc, null)
  const data = advancedAnalytics(built)
  assert.equal(data.calendar.length, 3); assert.equal(data.frequency[0].periodCount, 3)
  assert.equal(data.recoveryDays, 2)
  assert.equal(data.sessionGrouping.timeField, 'close_time_utc')
  assert.equal(advancedAnalytics(built, { years: '["2003"]' }).count, 3)
  const activity = advancedAnalytics(buildAnalyticsModel({ ...source, scope: { time_basis: 'activity' } }))
  assert.deepEqual(activity.calendar, []); assert.equal(activity.recoveryDays, null)
})

test('true equity drawdown preserves floating losses and measures peak-to-recovery elapsed days', () => {
  const result = accountEquityDrawdown(equitySource([equityPoint(100, 1), equityPoint(80, 2), equityPoint(90, 3), equityPoint(100, 4)]))
  assert.equal(result.available, true)
  assert.deepEqual(result.points.map(point => point.value), [0, -20, -10, 0])
  assert.equal(result.maxDrawdown, 20); assert.equal(result.averageDrawdown, 15)
  assert.equal(result.maxDrawdownPct, 20); assert.equal(result.averageDrawdownPct, 15)
  assert.equal(result.recoveryDays, 3); assert.equal(result.episodes, 1)
  assert.equal(result.partial, false)
  const built = buildAnalyticsModel({ ledger: [], equity_curve: equitySource([equityPoint(100, 1), equityPoint(80, 2)]) })
  assert.equal(advancedAnalytics(built).equityDrawdown.maxDrawdown, 20)
  assert.deepEqual(built.curve, [], 'true equity never substitutes for closed balance')
})

test('equity resets peaks at segment boundaries and never bridges missing observations', () => {
  const source = equitySource([equityPoint(100, 1), equityPoint(80, 2), equityPoint(50, 3, 1), equityPoint(40, 4, 1), equityPoint(50, 5, 1)])
  const result = accountEquityDrawdown(source)
  assert.equal(result.maxDrawdown, 20)
  assert.equal(result.points.filter(point => point.value === null).length, 1)
  assert.equal(result.recoveryEpisodes[0].endReason, 'segment_boundary')
  assert.equal(result.recoveryEpisodes[0].recovered, false)
  assert.equal(result.recoveryDays, 2)
  const gap = accountEquityDrawdown(equitySource([equityPoint(100, 1), equityPoint(null, 2), equityPoint(50, 3), equityPoint(45, 4)]))
  assert.equal(gap.maxDrawdown, 5); assert.equal(gap.partial, true)
  assert.equal(gap.recoveryDays, null)
  assert.equal(gap.points[1].value, null)
})

test('sampled equity metrics describe observed points and filtered trade scopes cannot claim equity', () => {
  const source = { ...equitySource([equityPoint(100, 1), equityPoint(80, 2)]), sampled: true, total_points: 500 }
  assert.equal(accountEquityDrawdown(source).partial, true)
  assert.equal(accountEquityDrawdown(source).metricsBasis, 'observed_points')
  assert.equal(accountEquityDrawdown(source, { filtered: true }).reason, 'trade_filtered_equity_scope')
  const built = buildAnalyticsModel({ ledger: [], equity_curve: source, scope: { active_filters: true } })
  assert.equal(advancedAnalytics(built).equityDrawdown.available, false)
  assert.equal(advancedAnalytics({ ...built, result: { ...built.result, scope: {} } }, { asset: 'EUR/USD' }).equityDrawdown.available, false)
  assert.equal(accountEquityDrawdown({ ...source, value_basis: 'closed_trade_balance' }).available, false)
})

test('current report kind is neutral for equity while actual kind omission and exposure filters still gate it', () => {
  const source = { ledger: [{ trade_id: 'a', net_pnl: 1, symbol: 'EUR/USD' }],
    equity_curve: equitySource([equityPoint(100, 1), equityPoint(80, 2)]) }
  const app = buildAnalyticsModel(source, 'app')
  const neutral = advancedAnalytics(app, { reportKinds: '["app"]' })
  assert.equal(neutral.localFiltered, true, 'retain existing balance filter semantics')
  assert.equal(neutral.equityDrawdown.available, true)
  assert.equal(advancedAnalytics(app, { reportKinds: '["app","prop"]' }).equityDrawdown.available, true)
  assert.equal(advancedAnalytics(app, { reportKinds: '["prop"]' }).equityDrawdown.available, false)
  assert.equal(advancedAnalytics(app, { reportKinds: '["app"]', asset: 'EUR/USD' }).equityDrawdown.available, false)
  const mixed = { ...app, ledger: [...app.ledger, { ...app.ledger[0], tradeId: 'prop', report_kind: 'prop' }] }
  assert.equal(advancedAnalytics(mixed, { reportKinds: '["app"]' }).equityDrawdown.available, false)
  assert.equal(advancedAnalytics({ ...app, result: { ...app.result, scope: { active_filters: true } } }, { reportKinds: '["app"]' }).equityDrawdown.available, false)
})

test('outcome percentages use each source capital before averaging and choosing extrema', () => {
  const input = model([100, 50, -100, -50, 0])
  input.result = { multi_session: true }
  input.ledger.forEach((row, i) => { row.starting_balance = [10000, 100, 10000, 100, 1000][i] })
  const data = advancedAnalytics(input)
  assert.equal(data.bestWinPct, 50)
  assert.equal(data.averageWinPct, 25.5)
  assert.equal(data.worstLossPct, -50)
  assert.equal(data.averageLossPct, -25.5)
  assert.equal(data.expectancy, 0)
  assert.equal(data.profitFactor, 1)
})

test('outcome percentage never hides missing capital or uses aggregate multi-session capital', () => {
  const input = model([100, 50, -100])
  input.result = { multi_session: true }
  input.ledger[0].starting_balance = 10000
  input.ledger[2].starting_balance = 10000
  for (const capital of [null, 0, -100, 'invalid']) {
    input.ledger[1].starting_balance = capital
    const data = advancedAnalytics(input)
    assert.equal(data.averageWinPct, null)
    assert.equal(data.bestWinPct, null)
    assert.equal(data.worstLossPct, -1)
  }
  input.result.multi_session = false
  delete input.ledger[1].starting_balance
  assert.equal(advancedAnalytics(input).bestWinPct, 5)
  assert.equal(advancedAnalytics(input).averageWinPct, 3)
})

test('outcome percentages follow breakeven threshold and preserve empty groups', () => {
  const input = model([10, -2, -100, 0])
  input.ledger.forEach(row => { row.planned_risk_budget = 1 })
  const data = advancedAnalytics(input, {}, { breakevenThreshold: 5 })
  assert.equal(data.averageWinPct, 1)
  assert.equal(data.averageLossPct, -10)
  assert.equal(data.losses, 1)
  assert.equal(data.breakeven, 2)
  assert.equal(data.expectancy, -23)
  assert.equal(data.profitFactor, 10 / 102, 'threshold must not remove small losses from gross loss')
  const empty = advancedAnalytics(model([]))
  assert.equal(empty.averageWinPct, null)
  assert.equal(empty.worstLossPct, null)
})
