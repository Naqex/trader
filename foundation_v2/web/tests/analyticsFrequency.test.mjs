import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'

const model = dates => ({
  ledger: dates.map((date, index) => ({ tradeId: String(index), close_time_utc: date && `${date}T12:00:00Z`, report_time_utc: '2030-07-01T12:00:00Z', net_pnl: index % 2 ? null : 0, side: index % 2 ? 'SELL' : 'BUY' })),
  curve: [], drawdown: [], startBalance: 1000, result: { scope: { time_basis: 'market' } },
})
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)

test('five-trade reference uses weekday means and active-period header denominators', () => {
  const data = advancedAnalytics(model(['2025-06-09', '2025-06-09', '2025-06-11', '2025-06-15', '2025-06-17']))
  assert.deepEqual(data.frequency.map(row => [row.tradeCount, row.periodCount, row.average]), [[5, 4, 1.25], [5, 2, 2.5], [5, 1, 5]])
  assert.deepEqual(data.frequencySeries.day.map(row => [row.label, row.average]), [['T2', 2], ['T3', 1], ['T4', 1], ['T5', null], ['T6', null], ['T7', null], ['CN', 1]])
  assert.deepEqual(data.frequencySeries.week.map(row => [row.label, row.average]), [['24', 4], ['25', 1]])
  assert.equal(data.frequencySeries.month[5].average, 5)
  assert.equal(data.frequencySeries.month.length, 12)
})

test('repeated weekdays and months use distinct active dates/months rather than raw totals', () => {
  const data = advancedAnalytics(model(['2024-01-01', '2024-01-01', '2024-01-08', '2024-01-02', '2025-01-06', '2025-01-06', '2025-02-03']))
  const monday = data.frequencySeries.day[0], january = data.frequencySeries.month[0]
  assert.deepEqual(monday, { label: 'T2', tradeCount: 6, periodCount: 4, average: 1.5 })
  assert.deepEqual(january, { label: '01', tradeCount: 6, periodCount: 2, average: 3 })
  near(data.frequency[0].average, 7/5)
  assert.notEqual(data.frequency[0].average, (monday.average + 1) / 2, 'header is weighted by active periods, not equally by categories')
  near(data.frequency[2].average, 7/3)
  for (const key of ['day', 'week', 'month']) assert.equal(data.frequencySeries[key].reduce((sum, row) => sum + row.tradeCount, 0), 7)
})

test('ISO week-year keeps boundary dates together and averages matching week numbers across years', () => {
  const data = advancedAnalytics(model(['2020-12-31', '2021-01-01', '2021-01-04', '2021-01-04', '2022-01-03']))
  assert.deepEqual(data.frequencySeries.week, [
    { label: '1', tradeCount: 3, periodCount: 2, average: 1.5 },
    { label: '53', tradeCount: 2, periodCount: 1, average: 2 },
  ])
  near(data.frequency[1].average, 5/3)
})

test('scope filters and timezone recompute counts and active-period denominators together', () => {
  const source = model(['2024-01-01', '2024-01-02', '2024-01-08'])
  source.ledger[0].close_time_utc = '2024-01-01T23:30:00Z'
  const utc = advancedAnalytics(source, { timezone: 'UTC' }), vn = advancedAnalytics(source, { timezone: 'Asia/Ho_Chi_Minh' })
  assert.equal(utc.frequency[0].periodCount, 3); assert.equal(vn.frequency[0].periodCount, 2)
  assert.equal(vn.frequencySeries.day[1].average, 2)
  const filtered = advancedAnalytics(source, { sides: '["buy"]', timezone: 'UTC' })
  assert.equal(filtered.frequencySeries.day[0].average, 1)
  assert.equal(filtered.frequency[0].tradeCount, 2)
  assert.equal(filtered.frequency[0].periodCount, 2)
  assert.ok(filtered.frequencySeries.month.every(row => !row.periodCount || row.label === '01'), 'Chart dates, not recorded realtime July, drive market reports')
})

test('unknown timestamps are excluded, unknown PnL still counts, empty scope stays unavailable', () => {
  const data = advancedAnalytics(model(['2024-01-01', '2024-01-01', null]))
  assert.equal(data.frequency[0].tradeCount, 2); assert.equal(data.frequency[0].average, 2)
  assert.equal(data.incomplete, true)
  const empty = advancedAnalytics(model([]))
  assert.deepEqual(empty.frequencySeries, { day: [], week: [], month: [] })
  assert.ok(empty.frequency.every(row => row.average === null && row.periodCount === 0 && row.tradeCount === 0))
})
