import assert from 'node:assert/strict'
import test from 'node:test'
import { protectionAmount, protectionPips, protectionPrice, quantityForRisk } from '../src/orderProtection.js'

const spec = { pip_size:'0.0001', tick_size:'0.00001', contract_size:'100000', quantity_min:'0.01', quantity_step:'0.01' }
const costs = { quote_to_account_rate:'1', account_ccy:'USD' }

test('price and pip edits agree for BUY and SELL, including profit-locking stops', () => {
  for (const side of ['BUY','SELL']) for (const kind of ['stopLoss','takeProfit']) for (const pips of [20,40,-10,0]) {
    const price = protectionPrice(String(pips), 1.1, side, kind, spec)
    assert.equal(protectionPips(price, 1.1, side, kind, spec), pips)
  }
  assert.equal(protectionPrice('20.26',1.1,'BUY','stopLoss',spec),'1.09797')
  assert.equal(protectionPips('',1.1,'BUY','stopLoss',spec),'')
  assert.equal(protectionPrice('',1.1,'BUY','stopLoss',spec),'')
  assert.equal(protectionPrice('20',null,'BUY','stopLoss',spec),'')
  assert.equal(protectionPrice('20',1.1,'BUY','stopLoss',{}),'')
  assert.equal(protectionPrice('1e308',1.1,'SELL','stopLoss',{...spec,pip_size:100}),'')
})

test('gross estimates use the selected side, quantity and account conversion', () => {
  assert.ok(Math.abs(protectionAmount('1.098',1.1,'BUY','.1',spec,costs) + 20) < 1e-8)
  assert.ok(Math.abs(protectionAmount('1.098',1.1,'SELL','.1',spec,{...costs,quote_to_account_rate:2}) - 40) < 1e-8)
  for (const rate of [null,undefined,'',0]) assert.equal(protectionAmount('1.098',1.1,'BUY','.1',spec,{...costs,quote_to_account_rate:rate}),null)
  assert.equal(protectionAmount('',1.1,'BUY','.1',spec,costs),null)
  assert.equal(protectionAmount('1.098',1.1,'BUY','.1',spec,{}),null)
})

test('risk sizing rounds down to instrument step and rejects unusable budgets', () => {
  assert.equal(quantityForRisk(101,'1.098',1.1,'BUY',spec,costs),'0.5')
  assert.equal(quantityForRisk(100,'1.098',1.1,'BUY',spec,costs),'0.5')
  assert.equal(quantityForRisk(101,'1.102',1.1,'SELL',spec,costs),'0.5')
  assert.equal(quantityForRisk(1,'1.098',1.1,'BUY',spec,costs),null)
  assert.equal(quantityForRisk(100,'1.101',1.1,'BUY',spec,costs),null)
  assert.equal(quantityForRisk(100,'1.1',1.1,'BUY',spec,costs),null)
  assert.equal(quantityForRisk(100,'1.098',1.1,'BUY',spec,{}),null)
  for (const budget of [1,10,30,100,123.45,1000]) {
    const quantity = quantityForRisk(budget,'1.09703',1.1,'BUY',spec,costs)
    if (quantity) assert.ok(-protectionAmount('1.09703',1.1,'BUY',quantity,spec,costs) <= budget + 1e-8)
  }
})
