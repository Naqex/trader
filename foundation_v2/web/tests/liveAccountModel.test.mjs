import test from 'node:test'
import assert from 'node:assert/strict'
import { liveAccountRows, accountTransactions, accountCashSummary, accountDraftErrors, duplicateAccountSeed, mt5AccountName } from '../src/liveAccountModel.js'

test('MT5 names use verified login and environment with an optional owner label',()=>{
  const connection={name:'MetaTrader 5',account_login:'464104926',login_hint:'…4926',account_environment:'demo'}
  assert.equal(mt5AccountName(connection),'MT5 464104926 - demo')
  assert.equal(mt5AccountName({...connection,name:'Standard'}),'MT5 464104926 - demo - Standard')
  assert.equal(mt5AccountName({...connection,name:'MT5',account_environment:'real'}),'MT5 464104926 - real')
  assert.equal(mt5AccountName({...connection,name:'MetaTrader',account_environment:'unknown',account_login:null}),'MT5 …4926')
  assert.equal(mt5AccountName({name:'My account'}),'MT5 - My account')
})

test('account metadata validates type, UTC date and exact decimal input',()=>{
  const draft={name:'New',currency:'USD',account_type:'prop',opening_balance:'0',opening_at_utc:'2026-09-01T10:20'}
  assert.deepEqual(accountDraftErrors(draft),{})
  for(const opening_balance of ['','-1','NaN','1e2','1000000000000001','0.0000000000001']) assert.ok(accountDraftErrors({...draft,opening_balance}).opening_balance)
  assert.ok(accountDraftErrors({...draft,account_type:'unknown'}).account_type)
  assert.ok(accountDraftErrors({...draft,opening_at_utc:''}).opening_at_utc)
  assert.ok(accountDraftErrors({...draft,name:'   '}).name)
})

test('opening date survives snapshots and transactions; legacy uses creation time',()=>{
  const dated={...account,payload:{...account.payload,opening_at_utc:'2026-09-01T10:20:00Z',account_type:'live'}}
  const row=liveAccountRows([dated],[dated],null)[0]
  assert.equal(row.snapshot.history_from_utc,dated.payload.opening_at_utc)
  assert.equal(accountTransactions(row)[0].time,Date.parse(dated.payload.opening_at_utc))
  assert.equal(accountTransactions(liveAccountRows([account],[account],null)[0])[0].time,Date.parse(account.created_at_utc))
})

test('duplicates copy configuration without account ids, history or credentials',()=>{
  const row=liveAccountRows([account],[account],null)[0]
  const seed=duplicateAccountSeed(row,0)
  assert.equal(seed.opening_balance,'1000')
  assert.equal(seed.opening_at_utc,'1970-01-01T00:00')
  assert.equal(seed.account_id,undefined)
  const broker=duplicateAccountSeed({name:'MT5',snapshot:{account:{}},connection:{credential:'never copy'}},0)
  assert.equal(broker.opening_balance,'')
  assert.equal(broker.connection,undefined)
})

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
