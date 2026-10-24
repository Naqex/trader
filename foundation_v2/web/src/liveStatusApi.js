const LIVE_STATUS_URL = '/api/v2/live/status'

function statusError(message, kind = 'error') {
  const error = new Error(message)
  error.kind = kind
  return error
}

export async function readLiveStatus(workspace, signal, connectionId, summary = false, cache = {}) {
  const params = new URLSearchParams()
  if (connectionId) params.set('connection_id',connectionId)
  if (summary) params.set('summary','true')
  const response = await fetch(`${LIVE_STATUS_URL}?${params}`, {
    method: 'GET',
    headers: { 'X-Workspace-Id': workspace, ...(cache.etag ? {'If-None-Match':cache.etag} : {}) },
    signal,
  })
  if (response.status === 304 && cache.payload) return cache.payload
  const payload = await response.json().catch(() => null)
  if (response.status === 404 || response.status === 501) throw statusError('live_status_unavailable', 'unavailable')
  if (!response.ok) throw statusError(String(payload?.detail || `HTTP ${response.status}`), response.status === 403 ? 'denied' : 'error')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw statusError('invalid_live_status_payload', 'unavailable')
  if (!['ready', 'unavailable', 'locked'].includes(payload.status)) throw statusError('invalid_live_status_state', 'unavailable')
  cache.payload=payload;cache.etag=response.headers.get('etag')
  return payload
}
