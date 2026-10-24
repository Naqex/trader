import test from 'node:test'
import assert from 'node:assert/strict'
import { retainLiveChart, mergeMarketUpdate, readMarketStream } from '../src/liveMarketStream.js'

const bar=(timestamp,close=1.1)=>({timestamp,open:1.1,high:1.2,low:1,close,volume:2})
const snapshot=()=>({status:'ready',mode:'demo',account:{login:'1',server:'demo'},symbol:'EURUSD',bars:[bar(100),bar(160)],positions:[],orders:[]})

test('chart retention does not replace the unavailable authoritative snapshot',()=>{
 const ready=snapshot(), locked={status:'locked',mode:'demo',execution_enabled:false,bars:[]}
 assert.equal(retainLiveChart(ready,locked),ready)
 assert.equal(locked.execution_enabled,false)
 assert.equal(retainLiveChart(ready,{...locked,access_denied:true}),null)
 assert.equal(retainLiveChart(ready,{...locked,account:{login:'2',server:'demo'}}),null)
 const unchanged=retainLiveChart(ready,snapshot())
 assert.equal(unchanged.bars,ready.bars)
 const edited=retainLiveChart(ready,{...snapshot(),bars:[bar(100),bar(160,1.15)]})
 assert.equal(edited.bars[1].close,1.15)
})

test('partial updates preserve history, replace corrections and retain bars on quote-only events',()=>{
 const old=snapshot()
 const next=mergeMarketUpdate(old,{bars:[bar(160,1.15),bar(220)]})
 assert.deepEqual(next.bars.map(item=>item.timestamp),[100,160,220])
 assert.equal(next.bars[1].close,1.15)
 assert.equal(mergeMarketUpdate(next,{quote:{bid:1,ask:1.1}}).bars,next.bars)
 assert.deepEqual(mergeMarketUpdate(next,{bars:[bar(220)],replace_bars:true}).bars,[bar(220)])
 assert.throws(()=>mergeMarketUpdate(null,{}),/invalid/)
})

test('stream parses split UTF-8/SSE frames, heartbeat and delta without duplicate snapshots',async()=>{
 const events=`: market\n\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\nevent: update\ndata: ${JSON.stringify({bars:[bar(160,1.17)],quote:{bid:1.17,ask:1.18}})}\n\n`
 const bytes=new TextEncoder().encode(events), received=[]
 const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close()}}),{headers:{'content-type':'text/event-stream'}})
 await readMarketStream(response,value=>received.push(value),new AbortController().signal)
 assert.equal(received.length,2)
 assert.equal(received[1].bars[1].close,1.17)
 assert.equal(received[1].bars.length,2)
})

test('HTML error responses cannot be interpreted as a connected market stream',async()=>{
 await assert.rejects(readMarketStream(new Response('<html/>'),()=>assert.fail('delivered data')),/unavailable/)
})
