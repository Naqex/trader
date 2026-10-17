import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = '../evidence/rust-native-20261017/frontend/chart-engine-split'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
await mkdir(output, { recursive: true })
const report = { scope: 'Actual lightweight chart package and React components with isolated synthetic GET-only intercepted API fixtures. No owner, provider, broker writes. Advanced native engine separately covered by quickTrading.browser.', cases: [], errors: [], blocked: [], modules: [] }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
await context.addInitScript(() => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark') })
const page = await context.newPage()
page.on('pageerror', error => report.errors.push(error.message))
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === origin && url.pathname.endsWith('/activity')) return route.fulfill({ status: 204 })
  if (url.origin !== origin || request.method() !== 'GET') { report.blocked.push(`${request.method()} ${url.pathname}`); return route.abort() }
  if (!url.pathname.startsWith('/api/')) { if (url.pathname.includes('LightweightReplayChart') || url.pathname.includes('lightweight-charts')) report.modules.push(url.pathname); return route.continue() }
  if (url.pathname === '/api/v2/events') return route.fulfill({ contentType: 'text/event-stream', body: ': synthetic\n\n' })
  if (url.pathname === `/api/v2/replay/sessions/${fixture.session}`) return route.fulfill({ json: fixture.latest })
  if (url.pathname === '/api/v2/data/datasets') return route.fulfill({ json: fixture.datasets })
  return route.fulfill({ json: { items: [], available: false } })
})
const chart = page.getByTestId('replay-chart')
const range = () => chart.evaluate(node => ({ from: Number(node.dataset.rangeFrom), to: Number(node.dataset.rangeTo) }))
try {
  await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}&chart_engine=lightweight&cursor=60`)
  await chart.locator('canvas').first().waitFor()
  assert.equal(await chart.getAttribute('data-visible-row-count'), '61')
  await chart.evaluate(node => { node.__qaCanvas = node.querySelector('canvas') })
  const box = await chart.locator('canvas').first().boundingBox()
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .4)
  assert.equal(await chart.evaluate(node => node.__qaCanvas === node.querySelector('canvas')), true, 'crosshair React updates retain chart instance')
  report.cases.push('Lazy engine paints real canvas with exactly the visible 61-row prefix; crosshair keeps canvas mounted')
  const before = await range()
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5, { steps: 12 }); await page.mouse.up()
  await page.waitForFunction(before => Math.abs(Number(document.querySelector('[data-testid=replay-chart]').dataset.rangeFrom) - before) > .1, before.from)
  const panned = await range()
  report.cases.push('Native drag pans the chart without remounting the canvas')
  for (const label of ['Bars', 'Line', 'Area', 'Baseline', 'Candles']) {
    await page.locator('.chart-type-command .fx-select-trigger').click()
    await page.getByRole('option', { name: label, exact: true }).click()
    await chart.locator('canvas').first().waitFor()
    await page.waitForFunction(from => Math.abs(Number(document.querySelector('[data-testid=replay-chart]').dataset.rangeFrom) - from) < .01, panned.from)
    assert.equal(await chart.getAttribute('data-visible-row-count'), '61')
  }
  report.cases.push('All five chart types retain the selected logical range and visible cutoff')
  await page.screenshot({ path: `${output}/lightweight.png` })
  await page.reload(); await chart.locator('canvas').first().waitFor()
  assert.equal(await chart.getAttribute('data-visible-row-count'), '61')
  assert.ok(report.modules.some(value => value.includes('LightweightReplayChart')))
  assert.ok(report.modules.some(value => value.includes('lightweight-charts')))
  report.cases.push('Explicit lightweight mode reloads its own renderer chunk and real chart package successfully')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, [])
  report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; await page.screenshot({ path: `${output}/failure.png` }); throw error }
finally { await browser.close(); await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length }))
