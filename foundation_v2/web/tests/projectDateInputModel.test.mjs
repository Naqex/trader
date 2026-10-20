import assert from 'node:assert/strict'
import test from 'node:test'
import { boundedDateTimeValue } from '../src/projectDateInputModel.js'
import { parseDateField } from '../src/dateFormat.js'

const lower = '2026-10-20T09:00'
const upper = '2026-10-20T17:00'

test('calendar date selection keeps an allowed time instead of replacing it with the lower bound', () => {
  for (const time of ['09:00', '10:30', '16:00', '17:00']) {
    assert.equal(parseDateField(boundedDateTimeValue('2026-10-20', time, lower, upper), 'datetime-local'), `2026-10-20T${time}`)
  }
})

test('calendar date selection clamps only outside the selected day time bounds', () => {
  assert.equal(boundedDateTimeValue('2026-10-20', '08:00', lower, upper), '20/10/2026 09:00')
  assert.equal(boundedDateTimeValue('2026-10-20', '18:00', lower, upper), '20/10/2026 17:00')
  assert.equal(boundedDateTimeValue('2026-10-21', '08:00', lower, '2026-10-22T17:00'), '21/10/2026 08:00')
})

test('calendar bounds preserve UTC wall time and boundary seconds without timezone conversion', () => {
  assert.equal(boundedDateTimeValue('2026-10-20', '08:00', '2026-10-20T09:00:30Z', upper), '20/10/2026 09:00:30')
  assert.equal(boundedDateTimeValue('2026-10-20', '18:00', lower, '2026-10-20T17:00:30Z'), '20/10/2026 17:00:30')
  assert.equal(boundedDateTimeValue('2026-10-29', '10:30', '2026-10-29T09:00Z', '2026-10-29T17:00Z'), '29/10/2026 10:30')
})

test('unbounded calendar dates retain their time, including midnight', () => {
  assert.equal(boundedDateTimeValue('2026-10-20', '10:30'), '20/10/2026 10:30')
  assert.equal(boundedDateTimeValue('2026-10-20', ''), '20/10/2026 00:00')
})
