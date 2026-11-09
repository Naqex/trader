import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5252'
assert.equal(origin, 'http://127.0.0.1:5252', 'This regression uses only its assigned isolated mock origin')
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/owner-system-audit-20261031/replay-link'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const dataset = fixture.datasets.items[0].dataset_id
const report = { scope: 'Mock API only, including integrations/health. No backend, provider, broker or owner data.', cases: [], errors: [] }
const browser = await chromium.launch()
await mkdir(out, { recursive: true })

const item = (record_id, extra = {}) => ({ record_id, dataset_id: dataset, revision: 1, dataset_available: true, updated_at_utc: '2026-10-31T00:00:00Z', ...extra })
const replay = id => ({ ...structuredClone(fixture.latest), record_id: id, dataset_sha256: null })
async function scenario(name, { items = [], remembered = '', status = 200, narrow = false, blockedStorage = false } = {}, check) {
  const calls = []
  const context = await browser.newContext({ viewport: { width: narrow ? 390 : 1440, height: 900 }, serviceWorkers: 'block' })
  await context.addInitScript(({ remembered, workspace, blockedStorage }) => {
    if (location.origin !== 'http://127.0.0.1:5252') return
    localStorage.setItem('tw-language', 'vi')
    if (remembered) localStorage.setItem(`tw:replay:last:${workspace}`, remembered)
    if (blockedStorage) {
      Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError') }
      Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError') }
    }
  }, { remembered, workspace: fixture.workspace, blockedStorage })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname.startsWith('/integrations/')) return route.fulfill({ status: 503, json: { status: 'unavailable' } })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    calls.push({ method: req.method(), path: url.pathname, search: url.search, ...(req.method() === 'POST' ? { body: req.postDataJSON() } : {}) })
    if (url.pathname.endsWith('/activity')) {
      const event = req.postDataJSON()
      return route.fulfill({ json: { schema_version: 'replay-activity-v1', event_id: event.event_id, session_id: url.pathname.split('/').at(-2), accepted_seconds: (Date.parse(event.ended_at_utc) - Date.parse(event.started_at_utc)) / 1000 } })
    }
    if (req.method() === 'POST') {
      assert.equal(url.pathname, '/api/v2/replay/sessions', 'Only intentional replay creation is mocked')
      const body = req.postDataJSON()
      assert.equal(body.dataset_id, dataset)
      return route.fulfill({ json: replay('created-session') })
    }
    assert.equal(req.method(), 'GET', 'No other mutations are allowed')
    if (url.pathname === '/api/v2/replay/sessions') return route.fulfill({ status, json: status === 200 ? { items } : { detail: 'catalog_read_failed' } })
    if (url.pathname === '/api/v2/data/datasets') return route.fulfill({ json: fixture.datasets })
    if (/^\/api\/v2\/replay\/sessions\/[^/]+$/.test(url.pathname)) {
      const result = replay(url.pathname.split('/').at(-1))
      const cursor = url.searchParams.get('cursor_index')
      if (cursor !== null) Object.assign(result, { historical_view: true, view_cursor_index: Number(cursor) })
      return route.fulfill({ json: result })
    }
    if (['/api/v2/events', '/api/v2/workspace/events'].includes(url.pathname)) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
    return route.fulfill({ json: { items: [], available: false, configured: false, status: 'unavailable' } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`))
  const href = extra => `${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&chart_engine=lightweight&dataset=${dataset}${extra || ''}`
  const posts = () => calls.filter(call => call.method === 'POST' && call.path === '/api/v2/replay/sessions')
  const form = () => page.locator('.replay-start button.primary-action:enabled')
  const ready = async id => {
    await page.locator('.replay-workspace').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('session'), id)
  }
  try {
    await check({ page, href, posts, form, ready, calls })
    // Let the active document flush activity on blur before pagehide keepalive.
    const teardownPage = await context.newPage()
    await teardownPage.bringToFront()
    await page.waitForLoadState('networkidle')
    await page.goto('about:blank')
    await page.waitForLoadState('networkidle')
    report.cases.push({ name, result: 'PASS', creates: posts(), posts: calls.filter(call => call.method === 'POST'), reads: calls.filter(call => call.method === 'GET' && call.path.startsWith('/api/v2/replay/sessions')) })
  } catch (error) {
    report.failedCase = { name, calls, url: page.url(), visibleText: (await page.locator('body').innerText()).slice(0, 5000) }
    await page.screenshot({ path: `${out}/failure.png` })
    throw error
  } finally { await context.close() }
}

try {
  await scenario('dataset bookmark and reload are read-only; create button writes once', { narrow: true, remembered: 'unrelated-session' }, async ({ page, href, posts, form, ready }) => {
    await page.goto(href())
    await form().waitFor()
    assert.equal(posts().length, 0)
    assert.equal(new URL(page.url()).searchParams.has('session'), false)
    await page.reload()
    await form().waitFor()
    assert.equal(posts().length, 0)
    await page.screenshot({ path: `${out}/dataset-form-mobile.png` })
    await form().evaluate(button => { button.click(); button.click() })
    await ready('created-session')
    assert.equal(posts().length, 1)
    assert.equal(new URL(page.url()).searchParams.has('fresh'), false)
    await page.reload()
    await ready('created-session')
    assert.equal(posts().length, 1)
  })
  await scenario('dataset reuses most recently updated eligible session', { remembered: 'unrelated-session', items: [
    item('old', { updated_at_utc: '2026-10-01T00:00:00Z' }), item('latest'),
    item('other', { dataset_id: 'other-dataset', updated_at_utc: '2026-11-01T00:00:00Z' }),
    item('archived', { archived: true }), item('prop', { session_kind: 'prop' }), item('unavailable', { dataset_available: false }),
  ] }, async ({ page, href, posts, ready }) => {
    await page.goto(href())
    await ready('latest')
    await page.reload()
    await ready('latest')
    assert.equal(posts().length, 0)
  })
  await scenario('fresh launcher retains explicit form and start index', { remembered: 'old', items: [item('old')] }, async ({ page, href, posts, form, ready, calls }) => {
    await page.goto(href('&fresh=1&start=12'))
    await form().waitFor()
    assert.equal(await page.locator('.replay-start input[type="number"]').inputValue(), '12')
    assert.equal(calls.some(call => call.path === '/api/v2/replay/sessions'), false)
    assert.equal(posts().length, 0)
    await page.screenshot({ path: `${out}/fresh-form-desktop.png` })
    await form().click()
    await ready('created-session')
    assert.equal(posts().length, 1)
    assert.equal(posts()[0].body.start_index, 12)
    await page.reload()
    await ready('created-session')
    assert.equal(posts().length, 1)
  })
  await scenario('explicit session/cursor wins over dataset and fresh', {}, async ({ page, href, posts, ready, calls }) => {
    await page.goto(href('&session=historical-session&cursor=5&fresh=1'))
    await ready('historical-session')
    assert.equal(new URL(page.url()).searchParams.get('cursor'), '5')
    assert.ok(calls.some(call => call.path.endsWith('/historical-session') && call.search.includes('cursor_index=5')))
    assert.equal(calls.some(call => call.path === '/api/v2/replay/sessions'), false)
    assert.equal(posts().length, 0)
  })
  await scenario('catalog read failure stays read-only', { status: 503 }, async ({ page, href, posts }) => {
    await page.goto(href())
    await page.locator('.replay-error-panel').waitFor()
    assert.equal(posts().length, 0)
  })
  await scenario('blocked browser storage retains URL-based resume', { blockedStorage: true, items: [item('latest')] }, async ({ page, href, posts, ready }) => {
    await page.goto(href())
    await ready('latest')
    await page.reload()
    await ready('latest')
    assert.equal(posts().length, 0)
  })
  assert.deepEqual(report.errors, [])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally {
  await browser.close()
  await writeFile(`${out}/browser.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: report.result, cases: report.cases.map(test => ({ name: test.name, creates: test.creates.length })), errors: report.errors, ...(report.failure ? { failure: report.failure } : {}) }))
}
