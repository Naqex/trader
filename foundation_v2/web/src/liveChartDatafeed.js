import { replayBars, replayResolution } from './advancedReplayDatafeed.js'

// Live bars contain the current, unfinished candle. Updating it must not reset
// the chart as a replay rewind would. The terminal owns the selected timeframe.
export function createLiveChartDatafeed({ symbol, seconds, tickSize, rows, assetClass = 'fx' }) {
  const interval = replayResolution(seconds), supported = [interval]
  const type = { fx:'forex', crypto:'crypto', equity:'stock', futures:'futures' }[assetClass] || 'spread'
  const digits = tickSize > 0 ? Math.min(8,Number(tickSize).toFixed(8).replace(/0+$/,'').split('.')[1]?.length || 0) : 5
  const pricescale = 10 ** digits
  let current = replayBars(rows,Infinity,seconds), alive = true
  const subscriptions = new Map()
  const defer = callback => setTimeout(() => { if (alive) callback() },0)
  const datafeed = {
    onReady(callback) { defer(() => callback({supported_resolutions:supported,supports_marks:false,supports_timescale_marks:false,supports_time:false})) },
    resolveSymbol(name,callback,error) { defer(() => name === symbol ? callback({name:symbol,ticker:symbol,description:`${symbol} · MT5`,exchange:'MT5',listed_exchange:'MT5',type,session:'24x7',timezone:'Etc/UTC',format:'price',pricescale,minmov:Math.max(1,Math.round(Number(tickSize || 1/pricescale)*pricescale)),has_intraday:seconds<86400,has_daily:seconds>=86400,has_weekly_and_monthly:false,intraday_multipliers:seconds<86400?[interval]:[],daily_multipliers:seconds>=86400?['1']:[],supported_resolutions:supported,data_status:'streaming'}) : error('Unknown MT5 symbol')) },
    getBars(info,resolution,period,callback,error) {
      defer(() => {
        if (resolution !== interval) { error('Select the timeframe in the MT5 toolbar.'); return }
        const before = current.filter(bar => bar.time/1000 < period.to)
        const matching = before.filter(bar => bar.time/1000 >= period.from)
        const bars = period.countBack > matching.length ? before.slice(-Math.min(period.countBack,1000)) : matching
        callback(bars,{noData:!bars.length})
      })
    },
    subscribeBars(info,resolution,callback,id,reset) { subscriptions.set(id,{callback,reset,last:current.at(-1)}) },
    unsubscribeBars(id) { subscriptions.delete(id) },
    searchSymbols(input,exchange,type,callback) { defer(() => callback([])) },
  }
  return {datafeed,interval,supported,
    update(nextRows) {
      const next = replayBars(nextRows,Infinity,seconds)
      const previous = new Map(current.map(bar => [bar.time,bar]))
      const lastTime = current.at(-1)?.time
      const correction = next.at(-1)?.time < lastTime || next.some(bar => bar.time < lastTime && previous.has(bar.time) && JSON.stringify(bar) !== JSON.stringify(previous.get(bar.time)))
      current = next
      if (correction) { subscriptions.forEach(item => {item.last=null;item.reset?.()}); return false }
      subscriptions.forEach(item => {
        for (const bar of current) if (!item.last || bar.time > item.last.time || bar.time === item.last.time && JSON.stringify(bar) !== JSON.stringify(item.last)) {
          item.last = bar; item.callback({...bar})
        }
      })
      return true
    },
    dispose() {alive=false;subscriptions.clear()},
  }
}
