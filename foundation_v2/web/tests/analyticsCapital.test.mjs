import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics, analyticsCapitalBases, periodReturn } from '../src/tradingAnalyticsModel.js'
const row=(session_id,net_pnl,starting_balance,date='2024-01-01T12:00:00Z')=>({session_id,net_pnl,starting_balance,report_time_utc:date})
const model=ledger=>({ledger,curve:[],drawdown:[],startBalance:10000,result:{multi_session:true}})
test('session sum and overall gain count each source capital once across assets and months',()=>{
 const source=model([row('a',100,1000),row('a',100,1000,'2024-02-01T12:00:00Z'),row('b',200,2000)])
 const data=advancedAnalytics(source,{timezone:'UTC'})
 assert.equal(periodReturn(data.months,data.capitalBases.initial,'sessions'),30)
 assert.equal(periodReturn(data.months,data.capitalBases.initial,'overall'),400/3000*100)
 assert.equal(periodReturn(data.months.slice(0,1),data.capitalBases.initial,'overall'),10)
 assert.equal(data.hours.find(item=>item.label==='12').profitPct,400/3000*100)
 const filtered=advancedAnalytics(source,{timezone:'UTC',search:'unmatched'})
 assert.deepEqual(filtered.capitalBases,data.capitalBases,'filters do not change the source capital pool')
})
test('missing, conflicting, zero capital and unrepresented sources cannot silently become returns',()=>{
 for(const ledger of [[row('a',100,null)],[row('a',100,0)],[row('a',100,1000),row('a',20,2000)]]){
 const data=advancedAnalytics(model(ledger));assert.equal(periodReturn(data.months,data.capitalBases.initial),null)
 }
 const source=model([row('a',100,1000)]);source.result.sources=[{session_id:'a'},{session_id:'b'}]
 const data=advancedAnalytics(source);assert.equal(periodReturn(data.months,data.capitalBases.initial),null)
})
test('current balance requires an explicit account snapshot and does not use filtered ending balance',()=>{
 const source={ledger:[row('a',100,null)],startBalance:1000,endingBalance:1100,result:{}}
 assert.deepEqual(analyticsCapitalBases(source),{initial:[{id:'a',capital:1000}],current:[{id:'a',capital:null}]})
 source.result.portfolio_account={balance:'1450'}
 assert.equal(analyticsCapitalBases(source).current[0].capital,1450)
 source.result.multi_session=true;assert.equal(analyticsCapitalBases(source).current[0].capital,null)
})
test('zero P/L returns stay zero, incomplete financial groups stay unknown',()=>{
 const data=advancedAnalytics(model([row('a',0,1000)]));assert.equal(periodReturn(data.months,data.capitalBases.initial),0)
 assert.equal(periodReturn([{complete:false,sourceNet:[]}],data.capitalBases.initial),null)
})

test('mixed account currencies never produce a money-weighted aggregate percentage',()=>{
 const source=model([{...row('a',100,1000),account_currency:'USD'},{...row('b',200,1000),account_currency:'EUR'}])
 const data=advancedAnalytics(source)
 assert.equal(periodReturn(data.months,data.capitalBases.initial),null)
 assert.equal(periodReturn(data.months,data.capitalBases.initial,'sessions'),30)
})

test('undated financial trades stay in totals and report incomplete temporal coverage',()=>{
 const source=model([row('a',100,1000),row('a',100,1000,null)])
 const data=advancedAnalytics(source,{timezone:'UTC'})
 assert.equal(data.net,200)
 assert.equal(data.count,2)
 assert.equal(data.datedCount,1)
 assert.equal(data.incomplete,true)
 assert.equal(data.months[0].net,100,'the known month is a subset, never an invented allocation')
})
