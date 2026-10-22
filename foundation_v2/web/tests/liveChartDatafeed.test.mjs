import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveChartDatafeed } from '../src/liveChartDatafeed.js'

const candle=(timestamp,close=1.1)=>({timestamp,open:1.1,high:1.2,low:1.0,close,volume:3})
const make=()=>createLiveChartDatafeed({symbol:'EURUSD',seconds:60,tickSize:0.00001,rows:[candle(1699999920),candle(1699999980)]})

test('symbol metadata preserves the instrument class and broker tick size',async()=>{
 const live=createLiveChartDatafeed({symbol:'INDEX',assetClass:'futures',seconds:60,tickSize:0.25,rows:[]})
 const info=await new Promise((resolve,reject)=>live.datafeed.resolveSymbol('INDEX',resolve,reject))
 assert.equal(info.type,'futures');assert.equal(info.pricescale,100);assert.equal(info.minmov,25)
 live.dispose()
})
test('current live candle streams without replay reset; historical corrections reset',()=>{
 const live=make(), streamed=[];let resets=0
 live.datafeed.subscribeBars({},'1',bar=>streamed.push(bar),'one',()=>resets++)
 assert.equal(live.update([candle(1699999920),candle(1699999980,1.15)]),true)
 assert.equal(resets,0);assert.equal(streamed.length,1);assert.equal(streamed[0].time,1699999980000)
 live.update([candle(1699999920),candle(1699999980,1.15),candle(1700000040)])
 assert.equal(streamed.length,2)
 assert.equal(live.update([candle(1699999920,1.05),candle(1699999980,1.15)]),false)
 assert.equal(resets,1)
 live.dispose()
 live.update([candle(1700000100)])
 assert.equal(streamed.length,2)
})
test('only the selected terminal timeframe serves history and it respects countBack',async()=>{
 const live=make()
 const bars=await new Promise((resolve,reject)=>live.datafeed.getBars({},'1',{from:0,to:1700000040,countBack:1},resolve,reject))
 assert.equal(bars.length,2)
 const error=await new Promise(resolve=>live.datafeed.getBars({},'5',{from:0,to:1700000040,countBack:1},()=>assert.fail('unsupported timeframe served'),resolve))
 assert.match(error,/timeframe/)
 live.dispose()
})
