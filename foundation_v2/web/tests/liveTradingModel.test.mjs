import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_DRAFT, tradingReady, tradingBlockReason, demoDraftError, demoIntent, previewMatches, decodeDemoSnapshot, finalDemoReceipt, managedBrokerRules, quoteQuality, demoReason } from '../src/liveTradingModel.js'
const now = 1700000000000
const ready = {status:'ready',mode:'demo',execution_enabled:true,account:{login:'123',server:'Test',trade_mode:'demo'},policy:{max_quote_age_ms:5000},quote:{bid:1.1,ask:1.1002,time_msc:now},bars:[],positions:[],orders:[]}
const spec = {quantity_min:0.01,quantity_max:10,quantity_step:0.01}

test('application freshness policy stays distinct from broker permissions and session state',()=>{
 const payload={...ready,policy:{source:'application',profile:'managed_account',max_quote_age_ms:5000},broker_state:{source:'mt5',session:{state:'unknown'}}}
 assert.equal(managedBrokerRules(payload),true)
 assert.equal(managedBrokerRules({...ready,policy:{source:'broker'}}),true)
 assert.equal(managedBrokerRules({...ready,policy:{source:'application',profile:'bounded_demo'}}),false)
 assert.equal(quoteQuality(payload,now).state,'fresh')
 assert.equal(quoteQuality(payload,now+7000).state,'stale')
 assert.equal(quoteQuality({...payload,quote:{...payload.quote,time_msc:now+2000}},now).state,'future')
 assert.equal(quoteQuality({...payload,quote:{...payload.quote,time_msc:1e20}},now).state,'invalid')
 assert.equal(payload.broker_state.session.state,'unknown')
 assert.match(demoReason('demo_broker_rejected',10018),/MT5 xác nhận thị trường/)
 assert.doesNotMatch(demoReason('demo_quote_stale',10018),/MT5 xác nhận thị trường/)
})
test('permission, account mode, quote age and crossed market fail closed',()=>{
 assert.equal(tradingReady(ready,now),true)
 for(const payload of [{...ready,execution_enabled:false},{...ready,mode:'live'},{...ready,account:{...ready.account,trade_mode:'real'}},{...ready,quote:{...ready.quote,time_msc:now-5001}},{...ready,quote:{...ready.quote,time_msc:now+1001}},{...ready,quote:{...ready.quote,bid:1.2}}]) assert.equal(tradingReady(payload,now),false)
})
test('block reason describes stale quotes even when snapshot reports demo_ready',()=>{
 assert.equal(tradingBlockReason({...ready,reason:'demo_ready',quote:{...ready.quote,time_msc:now-13000}},now),'demo_quote_stale')
 assert.equal(tradingBlockReason({...ready,execution_enabled:false,reason:'demo_paused'},now),'demo_paused')
 assert.equal(tradingBlockReason({...ready,quote:{...ready.quote,bid:0}},now),'demo_quote_unavailable')
 assert.equal(tradingReady({...ready,quote:{...ready.quote,time_msc:now+1000}},now),true)
 assert.equal(tradingReady({...ready,quote:{...ready.quote,time_msc:now-5000}},now),true)
})
test('ticket requires MT5 lot grid and a correctly directed stop',()=>{
 const good = {...DEMO_DRAFT,quantity:'0.02',stopLoss:'1.09',takeProfit:'1.12'}
 assert.equal(demoDraftError(good,spec,ready.quote),'')
 for(const draft of [{...good,quantity:'0.015'},{...good,quantity:''},{...good,quantity:true},{...good,stopLoss:'1.2'},{...good,takeProfit:'1.0'},{...good,orderType:'limit'}]) assert.ok(demoDraftError(draft,spec,ready.quote))
 assert.ok(demoDraftError(good,{},ready.quote))
})
test('confirmation expires and binds exact account, server, side and amounts',()=>{
 const draft = {...DEMO_DRAFT,quantity:'0.02',stopLoss:'1.09'}
 const intent = demoIntent(ready,'EURUSD',draft), preview={value:{passed:true},key:JSON.stringify(intent),at:now}
 assert.equal(previewMatches(preview,intent,now+4999),true)
 assert.equal(previewMatches(preview,intent,now+5000),false)
 for(const patch of [{account_id:'other'},{server:'other'},{side:'SELL'},{volume:0.03}]) assert.equal(previewMatches(preview,{...intent,...patch},now),false)
 assert.equal(previewMatches({...preview,value:{passed:false}},intent,now),false)
})
test('invalid snapshots cannot present a ready trading workspace',()=>{
 assert.equal(decodeDemoSnapshot(ready),ready)
 assert.throws(()=>decodeDemoSnapshot({...ready,positions:null}))
 assert.throws(()=>decodeDemoSnapshot({...ready,mode:'live'}))
})

test('ISO terminal bars normalize at the API boundary for both chart engines',()=>{
 const row={timestamp:'2023-11-14T22:13:00+00:00',open:1.1,high:1.2,low:1.0,close:1.15,volume:5}
 assert.equal(decodeDemoSnapshot({...ready,bars:[row]}).bars[0].timestamp,1699999980)
 assert.throws(()=>decodeDemoSnapshot({...ready,bars:[{...row,timestamp:'invalid'}]}))
 assert.throws(()=>decodeDemoSnapshot({...ready,bars:[{...row,close:null}]}))
})

test('accepted or partial results needing reconciliation never release the send lock',()=>{
 for(const status of ['filled','accepted','done']) {
  assert.equal(finalDemoReceipt({status}),true)
  assert.equal(finalDemoReceipt({status,requires_reconciliation:true}),false)
 }
 assert.equal(finalDemoReceipt({status:'unknown'}),false)
})


test('managed Demo and Real accounts share order rules and preserve connection identity',()=>{
 for(const mode of ['demo','real']) {
  const payload={...ready,mode,connection_id:'selected-connection',policy:{source:'broker',max_quote_age_ms:5000},account:{...ready.account,trade_mode:mode}}
  assert.equal(tradingReady(payload,now),true)
  const draft={...DEMO_DRAFT,quantity:'0.02'}
  assert.equal(demoDraftError(draft,spec,payload.quote,true),'')
  const intent=demoIntent(payload,'EURUSD',draft)
  assert.equal(intent.mode,mode)
  assert.equal(intent.connection_id,'selected-connection')
  assert.equal(intent.stop_loss,null)
 }
 assert.equal(tradingReady({...ready,mode:'real',account:{...ready.account,trade_mode:'real'}},now),false)
})
