import { replayBars, replayResolution } from './advancedReplayDatafeed.js'

// Live bars contain the current, unfinished candle. Updating it must not reset
// the chart as a replay rewind would. Each timeframe keeps its own broker bars.
export function createLiveChartDatafeed({ symbol, seconds, tickSize, rows, assetClass = 'fx', timeframes = [seconds], onResolution }) {
  const interval = replayResolution(seconds), supported = [...new Set(timeframes.map(replayResolution))]
  const type = { fx:'forex', crypto:'crypto', equity:'stock', futures:'futures' }[assetClass] || 'spread'
  const digits = tickSize > 0 ? Math.min(8,Number(tickSize).toFixed(8).replace(/0+$/,'').split('.')[1]?.length || 0) : 5
  const pricescale = 10 ** digits
  let alive = true, requested = interval
  const series = new Map([[interval,replayBars(rows,Infinity,seconds)]]), subscriptions = new Map(), pending = new Set(), failed = new Set()
  const defer = callback => setTimeout(() => { if (alive) callback() },0)
  const selectInterval = resolution => {
    if (alive && supported.includes(resolution) && resolution !== requested) { requested = resolution; onResolution?.(resolution) }
  }
  const serve = ({resolution,period,callback}) => {
    const before = series.get(resolution).filter(bar => bar.time/1000 < period.to)
    const matching = before.filter(bar => bar.time/1000 >= period.from)
    const bars = period.countBack > matching.length ? before.slice(-Math.min(period.countBack,1000)) : matching
    callback(bars,{noData:!bars.length})
  }
  const datafeed = {
    onReady(callback) { defer(() => callback({supported_resolutions:supported,supports_marks:false,supports_timescale_marks:false,supports_time:false})) },
    resolveSymbol(name,callback,error) { defer(() => name === symbol ? callback({name:symbol,ticker:symbol,description:`${symbol} · MT5`,exchange:'MT5',listed_exchange:'MT5',type,session:'24x7',timezone:'Etc/UTC',format:'price',pricescale,minmov:Math.max(1,Math.round(Number(tickSize || 1/pricescale)*pricescale)),has_intraday:timeframes.some(value=>value<86400),has_daily:timeframes.includes(86400),has_weekly_and_monthly:false,intraday_multipliers:supported.filter(value=>/^\d+$/.test(value)),daily_multipliers:['1'],supported_resolutions:supported,data_status:'streaming'}) : error('Unknown MT5 symbol')) },
    getBars(info,resolution,period,callback,error) {
      defer(() => {
        if (!supported.includes(resolution)) { error('Unsupported MT5 timeframe.'); return }
        selectInterval(resolution)
        const request = {resolution,period,callback}
        if (series.has(resolution)) { serve(request); return }
        request.timer = setTimeout(() => { pending.delete(request); failed.add(resolution); if(alive)error('MT5 timeframe data unavailable.') },15000)
        pending.add(request)
      })
    },
    subscribeBars(info,resolution,callback,id,reset) { subscriptions.set(id,{resolution,callback,reset,last:series.get(resolution)?.at(-1)}) },
    unsubscribeBars(id) { subscriptions.delete(id) },
    searchSymbols(input,exchange,type,callback) { defer(() => callback([])) },
  }
  return {datafeed,interval,supported,selectInterval,
    update(nextRows, nextSeconds = seconds) {
      const resolution = replayResolution(nextSeconds), next = replayBars(nextRows,Infinity,nextSeconds), current = series.get(resolution) || []
      const previous = new Map(current.map(bar => [bar.time,bar]))
      const lastTime = current.at(-1)?.time
      const correction = next.at(-1)?.time < lastTime || next.some(bar => bar.time < lastTime && previous.has(bar.time) && JSON.stringify(bar) !== JSON.stringify(previous.get(bar.time)))
      series.set(resolution,next)
      pending.forEach(request=>{if(request.resolution===resolution){clearTimeout(request.timer);pending.delete(request);defer(()=>serve(request))}})
      if (correction || failed.delete(resolution)) { subscriptions.forEach(item => {if(item.resolution===resolution){item.last=null;item.reset?.()}}); return false }
      subscriptions.forEach(item => {
        if(item.resolution!==resolution)return
        for (const bar of next) if (!item.last || bar.time > item.last.time || bar.time === item.last.time && JSON.stringify(bar) !== JSON.stringify(item.last)) {
          item.last = bar; item.callback({...bar})
        }
      })
      return true
    },
    dispose() {alive=false;subscriptions.clear();pending.forEach(request=>clearTimeout(request.timer));pending.clear();series.clear()},
  }
}
