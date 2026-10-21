import test from 'node:test'
import assert from 'node:assert/strict'
import { liveAccountRows, accountTransactions, accountCashSummary } from '../src/liveAccountModel.js'

const account = {record_id:'a',kind:'account',created_at_utc:'2026-10-01T00:00:00Z',payload:{name:'QA',currency:'USD',opening_balance:'1000'}}
test('manual opening balance is its own event, never a deposit or live equity',()=>{
  const row = liveAccountRows([account],[account],null)[0]
  assert.equal(row.snapshot.account.balance,1000)
  assert.equal(row.snapshot.account.equity,null)
  assert.deepEqual(accountTransactions(row).map(item => [item.kind,item.amount]),[['opening',1000]])
  assert.deepEqual(accountCashSummary(row),{deposit:null,withdrawal:null,fees:null,net:0})
})
test('broker cash movements are separated from trading deals and retain signed amounts',()=>{
  const broker = {source:'MT5',account:{account_ref:'masked',currency:'USD',balance:1090},deals:[{profit:100,commission:-5,swap:0,fee:-2}],cashflows:[{ticket:1,type:2,profit:1000,time_msc:1},{ticket:2,type:2,profit:-10,time_msc:2},{ticket:3,type:4,profit:-2,time_msc:3},{ticket:4,type:5,profit:9,time_msc:4}]}
  const row = liveAccountRows([],[],broker)[0]
  assert.deepEqual(accountTransactions(row).map(item => item.kind),['other','fee','withdrawal','deposit'])
  assert.deepEqual(accountCashSummary(row),{deposit:1000,withdrawal:-10,fees:-2,net:93})
  assert.equal(row.snapshot.account.opening_balance,undefined)
})
test('missing cashflow data or amounts remain unknown, empty verified history may be zero',()=>{
  const row = {snapshot:{account:{},deals:null,cashflows:null}}
  assert.equal(accountTransactions(row),null)
  assert.deepEqual(accountCashSummary(row),{deposit:null,withdrawal:null,fees:null,net:null})
  row.snapshot.cashflows = [{ticket:1,type:2,profit:null,time_msc:1}]
  assert.equal(accountCashSummary(row).deposit,null)
  row.snapshot.cashflows = []
  assert.equal(accountCashSummary(row).deposit,0)
  assert.equal(accountTransactions(null),null)
})
test('account rows isolate manual accounts and mark stale snapshots visibly',()=>{
  const records = [account,{record_id:'other',kind:'trade',updated_at_utc:'2099-01-01',payload:{account_id:'elsewhere'}}]
  const [broker,manual] = liveAccountRows([account],records,{stale:true,account:{account_ref:'mask'}})
  assert.equal(broker.status,'stale')
  assert.equal(manual.updated,account.created_at_utc)
})
test('queued and disconnected MT5 accounts remain selectable without invented balances',()=>{
  const rows=liveAccountRows([],[],{connections:[{id:'one',name:'One',status:'queued'},{id:'two',name:'Two',status:'disconnected',account:{balance:42,currency:'USD'}}]})
  assert.deepEqual(rows.map(row=>row.id),['broker:one','broker:two'])
  assert.equal(rows[0].snapshot.account.balance,undefined)
  assert.equal(rows[1].snapshot.account.balance,42)
  assert.equal(accountTransactions(rows[1]),null)
  assert.equal(accountCashSummary(rows[1]).net,null)
})
test('only selected MT5 connection receives its full history',()=>{
  const rows=liveAccountRows([],[],{connection_id:'two',account:{balance:20},deals:[],cashflows:[],connections:[{id:'one',name:'One',status:'connected',account:{balance:10}},{id:'two',name:'Two',status:'connected',account:{balance:20}}]})
  assert.equal(accountTransactions(rows[0]),null)
  assert.deepEqual(accountTransactions(rows[1]),[])
  assert.equal(rows[0].snapshot.account.balance,10)
})
