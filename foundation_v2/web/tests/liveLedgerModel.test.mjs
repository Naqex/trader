import test from 'node:test'
import assert from 'node:assert/strict'
import { manualSnapshot, closedTradeStats, tagResults, exportTradesCsv, parseTradesCsv } from '../src/liveLedgerModel.js'
const account = {record_id:'a',created_at_utc:'2026-10-01T00:00:00Z',payload:{name:'QA',currency:'USD',opening_balance:'1000'}}
const trade = (gross,tags=['London']) => ({record_id:String(gross),kind:'trade',payload:{account_id:'a',symbol:'EURUSD',side:'BUY',quantity:'1',opened_at_utc:'2026-10-02T00:00:00Z',closed_at_utc:'2026-10-02T01:00:00Z',entry_price:'1.1',exit_price:'1.2',gross_pnl:String(gross),commission:'-2',swap:'-1',fee:'-2',tags,note:'a, "quote"\nline'}})
test('manual ledger isolates accounts/currency and uses signed costs once',()=>{
  const records=[trade(100),trade(-50),{...trade(900),payload:{...trade(900).payload,account_id:'other'}}]
  const snapshot=manualSnapshot(account,records,Date.parse('2026-10-20T00:00:00Z'))
  assert.equal(snapshot.deals.length,2);assert.equal(snapshot.account.balance,1040)
  assert.equal(snapshot.account.equity,null)
  assert.deepEqual(closedTradeStats(snapshot.deals,1000),{count:2,net:40,winRate:50,profitFactor:95/55,returnPercent:4})
  const groups=tagResults(snapshot.deals);assert.equal(groups[0].net,40);assert.equal(groups[0].count,2)
})
test('missing cost or malformed opening capital cannot become a known balance',()=>{
  const record=trade(100);record.payload.commission=null
  const snapshot=manualSnapshot(account,[record]);assert.equal(snapshot.account.balance,null)
  assert.equal(closedTradeStats(snapshot.deals,1000).net,null)
  assert.equal(manualSnapshot({...account,payload:{...account.payload,opening_balance:true}},[trade(100)]).account.balance,null)
  assert.equal(closedTradeStats([],0).returnPercent,null)
})
test('CSV roundtrip preserves decimals, multiline quotes and signed costs',()=>{
  const record=trade(-50),rows=parseTradesCsv(exportTradesCsv([record]))
  for(const key of ['gross_pnl','commission','swap','note']) assert.equal(rows[0][key],record.payload[key])
  assert.deepEqual(rows[0].tags,['London'])
})
test('CSV neutralizes formulas in text but preserves negative monetary amounts',()=>{
  const record=trade(-50);record.payload.symbol='=1+1';record.payload.note='@SUM(1,1)'
  const csv=exportTradesCsv([record]);assert.match(csv,/"'=1\+1"/);assert.match(csv,/"'@SUM/);assert.match(csv,/"-50"/)
})
test('CSV rejects invalid dates, incomplete quotes, headers and numeric overflow',()=>{
  const record=trade(100);record.payload.opened_at_utc='2026-02-30T00:00:00Z'
  assert.throws(()=>parseTradesCsv(exportTradesCsv([record])),/Dòng 2/)
  record.payload.opened_at_utc='2026-10-03T00:00:00Z';assert.throws(()=>parseTradesCsv(exportTradesCsv([record])),/Dòng 2/)
  assert.throws(()=>parseTradesCsv('symbol\nEURUSD'),/Cột/);assert.throws(()=>parseTradesCsv('"unclosed'),/ngoặc/)
})
test('CSV validates every row against server text and tag bounds before import starts',()=>{
  for (const patch of [{symbol:'X'.repeat(65)},{note:'a'.repeat(20001)},{tags:Array.from({length:21},(_,i)=>`tag${i}`)},{tags:['London','london']},{tags:['x'.repeat(65)]},{quantity:'0'.repeat(33)+'1'}]) {
    const record=trade(100);Object.assign(record.payload,patch)
    assert.throws(()=>parseTradesCsv(exportTradesCsv([trade(50),record])),/Dòng 3/)
  }
})
