import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalyticsModel } from '../src/analyticsViewModel.js'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'
import { bucketCurve } from '../src/analyticsPresentation.js'
import { filterLiveDeals, LIVE_FILTERS, summarizeDeals } from '../src/liveWorkspaceModel.js'

test('balance gaps survive projection and every interval; fallback drawdown cannot cross them', () => {
  const ledger = [10, null, -20].map((net_pnl, index) => ({
    trade_id: `t${index}`, net_pnl, report_time_utc: `2026-10-12T12:0${index}:00Z`,
  }))
  const model = buildAnalyticsModel({ ledger, metrics: {
    starting_balance: 100,
    closed_trade_balance_curve: [100, 110, null, 90].map((value, index) => ({ value, trade_id: index ? `t${index - 1}` : null })),
  } })
  assert.deepEqual(model.curve.map(point => point.value), [100, 110, null, 90])
  assert.deepEqual(model.drawdown.map(point => point.drawdown), [0, 0, null, null])
  assert.equal(model.maxDrawdown, null)
  assert.equal(model.endingBalance, 90)
  for (const interval of ['all', 'day', 'hour', 'minute']) {
    const values = bucketCurve(model.curve, model.ledger, interval).points.map(point => point.value)
    assert.ok(values.includes(null), `${interval} must retain the missing observation`)
    assert.equal(values.at(-1), 90)
  }
  const report = advancedAnalytics(model)
  for (const key of ['maxDrawdown', 'maxDrawdownPct', 'averageDrawdown', 'episodes', 'recoveryTrades', 'recoveryDays']) assert.equal(report[key], null, key)
  const trailing = buildAnalyticsModel({ metrics: { closed_trade_balance_curve: [100, 110, null] } })
  assert.equal(trailing.endingBalance, undefined, 'last known balance is not the ending balance')
  assert.equal(buildAnalyticsModel({ metrics: { closed_trade_balance_curve: [null, 110] } }).startBalance, undefined)
})

test('dated trades retain count and frequency when PnL is unknown; only financial fields become unknown', () => {
  const ledger = [10, null, -5].map((net_pnl, index) => ({
    trade_id: `t${index}`, net_pnl, report_time_utc: index === 2 ? null : '2026-10-12T12:00:00Z',
  }))
  const data = advancedAnalytics(buildAnalyticsModel({ ledger, metrics: { starting_balance: 100 } }))
  assert.equal(data.count, 3)
  assert.equal(data.datedCount, 2)
  assert.equal(data.calendarUndatedCount, 1)
  assert.equal(data.frequency[0].average, 2)
  assert.deepEqual(data.frequencySeries.day[0], { label: 'T2', tradeCount: 2, periodCount: 1, average: 2 })
  assert.equal(data.hours.reduce((sum, row) => sum + row.count, 0), 2)
  assert.equal(data.hours.find(row => row.label === '12').net, null)
  assert.equal(data.hours.find(row => row.label === '12').winRate, null)
  assert.equal(data.months[0].net, null)
  assert.equal(data.calendar[0].count, 2)
  assert.equal(data.incomplete, true)
  const dated = advancedAnalytics(buildAnalyticsModel({ ledger: ledger.slice(0, 2) }))
  assert.equal(dated.datesComplete, true)
  assert.equal(dated.incomplete, true, 'date coverage and financial coverage are separate')
})

test('Live tags apply per record in mixed and manual scopes, clear cleanly and exclude untagged broker deals', () => {
  const deal = (profit, tags) => ({ type: 0, symbol: 'EURUSD', time_msc: Date.parse('2026-10-12T12:00:00Z'), profit, commission: 0, swap: 0, fee: 0,
    ...(tags ? { record: { payload: { tags } } } : {}) })
  const payload = { manual: false, account: { account_ref: 'aggregate' }, deals: [deal(25, ['setup-a']), deal(-10, ['setup-b']), deal(100)] }
  const snapshot = structuredClone(payload)
  for (const manual of [false, true]) {
    const scope = { ...payload, manual }
    assert.deepEqual(summarizeDeals(filterLiveDeals(scope, { ...LIVE_FILTERS, tags: ['setup-a'] })), { count: 1, net: 25 })
    assert.deepEqual(summarizeDeals(filterLiveDeals(scope, { ...LIVE_FILTERS, tags: ['setup-a', 'setup-b'] })), { count: 2, net: 15 })
    assert.deepEqual(summarizeDeals(filterLiveDeals(scope, { ...LIVE_FILTERS, tags: [] })), { count: 3, net: 115 })
  }
  assert.deepEqual(filterLiveDeals({ ...payload, deals: [deal(100)] }, { ...LIVE_FILTERS, tags: ['setup-a'] }), [])
  assert.deepEqual(payload, snapshot)
})
