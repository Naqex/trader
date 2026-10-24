import { dealNet } from './liveWorkspaceModel.js'

// Booked trading PnL includes entry/exit costs, never deposits or balance changes.
export function mt5AccountPnl(snapshot, history, connectionId) {
  const floating = snapshot?.status === 'ready' && Array.isArray(snapshot.positions) && snapshot.positions.every(item=>Number.isFinite(item.profit))
    ? snapshot.positions.reduce((sum,item)=>sum+item.profit,0) : null
  const from = Date.parse(history?.history_from_utc), to = Date.parse(history?.captured_at_utc)
  const boundLogin = history?.account_binding?.login ?? history?.execution_binding?.login
  const matches = history?.status === 'ready' && !history.stale && history.connection_id === connectionId
    && history.account?.currency === snapshot?.account?.currency
    && (boundLogin == null || String(boundLogin) === String(snapshot?.account?.login))
    && Number.isFinite(from) && Number.isFinite(to) && from <= to && Array.isArray(history.deals)
  const deals = matches ? history.deals.filter(item=>[0,1].includes(item.type)) : []
  const realized = matches && deals.every(item=>Number.isFinite(item.time_msc) && item.time_msc >= from && item.time_msc <= to && dealNet(item)!==null)
    ? deals.reduce((sum,item)=>sum+dealNet(item),0) : null
  return { floating, realized, from:matches?from:null, to:matches?to:null }
}
