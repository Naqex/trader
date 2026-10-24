import { cumulativeDealSeries, dealNet, filterLiveDeals, summarizeDeals } from './liveWorkspaceModel.js'

export function selectLiveConnection(items, previousId) {
  return items.find(item=>item.id===previousId)?.id || items.find(item=>item.status==='connected'&&item.requested_mode==='trading')?.id || items.find(item=>item.requested_mode==='trading')?.id || items[0]?.id || ''
}

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
  const chartComplete=deals.every(deal=>Number.isFinite(deal.time_msc) && Number.isFinite(new Date(deal.time_msc).getTime()) && dealNet(deal)!==null)
  const months=new Map(), weekdays=Array(7).fill(0)
  if(chartComplete)for(const deal of deals){
    const date=new Date(deal.time_msc), month=date.toISOString().slice(0,7), net=dealNet(deal)
    months.set(month,(months.get(month)||0)+net)
    weekdays[(date.getUTCDay()+6)%7]+=net
  }
  return {...summarizeDeals(deals),gross:sum(['profit']),costs:sum(['commission','swap','fee']),from,to,stale:payload.stale===true,currency:payload.account.currency,
    deals:[...deals].sort((a,b)=>(b.time_msc||0)-(a.time_msc||0)),chartComplete,
    series:chartComplete?cumulativeDealSeries(deals):[],
    months:[...months].sort(([a],[b])=>a.localeCompare(b)).map(([label,value])=>({label,value})),
    weekdays:chartComplete&&deals.length?weekdays.map((value,index)=>({label:['T2','T3','T4','T5','T6','T7','CN'][index],value})):[]}
}
