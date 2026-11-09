import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [origin, output] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180', 'Use an isolated test server')
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const rows = fixture.latest.visible_rows
let canonical = 20, revision = fixture.latest.revision, steps = 0
const view = (cursor = canonical) => ({ ...structuredClone(fixture.latest), revision,
  dataset_sha256: null, canonical_cursor_index: canonical, view_cursor_index: cursor,
  historical_view: cursor < canonical, cutoff_timestamp: rows[cursor].timestamp,
  visible_row_start: 0, visible_row_count: cursor + 1, visible_rows: rows.slice(0, cursor + 1),
  has_future_rows: canonical < rows.length - 1, total_row_count: rows.length,
  payload: { ...fixture.latest.payload, cursor_index: cursor, execution: null } })
const report = { scope: 'Synthetic replay responses; real local Advanced Charts; no owner/API/broker writes', errors: [], blocked: [], checks: [] }
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
  await context.addInitScript(() => {
    localStorage.setItem('tw-language', 'vi')
    localStorage.setItem('tw-theme', 'dark')
    window.__continuity = { created: 0, removed: 0, blankFrames: 0, observe: false }
    document.addEventListener('load', event => {
      if (!event.target.src?.includes('charting_library.standalone.js')) return
      const Original = window.TradingView.widget
      window.TradingView.widget = function (...args) {
        window.__continuity.created++
        const widget = new Original(...args), remove = widget.remove.bind(widget)
        widget.remove = () => { window.__continuity.removed++; return remove() }
        return widget
      }
    }, true)
    const sample = () => {
      if (window.__continuity.observe) {
        const host = document.querySelector('.advanced-chart-host')
        let hidden = !host || host.hasAttribute('inert') || !host.querySelector('iframe')
        for (let node = host; node && !hidden; node = node.parentElement) {
          const style = getComputedStyle(node)
          hidden = style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 1
        }
        if (hidden || document.querySelector('[data-testid="chart-loading"]')) window.__continuity.blankFrames++
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { report.blocked.push(request.url()); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method() === 'POST' && url.pathname === `/api/v2/replay/sessions/${fixture.session}/step`) {
      const command = request.postDataJSON()
      assert.equal(command.expected_revision, revision)
      canonical = Math.min(rows.length - 1, canonical + command.steps)
      revision++; steps++
      await new Promise(resolve => setTimeout(resolve, 100))
      return route.fulfill({ json: view() })
    }
    if (request.method() !== 'GET') { report.blocked.push(`${request.method()} ${url.pathname}`); return route.abort() }
    let body = { items: [], available: false }
    if (url.pathname === `/api/v2/replay/sessions/${fixture.session}`) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const cursor = url.searchParams.has('cursor_index') ? Number(url.searchParams.get('cursor_index')) : canonical
      const interval = Number(url.searchParams.get('advance_interval_seconds') || 0)
      body = view(Math.min(canonical, cursor + Math.floor(interval / 60)))
    } else if (url.pathname === '/api/v2/data/datasets') body = fixture.datasets
    else if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
    return route.fulfill({ json: body })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&area=testing&surface=workspace&session=${fixture.session}`)
  const chart = page.getByTestId('replay-chart')
  await page.locator('[data-chart-engine=advanced][data-chart-status=ready]').waitFor({ timeout: 30000 })
  let frame = await page.locator('.advanced-chart-host iframe').elementHandle()
  await page.evaluate(() => { window.__continuity.observe = true })
  await page.screenshot({ path: `${output}/before.png` })
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('step-1').click()
    await page.waitForFunction(cutoff => document.querySelector('[data-testid="replay-chart"]').dataset.cutoff === String(cutoff), rows[21 + i].timestamp)
    report.checks.push({ step: i + 1, lifecycle: await page.evaluate(() => window.__continuity) })
  }
  report.checks.push('three forward steps')
  assert.deepEqual(await page.evaluate(() => [window.__continuity.created, window.__continuity.removed, window.__continuity.blankFrames]), [1, 0, 0])
  assert.equal(await frame.evaluate(node => node === document.querySelector('.advanced-chart-host iframe')), true)
  // Rewind intentionally rebuilds the native layout to exclude later drawings.
  // It must rebuild once, rather than on every subsequent forward cutoff.
  await page.evaluate(() => { window.__continuity.observe = false })
  await page.getByRole('button', { name: 'Lùi một nến', exact: true }).click()
  await page.waitForFunction(cutoff => document.querySelector('[data-testid="replay-chart"]').dataset.cutoff === String(cutoff), rows[22].timestamp)
  assert.equal(await chart.getAttribute('data-visible-row-count'), '23')
  await page.locator('[data-chart-engine=advanced][data-chart-status=ready]').waitFor()
  assert.equal(await frame.evaluate(node => node.isConnected), false)
  frame = await page.locator('.advanced-chart-host iframe').elementHandle()
  await page.evaluate(() => { window.__continuity.observe = true })
  report.checks.push('backward cutoff hides the later candle')
  report.checks.push({ rewind: await page.evaluate(() => window.__continuity) })
  await page.getByTestId('step-1').click()
  await page.waitForFunction(cutoff => document.querySelector('[data-testid="replay-chart"]').dataset.cutoff === String(cutoff), rows[23].timestamp)
  await page.getByTestId('play-toggle').click()
  await page.waitForFunction(cutoff => Number(document.querySelector('[data-testid="replay-chart"]').dataset.cutoff) >= cutoff, rows[27].timestamp)
  await page.getByTestId('play-toggle').click()
  await page.getByTestId('step-1').waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled)
  report.checks.push('autoplay and pause')
  report.lifecycle = await page.evaluate(() => window.__continuity)
  assert.equal(await frame.evaluate(node => node === document.querySelector('.advanced-chart-host iframe')), true)
  assert.deepEqual([report.lifecycle.created, report.lifecycle.removed, report.lifecycle.blankFrames], [2, 1, 0])
  assert.deepEqual(report.errors, [])
  assert.equal(report.blocked.filter(path => !path.endsWith('/activity')).length, 0)
  await page.screenshot({ path: `${output}/after.png` })
  report.steps = steps; report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report))
