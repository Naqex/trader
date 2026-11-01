// Synthetic GET-only causal gates on isolated production previews. No latency extrapolation.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const [origin, output, mode = 'candidate'] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
assert(['baseline', 'candidate'].includes(mode))
await mkdir(output, { recursive: true })
const report = { scope: 'Production UI; synthetic GET-only fixtures; prerequisite response gated', mode, cases: [], errors: [], writes: [] }
const browser = await chromium.launch()
const ledger = { schema_version: 'replay-trades-page-v1', status: 'ready', snapshot_key: 'overlap-fixture', ledger: [], sources: [], excluded: [], scope: { session_ids: ['fixture-session'] }, facets: { assets: [], tags: [], strategies: [], years: [], types: [] }, pagination: { page: 1, page_size: 10, returned_count: 0, filtered_count: 0, page_count: 0 } }
const broker = { status: 'ready', connection_id: 'fixture-broker', source: 'SYNTHETIC MT5', captured_at_utc: '2026-10-30T12:00:00Z', account: { account_ref: 'fixture', currency: 'USD', balance: 10000, equity: 10000 }, connections: [], positions: [], orders: [], deals: [], cashflows: [], quotes: [] }
const session = { record_id: 'fixture-session', revision: 1, name: 'Synthetic session', dataset_available: true }
const requestWithin = (promise, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 10000)
  promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
})
try {
  for (const journey of ['live', 'ledger']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, reducedMotion: 'reduce' })
    await context.routeWebSocket('**/*', socket => socket.close())
    let release, prerequisiteStarted, independentStarted, released = false
    const gate = new Promise(resolve => { release = resolve })
    const prerequisite = new Promise(resolve => { prerequisiteStarted = resolve })
    const independent = new Promise(resolve => { independentStarted = resolve })
    const requests = [], started = performance.now()
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(url.pathname); return route.abort() }
      if (journey === 'live' && /\/assets\/LiveSurfaces-[^/]+\.js$/.test(url.pathname)) independentStarted()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      requests.push({ path: url.pathname, startedMs: Math.round(performance.now() - started), beforeRelease: !released })
      if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
      if (journey === 'live' && url.pathname === '/api/v2/live/status' || journey === 'ledger' && url.pathname === '/api/v2/replay/sessions') {
        prerequisiteStarted(); await gate
        return route.fulfill({ json: journey === 'live' ? broker : { items: [session] } })
      }
      if (url.pathname === '/api/v2/replay/trades') { independentStarted(); return route.fulfill({ json: ledger }) }
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      if (url.pathname === '/api/v2/trade-labels') return route.fulfill({ json: { schema_version: 'trade-labels-v1', items: [], assignments: [], groups: [] } })
      if (url.pathname === '/api/v2/trade-groups') return route.fulfill({ json: { version: 'trade-groups-v1', revision: 0, items: [] } })
      return route.fulfill({ json: { items: [], available: false } })
    })
    const page = await context.newPage(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => report.errors.push(error.message))
    try {
      await page.goto(`${origin}/?workspace=tenant-a&view=${journey === 'live' ? 'live&area=live' : 'trade&area=testing&sessions=all'}&section=trades&lang=vi`)
      await requestWithin(prerequisite, `${journey} prerequisite`)
      let timer
      const overlaps = await Promise.race([independent.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500) })])
      clearTimeout(timer)
      if (journey === 'live') assert.equal(await page.locator('.live-trades-content').count(), 0, 'No journal data rendered before account status resolves')
      released = true; release()
      assert.equal(overlaps, mode === 'candidate', `${journey} independent work overlaps prerequisite only in candidate`)
      await page.locator(journey === 'live' ? '.live-trades-content' : '[data-testid="aggregate-trades"]').waitFor()
      report.cases.push({ journey, overlaps, prerequisiteGatePreserved: journey === 'live', requests })
    } finally { release(); await context.close() }
  }
  if (mode === 'candidate') for (const state of ['denied', 'error', 'empty']) {
    const context = await browser.newContext()
    let release, ledgerStarted
    const gate = new Promise(resolve => { release = resolve })
    const ledgerRequest = new Promise(resolve => { ledgerStarted = resolve })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) { report.writes.push(url.pathname); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
      if (url.pathname === '/api/v2/replay/sessions') {
        await gate
        return route.fulfill(state === 'empty' ? { json: { items: [] } } : { status: state === 'denied' ? 403 : 500, json: { detail: `fixture_${state}` } })
      }
      if (url.pathname === '/api/v2/replay/trades') { ledgerStarted(); return route.fulfill({ json: ledger }) }
      return route.fulfill({ json: { schema_version:'trade-labels-v1', version:'trade-groups-v1', revision:0, items:[], assignments:[], groups:[] } })
    })
    const page = await context.newPage(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => report.errors.push(error.message))
    try {
      await page.goto(`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&sessions=all`)
      await requestWithin(ledgerRequest, `${state} ledger request`); release()
      const expected = state === 'denied' ? '[data-empty-kind="denied"]' : state === 'empty' ? '[data-empty-kind="sessions"]' : '[data-testid="session-catalog-error"]'
      await page.locator(expected).waitFor()
      assert.equal(await page.getByTestId('aggregate-trades').count(), 0)
      report.cases.push({ catalogState: state, finalCatalogPrecedencePreserved: true })
    } finally { release(); await context.close() }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.writes, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
