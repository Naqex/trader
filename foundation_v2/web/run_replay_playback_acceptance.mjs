import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const phase = process.argv[2] || 'after'
const output = new URL(`../evidence/replay-playback-20261019/${phase}/`, import.meta.url)
await mkdir(output, { recursive: true })
const session = process.env.TW_REPLAY_QA_SESSION || '6428cf18b3f54a36b2e90207ef12392e'
const startCursor = Number(process.env.TW_REPLAY_QA_CURSOR || 2997)
const fullHistory = process.env.TW_REPLAY_QA_FULL_HISTORY === '1'
assert.match(session, /^[a-zA-Z0-9-]+$/)
assert.ok(Number.isSafeInteger(startCursor) && startCursor >= 0)
const url = `http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&mode=Practice&surface=workspace&cursor=${startCursor}`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1368, height: 790 } })
const requests = [], errors = [], blocked = [], steps = []
const byRequest = new WeakMap()
await page.addInitScript(() => {
  document.addEventListener('load', event => {
    if (!event.target.src?.includes('charting_library.standalone.js')) return
    const Original = window.TradingView.widget
    window.TradingView.widget = function (...args) {
      const feed = args[0].datafeed, getBars = feed.getBars.bind(feed), subscribe = feed.subscribeBars.bind(feed)
      const remember = bar => { if (bar) window.__qaLastBar = { ...bar } }
      feed.getBars = (info, resolution, period, callback, error) => getBars(info, resolution, period, (bars, meta) => { remember(bars.at(-1)); callback(bars, meta) }, error)
      feed.subscribeBars = (info, resolution, callback, ...rest) => subscribe(info, resolution, bar => { remember(bar); callback(bar) }, ...rest)
      const widget = new Original(...args)
      window.__qaWidget = widget
      return widget
    }
  }, true)
})
page.on('pageerror', error => errors.push(String(error)))
page.on('response', response => {
  if (!response.url().includes('/api/')) return
  const request = response.request()
  const item = { path: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status(), duration: null }
  requests.push(item); byRequest.set(request, item)
})
page.on('requestfinished', request => { const item = byRequest.get(request); if (item) item.duration = request.timing().responseEnd })
// Historical playback must remain read-only; no test writes to the owner's session.
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD'].includes(route.request().method())) { blocked.push(route.request().method() + ' ' + route.request().url()); return route.abort() }
  if (fullHistory) {
    const url = new URL(route.request().url())
    if (url.searchParams.get('response_view') === 'history-v1') {
      url.searchParams.delete('response_view')
      return route.continue({ url: url.href })
    }
  }
  return route.continue()
})
try {
await page.goto(url)
const chart = page.locator('.advanced-replay-chart')
await chart.waitFor()
await page.waitForFunction(() => document.querySelector('.advanced-replay-chart')?.dataset.chartStatus === 'ready', null, { timeout: 30000 })
await page.evaluate(() => {
  window.playbackProbe = { mounts: 0, gaps: [], last: performance.now() }
  const probe = window.playbackProbe
  probe.observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) {
      probe.mounts += (node.matches('iframe') ? 1 : 0) + node.querySelectorAll('iframe').length
    }
  })
  probe.observer.observe(document.querySelector('.chart-canvas'), { childList: true, subtree: true })
  const frame = now => { probe.gaps.push(now - probe.last); probe.last = now; probe.raf = requestAnimationFrame(frame) }
  probe.raf = requestAnimationFrame(frame)
})
await page.screenshot({ path: fileURLToPath(new URL('initial.png', output)) })
for (let i = 0; i < 5; i++) {
  const before = Number(new URL(page.url()).searchParams.get('cursor'))
  const start = performance.now()
  await page.getByTestId('step-1').click()
  await page.waitForFunction(cursor => Number(new URL(location.href).searchParams.get('cursor')) > cursor, before)
  await page.waitForFunction(() => document.querySelector('.advanced-replay-chart')?.dataset.chartStatus === 'ready')
  await page.waitForFunction(() => window.__qaLastBar?.time === Number(document.querySelector('.advanced-replay-chart').dataset.cutoff) * 1000)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  steps.push(performance.now() - start)
}
const native = page.frames().find(frame => frame !== page.mainFrame() && frame.url().includes('charting_library')) || page.frames()[1]
const buttons = native ? await native.locator('button').evaluateAll(nodes => nodes.slice(0, 60).map(node => ({ text: node.textContent, title: node.title, label: node.getAttribute('aria-label'), data: node.getAttribute('data-value') }))) : []
const probe = await page.evaluate(() => {
  const probe = window.playbackProbe
  cancelAnimationFrame(probe.raf); probe.observer.disconnect()
  return { mounts: probe.mounts, gaps: probe.gaps }
})
await page.screenshot({ path: fileURLToPath(new URL('steps.png', output)) })
if (phase !== 'before') assert.equal(probe.mounts, 0, 'Forward history playback must reuse its widget')
const checks = []
if (phase !== 'before') {
  assert.equal(await page.locator('.replay-history-banner').count(), 0)
  assert.equal(await page.locator('.chart-bottom-bar').isVisible(), false)
  const box = await chart.boundingBox()
  await page.getByRole('button', { name: 'Chọn nến bắt đầu replay', exact: true }).click()
  assert.equal(await page.locator('.wm-notification').count(), 0)
  assert.deepEqual(await chart.boundingBox(), box, 'Selection must not shift the chart')
  await page.keyboard.press('Escape')
  checks.push('No banners or chart layout shift when selecting a replay start')

  const cursor = () => Number(new URL(page.url()).searchParams.get('cursor'))
  let at = cursor()
  await page.getByTestId('play-toggle').click()
  await page.waitForFunction(at => Number(new URL(location.href).searchParams.get('cursor')) > at, at)
  assert.equal(await page.getByTestId('play-toggle').getAttribute('aria-label'), 'Tạm dừng')
  const pane = await native.locator('[data-name="pane-widget-chart-gui-wrapper"]').first().boundingBox()
  await page.mouse.move(pane.x + pane.width * .55, pane.y + pane.height * .5)
  await page.mouse.down()
  await page.mouse.move(pane.x + pane.width * .75, pane.y + pane.height * .5, { steps: 12 })
  await page.mouse.up()
  const panned = await page.evaluate(() => window.__qaWidget.activeChart().getVisibleRange())
  assert.equal(await page.getByTestId('play-toggle').getAttribute('aria-label'), 'Tạm dừng', 'Pan must not stop playback')
  at = cursor()
  await page.waitForFunction(at => Number(new URL(location.href).searchParams.get('cursor')) > at, at)
  const advancedRange = await page.evaluate(() => window.__qaWidget.activeChart().getVisibleRange())
  assert.ok(Math.abs(advancedRange.from - panned.from) < 1 && Math.abs(advancedRange.to - panned.to) < 1, 'New bars must not recenter a panned chart')
  await native.getByText('3m', { exact: true }).first().click()
  await page.waitForFunction(() => window.__qaWidget.activeChart().resolution() === '3')
  assert.equal(await page.getByTestId('play-toggle').getAttribute('aria-label'), 'Tạm dừng', 'Native timeframe change must not stop playback')
  at = cursor()
  await page.waitForFunction(at => Number(new URL(location.href).searchParams.get('cursor')) > at, at)
  await page.getByTestId('play-toggle').click()
  checks.push('Playback continues across native pan and 1m → 3m timeframe change')

  await page.waitForFunction(() => !document.querySelector('.legacy-sync-toggle input').disabled)
  await page.getByRole('switch', { name: 'Đồng bộ khung replay với khung chart' }).check()
  await page.getByTestId('play-toggle').click()
  await native.getByText('5m', { exact: true }).first().click()
  await page.waitForFunction(() => window.__qaWidget.activeChart().resolution() === '5')
  assert.equal(await page.getByTestId('play-toggle').getAttribute('aria-label'), 'Tạm dừng')
  at = cursor()
  await page.waitForFunction(at => Number(new URL(location.href).searchParams.get('cursor')) > at, at)
  await page.getByTestId('play-toggle').click()
  checks.push('Synced timeframe change keeps Play active and advances at the new interval')

  await page.waitForFunction(() => !document.querySelector('.legacy-replay-previous').disabled)
  const pendingRead = page.waitForRequest(request => request.url().includes('advance_interval_seconds='))
  await page.getByTestId('play-toggle').click()
  await pendingRead
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Space')
  assert.equal(await page.getByTestId('play-toggle').getAttribute('aria-label'), 'Phát replay')
  checks.push('Space can pause playback while a historical read is in flight')

  await page.waitForFunction(() => !document.querySelector('.legacy-replay-previous').disabled)
  const oldCutoff = Number(await chart.getAttribute('data-cutoff'))
  const oldWidget = await page.evaluateHandle(() => window.__qaWidget)
  await page.getByRole('button', { name: 'Lùi một nến', exact: true }).click()
  await page.waitForFunction(old => Number(document.querySelector('.advanced-replay-chart')?.dataset.cutoff) < old, oldCutoff)
  await page.waitForFunction(() => document.querySelector('.advanced-replay-chart')?.dataset.chartStatus === 'ready')
  assert.equal(await page.evaluate(old => window.__qaWidget === old, oldWidget), false, 'Rewind restores a chart snapshot scoped to the earlier cutoff')
  assert.ok(await page.evaluate(() => window.__qaLastBar.time <= Number(document.querySelector('.advanced-replay-chart').dataset.cutoff) * 1000))
  checks.push('Rewind restores a safe earlier chart, without future bars')

  const before = await page.request.get(`http://127.0.0.1:5180/api/v2/replay/sessions/${session}/metadata`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  const metadata = await before.json()
  await page.getByTestId('replay-latest').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="replay-latest"]'))
  await page.waitForFunction(() => document.querySelector('.advanced-replay-chart')?.dataset.chartStatus === 'ready')
  assert.equal(cursor(), metadata.payload.cursor_index)
  checks.push('Compact return-to-latest control reaches the canonical cursor')
  // The existing audit flag disables activity logging for screenshots; the
  // timed journey above exercises the normal page with every write blocked.
  await page.goto(page.url() + '&demo=1')
  await page.waitForFunction(() => document.querySelector('.advanced-replay-chart')?.dataset.chartStatus === 'ready')
  for (const width of [360, 768, 1368]) {
    await page.setViewportSize({ width, height: 790 })
    await page.screenshot({ path: fileURLToPath(new URL(`width-${width}.png`, output)) })
    const toolbar = await page.locator('.legacy-replay-toolbar').boundingBox()
    assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= width + 1, `Replay toolbar fits ${width}px`)
  }
  checks.push('Replay toolbar fits 360, 768 and 1368px')
  const safeCutoff = await chart.getAttribute('data-cutoff')
  await page.route(new RegExp(`/replay/sessions/${session}\\?`), route => route.fulfill({ status: 503, json: { detail: 'Scoped QA read failure' } }), { times: 1 })
  await page.getByRole('button', { name: 'Lùi một nến', exact: true }).click()
  await page.locator('[data-resource-state="stale"]').waitFor()
  assert.equal(await chart.getAttribute('data-cutoff'), safeCutoff)
  assert.equal(await chart.getAttribute('data-chart-status'), 'ready')
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  checks.push('Failed historical read retains the last chart and locks stepping')
  assert.deepEqual(blocked.filter(value => !value.includes('/activity')), [])
  assert.deepEqual(errors, [])
}
const result = { phase, fullHistory, steps, probe, requests, errors, blocked, buttons, checks }
await writeFile(new URL('measurements.json', output), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ phase, steps: steps.map(Math.round), mounts: probe.mounts, errors, apiRequests: requests.length, checks }))
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', output)) }).catch(() => {})
  await writeFile(new URL('failure.json', output), JSON.stringify({ error: String(error), steps, requests, errors, blocked }, null, 2))
  throw error
} finally { await browser.close() }
