import test from 'node:test'
import assert from 'node:assert/strict'
import {readSessionPresets,saveSessionPreset,deleteSessionPreset,sessionPresetKey} from '../src/sessionPresets.js'
const store = () => {const values=new Map();return {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value)}}
const config = () => ({balance:'10000',datasets:['asset-one'],strategy:'',propDraft:{profileKind:'generic',targetPercent:'10',dailyLoss:'500',overallLoss:'1000',durationDays:''},tradingOptions:{version:'session-trading-options-v2',costs_enabled:false,assets:{'asset-one':{spread_price:'0',commission_per_lot:'0',commission_charge:'round_trip',slippage:{mode:'off'}}}}})
test('browser presets survive reads, isolate workspace/mode and do not alias form drafts',()=>{
 const storage=store(),draft=config(),saved=saveSessionPreset(storage,'one','backtest',{name:'  TEST  ',config:draft})
 draft.datasets.push('other');draft.balance='50000'
 assert.equal(saved.name,'TEST');assert.deepEqual(readSessionPresets(storage,'one','backtest'),[saved])
 assert.equal(saved.config.balance,'10000');assert.deepEqual(saved.config.datasets,['asset-one'])
 assert.deepEqual(readSessionPresets(storage,'two','backtest'),[]);assert.deepEqual(readSessionPresets(storage,'one','prop'),[])
})
test('editing and deleting one preset preserve other saved configurations',()=>{
 const storage=store(),one=saveSessionPreset(storage,'one','backtest',{name:'one',config:config()}),two=saveSessionPreset(storage,'one','backtest',{name:'two',config:config()})
 const changed=saveSessionPreset(storage,'one','backtest',{...one,name:'renamed',config:{...config(),balance:'50000'}})
 assert.deepEqual(readSessionPresets(storage,'one','backtest'),[changed,two])
 deleteSessionPreset(storage,'one','backtest',changed.id)
 assert.deepEqual(readSessionPresets(storage,'one','backtest'),[two])
 assert.throws(()=>saveSessionPreset(storage,'one','backtest',one),/Preset đã thay đổi/)
})
test('invalid names, duplicate names and malformed settings never replace valid presets',()=>{
 const storage=store(),one=saveSessionPreset(storage,'one','backtest',{name:'one',config:config()})
 for(const name of ['', 'x'.repeat(161),'ONE']) assert.throws(()=>saveSessionPreset(storage,'one','backtest',{name,config:config()}))
 assert.throws(()=>saveSessionPreset(storage,'one','backtest',{name:'broken',config:{...config(),datasets:[]}}))
 assert.deepEqual(readSessionPresets(storage,'one','backtest'),[one])
})
test('corrupt or unsupported storage fails visibly instead of resetting and overwriting it',()=>{
 const storage=store(),key=sessionPresetKey('one','backtest')
 for(const value of ['broken',JSON.stringify({version:'future',items:[]}),JSON.stringify({version:'session-presets-v1',items:[{id:'x',name:'x',config:{}}]})]) {
  storage.setItem(key,value)
  assert.throws(()=>readSessionPresets(storage,'one','backtest'))
  assert.throws(()=>saveSessionPreset(storage,'one','backtest',{name:'new',config:config()}))
  assert.equal(storage.getItem(key),value)
 }
})
test('quota and access failures are propagated so UI cannot claim a preset was saved',()=>{
 const storage=store();storage.setItem=()=>{throw new DOMException('full','QuotaExceededError')}
 assert.throws(()=>saveSessionPreset(storage,'one','backtest',{name:'new',config:config()}),{name:'QuotaExceededError'})
 assert.deepEqual(readSessionPresets(storage,'one','backtest'),[])
})
