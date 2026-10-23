import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarAccountSelection, combineCalendarAccounts } from '../src/liveCalendarAccounts.js'
import { buildWorkspaceHref } from '../src/workspaceContext.js'
import { calendarWeeks, summarizeDeals } from '../src/liveWorkspaceModel.js'
const snapshot = (currency, profit, start='2026-10-01T00:00:00Z') => ({ account:{currency,balance:1000}, deals:[{ticket:1,symbol:'EURUSD',type:0,time_msc:Date.parse('2026-10-12T12:00:00Z'),profit,commission:0,swap:0,fee:0}],history_from_utc:start,captured_at_utc:'2026-10-23T00:00:00Z' })
test('all, none and explicit selections remain distinct across live navigation',()=>{
 for (const [value,expected] of [['all',null],['none',[]],['broker:a,manual-b',['broker:a','manual-b']]]) {
  const query=new URLSearchParams({live_accounts:value})
  assert.deepEqual(calendarAccountSelection(query),expected)
  const next=new URL(buildWorkspaceHref('live','tenant-a',query),'http://localhost')
  assert.equal(next.searchParams.get('live_accounts'),value)
 }
 assert.deepEqual(calendarAccountSelection(new URLSearchParams('live_account=broker:a')),['broker:a'])
 assert.equal(calendarAccountSelection(new URLSearchParams()),null)
})
test('combines same-currency PnL with account provenance and conservative coverage',()=>{
 const {payload,issue}=combineCalendarAccounts([{id:'a',payload:snapshot('USD',25)},{id:'b',payload:snapshot('USD',-10,'2026-10-10T00:00:00Z')}])
 assert.equal(issue,'')
 assert.deepEqual(summarizeDeals(payload.deals),{net:15,count:2})
 assert.equal(payload.account.balance,2000)
 assert.deepEqual(payload.deals.map(row=>row.source_account),['a','b'])
 assert.equal(payload.account.opening_balance,null)
 const days=calendarWeeks('2026-10',payload,payload.deals).flat()
 assert.equal(days.find(day=>day.key==='2026-10-05').covered,false)
 assert.equal(days.find(day=>day.key==='2026-10-12').covered,true)
})
test('missing accounts and mixed currencies never produce partial or converted totals',()=>{
 for(const sources of [[{id:'a',payload:snapshot('USD',25)},{id:'b',payload:null}],[{id:'a',payload:snapshot('USD',25)},{id:'b',payload:snapshot('EUR',10)}]]) {
  const result=combineCalendarAccounts(sources)
  assert.equal(result.payload,null)
  assert.ok(result.issue)
 }
 assert.deepEqual(combineCalendarAccounts([]),{payload:null,issue:''})
 const source=snapshot('USD',25);source.stale=true
 assert.ok(combineCalendarAccounts([{id:'a',payload:source}]).issue)
})
