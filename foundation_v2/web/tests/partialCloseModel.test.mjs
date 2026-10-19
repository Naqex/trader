import test from 'node:test'
import assert from 'node:assert/strict'
import { partialCloseAmount, partialCloseBasis, partialCloseError } from '../src/partialCloseModel.js'
import { closedChartTrades } from '../src/legacyChartTrades.js'

const position = { quantity: '.06', originalQuantity: '.10', quantityMin: '.01', quantityStep: '.01' }
test('percentage basis follows original or remaining position and rounds down without overclosing', () => {
  assert.equal(partialCloseBasis(position, 'remaining'), .06)
  assert.equal(partialCloseAmount(position, 'remaining', '50'), '0.03')
  assert.equal(partialCloseAmount(position, 'original', '50'), '0.05')
  assert.equal(partialCloseAmount(position, 'original', '25'), '0.02')
  assert.notEqual(partialCloseError(position, partialCloseAmount(position, 'original', '100')), '')
  assert.equal(partialCloseError(position, '.06'), '')
})
test('invalid sizing cannot submit a zero, excess, off-step or dust remainder', () => {
  for (const value of ['', '0', '-.01', '.07', '.015', 'NaN']) assert.notEqual(partialCloseError(position, value), '')
  assert.notEqual(partialCloseError({ ...position, quantity: '.05', quantityMin: '.02' }, '.04'), '')
  assert.notEqual(partialCloseError({ ...position, quantity: '.01' }, partialCloseAmount({ ...position, quantity: '.01' }, 'remaining', '50')), '')
  assert.equal(partialCloseError({ ...position, quantity: '.01' }, '.01'), '')
  for (const value of ['', '0', '101', '-1']) assert.equal(partialCloseAmount(position, 'remaining', value), '')
})
test('closed positions list shows each realized slice including a protective final fill', () => {
  const ledger = [
    { sequence: 1, kind: 'market_fill', details: { position_id: 'p', quantity: '.1', side: 'SELL', fill_price: '1.1' } },
    { sequence: 2, kind: 'manual_close', details: { position_id: 'p', quantity: '.02', net_pnl: '2', closed_position: { quantity: '.02' } } },
    { sequence: 3, kind: 'protective_fill', details: { position_id: 'p', net_pnl: '8', closed_position: { quantity: '.08' } } },
  ]
  const rows = closedChartTrades({ ledger })
  assert.deepEqual(rows.map(row => row.quantity), ['.02', '.08'])
  assert.equal(rows.reduce((sum, row) => sum + Number(row.realized), 0), 10)
  assert.equal(new Set(rows.map(row => row.key)).size, 2)
})
