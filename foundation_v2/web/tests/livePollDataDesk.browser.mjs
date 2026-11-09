// FE-05/FE-07 measurement on an isolated production preview. Synthetic GET fixtures;
// every write is aborted and recorded. Counts are diagnostic, not owner-runtime latency.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const [origin, output, seconds = '31'] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
await mkdir(output, { recursive: true })
const broker = { status: 'ready', connection_id: 'fixture-broker', source: 'SYNTHETIC MT5', captured_at_utc: '2026-10-30T12:00:00Z', account: { account_ref: 'fixture', currency: 'USD', balance: 10000, equity: 10000 }, connections: [], positions: [], orders: [], deals: [], cashflows: [], quotes: [] }
const report = { scope: 'Production UI; synthetic GET-only fixtures; writes aborted', observeSeconds: Number(seconds), poll: [], dataDesk: null, errors: [] }
const browser = await chromium.launch()
const guarded = (context, writes, handle) => context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== origin) return route.abort()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); return route.abort() }
  if (!url.pathname.startsWith('/api/')) return route.continue()
  if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
  return handle(route, request, url)
})
try {
  for (const section of ['notes', 'calendar', 'trades']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
    await context.routeWebSocket('**/*', socket => socket.close())
    const counts = { statusGETs: 0, full200: 0, notModified304: 0 }, writes = []
    await guarded(context, writes, (route, request, url) => {
      if (url.pathname === '/api/v2/live/status') {
        counts.statusGETs++
        if (request.headers()['if-none-match'] === '"fixture"') { counts.notModified304++; return route.fulfill({ status: 304, headers: { etag: '"fixture"' }, body: '' }) }
        counts.full200++; return route.fulfill({ json: broker, headers: { etag: '"fixture"' } })
      }
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      if (url.pathname === '/api/v2/trade-labels') return route.fulfill({ json: { schema_version: 'trade-labels-v1', items: [], assignments: [], groups: [] } })
      return route.fulfill({ json: { items: [], available: false } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=${section}&lang=vi`)
    await page.waitForTimeout(report.observeSeconds * 1000)
    report.poll.push({ section, visibility: await page.evaluate(() => document.visibilityState), ...counts, writes })
    await context.close()
  }
  const context = await browser.newContext()
  const writes = []
  await guarded(context, writes, (route, request, url) => {
    if (url.pathname === '/api/v2/data/datasets') return route.fulfill({ json: { items: [], catalog_items: [], catalog_state: { status: 'empty', configured: true, error: null }, download_state: null } })
    return route.fulfill({ json: { items: [], available: false } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&lang=vi`)
  await page.waitForTimeout(4000)
  report.dataDesk = { journey: 'open Data desk; empty configured catalog; no user action', writesAttempted: writes }
  await context.close()
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
