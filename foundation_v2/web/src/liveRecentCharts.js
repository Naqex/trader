import { DEMO_TIMEFRAMES } from './liveTradingModel.js'

export function recentChartsKey(workspace, connectionId, account) {
  return workspace && connectionId && account?.login && account?.server ? `tw:live-charts:v1:${JSON.stringify([workspace,connectionId,account.login,account.server])}` : ''
}

export function readRecentCharts(key, storage) {
  if (!key) return []
  try {
    storage ||= globalThis.localStorage
    const items=JSON.parse(storage.getItem(key))
    return Array.isArray(items) ? items.filter(item=>typeof item?.symbol==='string' && item.symbol.length>0 && item.symbol.length<=128 && Object.hasOwn(DEMO_TIMEFRAMES,item.timeframe) && Number.isFinite(item.openedAt)).slice(0,6) : []
  } catch { return [] }
}

export function rememberLiveChart(key, symbol, timeframe, storage, now = Date.now()) {
  if (!key || !symbol || !Object.hasOwn(DEMO_TIMEFRAMES,timeframe)) return
  const items=[{symbol,timeframe,openedAt:now},...readRecentCharts(key,storage).filter(item=>item.symbol!==symbol || item.timeframe!==timeframe)].slice(0,6)
  try { (storage || globalThis.localStorage)?.setItem(key,JSON.stringify(items)) } catch { /* Navigation must work when storage is unavailable. */ }
}
