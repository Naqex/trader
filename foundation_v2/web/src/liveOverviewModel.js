import { filterLiveDeals, summarizeDeals } from './liveWorkspaceModel.js'

export function liveOverviewPerformance(payload, connectionId, expectedAccount) {
  const from=Date.parse(payload?.history_from_utc), to=Date.parse(payload?.captured_at_utc)
  const available=Boolean(connectionId && payload?.connection_id===connectionId && payload?.status==='ready' && payload?.account && Array.isArray(payload.deals) && Number.isFinite(from) && Number.isFinite(to) && from<to)
  if(!available) return null
  if(expectedAccount){
    const binding=payload.account_binding || payload.account
    if(String(binding?.login ?? payload.account_login)!==String(expectedAccount.login) || binding?.server!==expectedAccount.server || payload.account.currency!==expectedAccount.currency)return null
  }
  const deals=filterLiveDeals(payload)
  const sum=keys=>deals.every(deal=>keys.every(key=>Number.isFinite(deal[key]))) ? deals.reduce((total,deal)=>total+keys.reduce((value,key)=>value+deal[key],0),0) : null
  return {...summarizeDeals(deals),gross:sum(['profit']),costs:sum(['commission','swap','fee']),from,to,stale:payload.stale===true,currency:payload.account.currency}
}
