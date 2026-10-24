import { decodeDemoSnapshot, demoIdentity } from './liveTradingModel.js'

const sameBars = (a,b) => a===b || a?.length === b?.length && a.every((bar,index) => ['timestamp','open','high','low','close','volume','tick_volume'].every(key => bar[key] === b[index][key]))

// Only the chart uses this retained view. Orders always use the current snapshot.
export function retainLiveChart(previous, next) {
  if (next?.access_denied) return null
  const identity = demoIdentity(next)
  if (next?.status !== 'ready' || !next.bars?.length) return identity && identity !== demoIdentity(previous) ? null : previous
  return {...next,bars:previous?.symbol === next.symbol && demoIdentity(previous) === identity && sameBars(previous.bars,next.bars) ? previous.bars : next.bars}
}

export function mergeMarketUpdate(previous, update) {
  if (!previous) throw new Error('demo_response_invalid')
  const {replace_bars:replace,...fields} = update
  const next = {...previous,...fields}
  if(!Object.hasOwn(update,'bars'))return {...decodeDemoSnapshot({...next,bars:[]}),bars:previous.bars}
  if (update.bars && !replace) {
    const byTime = new Map(previous.bars.map(bar => [bar.timestamp,bar]))
    const tail = decodeDemoSnapshot({...next,bars:update.bars}).bars
    for (const bar of tail) byTime.set(bar.timestamp,bar)
    next.bars = [...byTime.values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-300)
  }
  return decodeDemoSnapshot(next)
}

export async function readMarketStream(response, onSnapshot, signal) {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const error = new Error('demo_stream_unavailable');error.status=response.status;throw error
  }
  const reader=response.body.getReader(), decoder=new TextDecoder()
  let buffer='', current=null
  try {
    for (;;) {
      let timeout
      const {value,done}=await Promise.race([reader.read(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('demo_stream_disconnected')),15000)})]).finally(()=>clearTimeout(timeout))
      buffer=(buffer+decoder.decode(value,{stream:!done})).replace(/\r\n/g,'\n')
      if(buffer.length>2*1024*1024)throw new Error('demo_response_invalid')
      let end
      while((end=buffer.indexOf('\n\n'))>=0) {
        const lines=buffer.slice(0,end).split('\n');buffer=buffer.slice(end+2)
        const kind=lines.find(line=>line.startsWith('event:'))?.slice(6).trim()
        const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
        if(!['snapshot','update'].includes(kind)||!data)continue
        const payload=JSON.parse(data)
        current=kind==='snapshot'?decodeDemoSnapshot(payload):mergeMarketUpdate(current,payload)
        if(signal?.aborted)return
        if(onSnapshot(current)===false)return
      }
      if(done||signal?.aborted)return
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock()}
}

// One connection per visible chart, with current-state resync on every reconnect.
export function watchLiveMarket({workspace,symbol,timeframe,connectionId,onSnapshot,onError,fetcher=fetch}) {
  let stopped=false, controller, retry, failures=0
  const connect=async()=>{
    if(stopped||document.visibilityState==='hidden')return
    controller=new AbortController()
    const attempt=controller
    try {
      const params=new URLSearchParams({symbol,timeframe,connection_id:connectionId})
      const response=await fetcher(`/api/v2/live/trading/events?${params}`,{signal:attempt.signal,headers:{'X-Workspace-Id':workspace,Accept:'text/event-stream'}})
      await readMarketStream(response,value=>{failures=0;onSnapshot(value)},attempt.signal)
      if(!attempt.signal.aborted)throw new Error('demo_stream_disconnected')
    } catch(error) {if(!stopped&&!attempt.signal.aborted)onError(error)}
    if(!stopped&&!attempt.signal.aborted)retry=setTimeout(connect,Math.min(10000,500*2**Math.min(failures++,5)))
  }
  const visibility=()=>{
    clearTimeout(retry);controller?.abort()
    onError(new Error('demo_stream_disconnected'))
    if(document.visibilityState!=='hidden')void connect()
  }
  document.addEventListener('visibilitychange',visibility)
  void connect()
  return ()=>{stopped=true;clearTimeout(retry);controller?.abort();document.removeEventListener('visibilitychange',visibility)}
}
