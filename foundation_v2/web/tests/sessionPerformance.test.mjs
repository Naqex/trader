import test from 'node:test'
import assert from 'node:assert/strict'
import { closeTime, sessionPeriods } from '../src/sessionPerformanceModel.js'

test('activity period PnL uses observation times, Monday week and current calendar', () => {
  const ledger = [
    { close_time_utc: '2003-01-01T00:00:00Z', report_time_utc: '2026-09-30T23:59:00Z', net_pnl: 10 },
    { close_time_utc: '2003-01-02T00:00:00Z', report_time_utc: '2026-10-04T23:59:00Z', net_pnl: -4 },
    { close_time_utc: '2003-01-03T00:00:00Z', report_time_utc: '2026-10-05T00:01:00Z', net_pnl: 7 },
    { close_time_utc: '2003-01-04T00:00:00Z', report_time_utc: '2026-10-05T08:00:00+07:00', net_pnl: 2 },
  ]
  const result = sessionPeriods(ledger, 'UTC', new Date('2026-10-05T12:00:00Z'))
  assert.equal(result.anchor.toISOString(), '2026-10-05T12:00:00.000Z')
  assert.equal(result.month, 5)
  assert.equal(result.week, 9)
  assert.equal(result.day, 9)
  assert.deepEqual(result.months, [{ label: '2026-09', value: 10 }, { label: '2026-10', value: 5 }])
  assert.equal(result.weekdays.find(day => day.label === 'CN').value, -4)
  assert.equal(result.weekdays.find(day => day.label === 'T2').value, 9)
  assert.equal(result.weekdays.reduce((sum, day) => sum + day.value, 0), 15)
  const later = sessionPeriods(ledger, 'UTC', new Date('2026-11-05T12:00:00Z'))
  assert.equal(later.month, 0)
  assert.equal(later.week, 0)
  assert.equal(later.day, 0)
})

test('missing dates/PnL do not become a zero period or a fabricated daily chart', () => {
  for (const trade of [{ report_time_utc: null, net_pnl: 1 }, { report_time_utc: 'invalid', net_pnl: 1 }, { report_time_utc: 1704067200, net_pnl: null }, { close_time_utc: '2003-01-01', recorded_at_utc: '2026-10-01', updated_at_utc: '2026-10-02', net_pnl: 1 }]) {
    const result = sessionPeriods([trade])
    assert.equal(result.incomplete, true)
    assert.equal(result.day, null)
    assert.deepEqual(result.months, [])
  }
  assert.equal(sessionPeriods([]).day, null)
  assert.deepEqual(sessionPeriods([]).weekdays, [])
})

test('unknown observations do not erase known groups and Settings zone owns day boundaries', () => {
  const ledger = [{ report_time_utc: '2026-10-31T23:30:00Z', net_pnl: 10 }, { report_time_utc: null, close_time_utc: '2003-01-01', net_pnl: 90 }]
  const utc = sessionPeriods(ledger, 'UTC', new Date('2026-11-01T01:00:00Z'))
  const vn = sessionPeriods(ledger, 'Asia/Ho_Chi_Minh', new Date('2026-11-01T01:00:00Z'))
  assert.equal(utc.incomplete, true)
  assert.equal(utc.day, 0)
  assert.equal(vn.day, 10)
  assert.deepEqual(vn.months, [{ label: '2026-11', value: 10 }])
})

test('numeric epoch seconds and milliseconds normalize to the same historical UTC instant', () => {
  assert.equal(closeTime(1704067200).toISOString(), closeTime(1704067200000).toISOString())
  assert.equal(closeTime('1704067200').toISOString(), '2024-01-01T00:00:00.000Z')
  assert.equal(closeTime(false), null)
})


test('session backtest periods keep years separate and ignore real observation dates', () => {
  const ledger = [
    { close_time_utc: '2003-01-06T12:00:00Z', report_time_utc: '2026-10-25T10:00:00Z', net_pnl: 10 },
    { close_time_utc: '2004-01-05T12:00:00Z', report_time_utc: '2026-10-25T10:01:00Z', net_pnl: -3 },
  ]
  const market = sessionPeriods(ledger, 'UTC', new Date('2026-10-25'), 'market')
  assert.deepEqual(market.months, [{ label: '2003-01', value: 10 }, { label: '2004-01', value: -3 }])
  assert.equal(market.day, -3)
  assert.equal(market.weekdays[0].value, 7)
  assert.equal(market.incomplete, false)
  const activity = sessionPeriods(ledger, 'UTC', new Date('2026-10-25'))
  assert.deepEqual(activity.months, [{ label: '2026-10', value: 7 }])
  const legacy = sessionPeriods([{ close_time_utc: '2004-01-05T12:00:00Z', net_pnl: 5 }], 'UTC', new Date(), 'market')
  assert.equal(legacy.day, 5)
  assert.equal(legacy.incomplete, false)
})


test('split performance keeps both sides of a breakeven period, zero and missing months distinct', () => {
 const ledger = [10, -10, 0].map(net_pnl => ({ close_time_utc: '2003-01-01T00:00:00Z', net_pnl }))
 const result = sessionPeriods(ledger, 'UTC', new Date(), 'market')
 assert.deepEqual(result.performance.months, [{ label: '2003-01', value: 0, profit: 10, loss: -10, count: 3 }])
 assert.equal(result.performance.weekdays[2].count, 3)
 assert.equal(result.performance.weekdays[0].count, 0)
 assert.equal(result.performance.months.some(row => row.label === '2003-02'), false)
})
