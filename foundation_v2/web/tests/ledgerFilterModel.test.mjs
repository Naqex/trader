import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EXTRA_FILTERS } from '../src/tradingAnalyticsModel.js'
import { LEDGER_BASE_FILTERS, ledgerFilterChips, removeLedgerFilter, ledgerFilterUrl } from '../src/ledgerFilterModel.js'

test('chips retain zero hour, AND/OR tag values with commas and distinct date groups', () => {
 const filters={...LEDGER_BASE_FILTERS,from:'2024-01-01'},extra={...DEFAULT_EXTRA_FILTERS,sides:'["sell"]',hours:'["0"]',tagInclude:'["a,b","c"]',tagExclude:'["x"]'}
 const chips=ledgerFilterChips(filters,extra)
 assert.deepEqual(chips.map(c=>c.key),['sides','hours','tagInclude','tagExclude','dates'])
 assert.deepEqual(chips.find(c=>c.key==='tagInclude').values,['a,b','c'])
 assert.deepEqual(chips.find(c=>c.key==='hours').values,['0'])
 const [next,nextExtra]=removeLedgerFilter(filters,extra,chips.find(c=>c.key==='tagInclude'))
 assert.equal(next.from,'2024-01-01');assert.equal(nextExtra.tagInclude,'');assert.equal(nextExtra.tagExclude,'["x"]');assert.equal(nextExtra.sides,'["sell"]')
})

test('one URL update preserves session scope, language and unrelated state and removes the retired clock parameter', () => {
 const href='http://localhost/?workspace=tenant-a&view=trade&lang=en&sessions=a&sessions=b&from_close_utc=2020-01-01&analytics_timezone=UTC&trades_time_basis=activity&analytics_sides=%5B%22sell%22%5D&analytics_tagExclude=%5B%22x%22%5D'
 const url=ledgerFilterUrl(href,{...LEDGER_BASE_FILTERS,from:'2024-02-01'},{...DEFAULT_EXTRA_FILTERS,tagExclude:'["x"]',sides:'["sell"]'})
 assert.deepEqual(url.searchParams.getAll('sessions'),['a','b']);assert.equal(url.searchParams.get('lang'),'en')
 assert.equal(url.searchParams.get('from'),'2024-02-01');assert.equal(url.searchParams.has('from_close_utc'),false);assert.equal(url.searchParams.has('analytics_timezone'),false)
 assert.equal(url.searchParams.has('trades_time_basis'),false);assert.equal(url.searchParams.get('analytics_sides'),'["sell"]')
 const cleared=ledgerFilterUrl(url,LEDGER_BASE_FILTERS,DEFAULT_EXTRA_FILTERS)
 assert.equal(cleared.searchParams.has('analytics_sides'),false);assert.equal(cleared.searchParams.has('analytics_tagExclude'),false);assert.equal(cleared.searchParams.has('from'),false)
 assert.equal(cleared.searchParams.has('trades_time_basis'),false);assert.deepEqual(cleared.searchParams.getAll('sessions'),['a','b'])
})

test('removing dates or a legacy side leaves other groups intact and no empty chip remains', () => {
 const filters={...LEDGER_BASE_FILTERS,side:'buy',from:'2024-01-01',to:'2024-02-01'},extra={...DEFAULT_EXTRA_FILTERS,months:'["1"]'}
 let [next,nextExtra]=removeLedgerFilter(filters,extra,{key:'dates'})
 assert.equal(next.from,'');assert.equal(next.to,'');assert.equal(next.side,'buy');assert.equal(nextExtra.months,'["1"]')
 ;[next,nextExtra]=removeLedgerFilter(next,nextExtra,{key:'side',base:true})
 assert.deepEqual(ledgerFilterChips(next,nextExtra).map(c=>c.key),['months'])
 assert.deepEqual(ledgerFilterChips(LEDGER_BASE_FILTERS,DEFAULT_EXTRA_FILTERS),[])
})
