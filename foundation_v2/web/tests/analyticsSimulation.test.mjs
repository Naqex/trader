import test from 'node:test'
import assert from 'node:assert/strict'
import { monteCarlo, simulationMoments, monteCarloDefaults, monteCarloInputErrors } from '../src/analyticsSimulation.js'
import { readAnalyticsExperiment } from '../src/analyticsExperimentApi.js'

const base = { method:'configured', simulations:3, trades:4, capital:1000, seed:42, averageWin:20, averageLoss:10, winRate:100 }

test('Monte Carlo defaults use measured values and explicit assumptions for missing groups', () => {
  const defaults = monteCarloDefaults([{net_pnl:-2.28}],99997.72)
  assert.deepEqual({...defaults},{method:'normal',simulations:100,trades:100,capital:99997.72,averageWin:100,averageLoss:2.28,winRate:0,winStd:0,lossStd:0,seed:42})
  assert.deepEqual(monteCarloInputErrors(defaults),{})
  assert.equal(monteCarlo(defaults).totalLosses,10000)
  const empty = monteCarloDefaults([],null)
  assert.equal(empty.capital,10000);assert.equal(empty.winRate,50);assert.equal(empty.averageLoss,100)
  assert.equal(monteCarloDefaults([{net_pnl:12.345}],1000.123).averageWin,12.35)
  assert.equal(monteCarloDefaults([],0).capital,10000)
})

test('Monte Carlo field validation rejects blanks, bounds and excess work before running', () => {
  assert.deepEqual(monteCarloInputErrors(base),{})
  for (const key of ['simulations','trades','capital','averageWin','averageLoss','winRate']) assert(monteCarloInputErrors({...base,[key]:''})[key])
  for (const [key,value] of [['simulations',1.5],['trades',1001],['capital',0],['averageWin',-1],['averageLoss',-1],['winRate',101]]) assert(monteCarloInputErrors({...base,[key]:value})[key])
  assert(monteCarloInputErrors({...base,simulations:1000,trades:1000}).trades)
  assert.deepEqual(monteCarloInputErrors({...base,winRate:0,averageWin:0,averageLoss:0}),{})
})

test('Monte Carlo counts executed trades/streaks and treats no-loss PF as unbounded', () => {
  const result = monteCarlo(base)
  assert.equal(result.average,1080); assert.equal(result.totalWins,12); assert.equal(result.totalLosses,0)
  assert.equal(result.maxWinStreak,4); assert.equal(result.maxLossStreak,0); assert.equal(result.averageProfitFactor,Infinity)
  const lost = monteCarlo({...base,capital:25,winRate:0})
  assert.equal(lost.totalLosses,9); assert.equal(lost.totalWins,0); assert.equal(lost.maxLossStreak,3)
  assert.equal(lost.min,0); assert.equal(lost.maxDD,25); assert.equal(lost.averageProfitFactor,0)
  const zero = monteCarlo({...base,averageWin:0})
  assert.equal(zero.totalWins,0); assert.equal(zero.maxWinStreak,0); assert.equal(zero.averageProfitFactor,null)
})

test('Gaussian zero variance has an exact oracle and nonzero variance is deterministic', () => {
  const config = {...base,method:'normal',winStd:0,lossStd:0}
  assert.equal(monteCarlo(config).average,1080)
  const varied = {...config,winStd:100,lossStd:20,winRate:50}
  assert.deepEqual(monteCarlo(varied),monteCarlo(varied))
  assert.ok(monteCarlo(varied).paths.flat().every(value => Number.isFinite(value) && value>=0))
  assert.throws(() => monteCarlo({...config,winStd:null}),/chuẩn/)
  assert.throws(() => monteCarlo({...config,lossStd:-1}),/chuẩn/)
  assert.throws(() => monteCarlo({...base,capital:1e308,averageWin:1e308}),/giới hạn/)
})

test('screenshot configuration reconciles every summary with actual path changes', () => {
  const config = { ...base, method:'normal', simulations:2, trades:10, capital:10000, averageWin:100, averageLoss:460, winRate:75, winStd:0, lossStd:0 }
  const result = monteCarlo(config)
  assert.deepEqual(result.paths.map(path=>path.at(-1)),[10440,9320])
  assert.equal(result.average,9880);assert.equal(result.max,10440);assert.equal(result.min,9320)
  const runs = result.paths.map(path=>{
    const changes = path.slice(1).map((balance,index)=>balance-path[index])
    const wins = changes.filter(change=>change>0), losses = changes.filter(change=>change<0)
    const longest = sign=>changes.reduce((state,change)=>{const current=Math.sign(change)===sign?state.current+1:0;return {current,max:Math.max(state.max,current)}},{current:0,max:0}).max
    return {wins:wins.length,losses:losses.length,factor:wins.reduce((sum,value)=>sum+value,0)/-losses.reduce((sum,value)=>sum+value,0),winStreak:longest(1),lossStreak:longest(-1)}
  })
  assert.equal(result.totalWins,runs.reduce((sum,run)=>sum+run.wins,0))
  assert.equal(result.totalLosses,runs.reduce((sum,run)=>sum+run.losses,0))
  assert.equal(result.maxWinStreak,Math.max(...runs.map(run=>run.winStreak)))
  assert.equal(result.maxLossStreak,Math.max(...runs.map(run=>run.lossStreak)))
  assert.equal(result.averageProfitFactor,runs.reduce((sum,run)=>sum+run.factor,0)/runs.length)
  assert.notDeepEqual(monteCarlo({...config,seed:43}).paths,result.paths)
})

test('descriptive moments separate winning/losing magnitudes and preserve missing data', () => {
  const rows = [10,30,-10,-30,0].map(net_pnl=>({net_pnl}))
  assert.deepEqual(simulationMoments(rows),{averageWin:20,averageLoss:20,winStd:10,lossStd:10,winRate:50})
  assert.equal(simulationMoments([...rows,{net_pnl:null}]),null)
  assert.equal(simulationMoments([]),null)
  assert.deepEqual(simulationMoments([{net_pnl:0}]),{averageWin:null,averageLoss:null,winStd:null,lossStd:null,winRate:null})
  assert.equal(simulationMoments([{net_pnl:5}]).winStd,0)
})

test('explicit scenario reads preserve query fences, signal, workspace and configuration', async () => {
  const previous = globalThis.fetch, controller = new AbortController()
  const expected={session_id:'s',dataset_id:'d',dataset_sha256:'hash',revision:2,cursor_index:8,execution_event_sequence:17}
  const config={stop_distance_ticks:20,stop_multiplier:.5,target_r:2}
  let payload={schema_version:'replay-analytics-experiments-v1',read_only:true,config,provenance:expected,rows:[]}
  globalThis.fetch=async (url,options) => {
    const params=new URL(url,'http://localhost').searchParams
    assert.equal(params.get('cursor'),'8'); assert.equal(params.get('event_sequence'),'17'); assert.equal(params.get('stop_multiplier'),'0.5')
    assert.equal(options.headers['X-Workspace-Id'],'w'); assert.equal(options.signal,controller.signal)
    return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}})
  }
  try {
    const request={workspace:'w',sessionId:'s',filters:'cursor=8&event_sequence=17',config,signal:controller.signal,expected}
    assert.deepEqual(await readAnalyticsExperiment(request),payload)
    payload={...payload,config:{...config,target_r:3}}
    await assert.rejects(readAnalyticsExperiment(request),/Cấu hình/)
    payload={...payload,config,provenance:{...expected,execution_event_sequence:18}}
    await assert.rejects(readAnalyticsExperiment(request),/revision\/cutoff/)
    payload={...payload,provenance:expected,read_only:false}
    await assert.rejects(readAnalyticsExperiment(request),/invalid/)
  } finally { globalThis.fetch=previous }
})
