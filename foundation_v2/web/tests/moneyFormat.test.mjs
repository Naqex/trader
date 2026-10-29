import test from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, currencyLabel } from '../src/moneyFormat.js'

test('USD code and dollar label both format as a dollar prefix in each locale', () => {
  for (const suffix of [' USD', ' $']) {
    assert.equal(formatAmount(0, suffix), '$0')
    assert.equal(formatAmount(-2, suffix), '$-2')
    assert.equal(formatAmount(1234.5, suffix, 2, 'vi-VN'), '$1.234,5')
    assert.equal(formatAmount(1234.5, suffix, 2, 'en-US'), '$1,234.5')
  }
})

test('non-USD currencies and non-money units retain their identity', () => {
  assert.equal(currencyLabel('USD'), '$')
  for (const code of ['EUR', 'CAD', 'USDT', '', undefined]) assert.equal(currencyLabel(code), code)
  assert.equal(formatAmount(2, ' EUR'), '2 EUR')
  assert.equal(formatAmount(2, '%'), '2%')
  assert.equal(formatAmount(2, ' R'), '2 R')
})

test('unknown amounts do not become zero money', () => {
  for (const value of [null, undefined, '', false, NaN, Infinity, 'invalid']) assert.equal(formatAmount(value, ' $'), '-')
})
