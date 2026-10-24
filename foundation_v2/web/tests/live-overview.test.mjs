import test from 'node:test'
import assert from 'node:assert/strict'
import {recentChartsKey,readRecentCharts,rememberLiveChart} from '../src/liveRecentCharts.js'
import {liveOverviewPerformance,selectLiveConnection} from '../src/liveOverviewModel.js'

const account={login:123,server:'test',account_ref:'…123',currency:'USD'}
const fixture={connection_id:'a',status:'ready',account,history_from_utc:'2026-10-23T00:00:00Z',captured_at_utc:'2026-10-24T00:00:00Z',deals:[]}
test('refresh keeps selected account even after connection order or availability changes',()=>{
  const items=[{id:'b',status:'connected',requested_mode:'trading'},{id:'a',status:'disconnected',requested_mode:'trading'}]
  assert.equal(selectLiveConnection(items,'a'),'a')
  assert.equal(selectLiveConnection(items,'removed'),'b')
  assert.equal(selectLiveConnection([],''),'')
})
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
test('report groups executions by UTC, excludes deposits and orders recent executions',()=>{
  const deal=(type,time,profit)=>({type,time_msc:Date.parse(time),profit,commission:-1,swap:0,fee:0})
  const result=liveOverviewPerformance({...fixture,deals:[deal(0,'2026-09-30T23:30:00Z',5),deal(1,'2026-10-01T01:00:00Z',-2),deal(2,'2026-10-01T02:00:00Z',10000)]},'a',account)
  assert.equal(result.chartComplete,true)
  assert.deepEqual(result.months,[{label:'2026-09',value:4},{label:'2026-10',value:-3}])
  assert.equal(result.weekdays[2].value,4)
  assert.equal(result.weekdays[3].value,-3)
  assert.deepEqual(result.series.map(point=>point.value),[4,1])
  assert.equal(result.deals[0].type,1)
  assert.equal(result.count,2)
})
test('incomplete costs or timestamps never become zero chart points',()=>{
  for(const patch of [{commission:null},{time_msc:null},{time_msc:Infinity}]){
    const result=liveOverviewPerformance({...fixture,deals:[{type:0,time_msc:1792713600000,profit:10,commission:-1,swap:0,fee:0,...patch}]},'a',account)
    assert.equal(result.chartComplete,false)
    assert.deepEqual(result.months,[])
    assert.deepEqual(result.weekdays,[])
    assert.deepEqual(result.series,[])
    assert.equal(result.deals.length,1)
  }
})
