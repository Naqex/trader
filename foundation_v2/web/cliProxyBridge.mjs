import services from '../local-services.json' with { type: 'json' }

export const GATEWAY_MANAGEMENT_URL = `http://${services.host}:${services.cliProxyApiPort}/management.html`
export const GATEWAY_HEALTH_PATH = '/integrations/cliproxyapi/health'

// Preview checks panel availability without resolving credentials or proxying management actions.
export async function cliProxyHealth(req, res, next) {
  if (req.url?.split('?')[0] !== GATEWAY_HEALTH_PATH) return next()
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
  try {
    const response = await fetch(GATEWAY_MANAGEMENT_URL, { signal: AbortSignal.timeout(4000), redirect: 'error' })
    await response.body?.cancel()
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html')) throw new Error('unavailable')
    res.end(JSON.stringify({ status: 'ok' }))
  } catch {
    res.statusCode = 503
    res.end(JSON.stringify({ status: 'unavailable' }))
  }
}
