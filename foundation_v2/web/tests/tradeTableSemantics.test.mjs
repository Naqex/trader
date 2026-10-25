import test from 'node:test'
import assert from 'node:assert/strict'
import { validTradeTableRow, validateTradesPayload, filterAnalyticsRows } from '../src/tradingAnalyticsModel.js'
import { tableTimezoneLabel } from '../src/timezone.js'
import { formatAmount } from '../src/moneyFormat.js'
import { displayDate, displayTime } from '../src/dateFormat.js'

test('Open has no realized return; unknown and zero remain distinct', () => {
  const open = { status: 'open', quantity: 1, price_open: 1.2, side: 'BUY', net_pnl: null }
  assert(validTradeTableRow(open))
  assert(!validTradeTableRow({ ...open, net_pnl: 0 }))
  assert(!validTradeTableRow({ ...open, close_time_utc: '2026-10-25T00:00:00Z' }))
  assert(!validTradeTableRow({ ...open, quantity: 0 }))
  assert(validTradeTableRow({ status: 'closed', net_pnl: 0 }))
  assert(!validTradeTableRow({ status: 'pending', net_pnl: 0 }))
  assert.throws(() => validateTradesPayload({ schema_version: 'dashboard-replay-performance-v1', status: 'ready', metrics: { closed_trade_count: 1 }, ledger: [open], sources: [], excluded: [], scope: { session_ids: [] } }))
  assert.equal(formatAmount(null), '-')
  assert.equal(formatAmount(0), '0')
  assert.equal(displayDate(null), '-')
  assert.equal(displayTime(null), '-')
})

test('table filtering uses Open entry activity without inventing exit time', () => {
  const rows = [{ status: 'open', table_time_utc: '2026-10-25T01:00:00Z', report_time_utc: null, net_pnl: null },
    { status: 'closed', report_time_utc: '2026-10-24T01:00:00Z', net_pnl: 10 }]
  assert.deepEqual(filterAnalyticsRows(rows, { statuses: '["open"]', hours: '["1"]', timezone: 'UTC' }), [rows[0]])
  assert.deepEqual(filterAnalyticsRows(rows, { statuses: '["open"]', outcomes: '["win"]' }), [])
  assert.deepEqual(filterAnalyticsRows(rows, { statuses: '["closed"]' }), [rows[1]])
  assert.equal(rows[0].report_time_utc, null)
})

test('footer timezone offsets follow observation instants, including DST', () => {
  const winter = new Date('2026-01-15T12:00:00Z'), summer = new Date('2026-07-15T12:00:00Z')
  assert.equal(tableTimezoneLabel('Asia/Ho_Chi_Minh', [winter, summer]), '(UTC+7) Asia/Ho Chi Minh')
  assert.equal(tableTimezoneLabel('America/New_York', [winter, summer]), '(UTC-5 / UTC-4) America/New York')
  assert.equal(tableTimezoneLabel('America/New_York', []), 'America/New York')
})
