import test from 'node:test'
import assert from 'node:assert/strict'
import { compareTableValues, nextTableSort, nextTableSorts, sortTableRows, tableColumnsPreference } from '../src/tableModel.js'
import { filterLibrary } from '../src/dataLibraryModel.js'
import { filterAnalyticsRows } from '../src/tradingAnalyticsModel.js'

test('numeric table sort keeps zero and both signs, unknown last in both directions', () => {
  const values=[null,0,-2,NaN,12,undefined]
  assert.deepEqual([...values].sort((a,b)=>compareTableValues(a,b,'asc')).slice(0,3),[-2,0,12])
  assert.deepEqual([...values].sort((a,b)=>compareTableValues(a,b,'desc')).slice(0,3),[12,0,-2])
  assert.equal(compareTableValues(null,NaN),0)
  assert(compareTableValues('Item 2','Item 10')<0)
  assert.deepEqual(nextTableSort({key:'a',direction:'asc'},'a'),{key:'a',direction:'desc'})
})

test('library search and dropdowns cover late rows before sorting and slicing', () => {
  const rows=Array.from({length:35},(_,i)=>({key:`item-${i}`,instrument_id:`CODE${i}`,name:i===34?'Vàng dữ liệu':'Euro',asset_class:i===34?'metal':'fx',downloaded:true,row_count:i}))
  assert.equal(filterLibrary(rows,{sort:'count-asc'}).slice(0,10).some(row=>row.name==='Vàng dữ liệu'),false)
  for (const filter of [{search:' LIEU  vang '},{category:'metal'}]) {
    const filtered=filterLibrary(rows,filter)
    assert.equal(filtered.length,1);assert.equal(filtered[0].key,'item-34')
  }
  assert.deepEqual(filterLibrary(rows,{sort:'count-desc'}).slice(0,2).map(r=>r.row_count),[34,33])
})

test('date sort matches displayed catalog metadata, epochs and ISO dates', () => {
  const rows=[{key:'seconds',instrument_id:'A',downloaded:true,first_timestamp:1704067200},{key:'iso',instrument_id:'B',downloaded:true,available_range:{from_utc:'2025-01-01T00:00:00Z'}},{key:'catalog',instrument_id:'C',provider:'Dukascopy',downloaded:false},{key:'missing',instrument_id:'D',downloaded:false}]
  const download={provider:'Dukascopy',earliest_dates:{C:'2023-01-01'}}
  assert.deepEqual(filterLibrary(rows,{sort:'from-asc',download}).map(r=>r.key),['catalog','seconds','iso','missing'])
  assert.deepEqual(filterLibrary(rows,{sort:'from-desc',download}).map(r=>r.key),['iso','seconds','catalog','missing'])
  assert.equal(filterLibrary([{...rows[0],key:'z',row_count:2},{...rows[0],key:'a',row_count:2}],{sort:'count-desc'})[0].key,'a')
})

test('local trade search uses the same unaccented unordered tokens as native trades', () => {
  const rows=Array.from({length:35},(_,i)=>({trade_id:`t-${i}`,tags:i===34?['Kỷ luật tốt']:[],net_pnl:i}))
  const filtered=filterAnalyticsRows(rows,{search:' TOT  ky LUAT '})
  assert.equal(filtered.length,1);assert.equal(filtered[0].trade_id,'t-34')
})

test('ordered multi-sort toggles in place and uses later keys only for ties before paging', () => {
  let sorts = nextTableSorts([], 'group')
  sorts = nextTableSorts(sorts, 'pnl')
  assert.deepEqual(nextTableSorts(sorts, 'group'), [{ key: 'group', direction: 'desc' }, { key: 'pnl', direction: 'asc' }])
  const rows = [{ id: 'a', group: 'B', pnl: -2 }, { id: 'b', group: 'A', pnl: null }, { id: 'c', group: 'A', pnl: 0 }, { id: 'd', group: 'A', pnl: -2 }, { id: 'e', group: 'A', pnl: -2 }]
  const sorted = sortTableRows(rows, sorts, (row, key) => row[key])
  assert.deepEqual(sorted.map(row => row.id), ['d', 'e', 'c', 'b', 'a'])
  assert.deepEqual(sorted.slice(2, 4).map(row => row.id), ['c', 'b'])
  assert.deepEqual(sortTableRows(rows, nextTableSorts(sorts, 'pnl'), (row, key) => row[key]).map(row => row.id), ['c', 'd', 'e', 'b', 'a'])
  assert.deepEqual(sortTableRows(rows, [], (row, key) => row[key]), rows)
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'd', 'e'])
})

test('column preferences recover malformed/stale storage and retain deliberate empty selection', () => {
  const available = ['a', 'b', 'c']
  assert.deepEqual(tableColumnsPreference('["c","a","a","retired"]', available), ['a', 'c'])
  assert.deepEqual(tableColumnsPreference('[]', available), [])
  for (const raw of [null, 'oops', '{}', '[2]', '["retired"]']) assert.deepEqual(tableColumnsPreference(raw, available), available)
})
