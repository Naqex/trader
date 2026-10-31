export const PAPERCLIP_ORIGIN = 'http://127.0.0.1:3100'
export const PAPERCLIP_HEALTH_PATH = '/integrations/paperclip/health'

// A fixed read-only route avoids giving the host a general local HTTP proxy.
export async function paperclipHealth(req, res, next) {
  if (req.url?.split('?')[0] !== PAPERCLIP_HEALTH_PATH) return next()
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
  try {
    const response = await fetch(`${PAPERCLIP_ORIGIN}/api/health`, { signal: AbortSignal.timeout(4000), redirect: 'error' })
    const health = await response.json()
    if (!response.ok || health.status !== 'ok' || !health.deploymentMode || !health.commit) throw new Error('unavailable')
    res.end(JSON.stringify({ status: 'ok', version: health.version, commit: health.commit }))
  } catch {
    res.statusCode = 503
    res.end(JSON.stringify({ status: 'unavailable' }))
  }
}

export function localPaperclip() {
  return {
    name: 'local-paperclip-health',
    configureServer(server) { server.middlewares.use(paperclipHealth) },
    configurePreviewServer(server) { server.middlewares.use(paperclipHealth) },
  }
}
