import { decodeDemoSnapshot } from './liveTradingModel.js'

async function request(workspace, path, { body, signal } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort',abort,{once:true})
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort,125000)
  try {
    // Commands never retry automatically: an interrupted send needs reconciliation.
    const response = await fetch(`/api/v2/live/trading${path}`,{ method:body ? 'POST' : 'GET', signal:controller.signal,
      headers:{'X-Workspace-Id':workspace,...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {}) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) { const error = new Error(typeof payload?.detail === 'string' ? payload.detail : 'demo_response_invalid'); error.status=response.status; throw error }
    return payload
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort) }
}
export async function readDemoTrading(workspace,symbol,timeframe,signal,connectionId,{ summary = false } = {}) {
  const params = new URLSearchParams({timeframe})
  if (symbol) params.set('symbol',symbol)
  if (connectionId) params.set('connection_id',connectionId)
  if (summary) params.set('summary','true')
  return decodeDemoSnapshot(await request(workspace,`?${params}`,{signal}))
}
export const previewDemoOrder = (workspace,body,signal) => request(workspace,'/preview',{body,signal})
export const commandDemoOrder = (workspace,body) => request(workspace,'/commands',{body})
export const reconcileDemoOrder = (workspace,requestId,connectionId) => request(workspace,'/reconcile',{body:{request_id:requestId,...(connectionId?{connection_id:connectionId}:{})}})
