// FE-07: opening Data desk with an empty catalog is read-only; only the owner's click refreshes it.
// Run against an isolated vite preview: node tests/dataDeskCatalogRefresh.browser.mjs http://127.0.0.1:5241
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const [origin] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(!['5180', '8010'].includes(new URL(origin).port))
const emptyCatalog = { status: 'empty', configured: true, error: null, refresh_available: true }
const cachedCatalog = { status: 'cached', configured: true, error: null, refresh_available: false, retrieved_at_utc: '2026-10-31T00:00:00Z' }
const instrument = { provider_id: 'dukascopy', instrument_id: 'EURUSD', symbol: 'EURUSD', category: 'forex', source: { provider: 'Dukascopy' } }
const writes = [], errors = []
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`)
      // Synthetic response only; no request reaches a real API.
      if (url.pathname === '/api/v2/data/catalog/refresh') return route.fulfill({ json: { catalog_items: [instrument], catalog_state: cachedCatalog } })
      return route.abort()
    }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
    if (url.pathname === '/api/v2/data/datasets') return route.fulfill({ json: { items: [], catalog_items: [], catalog_state: emptyCatalog, download_state: null } })
    return route.fulfill({ json: { items: [], available: false } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&lang=vi`)
  const empty = page.getByTestId('testing-empty-state')
  await empty.waitFor()
  await page.waitForTimeout(3000)
  assert.deepEqual(writes, [], 'opening Data desk must not write')
  await empty.getByRole('button', { name: 'Cập nhật danh mục' }).click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="testing-empty-state"] button.is-primary'))
  await page.waitForTimeout(1000)
  assert.deepEqual(writes, ['POST /api/v2/data/catalog/refresh'])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, writes }))
} finally { await browser.close() }
