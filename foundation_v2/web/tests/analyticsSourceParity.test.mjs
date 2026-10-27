import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics } from '../src/tradingAnalyticsModel.js'
import { excursionSummary, bucketCurve, profitFactorGauge } from '../src/analyticsPresentation.js'
import { curveCoordinates } from '../src/reportChartModel.js'
import { calendarPeriodSummary } from '../src/calendarViewModel.js'

function source(ledger) {
  return { ledger: ledger.map((row,index) => ({tradeId:String(index),side:'BUY',report_time_utc:`2024-01-0${index+1}T08:00:00Z`,...row})),startBalance:1000,endingBalance:1200,curve:[{value:1000},{value:1200}],drawdown:[],result:{} }
}
test('equal money with unequal risk receives independent R threshold classifications', () => {
  const input=source([{net_pnl:100,planned_risk_budget:10},{net_pnl:100,planned_risk_budget:1000},{net_pnl:-10,planned_risk_budget:10}])
  const data=advancedAnalytics(input,{}, {breakevenThreshold:1})
  assert.deepEqual(data.rows.map(row=>row.outcome),['win','breakeven','breakeven'])
  assert.equal(data.wins,1);assert.equal(data.breakeven,2);assert.ok(Math.abs(data.winRate-100/3)<1e-12)
  assert.equal(data.net,190);assert.equal(data.profitFactor,20)
  assert.equal(profitFactorGauge(data.rows).value,20)
  assert.equal(advancedAnalytics(input,{outcomes:'["breakeven"]'},{breakevenThreshold:1}).count,2)
})
test('missing original risk leaves classification unknown while financial and frequency data survive', () => {
  const input=source([{net_pnl:100,planned_risk_budget:10},{net_pnl:100},{net_pnl:0}])
  const data=advancedAnalytics(input,{}, {breakevenThreshold:1,experiments:{rows:[{trade_id:'1',realized_r:.01,excursion:{r_basis:'configured_stop_distance'}}]}})
  assert.deepEqual(data.rows.map(row=>row.outcome),['win','unknown','breakeven'])
  assert.equal(data.count,3);assert.equal(data.net,200);assert.equal(data.expectancy,200/3)
  assert.equal(data.complete,true);assert.equal(data.classificationComplete,false);assert.equal(data.classifiedCount,2)
  for (const key of ['wins','losses','breakeven','winRate','maxWinStreak','averageWinPct']) assert.equal(data[key],null,key)
  assert.equal(data.months[0].net,200);assert.equal(data.months[0].winRate,null)
  assert.equal(data.calendar.reduce((sum,row)=>sum+row.count,0),3)
  assert.equal(calendarPeriodSummary(data.calendar).winRate,null)
  assert.equal(calendarPeriodSummary(data.calendar).net,200)
  assert.equal(advancedAnalytics(input).wins,2,'default threshold requires no risk basis')
})
test('winning MAE respects the report classification', () => {
  const trades=[{tradeId:'a',net_pnl:5,outcome:'breakeven'},{tradeId:'b',net_pnl:100,outcome:'win'}]
  const rows=trades.map((row,index)=>({trade_id:row.tradeId,excursion:{r_basis:'initial_stop_distance',mae_r:index+.1}}))
  assert.deepEqual(excursionSummary({rows},trades).winners,[1.1])
})
test('time axis preserves irregular gaps, duplicate timestamps and rejects missing or reversed time', () => {
  const dates=['2024-01-01','2024-01-01','2024-01-02','2024-01-11']
  const result=curveCoordinates(dates,4)
  assert.equal(result.temporal,true);assert.deepEqual(result.positions,[0,0,.1,1])
  assert.equal(curveCoordinates(['1704067200','1704153600'],2).temporal,true)
  for(const dates of [[null,'2024-01-02'],['2024-01-02','2024-01-01'],['bad','2024-01-02']]){
    assert.equal(curveCoordinates(dates,2).temporal,false);assert.deepEqual(curveCoordinates(dates,2).positions,[0,1])
  }
})
test('bucket curve retains cumulative values and anchors origin at first actual observation', () => {
  const input=source([{net_pnl:100},{net_pnl:-20}]),curve=[{value:0},{value:100,tradeId:'0'},{value:80,tradeId:'1'}]
  for(const interval of ['all','day','hour','quarter']){
    const result=bucketCurve(curve,input.ledger,interval,'UTC')
    assert.deepEqual(result.points.map(point=>point.value),[0,100,80])
    assert.equal(result.timestamps[0],input.ledger[0].report_time_utc)
    assert.equal(curveCoordinates(result.timestamps,3).temporal,true)
  }
})
