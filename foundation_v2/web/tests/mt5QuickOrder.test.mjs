import test from 'node:test'
import assert from 'node:assert/strict'
import { mt5QuickDraft } from '../src/mt5QuickOrder.js'
import { defaultScalperPreset } from '../src/legacyScalperPreset.js'

const snapshot = { quote:{bid:1.1,ask:1.1002},instrument:{asset_class:'fx',tick_size:0.00001} }
const ticks = { enabled:true,stop:{enabled:true,value:'20',unit:'ticks'},target:{enabled:true,value:'40',unit:'ticks'} }
test('MT5 quick draft preserves lot and uses each executable quote for protection', () => {
  const buy=mt5QuickDraft(snapshot,'BUY','0.03',ticks), sell=mt5QuickDraft(snapshot,'SELL','0.03',ticks)
  assert.equal(buy.quantity,'0.03');assert.equal(buy.orderType,'market')
  assert.equal(buy.stopLoss,'1.1');assert.equal(buy.takeProfit,'1.1006')
  assert.equal(sell.stopLoss,'1.1002');assert.equal(sell.takeProfit,'1.0996')
  assert.deepEqual(buy.protectionEnabled,{stopLoss:true,takeProfit:true})
})
test('disabled preset clears both protective legs without needing a price', () => {
  const value=mt5QuickDraft(null,'SELL','0.01',defaultScalperPreset())
  assert.equal(value.stopLoss,'');assert.equal(value.takeProfit,'')
  assert.deepEqual(value.protectionEnabled,{stopLoss:false,takeProfit:false})
})
test('unknown pip size is rejected instead of inferred from MT5 digits', () => {
  const preset=structuredClone(ticks);preset.stop.unit='pips'
  assert.throws(()=>mt5QuickDraft({...snapshot,instrument:{...snapshot.instrument,digits:5}},'BUY','0.01',preset))
  assert.throws(()=>mt5QuickDraft({...snapshot,quote:null},'BUY','0.01',ticks))
  assert.deepEqual(snapshot.quote,{bid:1.1,ask:1.1002})
})
