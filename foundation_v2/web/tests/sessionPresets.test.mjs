import test from 'node:test'
import assert from 'node:assert/strict'
import {readLegacySessionPresets,validateSessionPreset,sessionPresetKey} from '../src/sessionPresets.js'
import {fetchSessionPresets,saveSessionPreset,deleteSessionPreset} from '../src/sessionPresetApi.js'
const store = () => {const values=new Map();return {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
const config = () => ({balance:'10000',datasets:['asset-one'],strategy:'',propDraft:{profileKind:'generic',targetPercent:'10',dailyLoss:'500',overallLoss:'1000',durationDays:''},tradingOptions:{version:'session-trading-options-v2',costs_enabled:false,assets:{'asset-one':{spread_price:'0',commission_per_lot:'0',commission_charge:'round_trip',slippage:{mode:'off'}}}}})
const item = (name='one') => ({id:name,mode:'backtest',revision:1,name,config:config()})
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})

test('legacy presets remain scoped and malformed storage is never overwritten',()=>{
 const storage=store(),key=sessionPresetKey('one','backtest'),saved=item()
 storage.setItem(key,JSON.stringify({version:'session-presets-v1',items:[saved]}))
 assert.deepEqual(readLegacySessionPresets(storage,'one','backtest'),[saved])
 assert.deepEqual(readLegacySessionPresets(storage,'two','backtest'),[])
 assert.deepEqual(readLegacySessionPresets(storage,'one','prop'),[])
 for(const raw of ['broken',JSON.stringify({version:'future',items:[]})]) {
  storage.setItem(key,raw);assert.throws(()=>readLegacySessionPresets(storage,'one','backtest'));assert.equal(storage.getItem(key),raw)
 }
})

test('preset validation trims names and clones configuration without mutating the draft',()=>{
 const draft={name:'  one  ',config:config()},saved=validateSessionPreset(draft)
 assert.equal(saved.name,'one');draft.config.balance='50000';assert.equal(saved.config.balance,'10000')
 for(const name of ['', 'x'.repeat(161)]) assert.throws(()=>validateSessionPreset({name,config:config()}))
 assert.throws(()=>validateSessionPreset({name:'bad',config:{...config(),datasets:[]}}))
})

test('server save/edit/delete carry workspace, mode and expected revision; conflicts stay visible',async t=>{
 const calls=[]
 t.mock.method(globalThis,'fetch',async (path,options)=>{
  calls.push({path,body:JSON.parse(options.body),headers:new Headers(options.headers)})
  if(path.endsWith('/delete')) return json({id:'one',mode:'backtest',revision:3,deleted:true})
  if(calls.length===3) return json({detail:'session_preset_revision_conflict'},409)
  return json({...item(),revision:calls.length})
 })
 const created=await saveSessionPreset('api-test','backtest',{name:'one',config:config()})
 const edited=await saveSessionPreset('api-test','backtest',created)
 await assert.rejects(saveSessionPreset('api-test','backtest',created),/Preset đã thay đổi/)
 await deleteSessionPreset('api-test','backtest',edited)
 assert.equal(calls[0].headers.get('X-Workspace-Id'),'api-test')
 assert.equal(calls[0].body.mode,'backtest');assert.ok(calls[0].headers.get('Idempotency-Key'))
 assert.equal(calls[1].body.expected_revision,1);assert.equal(calls[3].body.expected_revision,2)
})

test('legacy import verifies server reads before removing its browser backup',async t=>{
 const storage=store(),key=sessionPresetKey('import-test','backtest'),old={id:'old',name:'one',config:config()}
 storage.setItem(key,JSON.stringify({version:'session-presets-v1',items:[old]}))
 let items=[],reads=0
 t.mock.method(globalThis,'fetch',async (path,options)=>{
  if(!options.method || options.method==='GET') {reads++;return json({version:'session-presets-v1',items})}
  assert.equal(new Headers(options.headers).get('Idempotency-Key'),'session-preset-import-v1:backtest:old')
  items=[item()];return json(items[0],201)
 })
 const result=await fetchSessionPresets('import-test','backtest',{storage})
 assert.equal(result.warning,'');assert.equal(result.items.length,1);assert.equal(reads,2)
 assert.equal(storage.getItem(key),null)
})

test('partial or conflicting imports retain local backups and preserve server settings',async t=>{
 const storage=store(),key=sessionPresetKey('conflict-test','backtest'),old={id:'old',name:'one',config:{...config(),balance:'50000'}}
 const raw=JSON.stringify({version:'session-presets-v1',items:[old]});storage.setItem(key,raw)
 let writes=0
 t.mock.method(globalThis,'fetch',async (path,options)=>{
  if(options.method==='POST') {writes++;throw new Error('unexpected write')}
  return json({version:'session-presets-v1',items:[item()]})
 })
 const result=await fetchSessionPresets('conflict-test','backtest',{storage})
 assert.ok(result.warning);assert.equal(storage.getItem(key),raw);assert.equal(writes,0)
 assert.equal(result.items[0].config.balance,'10000')
 storage.setItem(key,'broken')
 const corrupt=await fetchSessionPresets('conflict-test','backtest',{storage})
 assert.ok(corrupt.warning);assert.equal(corrupt.items.length,1);assert.equal(storage.getItem(key),'broken')
})

test('a stale or altered save response is an unknown outcome, not successful persistence',async t=>{
 const original=item()
 const replies=[original,{...original,id:'other',revision:2},{...original,revision:2,config:{...config(),balance:'50000'}}]
 t.mock.method(globalThis,'fetch',async()=>json(replies.shift()))
 for(let i=0;i<3;i++) await assert.rejects(saveSessionPreset('stale-test','backtest',original),error=>error.outcomeKnown===false)
})

test('import never erases local changes made by another tab while requests are pending',async t=>{
 const storage=store(),key=sessionPresetKey('tab-race','backtest'),old={id:'old',name:'one',config:config()}
 storage.setItem(key,JSON.stringify({version:'session-presets-v1',items:[old]}))
 const changed=JSON.stringify({version:'session-presets-v1',items:[old,{...old,id:'new',name:'new'}]})
 let reads=0
 t.mock.method(globalThis,'fetch',async(path,options)=>{
  if(options.method==='POST') {storage.setItem(key,changed);return json(item(),201)}
  return json({version:'session-presets-v1',items:++reads===1?[]:[item()]})
 })
 const result=await fetchSessionPresets('tab-race','backtest',{storage})
 assert.ok(result.warning);assert.equal(storage.getItem(key),changed)
})
