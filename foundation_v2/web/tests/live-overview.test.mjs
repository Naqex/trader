import test from 'node:test'
import assert from 'node:assert/strict'
import {recentChartsKey,readRecentCharts,rememberLiveChart} from '../src/liveRecentCharts.js'
import {liveOverviewPerformance} from '../src/liveOverviewModel.js'

const account={login:123,server:'test',account_ref:'…123',currency:'USD'}
const fixture={connection_id:'a',status:'ready',account,history_from_utc:'2026-10-23T00:00:00Z',captured_at_utc:'2026-10-24T00:00:00Z',deals:[]}
test('history identity and coverage are required; a synced empty window is zero',()=>{
  assert.equal(liveOverviewPerformance(fixture,'b'),null)
  assert.equal(liveOverviewPerformance({...fixture,deals:undefined},'a'),null)
  assert.equal(liveOverviewPerformance({...fixture,history_from_utc:null},'a'),null)
  assert.equal(liveOverviewPerformance(fixture,'a').net,0)
  assert.equal(liveOverviewPerformance(fixture,'a',{...account,login:456}),null)
  assert.equal(liveOverviewPerformance(fixture,'a',{...account,server:'other'}),null)
  assert.equal(liveOverviewPerformance(fixture,'a',account).net,0)
})
test('cashflows excluded, fees included; executions are not closed trades',()=>{
  const deals=[{type:2,profit:10000},{type:0,profit:0,commission:-2,swap:0,fee:0},{type:1,profit:30,commission:-2,swap:-1,fee:-1}]
  const result=liveOverviewPerformance({...fixture,deals},'a')
  assert.deepEqual([result.net,result.gross,result.costs,result.count],[24,30,-6,2])
  assert.equal(liveOverviewPerformance({...fixture,deals:[{type:0,profit:30,commission:null,swap:0,fee:0}]},'a').net,null)
  assert.equal(liveOverviewPerformance({...fixture,stale:true},'a').stale,true)
})
test('recent charts isolate workspace, terminal, account and server; deduplicate and bound',()=>{
  const values=new Map(), storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}
  const key=recentChartsKey('w','a',account)
  for(let i=0;i<8;i++)rememberLiveChart(key,`S${i}`,'M1',storage,i)
  rememberLiveChart(key,'S7','M1',storage,9)
  assert.equal(readRecentCharts(key,storage).length,6)
  assert.equal(readRecentCharts(key,storage)[0].openedAt,9)
  for(const other of [recentChartsKey('x','a',account),recentChartsKey('w','b',account),recentChartsKey('w','a',{...account,server:'other'}),recentChartsKey('w','a',{...account,login:456})])assert.deepEqual(readRecentCharts(other,storage),[])
  storage.setItem(key,'[{"symbol":"BAD","timeframe":"garbage","openedAt":1}]')
  assert.deepEqual(readRecentCharts(key,storage),[])
  assert.doesNotThrow(()=>rememberLiveChart(key,'EURUSD','M1',{getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}}))
})
