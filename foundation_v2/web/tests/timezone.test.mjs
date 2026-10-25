import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayBoundary, dateRangeBoundary, setTimezone, zonedDateKey, instantToWall, wallToInstant, chartTimezones } from '../src/timezone.js'
import { displayDate } from '../src/dateFormat.js'
import { formatAmount } from '../src/moneyFormat.js'
import { matchesSearch } from '../src/searchText.js'

test('UTC persistence boundary and selected display zone remain independent', () => {
  setTimezone('Asia/Ho_Chi_Minh')
  assert.equal(displayDate('2026-10-31T20:30:00Z', {timeStyle:'medium'}), '01/11/2026 03:30:00')
  assert.equal(displayDate('2026-10-31'), '31/10/2026')
  assert.equal(dateRangeBoundary('2026-11-01'), '2026-10-31T17:00:00.000Z')
  assert.equal(dateRangeBoundary('2026-11-01', true), '2026-11-01T16:59:59.999Z')
  assert.equal(zonedDateKey('2026-10-31T20:30:00Z'), '2026-11-01')
  assert.equal(wallToInstant('2026-11-01T03:30:00'), '2026-10-31T20:30:00.000Z')
  assert.equal(instantToWall('2026-10-31T20:30:00Z'), '2026-11-01T03:30:00')
  assert.ok(chartTimezones.includes('Asia/Ho_Chi_Minh'))
  setTimezone('UTC')
})
test('DST local days and skipped civil dates do not assume 24 hours', () => {
  assert.equal(dayBoundary('2026-03-09','America/New_York')-dayBoundary('2026-03-08','America/New_York'),23*3600000)
  assert.equal(dayBoundary('2026-11-02','America/New_York')-dayBoundary('2026-11-01','America/New_York'),25*3600000)
  assert.equal(dayBoundary('2011-12-31','Pacific/Apia')-dayBoundary('2011-12-30','Pacific/Apia'),0)
  assert.throws(()=>dateRangeBoundary('2026-02-30',true,'UTC'),/invalid_calendar_date/)
  assert.equal(instantToWall(0,'UTC'),'1970-01-01T00:00:00')
  assert.throws(()=>wallToInstant('2026-03-08T02:30','America/New_York'), /nonexistent/)
  assert.throws(()=>wallToInstant('2026-11-01T01:30','America/New_York'), /ambiguous/)
  assert.equal(wallToInstant('2026-11-01T02:30','America/New_York'),'2026-11-01T07:30:00.000Z')
})
test('money uses dollar symbol only for USD and never converts unknown to zero', () => {
  assert.equal(formatAmount(10000,' USD',2,'en-US'),'$10,000')
  assert.equal(formatAmount(-3.5,' EUR',2,'en-US'),'-3.5 EUR')
  for(const value of [null, undefined, '', NaN, true]) assert.equal(formatAmount(value,' USD'),'-')
  assert.equal(formatAmount(0,' USD',2,'en-US'),'$0')
})
test('search matches Vietnamese accents and every query token', () => {
  assert.equal(matchesSearch('Phiên giao dịch Đầu tiên','phien dau'),true)
  assert.equal(matchesSearch('Phiên giao dịch Đầu tiên','phien usd'),false)
})
