import assert from 'node:assert/strict'
import test from 'node:test'
import { protectionAmount, protectionPips, protectionPrice, quantityForRisk, selectOrderDraft } from '../src/orderProtection.js'
import { marketQuotes, orderDraft } from '../src/replayOrderModel.js'

const spec = { pip_size:'0.0001', tick_size:'0.00001', contract_size:'100000', quantity_min:'0.01', quantity_step:'0.01' }
const costs = { quote_to_account_rate:'1', account_ccy:'USD' }

test('side/type transitions preserve each explicit protection state and pip distance', () => {
  const replay = { visible_rows:[{close:1.1}], payload:{execution:{spread_price:'.0002',instrument_spec:spec}} }
  const quotes = marketQuotes(replay)
  const entry = draft => draft.orderType ? Number(draft.entryPrice) : draft.side === 'BUY' ? quotes.ask : quotes.bid
  for (const stopLoss of [false,true]) for (const takeProfit of [false,true]) {
    let draft = { ...orderDraft(replay,spec), quantity:'.37', protectionEnabled:{stopLoss,takeProfit} }
    for (const key of ['stopLoss','takeProfit']) if (draft.protectionEnabled[key]) draft[key] = protectionPrice(30,entry(draft),draft.side,key,spec)
    for (const side of ['SELL','BUY','SELL','BUY']) for (const orderType of ['limit','stop','market']) {
      const before = structuredClone(draft)
      const next = selectOrderDraft(draft,replay,spec,{side,orderType})
      assert.deepEqual(draft,before,'Selection must not mutate the previous draft')
      assert.deepEqual(next.protectionEnabled,{stopLoss,takeProfit})
      assert.equal(next.quantity,'.37')
      for (const key of ['stopLoss','takeProfit']) {
        if (next.protectionEnabled[key]) assert.equal(protectionPips(next[key],entry(next),side,key,spec),30)
        else assert.equal(next[key],'')
      }
      assert.equal(selectOrderDraft(next,replay,spec,{side,orderType}),next,'Reselecting the current option is a no-op')
      draft = next
    }
  }
  const emptyEnabled = { ...orderDraft(replay,spec), protectionEnabled:{stopLoss:true,takeProfit:false} }
  const next = selectOrderDraft(emptyEnabled,replay,spec,{side:'SELL'})
  assert.equal(next.protectionEnabled.stopLoss,true,'Cleared enabled inputs stay enabled and empty for required-field validation')
  assert.equal(next.stopLoss,'')
})

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
