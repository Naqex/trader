import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.env.QUICK_TRADING_OUTPUT || '../evidence/quick-trading-20261016/redesign'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const spec = fixture.datasets.items[0].instrument_spec
const initialExecution = { cursor_index: 60, instrument_spec: spec, cost_model: { account_ccy: 'USD' }, spread_price: '0.0002', balance: '10000', equity: '10000', floating_pl: '0', position: null, pending_market_order: null, ledger: [] }
let replay = { ...fixture.latest, dataset_sha256: null, has_future_rows: true, payload: { ...fixture.latest.payload, execution: null, starting_balance: '10000', starting_balance_ccy: 'USD' } }
const report = { scope: 'Synthetic API intercepts only; real native chart and controls. Real iframe DOM drag controls; native line state observed via test-only proxy. No owner, provider or broker writes.', cases: [], requests: [], errors: [], unexpected: [] }
let nextMutation
function holdMutation(fail = false) {
  let release
  const wait = new Promise(resolve => { release = resolve })
  nextMutation = { wait, fail }
  return release
}
const browser = await chromium.launch()
await mkdir(output, { recursive: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
await context.addInitScript(workspace => {
  localStorage.setItem('tw-language', 'vi')
  // Keep the movable replay toolbar clear of the fixture's equal-price labels.
  localStorage.setItem(`tw:chart:replay-toolbar:native-refined:${workspace}`, JSON.stringify({ x: 70, y: 60 }))
  document.addEventListener('load', event => {
    if (!event.target.src?.includes('charting_library.standalone.js')) return
    const Original = window.TradingView.widget
    window.TradingView.widget = function (...args) {
      const widget = new Original(...args)
      window.__qaLines = []
      widget.onChartReady(() => {
        const chart = widget.activeChart(), create = chart.createOrderLine.bind(chart)
        window.__qaChart = chart
        chart.createOrderLine = (...args) => {
          const native = create(...args)
          const record = { native, removed: false }
          window.__qaLines.push(record)
          const proxy = new Proxy(native, { get(target, key) {
            if (typeof target[key] !== 'function') return target[key]
            return (...values) => {
              if (key === 'onMove' || key === 'onCancel') record[key] = values.at(-1)
              if (['setTooltip', 'setLineColor', 'setLineStyle', 'setText', 'setPrice', 'setQuantity', 'setCancellable', 'setEditable'].includes(key)) record[key] = values[0]
              if (key === 'setPrice') record.setPriceCalls = (record.setPriceCalls || 0) + 1
              if (key === 'remove') record.removed = true
              const result = target[key](...values)
              return result === target ? proxy : result
            }
          } })
          return proxy
        }
      })
      return widget
    }
  }, true)
}, fixture.workspace)
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== origin) { report.unexpected.push(request.url()); return route.abort() }
  if (!url.pathname.startsWith('/api/')) return route.continue()
  if (url.pathname.endsWith('/activity')) return route.abort()
  if (request.method() === 'GET') {
    if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
    return route.fulfill({ json: url.pathname === `/api/v2/replay/sessions/${fixture.session}` ? replay : url.pathname === '/api/v2/data/datasets' ? fixture.datasets : { items: [], available: false } })
  }
  const body = request.postDataJSON()
  report.requests.push({ path: url.pathname, body })
  const held = nextMutation; nextMutation = null
  if (held) {
    await held.wait
    if (held.fail) return route.fulfill({ status: 422, json: { detail: 'Fixture rejected protection' } })
  }
  assert.equal(body.expected_revision, replay.revision)
  const suffix = url.pathname.split('/').at(-1)
  let execution = replay.payload.execution
  if (suffix === 'execution') execution = structuredClone(initialExecution)
  else if (suffix === 'quick' || suffix === 'market') {
    assert.equal(body.execution_timing, 'current_quote')
    const quote = replay.visible_rows.at(-1).close + (body.side === 'BUY' ? .0001 : -.0001)
    execution = { ...(execution || structuredClone(initialExecution)), pending_market_order: null,
      position: { ...body, position_id: 'fixture-position', entry_fill: String(quote), opened_time_utc: fixture.latest.cutoff_timestamp } }
  }
  else if (suffix === 'protection') {
    const key = execution.position ? 'position' : 'pending_market_order'
    execution = { ...execution, [key]: { ...execution[key], stop_loss: body.stop_loss, take_profit: body.take_profit } }
  } else if (suffix === 'close') execution = { ...execution, position: null, pending_market_order: null, floating_pl: '0' }
  else { report.unexpected.push(`${request.method()} ${url.pathname}`); return route.abort() }
  replay = { ...replay, revision: replay.revision + (suffix === 'quick' ? 2 : 1), payload: { ...replay.payload, execution } }
  return route.fulfill({ json: replay })
})
const page = await context.newPage()
page.on('pageerror', error => report.errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') (report.consoleErrors ??= []).push(message.text()) })
const href = `${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`
const ready = () => page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
let chartFrame
const marker = kind => chartFrame.locator(`[data-order-kind=${kind}]`)
const waitRequests = async count => {
  chartFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await marker('entry').waitFor({ state: 'visible' })
  await page.waitForFunction(count => window.__qaLines?.filter(item => !item.removed).length === count && !document.querySelector('.legacy-trading-bar button.buy').disabled === false, count)
  await chartFrame.waitForFunction(() => !document.querySelector('[data-order-drag=stop]').disabled)
}

async function dragOrderHandle(label, deltaY, cancel = false) {
  const handle = chartFrame.getByRole('button', { name: label, exact: true })
  await handle.waitFor({ state: 'visible' })
  const box = await handle.boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  const before = await page.evaluate(() => ({ at: performance.now(), lines: window.__qaLines.length, updates: window.__qaLines.reduce((sum, item) => sum + (item.setPriceCalls || 0), 0) }))
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x, y + deltaY, { steps: 8 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  const after = await page.evaluate(() => ({ at: performance.now(), lines: window.__qaLines.length, updates: window.__qaLines.reduce((sum, item) => sum + (item.setPriceCalls || 0), 0) }))
  assert.equal(after.lines, before.lines, 'Drag reuses native lines instead of recreating them')
  report.performance ??= []
  report.performance.push({ label, durationMs: Number((after.at - before.at).toFixed(2)), previewUpdates: after.updates - before.updates })
}
async function closeEntry({ dismiss = false } = {}) {
  chartFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  const before = report.requests.length
  await marker('entry').locator('.wm-order-marker-close').click()
  const dialog = page.locator('.chart-order-close-dialog')
  await dialog.waitFor({ state: 'visible' })
  assert.equal(report.requests.length, before, 'X opens a confirmation without sending a close')
  if (dismiss) {
    await page.screenshot({ path: `${output}/close-confirmation.png` })
    await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(report.requests.length, before)
    return
  }
  await dialog.locator('button.is-destructive').click()
  await dialog.waitFor({ state: 'detached' })
  await marker('entry').waitFor({ state: 'hidden' })
  assert.equal(report.requests.length, before + 1)
  return report.requests.at(-1)
}
async function markerState() {
  return chartFrame.locator('[data-order-kind]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const body = node.querySelector('.wm-order-marker-body'), rect = node.getBoundingClientRect()
    return [node.dataset.orderKind, { text: node.querySelector('.wm-order-marker-text').textContent, quantity: node.querySelector('.wm-order-marker-quantity').textContent, quantityHidden: node.querySelector('.wm-order-marker-quantity').hidden, title: body.title, ghost: node.dataset.ghost === 'true', color: node.style.getPropertyValue('--order-color'), y: rect.y, left: rect.left, right: rect.right, cursor: getComputedStyle(body).cursor }]
  })))
}
async function preset({ stop, target, unit = 'pips', value = '15' }) {
  await page.locator('.legacy-scalper-button').click()
  const form = page.locator('.legacy-scalper-settings')
  for (const [i, enabled] of [stop, target].entries()) {
    const group = form.locator('fieldset').nth(i)
    await group.getByRole('switch').setChecked(enabled)
    if (enabled) { await group.locator('input[type=number]').fill(value); await group.getByRole('button', { name: unit === 'pips' ? 'Pips' : '%', exact: true }).click() }
  }
  await form.locator('.legacy-scalper-save').click()
  await form.waitFor({ state: 'detached' })
}
try {
  await page.goto(href); await ready()
  await preset({ stop: true, target: false })
  await page.reload(); await ready()
  await page.locator('.legacy-scalper-button').click()
  assert.equal(await page.locator('.legacy-scalper-settings fieldset').nth(0).getByRole('switch').isChecked(), true)
  assert.equal(await page.locator('.legacy-scalper-settings fieldset').nth(1).getByRole('switch').isChecked(), false)
  await page.keyboard.press('Escape')
  await preset({ stop: false, target: false })
  report.cases.push('Enabled Scalper preset saves without errors and restores independent legs after reload; disabling both clears the preset')
  await page.locator('.legacy-quantity-control input').fill('0.12')
  chartFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await page.evaluate(() => document.addEventListener('click', event => {
    if (event.target.closest('button.buy')) window.__qaClick = performance.now()
  }, { capture: true }))
  await chartFrame.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-order-kind=entry]')?.textContent.includes('Đang gửi')) requestAnimationFrame(() => {
        if (!parent.__qaPendingPaint) parent.__qaPendingPaint = parent.performance.now()
      })
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  const releaseBuy = holdMutation()
  await page.getByRole('button', { name: 'Mua', exact: true }).dblclick()
  await marker('entry').filter({ hasText: 'Đang gửi' }).waitFor()
  assert.equal(await marker('target').locator('button').isDisabled(), true)
  assert.equal(await marker('entry').locator('.wm-order-marker-close').isVisible(), false)
  await page.waitForFunction(() => window.__qaPendingPaint > 0)
  report.clickToPendingPaintMs = await page.evaluate(() => Number((window.__qaPendingPaint - window.__qaClick).toFixed(2)))
  releaseBuy()
  assert.equal(report.requests.length, 1)
  await waitRequests(3)
  const defaultLinePrices = await page.evaluate(() => window.__qaLines.filter(item => !item.removed && item.setPrice !== undefined).map(item => item.setPrice))
  assert.equal(new Set(defaultLinePrices.map(String)).size, 1, 'Unset SL/TP preview lines stay on the entry level by default')
  assert.equal(report.requests[0].path.endsWith('/orders/quick'), true)
  assert.equal(report.requests[0].body.expected_revision, fixture.latest.revision)
  assert.equal(report.requests[0].body.quantity, '0.12')
  assert.equal(report.requests[0].body.stop_loss, null)
  assert.equal(report.requests[0].body.take_profit, null)
  assert.equal(await page.locator('.legacy-order-modal').count(), 0)
  assert.equal(await page.locator('.legacy-quantity-control input').inputValue(), '0.12')
  assert.equal(replay.revision, fixture.latest.revision + 2)
  report.cases.push('First quick Buy initializes and fills at current quote in one browser request, preserving revisions; double click cannot duplicate, no dialog or implicit protections')
  const stop = Number((fixture.latest.visible_rows.at(-1).close - .002).toFixed(5))
  let initial = await markerState()
  assert.equal(initial.stop.text, 'SL'); assert.equal(initial.target.text, 'TP')
  assert.equal(initial.stop.y, initial.entry.y); assert.equal(initial.target.y, initial.entry.y)
  assert.ok(initial.target.right <= initial.stop.left && initial.stop.right < initial.entry.left, 'Default TP/SL touch without overlapping; Entry stays separate')
  assert.equal(initial.entry.color, '#089981')
  assert.equal(initial.stop.cursor, 'grab')
  assert.equal(await marker('entry').locator('[data-order-drag]').count(), 0, 'Entry is read-only')
  const cancelledBefore = report.requests.length
  await dragOrderHandle('Kéo Stop loss', 30, true)
  assert.equal(report.requests.length, cancelledBefore)
  assert.equal((await markerState()).stop.text, 'SL')
  assert.equal(await page.evaluate(() => window.__qaLines.find(item => !item.removed && item.setTooltip === 'Stop loss').setLineColor), '#F59E0B')
  await dragOrderHandle('Kéo Stop loss', -50)
  assert.equal(report.requests.length, cancelledBefore, 'Invalid BUY SL is local only')
  assert.equal(await page.evaluate(() => window.__qaLines.find(item => !item.removed && item.setTooltip === 'Stop loss').setLineColor), '#F59E0B')
  const releaseFailure = holdMutation(true)
  await dragOrderHandle('Kéo Stop loss', 80)
  await chartFrame.waitForFunction(() => document.querySelector('[data-order-drag=stop]').disabled)
  releaseFailure()
  await chartFrame.waitForFunction(() => !document.querySelector('[data-order-drag=stop]').disabled)
  assert.equal((await markerState()).stop.text, 'SL', 'Rejected change restores the ghost')
  assert.equal(await page.evaluate(() => window.__qaLines.find(item => !item.removed && item.setTooltip === 'Stop loss').setLineColor), '#F59E0B')
  const beforeMove = report.requests.length
  const releaseStop = holdMutation()
  await dragOrderHandle('Kéo Stop loss', 90)
  await chartFrame.waitForFunction(() => document.querySelector('[data-order-drag=stop]').disabled)
  const waiting = await markerState()
  assert.ok(waiting.stop.y > waiting.entry.y && !waiting.stop.ghost)
  await page.waitForTimeout(220)
  assert.equal((await markerState()).stop.y, waiting.stop.y, 'Preview remains while response is withheld')
  assert.equal(await page.evaluate(() => window.__qaLines.find(item => !item.removed && item.setTooltip === 'Stop loss').setPrice), Number(report.requests.at(-1).body.stop_loss))
  releaseStop()
  await chartFrame.waitForFunction(() => !document.querySelector('[data-order-drag=stop]').disabled)
  assert.equal(report.requests.length, beforeMove + 1)
  assert.ok(Number(report.requests.at(-1).body.stop_loss) < replay.visible_rows.at(-1).close)
  assert.equal(replay.payload.execution.position.take_profit, null)
  await marker('stop').locator('[data-order-drag]').focus()
  await page.keyboard.press('Delete')
  await chartFrame.waitForFunction(() => document.querySelector('[data-order-kind=stop]').dataset.ghost === 'true' && !document.querySelector('[data-order-drag=stop]').disabled)
  assert.equal(report.requests.at(-1).body.stop_loss, null)
  await closeEntry({ dismiss: true })
  await page.screenshot({ path: `${output}/queued-ghosts.png` })
  await closeEntry()
  await page.getByRole('button', { name: 'Bán', exact: true }).waitFor({ state: 'visible' })
  await preset({ stop: true, target: false })
  await page.getByRole('button', { name: 'Bán', exact: true }).click()
  await waitRequests(3)
  const sell = report.requests.at(-1).body
  assert.equal(sell.side, 'SELL')
  assert.equal(sell.quantity, '0.12')
  const close = fixture.latest.visible_rows.at(-1).close
  assert.ok(Math.abs(Number(sell.stop_loss) - (close - .0001 + .0015)) < .000011)
  assert.equal(sell.take_profit, null)
  const presetLinePrice = await page.evaluate(() => window.__qaLines.find(item => !item.removed && item.setTooltip === 'Stop loss')?.setPrice)
  assert.equal(String(presetLinePrice), String(sell.stop_loss), 'Scalper preset stop is reflected on the native chart line')
  const protectionBeforeDrag = report.requests.length
  const protectionRequest = page.waitForRequest(request => request.url().endsWith('/orders/protection')).catch(() => null)
  await dragOrderHandle('Kéo Take profit', 90)
  const draggedRequest = await protectionRequest
  assert.ok(draggedRequest, 'Valid iframe TP drag sends a protection request')
  const draggedBody = draggedRequest.postDataJSON()
  assert.equal(draggedBody.stop_loss, sell.stop_loss)
  assert.ok(Number(draggedBody.take_profit) < close, 'SELL TP drag moves below the reference')
  await page.waitForFunction(count => window.__qaLines?.length >= count, protectionBeforeDrag)
  assert.equal(report.requests.length, protectionBeforeDrag + 1)
  const protectionToast = page.locator('.wm-notification.is-structured').filter({ hasText: /(?:Take profit moved to|Đã dời Take profit đến)/i })
  await protectionToast.waitFor({ state: 'visible' })
  assert.match(await protectionToast.textContent(), /(?:Take profit moved to|Đã dời Take profit đến) [0-9.]+!/i)
  const invalidBeforeDrag = report.requests.length
  await dragOrderHandle('Kéo Take profit', -160)
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('SELL'))
  assert.equal(report.requests.length, invalidBeforeDrag, 'SELL TP drag above the reference is rejected locally')
  assert.match(await page.locator('[role=alert]').last().textContent(), /SELL|bán/i)
  report.cases.push('Iframe SL/TP hit-target drag survives the pause refresh; valid SELL TP commits once and crossed TP is rejected without a request')
  const sellMarkers = await markerState()
  assert.equal(sellMarkers.entry.color, '#FF603B')
  assert.ok(sellMarkers.stop.y < sellMarkers.entry.y && sellMarkers.entry.y < sellMarkers.target.y)
  report.cases.push('Visible TP/SL handles and keyboard deletion work; read-only Buy/Sell Entry uses side color and X opens confirmation; Scalper stop-only Sell uses saved 15 pip distance')
  await closeEntry()
  await preset({ stop: false, target: true, unit: 'percent', value: '0.5' })
  await page.getByRole('button', { name: 'Mua', exact: true }).click()
  await waitRequests(3)
  assert.equal(report.requests.at(-1).body.stop_loss, null)
  assert.ok(Math.abs(Number(report.requests.at(-1).body.take_profit) - (close + .0001) * 1.005) <= Number(spec.tick_size) + 1e-10)
  const pending = replay.payload.execution.position
  replay = { ...replay, revision: replay.revision + 1, payload: { ...replay.payload, execution: { ...replay.payload.execution, pending_market_order: null, position: { ...pending, position_id: 'fixture-position', entry_fill: String(close + .0001), opened_time_utc: fixture.latest.cutoff_timestamp }, floating_pl: '12.34' } } }
  await page.reload(); await ready(); await waitRequests(3)
  const positionMarkers = await markerState()
  assert.match(positionMarkers.entry.text, /BUY → \+12.34 USD/)
  assert.match(positionMarkers.target.text, /^TP → \+?[0-9.-]+ USD$/)
  assert.doesNotMatch(positionMarkers.target.text, /pips|ticks/i)
  assert.equal(positionMarkers.target.quantity, '0.12')
  assert.equal(positionMarkers.target.color, '#089981')
  assert.ok(positionMarkers.target.y < positionMarkers.entry.y)
  assert.deepEqual(await page.evaluate(() => window.__qaLines.filter(line => !line.removed).map(line => line.setLineStyle)), [2, 2, 2], 'Entry, SL and TP all use native dashed lines')
  await page.screenshot({ path: `${output}/position.png` })
  const savedReplay = structuredClone(replay)
  const noOverlap = async () => {
    const boxes = await markerState(), list = Object.entries(boxes)
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [kindA, a] = list[i], [kindB, b] = list[j]
      const gap = kindA !== 'entry' && kindB !== 'entry' && a.y === b.y ? 0 : 7
      assert.ok(Math.abs(a.y - b.y) >= 26 || a.right + gap <= b.left || b.right + gap <= a.left, `Order boxes overlap: ${JSON.stringify(boxes)}`)
    }
    return boxes
  }
  for (const side of ['BUY', 'SELL']) {
    replay = { ...savedReplay, revision: replay.revision + 1, payload: { ...savedReplay.payload, execution: { ...savedReplay.payload.execution, position: { ...savedReplay.payload.execution.position, side, stop_loss: null, take_profit: savedReplay.payload.execution.position.entry_fill } } } }
    await page.reload(); await ready(); await waitRequests(3)
    for (const width of [1064, 1368]) {
      await page.setViewportSize({ width, height: 790 })
      await page.waitForTimeout(120)
      const compact = await noOverlap()
      assert.equal(compact.target.text, 'TP')
      assert.equal(compact.target.quantityHidden, true)
      assert.equal(compact.target.ghost, false, 'Compact display must preserve a configured TP')
      assert.match(compact.target.title, /TP → 0.00 USD/)
      assert.equal(compact.entry.color, side === 'BUY' ? '#089981' : '#FF603B', 'Entry color identifies direction even when PnL is positive')
      assert.ok(Math.abs(compact.target.right - compact.stop.left) < 1, 'TP and SL share an edge at the same price')
      const grips = await chartFrame.locator('.wm-order-marker-grip').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, repeatWidth: getComputedStyle(node).backgroundSize.split(' ')[0] })))
      assert.ok(grips.length === 2 && grips.every(grip => grip.width === 2 && grip.repeatWidth === '2px'), 'Each drag grip has one dot column')
      await page.locator('.wm-notification > button').evaluateAll(nodes => nodes.forEach(node => node.click()))
      await page.screenshot({ path: `${output}/equal-price-${side}-${width}.png` })
    }
    const box = await marker('target').locator('button').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (side === 'BUY' ? -15 : 15), { steps: 3 })
    await chartFrame.waitForFunction(() => document.querySelector('[data-order-kind=target]').dataset.dragging === 'true' && document.querySelector('[data-order-kind=target] .wm-order-marker-text').textContent.includes('→'))
    const preview = await noOverlap()
    assert.match(preview.target.text, /^TP → /, 'Moving off Entry restores projected PnL')
    assert.equal(preview.target.quantityHidden, false)
    await page.keyboard.press('Escape'); await page.mouse.up()
    assert.equal((await noOverlap()).target.text, 'TP', 'Escape restores the compact label')
  }
  replay = { ...savedReplay, revision: replay.revision + 1 }
  await page.reload(); await ready(); await waitRequests(3)
  await page.setViewportSize({ width: 1440, height: 987 })
  report.cases.push('Equal-price set TP, unset SL and Entry never overlap for Buy/Sell at1064/1368px, during drag preview or Escape rollback')
  for (const [mode, inverted] of [[0, true], [1, false], [1, true], [2, false], [3, false], [0, false]]) {
    await page.evaluate(({ mode, inverted }) => {
      const scale = window.__qaChart.getPanes()[0].getMainSourcePriceScale()
      scale.setMode(mode); scale.setInverted(inverted)
    }, { mode, inverted })
    await page.mouse.move(600, 350); await page.mouse.wheel(0, 1)
    await page.waitForTimeout(100)
    const scaled = await markerState()
    const anchors = await chartFrame.locator('td.chart-markup-table.pane div.chart-gui-wrapper').evaluate(pane => {
      const markers = [...document.querySelectorAll('[data-order-kind]')].filter(node => node.dataset.ghost === 'false')
      return markers.map(node => {
        // Coincident native lines share one pixel row; the last line may cover
        // Entry with the SL color while all three price badges remain visible.
        const rgbs = [...document.querySelectorAll('[data-order-kind]')]
          .filter(other => Math.abs(parseFloat(other.style.top) - parseFloat(node.style.top)) < 1)
          .map(other => other.style.getPropertyValue('--order-color').slice(1).match(/../g).map(value => parseInt(value, 16)))
        const ys = []
        for (const canvas of pane.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect(), ctx = canvas.getContext('2d')
          if (!ctx || !rect.width || !rect.height) continue
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          for (let y = 0; y < canvas.height; y++) {
            let hits = 0
            for (let x = 30; x < Math.min(230, canvas.width); x++) {
              const i = (y * canvas.width + x) * 4
              if (pixels[i + 3] > 240 && rgbs.some(rgb => rgb.every((c, j) => Math.abs(c - pixels[i + j]) < 3))) hits++
            }
            if (hits > 12) ys.push(rect.top + (y + .5) * rect.height / canvas.height)
          }
        }
        const box = node.getBoundingClientRect(), center = box.y + box.height / 2
        return { kind: node.dataset.orderKind, center, inPane: center >= pane.getBoundingClientRect().top && center <= pane.getBoundingClientRect().bottom, nearestNative: ys.length ? ys.reduce((a, b) => Math.abs(a - center) < Math.abs(b - center) ? a : b) : null }
      })
    })
    report.anchorChecks ??= []; report.anchorChecks.push({ mode, inverted, anchors, range: await page.evaluate(() => window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange()) })
    for (const anchor of anchors.filter(anchor => anchor.inPane)) assert.ok(anchor.nearestNative !== null && Math.abs(anchor.center - anchor.nearestNative) < 2, `Native line alignment ${mode}/${inverted}: ${JSON.stringify(anchor)}`)
    report.scales ??= []
    report.scales.push({ mode, inverted, markers: scaled, scale: await page.evaluate(() => { const s = window.__qaChart.getPanes()[0].getMainSourcePriceScale(); return { mode: s.getMode(), inverted: s.isInverted(), range: s.getVisiblePriceRange() } }) })
    assert.ok(inverted ? scaled.target.y > scaled.entry.y : scaled.target.y < scaled.entry.y)
    // Both coordinate conversions must agree with the native price primitive.
    await marker('target').locator('button').focus()
    await page.keyboard.press('ArrowUp')
    await chartFrame.waitForFunction(() => !document.querySelector('[data-order-drag=target]').disabled)
    assert.equal(String(await page.evaluate(() => window.__qaLines.find(item => !item.removed && item.setTooltip === 'Take profit').setPrice)), replay.payload.execution.position.take_profit)
  }
  for (const width of [1064, 1368, 1440]) {
    await page.setViewportSize({ width, height: 790 })
    await page.waitForTimeout(160)
    const bounds = await chartFrame.locator('[data-wm-order-handles]').evaluate(node => {
      const rect = node.getBoundingClientRect(), pane = document.querySelector('td.chart-markup-table.pane div.chart-gui-wrapper').getBoundingClientRect()
      return { width: rect.width, y: rect.y, paneWidth: pane.width, paneY: pane.y }
    })
    assert.ok(Math.abs(bounds.width - bounds.paneWidth) < 2 && Math.abs(bounds.y - bounds.paneY) < 2, `Marker bounds follow resized chart: ${JSON.stringify(bounds)}`)
    await page.locator('.wm-notification > button').evaluateAll(nodes => nodes.forEach(node => node.click()))
    await page.screenshot({ path: `${output}/position-${width}-dark.png` })
  }
  const themeToggle = chartFrame.getByTestId('theme-toggle')
  await themeToggle.click()
  await page.locator('.fx-app[data-theme=light]').waitFor()
  await chartFrame.waitForFunction(() => document.querySelector('[data-order-kind=entry]')?.style.getPropertyValue('--order-color') === '#087F6A')
  await page.screenshot({ path: `${output}/position-1440-light.png` })
  await themeToggle.click()
  await page.locator('.fx-app[data-theme=dark]').waitFor()
  report.cases.push('Delayed mutation keeps preview/native line together; Escape, invalid and rejected ghost reset; Log/Invert/percent/indexed modes and viewport resize retain controls')
  const closed = await closeEntry()
  assert.equal(closed.body.target_id, 'fixture-position')
  assert.equal(replay.payload.execution.position, null)
  report.cases.push('Scalper target-only percent conversion, restored native position shows actual PnL and entry X sends close against position ID')
  replay = { ...replay, revision: replay.revision + 1, payload: { ...replay.payload, execution: null } }
  await page.reload(); await ready()
  const orderRequestsBefore = report.requests.length
  await page.locator('.chart-utility-actions').getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
  const orderDialog = page.locator('.legacy-order-modal')
  await orderDialog.waitFor()
  const orderQuantity = orderDialog.getByRole('spinbutton', { name: 'Khối lượng lệnh', exact: true })
  await orderQuantity.fill('0.12')
  const orderSave = orderDialog.getByRole('button', { name: 'Lưu', exact: true })
  assert.equal(await orderSave.isDisabled(), false, 'order can be submitted before an execution exists')
  await orderSave.click()
  await orderDialog.waitFor({ state: 'detached' })
  assert.equal(report.requests.length, orderRequestsBefore + 2)
  assert.equal(report.requests.at(-2).path.endsWith('/execution'), true)
  assert.equal(report.requests.at(-1).path.endsWith('/orders/market'), true)
  assert.equal(report.requests.at(-1).body.expected_revision, report.requests.at(-2).body.expected_revision + 1)
  assert.equal(await orderDialog.count(), 0)
  report.cases.push('Legacy order initializes the simulator on submit, then fills the market order at the current quote using the returned revision')
  await closeEntry()
  const beforeRejectedBuy = replay.revision
  const releaseRejectedBuy = holdMutation(true)
  await page.getByRole('button', { name: 'Mua', exact: true }).click()
  await marker('entry').filter({ hasText: 'Đang gửi' }).waitFor()
  releaseRejectedBuy()
  await marker('entry').waitFor({ state: 'hidden' })
  assert.equal(replay.revision, beforeRejectedBuy, 'Rejected quick order does not invent a saved position')
  report.cases.push('Rejected quick entry removes pending preview; light/dark palette switches retain chart controls')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpected, [])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; report.alerts = await page.locator('[role=alert]').allTextContents(); await page.screenshot({ path: `${output}/failure.png` }); throw error }
finally { await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, requests: report.requests.length, errors: report.errors }))
