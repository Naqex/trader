import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketCurve, excursionSummary, scenarioComparison, scenarioRiskCurve, realizedRiskSeries, idealRiskSummary } from '../src/analyticsPresentation.js'

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

test('scenario R sums per-trade original risk and orders by market close, not activity time', () => {
  const trades = [
    { tradeId:'late', net_pnl:200, realized_r:2, planned_risk_budget:999, close_time_utc:'2025-06-12T10:00:00Z', report_time_utc:'2026-10-28T00:00:00Z' },
    { tradeId:'early', net_pnl:-25, realized_r:-.5, close_time_utc:'2025-06-10T10:00:00Z', analytics_time_utc:'2026-10-29T00:00:00Z' },
    { tradeId:'same', net_pnl:50, realized_r:1, close_time_utc:'2025-06-12T10:00:00Z' },
  ]
  const rows = trades.map((trade,index) => ({trade_id:trade.tradeId,stop_loss:{status:'ready',net_pnl:[150,-50,25][index]}}))
  const result = scenarioRiskCurve(rows,trades,'stop_loss')
  assert.deepEqual(result.eligible.map(row=>row.tradeId),['early','late','same'])
  assert.deepEqual(result.baseline.map(row=>row.value),[-.5,1.5,2.5])
  assert.deepEqual(result.scenario.map(row=>row.value),[-1,.5,1])
  assert.deepEqual(result.timestamps,[Date.parse('2025-06-10T10:00:00Z'),Date.parse('2025-06-12T10:00:00Z'),Date.parse('2025-06-12T10:00:00Z')])
  assert.equal(trades[0].tradeId,'late')
})

test('scenario R preserves original-risk provenance and never fabricates missing denominators/dates', () => {
  const make = (tradeId, patch={}) => ({tradeId,net_pnl:10,realized_r:1,close_time_utc:'2025-06-10T10:00:00Z',...patch})
  const trades = [make('observed',{planned_risk_budget:999}),make('be',{net_pnl:0,realized_r:0,planned_risk_budget:50}),
    make('no-be-risk',{net_pnl:0,realized_r:0}),make('no-risk',{realized_r:null}),make('undated',{close_time_utc:null}),make('invalid-date',{close_time_utc:'not-a-date'}),make('ambiguous'),make('zero-risk',{net_pnl:0,realized_r:0,planned_risk_budget:0}),make('conflict',{realized_r:-1,planned_risk_budget:10}),make('outside')]
  const rows = trades.map(trade=>({trade_id:trade.tradeId,risk_reward:{status:trade.tradeId==='ambiguous'?'ambiguous':'ready',net_pnl:5}}))
  rows[0].realized_r=2; rows[0].excursion={r_basis:'initial_stop_distance'}
  const result=scenarioRiskCurve(rows,trades.slice(0,-1),'risk_reward')
  assert.deepEqual(result.eligible.map(row=>row.tradeId),['observed','be'])
  assert.deepEqual(result.baseline.map(row=>row.value),[2,2])
  assert.deepEqual(result.scenario.map(row=>row.value),[1,1.1])
})

test('scenario R can combine account currencies only using each trade original-risk denominator', () => {
  const trades=[{tradeId:'usd',net_pnl:100,planned_risk_budget:50,account_currency:'USD',close_time_utc:1750000000},{tradeId:'eur',net_pnl:10,planned_risk_budget:10,account_currency:'EUR',close_time_utc:1750000001000}]
  const rows=trades.map(row=>({trade_id:row.tradeId,stop_loss:{status:'ready',net_pnl:row.net_pnl/2}}))
  const result=scenarioRiskCurve(rows,trades,'stop_loss')
  assert.deepEqual(result.baseline.map(row=>row.value),[2,3])
  assert.deepEqual(result.scenario.map(row=>row.value),[1,1.5])
  assert.deepEqual(result.timestamps,[1750000000000,1750000001000])
})

test('scenario R rejects out-of-range dates and overflowing risk denominators', () => {
  const trades=[{tradeId:'date',net_pnl:1,realized_r:1,close_time_utc:1e30},{tradeId:'risk',net_pnl:1e308,realized_r:1e-308,close_time_utc:'2025-06-10T10:00:00Z'}]
  const rows=trades.map(trade=>({trade_id:trade.tradeId,stop_loss:{status:'ready',net_pnl:1}}))
  assert.deepEqual(scenarioRiskCurve(rows,trades,'stop_loss').eligible,[])
})
test('MAE bins require original risk and retain known zero, not configured or negative R', () => {
  const trades=[{tradeId:'a',net_pnl:10},{tradeId:'b',net_pnl:20},{tradeId:'c',net_pnl:-5}]
  const rows=[{trade_id:'a',excursion:{mae_r:0,r_basis:'initial_stop_distance'}},{trade_id:'b',excursion:{mae_r:2,r_basis:'configured_stop_distance'}},{trade_id:'c',excursion:{mae_r:1,r_basis:'initial_stop_distance'}},{trade_id:'b',excursion:{mae_r:-1,r_basis:'initial_stop_distance'}}]
  const result=excursionSummary({rows},trades)
  assert.deepEqual(result.values,[0,1]);assert.equal(result.average,null);assert.equal(result.min,null)
  assert.equal(result.winnerCount,2);assert.equal(result.completeWinners,false)
  assert.equal(result.bins.reduce((sum,bin)=>sum+bin.count,0),2)
})

test('MAE histogram keeps decimal boundaries and a bounded overflow bucket', () => {
  const values=[0,.1,.3,.999,1,1.1,2.999,3,99]
  const trades=values.map((_,i)=>({tradeId:String(i),outcome:'win'}))
  const rows=values.map((mae_r,i)=>({trade_id:String(i),excursion:{r_basis:'initial_stop_distance',mae_r}}))
  const data=excursionSummary({rows},trades)
  assert.equal(data.bins.length,16)
  assert.deepEqual(data.bins.at(-1),{start:3,end:null,count:2})
  assert.equal(data.bins.find(bin=>bin.start===.2).count,1)
  assert.equal(data.bins.reduce((sum,bin)=>sum+bin.count,0),values.length)
  assert.equal(data.min,0);assert.equal(data.max,99)
  const small=excursionSummary({rows:rows.slice(0,5)},trades.slice(0,5))
  assert.equal(small.bins.length,11)
  assert.equal(small.bins.find(bin=>bin.start===.3).count,1)
  assert.deepEqual(small.bins.at(-1),{start:1,end:null,count:1})
  assert.deepEqual(excursionSummary({rows:[]},trades).bins,[])
  assert.equal(excursionSummary({rows:[]},trades).max,null)
})

test('winning MAE stats require every winning trade and preserve an observed zero', () => {
  const trades=[{tradeId:'a',outcome:'win'},{tradeId:'b',outcome:'loss'}]
  const rows=[{trade_id:'a',excursion:{mae_r:0,r_basis:'initial_stop_distance'}}]
  const data=excursionSummary({rows},trades)
  assert.equal(data.completeWinners,true)
  assert.equal(data.average,0);assert.equal(data.min,0);assert.equal(data.max,0)
  assert.equal(excursionSummary({rows},[...trades,{tradeId:'c',outcome:'win'}]).average,null)
  assert.equal(excursionSummary({rows},[...trades,{tradeId:'c',outcome:'unknown'}]).max,null)
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
