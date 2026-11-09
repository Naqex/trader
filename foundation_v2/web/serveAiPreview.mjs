import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { paperclipHealth } from './paperclipBridge.mjs'
import { cliProxyHealth } from './cliProxyBridge.mjs'
import services from '../local-services.json' with { type: 'json' }

const root = fileURLToPath(new URL('../.runtime/ai-workspace-preview/', import.meta.url))
const port = Number(process.argv[2] || services.aiPreviewPort)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port')
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.json':'application/json' }
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  await paperclipHealth(req, res, () => cliProxyHealth(req, res, async () => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end('Trader preview: writes are disabled'); return }
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(url.pathname === '/api/v2/events' ? 204 : 503)
        res.end(url.pathname === '/api/v2/events' ? undefined : JSON.stringify({ detail:'ui_preview_services_not_connected' })); return
      }
      const requestPath = decodeURIComponent(url.pathname)
      const relative = requestPath === '/' || !path.extname(requestPath) ? 'index.html' : requestPath.slice(1)
      const target = path.resolve(root, relative)
      if (path.relative(root, target).startsWith('..') || !mime[path.extname(target)] || !(await stat(target)).isFile()) throw new Error('not-found')
      res.setHeader('Content-Type', mime[path.extname(target)])
      if (req.method === 'HEAD') res.end()
      else createReadStream(target).on('error', () => res.destroy()).pipe(res)
    } catch { res.writeHead(404); res.end('Not found') }
  }))
})
server.listen(port, services.host, () => console.log(`AI workspace preview: http://${services.host}:${port}/?workspace=tenant-a&view=ai&area=ai&section=paperclip&lang=vi`))
