import test from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_FILTERS, dealNet, filterLiveDeals, calendarWeeks, calendarWeekSummary, liveCalendarBorders, cumulativeDealSeries, summarizeDeals, dayKey } from '../src/liveWorkspaceModel.js'
const makeDeal = (ticket, time, profit, costs = {}) => ({ ticket, type: 0, symbol: 'EURUSD', time_msc: Date.parse(time), profit, commission: 0, swap: 0, fee: 0, ...costs })
const payload = { account: { account_ref: 'A', currency: 'USD' }, history_from_utc: '2026-09-30T12:00:00Z', captured_at_utc: '2026-10-06T08:00:00Z', deals: [makeDeal('1', '2026-10-04T23:30:00Z', 100, { commission: -5 }), makeDeal('2', '2026-10-05T09:00:00Z', -50, { fee: -2 }), { ...makeDeal('cash', '2026-10-04T08:00:00Z', 1000), type: 2 }] }
test('net includes every cost and excludes non-trading cashflows', () => {
 const deals = filterLiveDeals(payload)
 assert.equal(deals.length, 2);assert.equal(summarizeDeals(deals).net,43)
 assert.equal(dealNet({...deals[0], fee:undefined}),null)
 assert.equal(dealNet({...deals[0],profit:'100'}),null)
 assert.equal(summarizeDeals([],false).net,null)
})
test('filters use selected timezone and date bounds without mutating the source', () => {
 assert.equal(dayKey(payload.deals[0].time_msc,'Asia/Ho_Chi_Minh'),'2026-10-05')
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,timezone:'Asia/Ho_Chi_Minh',from:'2026-10-05',to:'2026-10-05'}).length,2)
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,outcome:'loss'}).length,1)
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,account:'other'}).length,0)
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,side:'1'}).length,0)
 assert.equal(payload.deals.length,3)
})
test('calendar distinguishes missing feed, fully covered empty day and partial cutoff', () => {
 const cells = calendarWeeks('2026-10',payload,filterLiveDeals(payload)).flat()
 assert.equal(cells.find(x=>x.key==='2026-10-01').net,0)
 assert.equal(cells.find(x=>x.key==='2026-10-06').net,null)
 assert.equal(cells.find(x=>x.key==='2026-10-04').net,95)
 assert.equal(cells.find(x=>x.key==='2026-10-05').net,-52)
 assert.ok(calendarWeeks('2026-10',null,[]).flat().every(x=>x.net===null))
 assert.ok(calendarWeeks('2026-10',{...payload,history_from_utc:null},[]).flat().every(x=>x.net===null))
})
test('unknown costs stop cumulative totals instead of bridging a misleading curve',()=> {
 const deals=filterLiveDeals(payload)
 const series=cumulativeDealSeries([deals[0],{...deals[1],fee:null},{...deals[1],time_msc:Date.parse('2026-10-06T01:00:00Z')}])
 assert.deepEqual(series.map(x=>x.value),[95,null,null])
})

test('calendar scaffold shows zero while missing account coverage remains unknown', () => {
 const empty = calendarWeeks('2026-10', null, [])
 assert.ok(empty.every(week => {
  assert.deepEqual(calendarWeekSummary(week, true), {count:0,net:0,partial:false})
  return week.every(day => day.net === null)
 }))
 // A selected MT5 connection may have no snapshot yet; it is not the empty scaffold.
 assert.deepEqual(calendarWeekSummary(empty[0], false), {count:null,net:null,partial:true})
 const complete = {...payload,history_from_utc:'2026-09-30T00:00:00Z',captured_at_utc:'2026-11-01T00:00:00Z'}
 const weeks = calendarWeeks('2026-10', complete, filterLiveDeals(complete))
 assert.deepEqual(calendarWeekSummary(weeks[0]),{count:1,net:95,partial:false})
 assert.deepEqual(calendarWeekSummary(weeks[2]),{count:0,net:0,partial:false})
 assert.deepEqual(calendarWeekSummary(calendarWeeks('2026-10',payload,filterLiveDeals(payload))[1]),{count:1,net:-52,partial:true})
 const missingCost = {...complete,deals:[makeDeal('unknown','2026-10-04T12:00:00Z',100,{fee:null})]}
 assert.deepEqual(calendarWeekSummary(calendarWeeks('2026-10',missingCost,filterLiveDeals(missingCost))[0]),{count:1,net:null,partial:true})
})

test('weekly totals exclude dates and weekdays outside the selected filter', () => {
 const complete = {...payload,history_from_utc:'2026-09-01T00:00:00Z',captured_at_utc:'2026-11-01T00:00:00Z'}
 const filters = {...LIVE_FILTERS,day:'1',from:'2026-10-05',to:'2026-10-05'}
 const weeks = calendarWeeks('2026-10', complete, filterLiveDeals(complete,filters),filters)
 assert.deepEqual(calendarWeekSummary(weeks[1]),{count:1,net:-52,partial:false})
 assert.equal(weeks[1].filter(day=>day.eligible).length,1)
 assert.deepEqual(calendarWeekSummary(weeks[0]),{count:null,net:null,partial:false})
})

test('full local-day coverage uses the selected zone and DST day length', () => {
 const filters={...LIVE_FILTERS,timezone:'America/New_York'}
 for(const [month,key,start,end] of [
  ['2026-03','2026-03-08','2026-03-08T05:00:00Z','2026-03-09T04:00:00Z'],
  ['2026-11','2026-11-01','2026-11-01T04:00:00Z','2026-11-02T05:00:00Z'],
 ]) {
  const source={account:payload.account,deals:[],history_from_utc:start,captured_at_utc:end}
  const cell=calendarWeeks(month,source,[],filters).flat().find(day=>day.key===key)
  assert.equal(cell.covered,true);assert.equal(cell.net,0);assert.equal(cell.partial,false)
  const incomplete={...source,captured_at_utc:new Date(Date.parse(end)-1).toISOString()}
  assert.equal(calendarWeeks(month,incomplete,[],filters).flat().find(day=>day.key===key).net,null)
 }
})

test('outcome filters use the same break-even tolerance as closed-trade statistics', () => {
 const values = [-2e-12,-1e-12,0,1e-12,2e-12]
 const source = {...payload,deals:values.map((value,index)=>makeDeal(String(index),'2026-10-05T09:00:00Z',value))}
 source.deals.push({...source.deals[0],ticket:'unknown',fee:null})
 assert.deepEqual(filterLiveDeals(source,{...LIVE_FILTERS,outcome:'flat'}).map(deal=>deal.profit),[-1e-12,0,1e-12])
 assert.deepEqual(filterLiveDeals(source,{...LIVE_FILTERS,outcome:'gain'}).map(deal=>deal.profit),[2e-12])
 assert.deepEqual(filterLiveDeals(source,{...LIVE_FILTERS,outcome:'loss'}).map(deal=>deal.profit),[-2e-12])
 assert.equal(source.deals.length,6)
})

test('calendar seams have one owner, keep adjacent tones and leave the bottom to the footer', () => {
 const weeks = Array.from({length:2}, (_, row) => Array.from({length:7}, (_, column) => ({key:`${row}:${column}`,inMonth:true,net:0})))
 weeks[0][0].net = 10
 weeks[0][1].net = -5
 weeks[0][6].net = -5
 weeks[1][6].net = -10
 const {days, totals} = liveCalendarBorders(weeks)
 const top = '--live-calendar-edge-top', left = '--live-calendar-edge-left'
 assert.equal(days.get('0:0')[top], 'var(--report-positive)')
 assert.equal(days.get('0:1')[left], 'var(--report-negative)', 'right owner resolves competing tones')
 assert.equal(days.get('0:2')[left], 'var(--report-negative)', 'neutral neighbor preserves the loss edge')
 assert.equal(days.get('1:0')[top], 'var(--report-positive)', 'lower neighbor owns the colored bottom seam')
 assert.equal(totals[0][left], 'var(--report-negative)', 'weekly total owns the last day right edge')
 assert.equal(totals[0][top], 'var(--wm-border)')
 assert.deepEqual(Object.keys(days.get('1:6')), [top, left], 'last-row cell draws no bottom edge alongside the orange footer')
 weeks[0][0].inMonth = false
 assert.equal(liveCalendarBorders(weeks).days.get('0:0')[top], 'var(--wm-border)', 'outside-month data does not create a tone')
})
