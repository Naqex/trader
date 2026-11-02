import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const route = '/integrations/paperclip/workflows'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const python = fileURLToPath(new URL('../../../../projects/integrations/TradingAgents/.venv/Scripts/python.exe', import.meta.url))
const script = fileURLToPath(new URL('../../../../tooling/ai-engines/studio_workflows.py', import.meta.url))
const actions = new Set(['overview', 'get', 'create', 'start', 'cancel'])
const pending = new Set()

export function invokeWorkflow(input) {
  return new Promise((resolve, reject) => {
    // Fixed executable/script and structured stdin; task data never becomes a command.
    const child = execFile(python, ['-X', 'utf8', script], { cwd: root, windowsHide: true, timeout: 45000, maxBuffer: 131072 }, (error, stdout) => {
      try {
        const result = JSON.parse(stdout)
        if (typeof result.ok !== 'boolean' || (error && result.ok)) throw new Error('invalid_response')
        resolve(result)
      } catch { reject(new Error('outcome_unknown')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
  })
}

export function workflowMiddleware(invoke = invokeWorkflow) {
  return async (req, res, next) => {
    if (req.url?.split('?')[0] !== route) return next()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json')
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
    // Private local controls only; no general HTTP/shell proxy or cross-origin API.
    const host = req.headers.host || ''
    if (!/^127\.0\.0\.1:[0-9]{1,5}$/.test(host)
        || req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') {
      send(403, { ok: false, error: 'origin_denied' }); return
    }
    if (req.method !== 'POST') { send(405, { ok: false, error: 'method_denied' }); return }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
      send(415, { ok: false, error: 'invalid_request' }); return
    }
    let key
    try {
      let wire = ''
      for await (const chunk of req) {
        wire += chunk.toString('utf8')
        if (Buffer.byteLength(wire) > 8192) { send(413, { ok: false, error: 'invalid_request' }); return }
      }
      const input = JSON.parse(wire)
      if (!input || typeof input !== 'object' || Array.isArray(input) || !actions.has(input.action)) {
        send(400, { ok: false, error: 'invalid_request' }); return
      }
      if (['create', 'start', 'cancel'].includes(input.action)) {
        if (typeof input.company !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.company)) {
          send(400, { ok: false, error: 'invalid_request' }); return
        }
        const company = input.company.toLowerCase()
        if (pending.has(company)) { send(409, { ok: false, error: 'operation_pending' }); return }
        key = company
        pending.add(key)
      }
      const result = await invoke(input)
      send(result.ok ? 200 : 409, result)
    } catch {
      // An interrupted control request may already have changed native tasks.
      send(503, { ok: false, error: 'outcome_unknown' })
    } finally { if (key !== undefined) pending.delete(key) }
  }
}

export function localStudioWorkflows() {
  return { name: 'local-studio-workflows',
    configureServer(server) { server.middlewares.use(workflowMiddleware()) },
    configurePreviewServer(server) { server.middlewares.use(workflowMiddleware()) } }
}
