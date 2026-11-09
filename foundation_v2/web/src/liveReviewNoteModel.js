import { completedLiveTrades } from './liveBrokerTrades.js'
import { dealNet, dayKey } from './liveWorkspaceModel.js'

export const noteTradeKey = link => JSON.stringify([link.account_id,link.trade_id])
export const noteTradeLink = row => ({account_id:row.account_id,trade_id:row.trade_id})

export function migrateReviewRecovery(recovery, defaults) {
  const normalize=value=>({...defaults,...value})
  return {...recovery,value:normalize(recovery.value),base:normalize(recovery.base),
    attempt:recovery.attempt ? {...recovery.attempt,value:normalize(recovery.attempt.value),
      // An unconfirmed old request must retain its original body for retry.
      legacyPayload:recovery.attempt.legacyPayload || (!Object.hasOwn(recovery.attempt.value,'linked_trades') ? recovery.attempt.value : undefined),
    } : null,
  }
}

export function reviewTradeRows(sources, names) {
  return sources.flatMap(({id,payload}) => completedLiveTrades(payload).filter(trade=>payload.manual || String(trade.ticket).startsWith('position:')).map(trade=>({
    ...trade,account_id:id,trade_id:String(trade.ticket),account_name:names.get(id) || id,currency:payload.account.currency,
    net:dealNet(trade),stale:payload.stale === true,
  }))).sort((a,b)=>b.time_msc-a.time_msc || noteTradeKey(a).localeCompare(noteTradeKey(b)))
}

export function reviewSummary(links, rows) {
  const map=new Map(rows.map(row=>[noteTradeKey(row),row])), selected=links.map(link=>map.get(noteTradeKey(link)))
  const complete=selected.every(row=>row && !row.stale && row.net!==null)
  const currencies=new Set(selected.filter(Boolean).map(row=>row.currency))
  return {count:links.length,missing:selected.filter(row=>!row).length,stale:selected.some(row=>row?.stale),
    net:complete && currencies.size===1 && [...currencies][0] ? selected.reduce((sum,row)=>sum+row.net,0) : null,
    currency:currencies.size===1 ? [...currencies][0] : '',
    winRate:complete && links.length ? selected.filter(row=>row.net>1e-12).length/links.length*100 : null,
    rows:selected,
  }
}

export function inReviewRange(row, from, to, timezone) {
  const day=dayKey(row.time_msc,timezone)
  return Boolean(day && (!from || day>=from) && (!to || day<=to))
}
