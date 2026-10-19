import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Real local transport/domain/UI. Only this newly-created fixture can mutate.
const api = 'http://127.0.0.1:8010', ui = 'http://127.0.0.1:5180', workspace = 'tenant-a'
const dataset = 'dataset-cf6f34c36ef44bfb76fe32e7b9d7d01c00bba077154767411ec747777568316c'
const output = process.env.QUICK_TRADING_OUTPUT || '../evidence/quick-trading-20261016/live'
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
  report.requests = []
  let historyReads = 0
  page.on('request', req => { if (req.method() === 'GET' && /chart-window|\/bars/.test(req.url())) historyReads++ })
  page.on('requestfinished', req => {
    if (req.method() !== 'POST' || !req.url().includes('/orders/')) return
    const timing = req.timing()
    report.requests.push({ endpoint: new URL(req.url()).pathname.split('/').at(-1),
      responseMs: Math.round(timing.responseStart), totalMs: Math.round(timing.responseEnd) })
  })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${ui}/?workspace=${workspace}&view=replay&surface=workspace&session=${record.record_id}`)
  await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const frame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await page.locator('.legacy-quantity-control input').fill('0.12')
  await page.evaluate(() => document.addEventListener('click', event => {
    if (event.target.closest('button.buy, button.sell')) { window.__qaClick = performance.now(); window.__qaPaint = 0; window.__qaConfirmedPaint = 0 }
  }, true))
  await frame.evaluate(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-order-kind=entry]')?.textContent.includes('Đang gửi')) requestAnimationFrame(() => {
        if (!parent.__qaPaint) parent.__qaPaint = parent.performance.now()
      })
      const entry = document.querySelector('[data-order-kind=entry]')
      if (entry?.textContent.includes('USD') && !entry.textContent.includes('Đang gửi')) requestAnimationFrame(() => {
        if (!parent.__qaConfirmedPaint) parent.__qaConfirmedPaint = parent.performance.now()
      })
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  for (const side of ['Mua', 'Bán', 'Mua', 'Bán']) {
    const response = page.waitForResponse(r => r.url().includes(path + '/orders/') && /\/(quick|market)$/.test(r.url()) && r.request().method() === 'POST')
    await page.getByRole('button', { name: side, exact: true }).click()
    const confirmed = await response
    assert.equal(confirmed.status(), 200)
    await frame.locator('[data-order-kind=entry]').filter({ hasText: 'USD' }).waitFor()
    await page.waitForFunction(() => window.__qaConfirmedPaint > 0)
    const timing = await page.evaluate(() => ({ pendingPaintMs: window.__qaPaint ? Number((window.__qaPaint - window.__qaClick).toFixed(2)) : null, confirmedPaintMs: Number((window.__qaConfirmedPaint - window.__qaClick).toFixed(2)), confirmedUiMs: Number((performance.now() - window.__qaClick).toFixed(2)) }))
    report.samples.push({ side, ...timing, responseStatus: confirmed.status() })
    const filled = await request(path)
    assert.equal(filled.payload.cursor_index, record.payload.cursor_index, 'Quick entry must not advance replay')
    assert.equal(filled.payload.execution.position.side, side === 'Mua' ? 'BUY' : 'SELL')
    assert.equal(filled.payload.execution.pending_market_order, null)
    if (side === 'Bán') {
      await page.screenshot({ path: `${output}/sell-entry.png` })
      await frame.getByRole('button', { name: 'Chỉnh sửa vị thế', exact: true }).click()
      const edit = page.locator('.legacy-order-modal')
      await edit.getByRole('heading', { name: 'Chỉnh sửa vị thế', exact: true }).waitFor()
      assert.equal(await edit.getByRole('switch').count(), 2)
      assert.equal(await edit.getByRole('button', { name: 'Không có thay đổi', exact: true }).isDisabled(), true)
      await page.screenshot({ path: `${output}/edit-position.png` })
      await edit.getByRole('button', { name: 'Hủy', exact: true }).click()
      if (!report.sellProtection) {
        const range = await page.evaluate(() => window.__qaLiveChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange())
        const iframe = await page.locator('.advanced-chart-host iframe').elementHandle()
        const readsBefore = historyReads, postsBefore = report.requests.length
        await frame.evaluate(() => {
          window.__qaFrames = []; window.__qaMeasuring = true
          let last
          const sample = now => { if (!window.__qaMeasuring) return; if (last) window.__qaFrames.push(now - last); last = now; requestAnimationFrame(sample) }
          requestAnimationFrame(sample)
        })
        const dragTo = async (kind, price, screenshot) => {
          const box = await frame.locator(`[data-order-drag=${kind}]`).boundingBox()
          const pane = await frame.locator('td.chart-markup-table.pane div.chart-gui-wrapper').boundingBox()
          const y = pane.y + pane.height * (range.to - price) / (range.to - range.from)
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
          await page.mouse.move(box.x + box.width / 2, y, { steps: 12 })
          if (screenshot) {
            const style = await frame.locator(`[data-order-drag=${kind}]`).evaluate(node => ({ outline: getComputedStyle(node).outlineWidth, border: getComputedStyle(node).borderTopWidth }))
            assert.deepEqual(style, { outline: '0px', border: '1px' }, 'Pointer drag has one border')
            await page.screenshot({ path: `${output}/${screenshot}.png` })
          }
          await page.mouse.up()
        }
        // Invalid SELL TP above the closeable ask must stay local.
        await dragTo('target', range.to - (range.to - range.from) * .15)
        assert.equal(report.requests.length, postsBefore)
        const entry = Number(filled.payload.execution.position.entry_fill)
        const target = Math.max(range.from + (range.to - range.from) * .06, entry - .00035)
        const stop = Math.min(range.to - (range.to - range.from) * .06, entry + .00055)
        for (const [kind, price] of [['target', target], ['stop', stop]]) {
          const saved = page.waitForResponse(r => r.url().endsWith(path + '/orders/protection') && r.request().method() === 'POST')
          await dragTo(kind, price, `sell-${kind}-drag`)
          assert.equal((await saved).status(), 200)
          await frame.waitForFunction(() => !document.querySelector('[data-order-drag=stop]').disabled)
          assert.deepEqual(await page.evaluate(() => window.__qaLiveChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange()), range)
        }
        const frames = await frame.evaluate(() => { window.__qaMeasuring = false; return window.__qaFrames })
        assert.equal(await iframe.evaluate(node => node.isConnected), true, 'Mutation keeps the native iframe mounted')
        assert.equal(historyReads, readsBefore, 'Protection does not reread chart history')
        const saved = (await request(path)).payload.execution.position
        assert.ok(Number(saved.take_profit) < entry && Number(saved.stop_loss) > entry)
        report.sellProtection = { target: saved.take_profit, stop: saved.stop_loss, historyReads: historyReads - readsBefore,
          iframeRetained: true, scaleRetained: true, invalidDragSent: false,
          frameIntervals: frames.length, maxFrameMs: Math.round(Math.max(...frames)), over32ms: frames.filter(ms => ms > 32).length }
        await page.mouse.move(500, 500)
        await page.screenshot({ path: `${output}/sell-protected.png` })
      }
    }
    await frame.locator('.wm-order-marker-close').click()
    const dialog = page.locator('.chart-order-close-dialog')
    await dialog.locator('button.is-destructive').click()
    await frame.locator('[data-order-kind=entry]').waitFor({ state: 'hidden' })
  }
  // The full order form must submit through the real service as well.
  await page.locator('.chart-utility-actions').getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
  const orderDialog = page.locator('.legacy-order-modal')
  await orderDialog.waitFor()
  await orderDialog.getByRole('spinbutton', { name: 'Khối lượng lệnh', exact: true }).fill('0.08')
  const formProtections = await orderDialog.locator('[data-protection] .legacy-order-grid label:first-child input').evaluateAll(nodes => nodes.map(node => Number(node.value)))
  assert.equal(formProtections.length, 2)
  const formSave = page.waitForResponse(r => r.url().endsWith(path + '/orders/market') && r.request().method() === 'POST')
  await orderDialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  assert.equal((await formSave).status(), 200)
  await orderDialog.waitFor({ state: 'detached' })
  const fromForm = await request(path)
  assert.equal(Number(fromForm.payload.execution.position.quantity), .08)
  assert.equal(Number(fromForm.payload.execution.position.stop_loss), formProtections[0])
  assert.equal(Number(fromForm.payload.execution.position.take_profit), formProtections[1])
  await frame.locator('.wm-order-marker-close').click()
  await page.locator('.chart-order-close-dialog button.is-destructive').click()
  await frame.locator('[data-order-kind=entry]').waitFor({ state: 'hidden' })
  assert.equal((await request(path)).payload.execution.pending_market_order, null)
  report.orderDialog = { saved: true, quantity: .08, stop: formProtections[0], target: formProtections[1], closed: true }
  // Market entry fills at the visible quote; amend its protection in the iframe.
  await page.getByRole('button', { name: 'Mua', exact: true }).click()
  await frame.locator('[data-order-kind=entry]').filter({ hasText: 'USD' }).waitFor()
  const before = await request(path)
  record = before
  assert.ok(record.payload.execution.position, 'Current-quote fill occurs without stepping replay')
  await page.goto(`${ui}/?workspace=${workspace}&view=replay&surface=workspace&session=${record.record_id}`); await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const positionFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  const handle = positionFrame.locator('[data-order-drag=stop]')
  await handle.waitFor()
  const box = await handle.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  const visible = await page.evaluate(() => window.__qaLiveChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange())
  const currentPrice = Number(record.visible_rows.at(-1).close)
  const wanted = Math.max(visible.from + (visible.to - visible.from) * .1, Math.min(Number(record.payload.execution.position.entry_fill), currentPrice) - .0004)
  const paneBox = await positionFrame.locator('td.chart-markup-table.pane div.chart-gui-wrapper').boundingBox()
  const destinationY = paneBox.y + paneBox.height * (visible.to - wanted) / (visible.to - visible.from)
  report.protectionAttempt = { currentPrice, entry: record.payload.execution.position.entry_fill, wanted, y, destinationY, visible }
  const protection = page.waitForResponse(r => r.url().endsWith(path + '/orders/protection') && r.request().method() === 'POST')
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, destinationY, { steps: 8 }); await page.mouse.up()
  assert.equal((await protection).status(), 200)
  await positionFrame.waitForFunction(() => !document.querySelector('[data-order-drag=stop]').disabled)
  report.scaleAfterProtection = await page.evaluate(() => window.__qaLiveChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange())
  assert.deepEqual(report.scaleAfterProtection, visible, 'Saving protection must not rescale or jump the chart')
  const amended = await request(path)
  assert.ok(Number(amended.payload.execution.position.stop_loss) < Number(amended.payload.execution.position.entry_fill))
  await page.reload(); await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const restoredFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await restoredFrame.locator('[data-order-kind=stop][data-ghost=false]').waitFor()
  await page.screenshot({ path: `${output}/real-position.png` })
  report.protection = { persistedAfterReload: true, stop: amended.payload.execution.position.stop_loss, revision: amended.revision }
  await restoredFrame.locator('.wm-order-marker-close').click()
  await page.locator('.chart-order-close-dialog button.is-destructive').click()
  await restoredFrame.locator('[data-order-kind=entry]').waitFor({ state: 'hidden' })
  const closed = await request(path)
  assert.equal(closed.payload.execution.position, null)
  assert.ok(closed.payload.execution.ledger.some(event => event.kind === 'manual_close' || event.type === 'manual_close'), 'Manual close is recorded in the actual ledger')
  report.positionClose = { confirmed: true, balance: closed.payload.execution.balance, ledgerEvents: closed.payload.execution.ledger.length }
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
