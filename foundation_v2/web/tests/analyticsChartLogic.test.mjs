import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'
import { realizedRiskSeries, idealRiskSummary, scenarioComparison, excursionSummary, profitFactorGauge } from '../src/analyticsPresentation.js'
import { monteCarlo } from '../src/analyticsSimulation.js'
import { calendarPeriodSummary } from '../src/calendarViewModel.js'

const close = ['2024-01-01T08:00:00Z','2024-01-03T08:00:00Z','2024-01-03T08:30:00Z','2024-02-05T14:00:00Z']
const trades = [100,-50,0,150].map((net_pnl,i) => ({ tradeId:String(i), net_pnl, side:i%2?'SELL':'BUY', close_time_utc:close[i], realized_r:null }))
const model = { ledger:trades, startBalance:1000, endingBalance:1200, curve:[1000,1100,1050,1050,1200].map(value=>({value})), drawdown:[0,50,50,0].map((drawdown,i)=>({drawdown,drawdownPct:drawdown/1100*100,tradeId:String(i)})), result:{scope:{time_basis:'market'}} }
const experiments = { rows:[{trade_id:'0',realized_r:2,excursion:{r_basis:'initial_stop_distance',mae_r:0},ideal:{status:'complete_week',value_r:4}}, {trade_id:'1',realized_r:-1,excursion:{r_basis:'initial_stop_distance',mae_r:1},ideal:{status:'partial_week',value_r:10}}, {trade_id:'3',realized_r:3,excursion:{r_basis:'initial_stop_distance',mae_r:.5},ideal:{status:'complete_week',value_r:6}}] }
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`)

test('independent four-trade oracle covers profit, sides, hours, sessions, weekdays, months, calendar and frequency', () => {
  const data = advancedAnalytics(model,{}, {experiments})
  assert.equal(data.net,200);assert.equal(data.expectancy,50);assert.equal(data.winRate,50)
  assert.equal(profitFactorGauge(data.rows).value,5)
  assert.deepEqual(data.side.map(row=>[row.count,row.winRate]),[[2,50],[2,50]])
  near(data.averageR,4/3);assert.equal(data.rCount,3)
  assert.equal(data.hours[8].averageR,.5);assert.equal(data.hours[14].averageR,3)
  assert.equal(data.sessions.find(row=>row.label==='London').averageR,4/3)
  assert.equal(data.sessions.find(row=>row.label==='Asia').averageR,.5)
  assert.equal(data.weekdays[0].net,250);assert.equal(data.weekdays[2].net,-50)
  assert.deepEqual(data.months.map(row=>[row.net,row.profitPct,row.averageR]),[[50,5,.5],[150,15,3]])
  const calendar=calendarPeriodSummary(data.calendar)
  assert.equal(calendar.count,4);assert.equal(calendar.net,200);near(calendar.averageR,4/3)
  near(data.frequency[0].count,4/36);near(data.frequency[1].count,4/6);assert.equal(data.frequency[2].count,2)
  assert.equal(data.frequencySeries.day.length,36);assert.equal(data.frequencySeries.day.reduce((sum,row)=>sum+row.count,0),4)
  assert.equal(data.maxDrawdown,50);assert.equal(data.averageDrawdown,50)
})

test('canonical RR joins only original-risk observations and recomputes every filtered group', () => {
  const input={...model,ledger:trades.map(row=>({...row,realized_r:row.tradeId==='0'?99:null}))}
  const data=advancedAnalytics(input,{sides:'["buy"]'},{experiments})
  assert.deepEqual(data.rows.map(row=>row.realized_r),[2,null])
  assert.equal(data.riskReward.average,2);assert.equal(data.hours[8].averageR,2);assert.equal(data.calendar[0].averageR,2)
  assert.equal(input.ledger[0].realized_r,99,'input remains untouched')
  const configured={rows:[{trade_id:'0',realized_r:88,excursion:{r_basis:'configured_stop_distance'}},{trade_id:'outside',realized_r:777,excursion:{r_basis:'initial_stop_distance'}}]}
  assert.equal(advancedAnalytics(model,{}, {experiments:configured}).riskReward.average,null)
})

test('RR and ideal RR preserve unavailable trade slots and average only measured values', () => {
  assert.deepEqual(realizedRiskSeries(experiments,trades).map(row=>[row.tradeId,row.value]),[['0',2],['1',-1],['2',null],['3',3]])
  const ideal=idealRiskSummary(experiments,trades)
  assert.deepEqual(ideal.series.map(row=>row.value),[4,null,null,6]);assert.equal(ideal.average,5);assert.equal(ideal.max,6)
  const mae=excursionSummary(experiments,trades)
  assert.deepEqual(mae.values,[0,1,.5]);assert.equal(mae.average,.25);assert.equal(mae.bins.reduce((sum,bin)=>sum+bin.count,0),3)
})

test('scenario ignores stale numeric payloads on unsupported or ambiguous rows', () => {
  const rows=[{trade_id:'0',stop_loss:{status:'ready',net_pnl:20}}, {trade_id:'1',stop_loss:{status:'ambiguous',net_pnl:999}}, {trade_id:'3',stop_loss:{status:'unsupported',net_pnl:999}}]
  const result=scenarioComparison(rows,trades,'stop_loss',1000)
  assert.deepEqual(result.baseline.map(row=>row.value),[1000,1100]);assert.deepEqual(result.scenario.map(row=>row.value),[1000,1020])
  assert.equal(result.net,20);assert.equal(result.eligible.length,1)
})

test('Monte Carlo rejects blank, boolean and unknown method inputs rather than converting them to zero', () => {
  const config={method:'configured',simulations:2,trades:3,capital:100,seed:42,averageWin:10,averageLoss:20,winRate:50}
  for(const key of ['simulations','trades','capital','seed','averageWin','averageLoss','winRate']) for(const bad of [null,'',false,'  ']) assert.throws(()=>monteCarlo({...config,[key]:bad}),`${key}: ${bad}`)
  assert.throws(()=>monteCarlo({...config,method:'invalid'}))
  const winning=monteCarlo({...config,winRate:100});assert.deepEqual(winning.paths,[[100,110,120,130],[100,110,120,130]])
  const losing=monteCarlo({...config,winRate:0,trades:10});assert.equal(losing.average,0);assert.equal(losing.ruinRate,100);assert.equal(losing.maxDD,100)
  const be=monteCarlo({...config,method:'ledger'},[{net_pnl:0}]);assert.equal(be.average,100);assert.equal(be.probabilityProfit,0)
  assert.throws(()=>monteCarlo({...config,capital:1e308,averageWin:1e308,winRate:100}),/giới hạn số/)
  assert.equal(monteCarlo({...config,capital:1e308,averageWin:0,winRate:100}).average,1e308,'finite paths must not overflow the aggregate mean')
})
