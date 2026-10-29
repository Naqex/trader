import test from 'node:test'
import assert from 'node:assert/strict'
import { liveLedgerRows, liveLedgerFacets, filterLiveLedgerRows } from '../src/liveLedgerFilters.js'
import { manualSnapshot } from '../src/liveLedgerModel.js'
import { journalRecords } from './liveJournal.fixture.mjs'
import { DEFAULT_EXTRA_FILTERS } from '../src/tradingAnalyticsModel.js'
import { LEDGER_BASE_FILTERS } from '../src/ledgerFilterModel.js'

const records = journalRecords()
const manual = manualSnapshot(records[0], records)
const select = (rows, extra = {}, filters = {}) => filterLiveLedgerRows(rows, {...LEDGER_BASE_FILTERS,...filters}, {...DEFAULT_EXTRA_FILTERS,...extra})

test('manual trades use the shared multi-category filter and return original rows', () => {
  const rows = liveLedgerRows(manual)
  const selected = select(rows, {assets:'["EURUSD","GBPUSD"]',sides:'["buy"]',outcomes:'["win"]'})
  assert.equal(selected.length,32)
  assert.equal(selected[0],manual.deals[1])
  assert.equal(select(rows,{statuses:'["open"]'}).length,0)
  assert.equal(select(rows,{notesPresence:'["with"]'}).length,65)
})

test('tag include/exclude AND and OR preserve commas and intersect categories', () => {
  const payload = structuredClone(manual)
  payload.deals[0].record.payload.tags = ['planned','review, later']
  const rows = liveLedgerRows(payload)
  assert.deepEqual(select(rows,{tagInclude:'["planned","review, later"]'}),[payload.deals[0]])
  assert.equal(select(rows,{tagInclude:'["planned","Tag 1"]',tagIncludeMode:'OR'}).length,3)
  assert.equal(select(rows,{tagInclude:'["planned"]',tagExclude:'["planned","absent"]'}).length,1)
  assert.equal(select(rows,{tagInclude:'["planned"]',tagExclude:'["planned","absent"]',tagExcludeMode:'OR'}).length,0)
})

test('date bounds and year/month/hour use the selected clock in the workspace timezone', () => {
  const payload = structuredClone(manual)
  payload.deals = [payload.deals[0]]
  payload.deals[0].record.payload.closed_at_utc = '2025-12-31T23:30:00Z'
  payload.deals[0].record.created_at_utc = '2026-10-22T12:00:00Z'
  const market = liveLedgerRows(payload), activity = liveLedgerRows(payload,'activity')
  assert.equal(select(market,{timezone:'Asia/Ho_Chi_Minh',years:'["2026"]',months:'["1"]',hours:'["6"]'},{from:'2026-01-01',to:'2026-01-01'}).length,1)
  assert.equal(select(market,{timezone:'UTC'},{from:'2026-01-01'}).length,0)
  assert.deepEqual(liveLedgerFacets(market,'UTC').years,['2025'])
  assert.deepEqual(liveLedgerFacets(activity,'UTC').date_range,{from:'2026-10-22',to:'2026-10-22'})
  payload.deals[0].record.created_at_utc = null
  assert.deepEqual(liveLedgerFacets(liveLedgerRows(payload,'activity'),'UTC').years,[])
})

test('broker filters run after reconstruction; closing side is not opening side, notes stay unknown', () => {
  const fill = {symbol:'EURUSD',volume:1,price:1,profit:0,commission:-1,swap:0,fee:0}
  const payload = {positions:[],deals:[
    {...fill,ticket:1,position_id:1,entry:0,type:0,time_msc:Date.parse('2026-10-01T12:00:00Z')},
    {...fill,ticket:2,position_id:1,entry:1,type:1,profit:10,time_msc:Date.parse('2026-10-02T12:00:00Z')},
    {...fill,ticket:3,position_id:3,entry:1,type:0,time_msc:Date.parse('2026-10-03T12:00:00Z')},
  ]}
  const rows = liveLedgerRows(payload)
  const selected = select(rows,{sides:'["buy"]',statuses:'["closed"]',outcomes:'["win"]'},{from:'2026-10-02',to:'2026-10-02'})
  assert.equal(selected.length,1)
  assert.equal(selected[0].fills.length,2)
  assert.equal(selected[0].net_pnl,8)
  assert.equal(select(rows,{sides:'["sell"]'}).length,0)
  assert.equal(select(rows,{notesPresence:'["without"]'}).length,0)
  assert.equal(select(rows).length,2)
  assert.deepEqual(liveLedgerRows(payload,'activity').map(row=>row.table_time_utc),rows.map(row=>row.table_time_utc))
})

test('empty data and unknown time do not gain invented facets or match date restrictions', () => {
  assert.deepEqual(liveLedgerRows(null),[])
  assert.deepEqual(liveLedgerFacets([],'UTC').years,[])
  const row={sourceRow:{ticket:'unknown'},table_time_utc:null,has_notes:null,net_pnl:null}
  assert.equal(select([row]).length,1)
  assert.equal(select([row],{}, {from:'2026-01-01'}).length,0)
})
