import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Real local transport/domain/UI. Only this newly-created fixture can mutate.
const api = 'http://127.0.0.1:8010', ui = 'http://127.0.0.1:5180', workspace = 'tenant-a'
const dataset = 'dataset-cf6f34c36ef44bfb76fe32e7b9d7d01c00bba077154767411ec747777568316c'
const output = '../evidence/quick-trading-20261016/live'
await mkdir(output, { recursive: true })
const report = { scope: 'Real local Axum/PostgreSQL/Python and native Advanced Charts; new disposable replay on existing 134 MiB dataset, no owner-session mutations or broker access.', samples: [], errors: [] }
const request = async (path, body) => {
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const json = await response.json()
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(json)}`)
  return json
}
let record, browser
try {
  record = await request('/api/v2/replay/sessions', { dataset_id: dataset, name: `QA quick trading ${Date.now()}`, starting_balance: '100000' })
  report.session = record.record_id
  const path = `/api/v2/replay/sessions/${record.record_id}`
  record = await request(path + '/step', { expected_revision: record.revision, steps: 60 })
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1368, height: 790 }, reducedMotion: 'reduce' })
  await context.addInitScript(() => {
    localStorage.setItem('tw-language', 'vi')
    document.addEventListener('load', event => {
      if (!event.target.src?.includes('charting_library.standalone.js')) return
      const Original = window.TradingView.widget
      window.TradingView.widget = function (...args) {
        const widget = new Original(...args)
        widget.onChartReady(() => { window.__qaLiveChart = widget.activeChart() })
        return widget
      }
    }, true)
  })
  await context.route('**/*', route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== ui && !['blob:', 'data:', 'about:'].includes(url.protocol)) return route.abort()
    if (url.pathname.startsWith('/api/') && req.method() !== 'GET' && !url.pathname.startsWith(path + '/orders/')) return route.abort()
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${ui}/?workspace=${workspace}&view=replay&surface=workspace&session=${record.record_id}`)
  await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const frame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await page.locator('.legacy-quantity-control input').fill('0.12')
  await page.evaluate(() => document.addEventListener('click', event => {
    if (event.target.closest('button.buy, button.sell')) { window.__qaClick = performance.now(); window.__qaPaint = 0 }
  }, true))
  await frame.evaluate(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-order-kind=entry]')?.textContent.includes('Đang gửi')) requestAnimationFrame(() => {
        if (!parent.__qaPaint) parent.__qaPaint = parent.performance.now()
      })
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  for (const side of ['Mua', 'Bán', 'Mua', 'Bán']) {
    const response = page.waitForResponse(r => r.url().includes(path + '/orders/') && /\/(quick|market)$/.test(r.url()) && r.request().method() === 'POST')
    await page.getByRole('button', { name: side, exact: true }).click()
    const confirmed = await response
    assert.equal(confirmed.status(), 200)
    await frame.locator('[data-order-kind=entry]').filter({ hasText: 'Chờ khớp' }).waitFor()
    const timing = await page.evaluate(() => ({ pendingPaintMs: window.__qaPaint ? Number((window.__qaPaint - window.__qaClick).toFixed(2)) : null, confirmedUiMs: Number((performance.now() - window.__qaClick).toFixed(2)) }))
    report.samples.push({ side, ...timing, responseStatus: confirmed.status() })
    await frame.locator('.wm-order-marker-close').click()
    const dialog = page.locator('.chart-order-close-dialog')
    await dialog.locator('button.is-destructive').click()
    await frame.locator('[data-order-kind=entry]').waitFor({ state: 'hidden' })
  }
  // Fill one order, then amend its protection through the actual iframe handle.
  await page.getByRole('button', { name: 'Mua', exact: true }).click()
  await frame.locator('[data-order-kind=entry]').filter({ hasText: 'Chờ khớp' }).waitFor()
  const before = await request(path)
  record = await request(path + '/step', { expected_revision: before.revision, steps: 1 })
  assert.ok(record.payload.execution.position, 'Next-bar fill occurs in the actual engine')
  await page.goto(`${ui}/?workspace=${workspace}&view=replay&surface=workspace&session=${record.record_id}`); await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const positionFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  const handle = positionFrame.locator('[data-order-drag=stop]')
  await handle.waitFor()
  const box = await handle.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  const visible = await page.evaluate(() => window.__qaLiveChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange())
  const currentPrice = Number(record.visible_rows.at(-1).close)
  const wanted = Math.min(Number(record.payload.execution.position.entry_fill), currentPrice) - .001
  const paneBox = await positionFrame.locator('td.chart-markup-table.pane div.chart-gui-wrapper').boundingBox()
  const destinationY = paneBox.y + paneBox.height * (visible.to - wanted) / (visible.to - visible.from)
  report.protectionAttempt = { currentPrice, entry: record.payload.execution.position.entry_fill, wanted, y, destinationY, visible }
  const protection = page.waitForResponse(r => r.url().endsWith(path + '/orders/protection') && r.request().method() === 'POST')
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, destinationY, { steps: 8 }); await page.mouse.up()
  assert.equal((await protection).status(), 200)
  await positionFrame.waitForFunction(() => !document.querySelector('[data-order-drag=stop]').disabled)
  const amended = await request(path)
  assert.ok(Number(amended.payload.execution.position.stop_loss) < Number(amended.payload.execution.position.entry_fill))
  await page.reload(); await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const restoredFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await restoredFrame.locator('[data-order-kind=stop][data-ghost=false]').waitFor()
  await page.screenshot({ path: `${output}/real-position.png` })
  report.protection = { persistedAfterReload: true, stop: amended.payload.execution.position.stop_loss, revision: amended.revision }
  assert.deepEqual(report.errors, [])
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack
  const failed = browser?.contexts()[0]?.pages()[0]
  if (failed) {
    report.url = failed.url(); report.uiText = (await failed.locator('body').innerText()).slice(-10000)
    report.chart = await failed.locator('[data-chart-status]').getAttribute('data-chart-status').catch(() => null)
    report.markerDocs = []
    for (const frame of failed.frames()) report.markerDocs.push({ url: frame.url().slice(0, 150), markers: await frame.locator('[data-order-kind]').count() })
    await failed.screenshot({ path: `${output}/failure.png` })
  }
  throw error
}
finally {
  await browser?.close()
  if (record) {
    const current = await request(`/api/v2/replay/sessions/${record.record_id}`)
    report.cleanup = await request(`/api/v2/replay/sessions/${record.record_id}/delete`, { expected_revision: current.revision, confirmation_name: current.payload.name })
  }
  await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
