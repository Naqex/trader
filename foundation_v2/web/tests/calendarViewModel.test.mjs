import test from 'node:test'
import assert from 'node:assert/strict'
import { civilMonthWeeks, shiftCalendarMonth, calendarPeriodSummary } from '../src/calendarViewModel.js'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'

for (const [month,days] of [['2023-02',28],['2024-02',29],['2024-04',30],['2024-12',31]]) {
  test(`Monday-first complete weeks for ${month}`, () => {
    const weeks = civilMonthWeeks(month), all = weeks.flat()
    assert.equal(all.filter(day => day.inMonth).length,days)
    assert.equal(all.length % 7,0)
    assert.equal(all[0].date.getUTCDay(),1)
    assert.equal(all.at(-1).date.getUTCDay(),0)
    assert.equal(new Set(all.map(day => day.key)).size,all.length)
    assert.equal(all.filter(day=>day.inMonth)[0].key,`${month}-01`)
  })
}
test('calendar navigation crosses empty months/years and clamps supported years', () => {
  assert.equal(shiftCalendarMonth('2024-12',1),'2025-01')
  assert.equal(shiftCalendarMonth('2025-01',-1),'2024-12')
  assert.equal(shiftCalendarMonth('2024-02',12),'2025-02')
  assert.equal(shiftCalendarMonth('0001-01',-12),'0001-01')
  assert.equal(shiftCalendarMonth('9999-12',12),'9999-12')
})
const model = rows => ({ ledger:rows,curve:[],drawdown:[],startBalance:1000,endingBalance:1000,result:{scope:{time_basis:'market'}} })
const row = (id,net,day,r=null) => ({tradeId:id,net_pnl:net,close_time_utc:day,realized_r:r})
test('period win rate and R weight trades, not days; BE stays in denominator', () => {
  const data = advancedAnalytics(model([
    row('a',10,'2024-01-01T12:00:00Z',2),
    row('b',-1,'2024-01-02T12:00:00Z',-1),
    row('c',0,'2024-01-02T13:00:00Z'),
    row('d',-3,'2024-01-02T14:00:00Z',-3),
  ]))
  const total = calendarPeriodSummary(data.calendar)
  assert.equal(total.net,6);assert.equal(total.count,4)
  assert.equal(total.winRate,25)
  assert.equal(total.averageR,-2/3);assert.equal(total.rCount,3)
})
test('calendar retains missing PnL, and undated rows make period unknown', () => {
  const data = advancedAnalytics(model([
    row('a',10,'2024-01-01T12:00:00Z',2),
    row('b',null,'2024-01-01T13:00:00Z'),
    row('c',20,null,3),
  ]))
  assert.equal(data.calendar[0].count,2)
  assert.equal(data.calendar[0].net,null)
  assert.equal(data.calendar[0].rows.length,2)
  assert.equal(data.calendarUndatedCount,1)
  assert.equal(data.frequencySeries.day[0].tradeCount,2,'dated trades count even when PnL is unknown')
  const total = calendarPeriodSummary(data.calendar,data.calendarUndatedCount)
  assert.equal(total.net,null);assert.equal(total.winRate,null)
  assert.equal(total.averageR,null);assert.equal(total.count,null)
  assert.equal(total.observedCount,2);assert.equal(total.partial,true)
})
test('calendar dates use selected timezone across DST/midnight; no outside-month totals', () => {
  const data=advancedAnalytics(model([
    row('a',1,'2024-03-01T00:30:00Z'),row('b',2,'2024-03-11T03:30:00Z'),row('c',3,'2024-04-01T04:30:00Z'),
  ]),{timezone:'America/New_York'})
  assert.deepEqual(data.calendar.map(item=>item.label),['2024-02-29','2024-03-10','2024-04-01'])
  assert.equal(calendarPeriodSummary(data.calendar.filter(item=>item.label.startsWith('2024-03'))).net,2)
})
test('empty and all-undated calendars do not manufacture money or risk', () => {
  assert.deepEqual(calendarPeriodSummary([]),{observedCount:0,count:0,rCount:0,partial:false,net:null,winRate:null,averageR:null})
  const data = advancedAnalytics(model([row('a',10,null)]))
  assert.equal(data.calendar.length,0);assert.equal(data.calendarUndatedCount,1)
  const summary = calendarPeriodSummary([],1)
  assert.equal(summary.count,null);assert.equal(summary.partial,true)
})

test('partial source cannot claim a complete period even if every received row is known', () => {
  const data = advancedAnalytics(model([row('a',10,'2024-01-01T12:00:00Z',2)]))
  const summary = calendarPeriodSummary(data.calendar,0,true)
  assert.equal(summary.net,null);assert.equal(summary.count,null)
  assert.equal(summary.averageR,null);assert.equal(summary.winRate,null)
  assert.equal(summary.observedCount,1);assert.equal(summary.partial,true)
})
