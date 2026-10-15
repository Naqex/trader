import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.env.QUICK_TRADING_OUTPUT || '../evidence/quick-trading-20261015/workflow'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const spec = fixture.datasets.items[0].instrument_spec
const initialExecution = { cursor_index: 60, instrument_spec: spec, cost_model: { account_ccy: 'USD' }, spread_price: '0.0002', balance: '10000', equity: '10000', floating_pl: '0', position: null, pending_market_order: null, ledger: [] }
let replay = { ...fixture.latest, dataset_sha256: null, has_future_rows: true, payload: { ...fixture.latest.payload, execution: null, starting_balance: '10000', starting_balance_ccy: 'USD' } }
const report = { scope: 'Synthetic API intercepts only; real native chart and controls. Native order-line move/cancel callbacks observed via test-only proxy. No owner, provider or broker writes.', cases: [], requests: [], errors: [], unexpected: [] }
const browser = await chromium.launch()
await mkdir(output, { recursive: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
await context.addInitScript(() => {
  localStorage.setItem('tw-language', 'vi')
  document.addEventListener('load', event => {
    if (!event.target.src?.includes('charting_library.standalone.js')) return
    const Original = window.TradingView.widget
    window.TradingView.widget = function (...args) {
      const widget = new Original(...args)
      window.__qaLines = []
      widget.onChartReady(() => {
        const chart = widget.activeChart(), create = chart.createOrderLine.bind(chart)
        chart.createOrderLine = (...args) => {
          const native = create(...args)
          const record = { native, removed: false }
          window.__qaLines.push(record)
          const proxy = new Proxy(native, { get(target, key) {
            if (typeof target[key] !== 'function') return target[key]
            return (...values) => {
              if (key === 'onMove' || key === 'onCancel') record[key] = values.at(-1)
              if (['setText', 'setPrice', 'setQuantity', 'setCancellable', 'setEditable'].includes(key)) record[key] = values[0]
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
})
let releaseInit, requestedInit
const initStarted = new Promise(resolve => { requestedInit = resolve })
const initGate = new Promise(resolve => { releaseInit = resolve })
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
  assert.equal(body.expected_revision, replay.revision)
  const suffix = url.pathname.split('/').at(-1)
  let execution = replay.payload.execution
  if (suffix === 'execution') { requestedInit(); await initGate; execution = structuredClone(initialExecution) }
  else if (suffix === 'market') execution = { ...execution, pending_market_order: body }
  else if (suffix === 'protection') {
    const key = execution.position ? 'position' : 'pending_market_order'
    execution = { ...execution, [key]: { ...execution[key], stop_loss: body.stop_loss, take_profit: body.take_profit } }
  } else if (suffix === 'close') execution = { ...execution, position: null, pending_market_order: null, floating_pl: '0' }
  else { report.unexpected.push(`${request.method()} ${url.pathname}`); return route.abort() }
  replay = { ...replay, revision: replay.revision + 1, payload: { ...replay.payload, execution } }
  return route.fulfill({ json: replay })
})
const page = await context.newPage()
page.on('pageerror', error => report.errors.push(error.message))
const href = `${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`
const ready = () => page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
const waitRequests = count => page.waitForFunction(count => window.__qaLines?.filter(item => !item.removed).length >= count && window.__qaLines.some(item => !item.removed && !/^SL|^TP/.test(item.setText) && item.setCancellable), count)
async function fireNative(kind, action, price) {
  const before = report.requests.length
  const removedBefore = await page.evaluate(() => window.__qaLines.filter(item => item.removed).length)
  await page.evaluate(({ kind, action, price }) => {
    const line = window.__qaLines.find(item => !item.removed && (kind === 'entry' ? !/^SL|^TP/.test(item.setText) : item.setText.startsWith(kind === 'stop' ? 'SL' : 'TP')))
    if (!line) throw Error(`Missing ${kind} line`)
    if (action === 'move') { if (!line.setEditable) throw Error('Line is not editable'); line.native.setPrice(price); line.onMove() }
    else { if (!line.setCancellable) throw Error('Line is not cancellable'); line.onCancel() }
  }, { kind, action, price })
  await page.waitForFunction(before => window.__qaLines.filter(item => item.removed).length > before, removedBefore)
  await page.waitForFunction(closing => {
    const lines = window.__qaLines.filter(item => !item.removed)
    return closing ? lines.length === 0 && !document.querySelector('.legacy-trading-bar button.buy').disabled : lines.length === 3 && lines.some(item => !/^SL|^TP/.test(item.setText) && item.setCancellable) && lines.filter(item => /^SL|^TP/.test(item.setText)).every(item => item.setEditable)
  }, kind === 'entry')
  assert.equal(report.requests.length, before + 1)
  return report.requests.at(-1)
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
  await page.getByRole('button', { name: 'Mua', exact: true }).dblclick()
  await initStarted
  assert.equal(report.requests.length, 1)
  releaseInit()
  await waitRequests(3)
  assert.equal(report.requests.length, 2)
  assert.equal(report.requests[1].body.expected_revision, fixture.latest.revision + 1)
  assert.equal(report.requests[1].body.quantity, '0.12')
  assert.equal(report.requests[1].body.stop_loss, null)
  assert.equal(report.requests[1].body.take_profit, null)
  assert.equal(await page.locator('.legacy-order-modal').count(), 0)
  assert.equal(await page.locator('.legacy-quantity-control input').inputValue(), '0.12')
  report.cases.push('First quick Buy initializes once then queues once using the returned revision, preserving quantity; double click cannot duplicate, no dialog or implicit protections')
  const stop = Number((fixture.latest.visible_rows.at(-1).close - .002).toFixed(5))
  assert.equal((await fireNative('stop', 'move', stop)).body.stop_loss, String(stop))
  assert.equal(replay.payload.execution.pending_market_order.take_profit, null)
  assert.equal((await fireNative('stop', 'cancel')).body.stop_loss, null)
  await page.screenshot({ path: `${output}/queued-ghosts.png` })
  await fireNative('entry', 'cancel')
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
  report.cases.push('Native ghost SL move adds only SL, X removes only SL, entry X cancels queued order; Scalper stop-only Sell uses saved 15 pip distance')
  await fireNative('entry', 'cancel')
  await preset({ stop: false, target: true, unit: 'percent', value: '0.5' })
  await page.getByRole('button', { name: 'Mua', exact: true }).click()
  await waitRequests(3)
  assert.equal(report.requests.at(-1).body.stop_loss, null)
  assert.ok(Math.abs(Number(report.requests.at(-1).body.take_profit) - (close + .0001) * 1.005) <= Number(spec.tick_size) + 1e-10)
  const pending = replay.payload.execution.pending_market_order
  replay = { ...replay, revision: replay.revision + 1, payload: { ...replay.payload, execution: { ...replay.payload.execution, pending_market_order: null, position: { ...pending, position_id: 'fixture-position', entry_fill: String(close + .0001), opened_time_utc: fixture.latest.cutoff_timestamp }, floating_pl: '12.34' } } }
  await page.reload(); await ready(); await waitRequests(3)
  const entry = await page.evaluate(() => window.__qaLines.find(line => !line.removed && !/^SL|^TP/.test(line.setText)).setText)
  assert.ok(entry.includes('12,34') || entry.includes('12.34'))
  await page.screenshot({ path: `${output}/position.png` })
  const closed = await fireNative('entry', 'cancel')
  assert.equal(closed.body.target_id, 'fixture-position')
  assert.equal(replay.payload.execution.position, null)
  report.cases.push('Scalper target-only percent conversion, restored native position shows actual PnL and entry X sends close against position ID')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpected, [])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, requests: report.requests.length, errors: report.errors }))
