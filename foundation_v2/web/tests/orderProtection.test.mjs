import assert from 'node:assert/strict'
import test from 'node:test'
import { protectionAmount, protectionPips, protectionPrice, quantityForRisk, selectOrderDraft, partialTargets, formatProtectionMoney } from '../src/orderProtection.js'
import { marketQuotes, orderDraft } from '../src/replayOrderModel.js'

const spec = { pip_size:'0.0001', tick_size:'0.00001', contract_size:'100000', quantity_min:'0.01', quantity_step:'0.01' }
const costs = { quote_to_account_rate:'1', account_ccy:'USD' }

test('side/type transitions preserve each explicit protection state and pip distance', () => {
  const replay = { visible_rows:[{close:1.1}], payload:{execution:{spread_price:'.0002',instrument_spec:spec}} }
  const quotes = marketQuotes(replay)
  const entry = draft => draft.orderType ? Number(draft.entryPrice) : draft.side === 'BUY' ? quotes.ask : quotes.bid
  for (const sizingMode of ['risk','quantity']) for (const stopLoss of [false,true]) for (const takeProfit of [false,true]) {
    let draft = { ...orderDraft(replay,spec), quantity:'.37', sizingMode, protectionEnabled:{stopLoss,takeProfit} }
    for (const key of ['stopLoss','takeProfit']) if (draft.protectionEnabled[key]) draft[key] = protectionPrice(30,entry(draft),draft.side,key,spec)
    for (const side of ['SELL','BUY','SELL','BUY']) for (const orderType of ['limit','stop','market']) {
      const before = structuredClone(draft)
      const next = selectOrderDraft(draft,replay,spec,{side,orderType})
      assert.deepEqual(draft,before,'Selection must not mutate the previous draft')
      assert.deepEqual(next.protectionEnabled,{stopLoss,takeProfit})
      assert.equal(next.quantity,'.37')
      assert.equal(next.sizingMode,sizingMode,'Side/type changes retain the selected sizing method')
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


test('partial target percentages resolve to exact lots and preserve hydrated allocations', () => {
  const draft = { side:'BUY',quantity:'.03',takeProfit:'1.102',protectionEnabled:{takeProfit:true},takeProfits:[{id:'a',price:'1.102',percent:String(100/3)},{id:'b',price:'1.104',percent:String(200/3)}] }
  assert.deepEqual(partialTargets(draft,spec),[{target_id:'a',price:'1.102',quantity:'0.01'},{target_id:'b',price:'1.104',quantity:'0.02'}])
  assert.throws(() => partialTargets({...draft,quantity:'.01'},spec),/too small|nhỏ/)
  assert.throws(() => partialTargets({...draft,takeProfits:draft.takeProfits.map(row=>({...row,percent:'40'}))},spec),/100%/)
  assert.throws(() => partialTargets({...draft,takeProfits:[draft.takeProfits[0],{...draft.takeProfits[1],price:'1.101'}]},spec),/gần đến xa/)
  assert.equal(partialTargets({...draft,protectionEnabled:{takeProfit:false}},spec),null)
  const replay={visible_rows:[{close:1.1}],payload:{execution:{spread_price:'0',instrument_spec:spec}}}
  const next=selectOrderDraft(draft,replay,spec,{side:'SELL'})
  assert.equal(next.takeProfits.length,2)
  assert.equal(next.takeProfits[1].price,'1.096')
  assert.equal(next.takeProfits[0].percent,draft.takeProfits[0].percent)
})

test('estimated amounts place the currency symbol first in Vietnamese and English', () => {
  assert.equal(formatProtectionMoney(4,'USD','vi'),'$4,00')
  assert.equal(formatProtectionMoney(-2,'USD','vi'),'$2,00')
  assert.equal(formatProtectionMoney(1234.5,'USD','en'),'$1,234.50')
  assert.equal(formatProtectionMoney(null,'USD','vi'),'—')
})
