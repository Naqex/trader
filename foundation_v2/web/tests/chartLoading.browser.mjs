import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [origin, output] = process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
assert.notEqual(new URL(origin).port,'5180','Use the isolated browser fixture')
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
// This readiness test renders the established candle prefix; it does not test historical paging.
const replay = { ...fixture.latest, dataset_sha256: null }
const href = extra => `${origin}/?workspace=${fixture.workspace}&view=replay&area=testing&surface=workspace&session=${fixture.session}${extra || ''}`
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Labeled synthetic replay prefix and real local chart engine; GET-only backend access, no owner session or broker writes', cases: [], errors: [], unexpected: [], blockedSyntheticActivity: [] }
function gate() { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
async function setup(width, theme, motion = 'reduce') {
  const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: motion })
  await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && request.method() === 'POST' && url.pathname === `/api/v2/replay/sessions/${fixture.session}/activity`) {
      report.blockedSyntheticActivity.push(`${request.method()} ${request.url()}`)
      return route.abort()
    }
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.unexpected.push(`${request.method()} ${request.url()}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    let body
    if (url.pathname === `/api/v2/replay/sessions/${fixture.session}`) body = replay
    else if (url.pathname === '/api/v2/data/datasets') body = fixture.datasets
    else if (url.pathname === '/api/v2/chart/annotations') body = { items: [] }
    else if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture stream\n\n' })
    else body = { items: [], available: false }
    return route.fulfill({ json: body })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  return { context, page }
}
async function centered(page, region) {
  const loader = page.getByTestId('chart-loading')
  await loader.waitFor()
  assert.equal(await loader.count(),1,'One app loading screen at a time')
  const [parent, box, indicator] = await Promise.all([region.boundingBox(), loader.boundingBox(), loader.locator(':scope > div').boundingBox()])
  assert.ok(Math.abs(parent.x - box.x) <= 1 && Math.abs(parent.y - box.y) <= 1)
  assert.ok(Math.abs(parent.width - box.width) <= 1 && Math.abs(parent.height - box.height) <= 1, 'Loading covers its chart viewport')
  assert.ok(Math.abs(parent.x + parent.width / 2 - indicator.x - indicator.width / 2) <= 1)
  assert.ok(Math.abs(parent.y + parent.height / 2 - indicator.y - indicator.height / 2) <= 1)
  assert.equal(await page.locator('main,[role=main]').count(), 1)
  assert.equal(await page.locator('.wm-page-skeleton').count(), 0)
  assert.equal(await page.locator('.fx-rail').count(), 0)
  assert.equal(await loader.getAttribute('aria-busy'), 'true')
  assert.equal(await page.locator('.legacy-replay-toolbar').evaluateAll(nodes => nodes.every(node => {
    const box = node.getBoundingClientRect()
    return Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-testid="chart-loading"]'))
  })), true, 'Loading covers the viewport-floating Replay toolbar')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
}
try {
  for (const width of [1440, 390]) for (const theme of ['dark', 'light']) {
    const motion = width === 390 ? 'reduce' : 'no-preference'
    const { context, page } = await setup(width, theme, motion)
    const chunk = gate(), session = gate(), library = gate(), requested = gate()
    await page.route('**/src/ReplayWorkspace.jsx*', async route => { await chunk.promise; await route.continue() })
    await page.route(`**/api/v2/replay/sessions/${fixture.session}*`, async route => { requested.release(); await session.promise; await route.fulfill({ json: replay }) })
    await page.route('**/charting_library/charting_library.standalone.js*', async route => { await library.promise; await route.continue() })
    await page.goto(href(), { waitUntil: 'domcontentloaded' })
    await centered(page, page.locator('.fx-content'))
    const animation = await page.locator('.wm-chart-loading-spinner').evaluate(node => getComputedStyle(node).animationName)
    assert.equal(animation, motion === 'reduce' ? 'none' : 'wm-chart-loading-spin')
    await page.evaluate(() => { window.__loadingShell = document.querySelector('.fx-topbar') })
    report.cases.push({ width, theme, stage: 'cold lazy route', motion })
    chunk.release()
    await Promise.race([requested.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Session read did not start')), 10000))])
    await centered(page, page.locator('.fx-content'))
    await page.screenshot({ path: `${output}/session-pending-${width}-${theme}.png`, animations: 'disabled' })
    report.cases.push({ width, theme, stage: 'initial session GET' })
    session.release()
    await page.locator('[data-chart-status=loading]').waitFor()
    await centered(page, page.locator('.fx-content'))
    const host = page.locator('.advanced-chart-host')
    assert.equal(await host.getAttribute('inert'), '')
    assert.equal(await host.getAttribute('aria-hidden'), 'true')
    assert.equal(await host.evaluate(node=>getComputedStyle(node).visibility),'hidden','Native iframe loader is not shown under the app loader')
    await page.screenshot({ path: `${output}/engine-pending-${width}-${theme}.png`, animations: 'disabled' })
    report.cases.push({ width, theme, stage: 'native library pending, host inert' })
    library.release()
    await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
    assert.equal(await page.getByTestId('chart-loading').count(), 0)
    assert.equal(await host.getAttribute('inert'), null)
    assert.equal(await host.getAttribute('aria-hidden'), null)
    assert.equal(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'), String(replay.visible_rows.length))
    assert.equal(await page.evaluate(() => window.__loadingShell === document.querySelector('.fx-topbar')), true)
    report.cases.push({ width, theme, stage: 'real engine ready, same shell, candle prefix retained' })
    if (width === 1440 && theme === 'dark') {
      const refresh = gate(), refreshRequested = gate()
      await page.evaluate(() => { window.__readyChartHost = document.querySelector('.advanced-chart-host') })
      await page.route(`**/api/v2/replay/sessions/${fixture.session}*`, async route => {
        refreshRequested.release(); await refresh.promise; await route.fulfill({ json: replay })
      })
      await page.evaluate(() => {
        const url = new URL(location.href); url.searchParams.delete('cursor')
        history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate'))
      })
      await Promise.race([refreshRequested.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Background session read did not start')), 10000))])
      assert.equal(await page.getByTestId('chart-loading').count(), 0)
      assert.equal(await page.locator('.replay-message:not(.replay-error)').count(), 0)
      assert.equal(await page.evaluate(() => window.__readyChartHost === document.querySelector('.advanced-chart-host')), true)
      assert.equal(await page.getByTestId('replay-chart').getAttribute('data-chart-status'), 'ready')
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v2/replay/sessions/${fixture.session}`)
      refresh.release()
      await refreshed
      await page.waitForFunction(cursor => new URL(location.href).searchParams.get('cursor') === String(cursor), replay.payload.cursor_index)
      assert.equal(await page.getByTestId('chart-loading').count(), 0)
      assert.equal(await page.evaluate(() => window.__readyChartHost === document.querySelector('.advanced-chart-host')), true)
      report.cases.push({ stage: 'same-session background GET retains ready chart without spinner or status row' })
    }
    await context.close()
  }
  {
    const { context, page } = await setup(1440, 'dark')
    await page.clock.install()
    await page.route(`**/api/v2/replay/sessions/${fixture.session}*`, route => route.abort('timedout'))
    await page.goto(href())
    await page.locator('.replay-error').waitFor()
    assert.equal(await page.getByTestId('chart-loading').count(), 0)
    report.cases.push({ stage: 'initial network error exits loading' })
    await context.close()
  }
  {
    const { context, page } = await setup(390, 'light')
    await page.clock.install()
    const pending = gate(), requested = gate()
    await page.route(`**/api/v2/replay/sessions/${fixture.session}*`, async route => { requested.release(); await pending.promise; await route.fulfill({ json: replay }).catch(() => {}) })
    await page.goto(href(), { waitUntil: 'domcontentloaded' })
    await page.getByTestId('chart-loading').waitFor()
    await requested.promise
    await page.clock.fastForward(16000)
    await page.locator('.replay-error').getByText('Đọc phiên quá thời gian chờ. Hãy mở lại phiên.', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('chart-loading').count(), 0)
    pending.release()
    report.cases.push({ stage: 'session deadline exits loading after 15 seconds' })
    await context.close()
  }
  for (const kind of ['library-error', 'data-ready-timeout']) {
    const { context, page } = await setup(1440, 'dark')
    await page.clock.install()
    if (kind === 'library-error') await page.route('**/charting_library/charting_library.standalone.js*', route => route.abort('failed'))
    else await context.addInitScript(() => {
      document.addEventListener('load', event => {
        if (!event.target.src?.includes('charting_library.standalone.js')) return
        const Original = window.TradingView.widget
        window.TradingView.widget = function (...args) {
          const widget = new Original(...args)
          widget.onChartReady(() => { widget.activeChart().dataReady = () => false; window.__blockedChartData = true })
          return widget
        }
      }, true)
    })
    await page.goto(href())
    if (kind === 'data-ready-timeout') {
      await page.waitForFunction(() => window.__blockedChartData === true)
      await centered(page, page.locator('.fx-content'))
      assert.equal(await page.locator('.advanced-chart-host').evaluate(node => getComputedStyle(node).visibility), 'hidden')
      await page.screenshot({ path: `${output}/data-pending-1440-dark.png`, animations: 'disabled' })
      await page.clock.fastForward(21000)
    }
    await page.locator('[data-chart-status=error]').waitFor()
    await page.getByRole('link', { name: 'Mở biểu đồ dự phòng' }).waitFor()
    assert.equal(await page.getByTestId('chart-loading').count(), 0)
    assert.equal(await page.locator('.advanced-chart-host').getAttribute('inert'), '')
    report.cases.push({ stage: kind })
    await context.close()
  }
  {
    const { context, page } = await setup(1440, 'dark')
    const pending = gate()
    await page.route('**/api/v2/replay/sessions', async route => { await pending.promise; await route.fulfill({ json: { items: [] } }).catch(() => {}) })
    await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&area=testing&select=1`, { waitUntil: 'domcontentloaded' })
    await page.locator('.wm-page-skeleton').waitFor()
    assert.equal(await page.getByTestId('chart-loading').count(), 0)
    pending.release()
    await page.locator('[data-empty-kind=sessions]').waitFor()
    report.cases.push({ stage: 'Sessions picker retains report skeleton' })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpected, [])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, unexpected: report.unexpected }))
