import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketCurve, excursionSummary, scenarioComparison, realizedRiskSeries, idealRiskSummary } from '../src/analyticsPresentation.js'

test('scenario comparison uses matching observed trades and never substitutes unresolved PnL', () => {
  const trades=[{tradeId:'a',net_pnl:10},{tradeId:'b',net_pnl:-5},{tradeId:'c',net_pnl:30}]
  const rows=[{trade_id:'a',risk_reward:{status:'ready',net_pnl:20}},{trade_id:'b',risk_reward:{status:'ready',net_pnl:null}},{trade_id:'outside',risk_reward:{status:'ready',net_pnl:1000}}]
  const result=scenarioComparison(rows,trades,'risk_reward',100)
  assert.deepEqual(result.baseline.map(point=>point.value),[100,110])
  assert.deepEqual(result.scenario.map(point=>point.value),[100,120])
  assert.equal(result.net,20);assert.equal(result.profitFactor,null)
  assert.equal(scenarioComparison([],trades,'risk_reward',100).net,null)
  const withBreakeven=[{trade_id:'a',risk_reward:{status:'ready',net_pnl:10}},{trade_id:'b',risk_reward:{status:'ready',net_pnl:0}},{trade_id:'c',risk_reward:{status:'ready',net_pnl:-10}}]
  assert.equal(scenarioComparison(withBreakeven,trades,'risk_reward',100).winRate,50)
  assert.equal(scenarioComparison(withBreakeven,trades,'risk_reward',100).averageDrawdown,10)
})
test('MAE bins require original risk and retain known zero, not configured or negative R', () => {
  const trades=[{tradeId:'a',net_pnl:10},{tradeId:'b',net_pnl:20},{tradeId:'c',net_pnl:-5}]
  const rows=[{trade_id:'a',excursion:{mae_r:0,r_basis:'initial_stop_distance'}},{trade_id:'b',excursion:{mae_r:2,r_basis:'configured_stop_distance'}},{trade_id:'c',excursion:{mae_r:1,r_basis:'initial_stop_distance'}},{trade_id:'b',excursion:{mae_r:-1,r_basis:'initial_stop_distance'}}]
  const result=excursionSummary({rows},trades)
  assert.deepEqual(result.values,[0,1]);assert.equal(result.average,0);assert.equal(result.min,0)
  assert.equal(result.bins.reduce((sum,bin)=>sum+bin.count,0),2)
})
test('bucket endpoints keep last balance, baseline and named-zone day including DST', () => {
  const rows=[{tradeId:'a',report_time_utc:'2024-03-10T04:30:00Z'},{tradeId:'b',report_time_utc:'2024-03-10T05:30:00Z'},{tradeId:'c',report_time_utc:'2024-03-10T07:30:00Z'}]
  const curve=[{value:100},{value:110,tradeId:'a'},{value:120,tradeId:'b'},{value:130,tradeId:'c'}]
  assert.deepEqual(bucketCurve(curve,rows,'day','America/New_York').points.map(point=>point.value),[100,110,130])
  rows[1].report_time_utc=null
  assert.deepEqual(bucketCurve(curve,rows,'day','UTC').points,[])
  assert.equal(bucketCurve(curve,rows,'all').points,curve)
})
test('realized R joins per trade and never discards valid ledger or original budget samples', () => {
  const trades=[{tradeId:'a',realized_r:2},{tradeId:'b',realized_r:3},{tradeId:'c',net_pnl:40,planned_risk_budget:10},{tradeId:'d',net_pnl:10,planned_risk_budget:0}]
  assert.deepEqual(realizedRiskSeries({rows:[{trade_id:'b',realized_r:3,excursion:{r_basis:'initial_stop_distance'}}]},trades).map(item=>item.value),[2,3,4,null])
  assert.deepEqual(realizedRiskSeries({rows:[{trade_id:'a',realized_r:100,excursion:{r_basis:'configured_stop_distance'}}]},trades).map(item=>item.value),[2,3,4,null])
})
test('ideal risk uses complete-week coverage and counts only observed losing trades', () => {
  const trades=[{tradeId:'a',outcome:'loss'},{tradeId:'b',outcome:'loss'},{tradeId:'c',outcome:'win'}]
  const rows=[{trade_id:'a',ideal:{status:'complete_week',value_r:-.1,could_have_profit_or_breakeven:false}},{trade_id:'b',ideal:{status:'partial_week',value_r:20,could_have_profit_or_breakeven:true}},{trade_id:'c',ideal:{status:'complete_week',value_r:2,could_have_profit_or_breakeven:true}}]
  const result=idealRiskSummary({rows},trades)
  assert.equal(result.average,.95);assert.equal(result.max,2);assert.equal(result.lossKnownCount,1);assert.equal(result.recoveryCount,0)
})


test('PF ring uses the uncapped ratio and maps only the ring to a cap of four', async () => {
  const { profitFactorGauge } = await import('../src/analyticsPresentation.js')
  const gauge = values => profitFactorGauge(values.map(net_pnl => ({ net_pnl })))
  for (const [ratio, fraction] of [[0,0],[1,.25],[2,.5],[4,1],[19.47,1]]) {
    const result = gauge([ratio * 100, -100])
    assert.equal(result.value, ratio)
    assert.equal(result.fraction, fraction)
  }
  assert.deepEqual(gauge([]), { status: 'finite', value: 0, fraction: 0 })
  assert.deepEqual(gauge([0,0]), { status: 'finite', value: 0, fraction: 0 })
  assert.deepEqual(gauge([100,200]), { status: 'unbounded', value: null, fraction: 1 })
  assert.deepEqual(gauge([-100,-200]), { status: 'finite', value: 0, fraction: 0 })
  assert.deepEqual(gauge([100,null]), { status: 'unavailable', value: null, fraction: null })
  assert.deepEqual(gauge([false,-100]), { status: 'unavailable', value: null, fraction: null })
  assert.equal(gauge([1,-2,0]).value, .5)
})
