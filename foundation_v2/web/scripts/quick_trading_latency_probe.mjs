import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import { createServer, request as httpRequest } from 'node:http'
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatibleAdvancedCharts } from '../advancedChartCompatibility.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const output = path.resolve(value('--output', '../evidence/rust-native-20261017/frontend/quick-latency/receipt.json'))
const baseline = args.includes('--baseline-source')
const samples = Number(value('--samples', 12))
assert.ok(Number.isSafeInteger(samples) && samples >= 2 && samples <= 40)
const api = value('--api-base', null)
const workspace = value('--workspace', 'visual-chart-fixture')
const dataset = value('--dataset-id', null)
if (api) {
  const url = new URL(api)
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only an explicitly selected local candidate API is allowed')
  assert.ok(dataset && args.includes('--workspace'), 'Real HTTP mode needs explicit dataset and workspace; it creates a new disposable replay only')
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const overlayPath = path.join(root, 'src/advancedOrderOverlay.js')
const overlaySource = baseline ? execFileSync('git', ['show', `${revision}:foundation_v2/web/src/advancedOrderOverlay.js`], { cwd: root, encoding: 'utf8' }) : await readFile(overlayPath, 'utf8')
const sourceSha256 = createHash('sha256').update(overlaySource).digest('hex')
const report = { scope: api ? 'Production React/native Advanced Charts + explicit local API HTTP; newly created disposable replay only, no owner session or broker. Transport includes loopback proxy.' : 'Production React/native Advanced Charts + identical in-memory synthetic API; no owner/provider/broker calls. Diagnostic rendering cost, not deployed API speed.', revision, baseline, sourceSha256, runtime: { node: process.version }, api, dataset, samples: [], errors: [], resources: [] }
const fixture = JSON.parse(await readFile(path.join(root, 'tests/visual/chart-fixture.json'), 'utf8'))
let replay = structuredClone(fixture.latest)
replay.payload.execution = null
replay.dataset_sha256 = null
replay.has_future_rows = true
const initial = { cursor_index: 60, instrument_spec: fixture.datasets.items[0].instrument_spec, cost_model: { account_ccy: 'USD' }, spread_price: '0.0002', balance: '10000', equity: '10000', floating_pl: '0', position: null, pending_market_order: null, ledger: [] }
const apiRequest = async (suffix, body) => {
  const response = await fetch(api + suffix, { method: body ? 'POST' : 'GET', headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  const result = await response.json()
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`)
  return result
}
if (api) {
  replay = await apiRequest('/api/v2/replay/sessions', { dataset_id: dataset, name: `Disposable quick latency ${Date.now()}`, starting_balance: '10000' })
  replay = await apiRequest(`/api/v2/replay/sessions/${replay.record_id}/step`, { expected_revision: replay.revision, steps: 60 })
}
const sessionPath = `/api/v2/replay/sessions/${replay.record_id}`
report.session = replay.record_id
const built = await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', build: { write: false }, plugins: baseline ? [{ name: 'baseline-overlay', enforce: 'pre', load(id) { return id.replaceAll('\\', '/') === overlayPath.replaceAll('\\', '/') ? overlaySource : null } }] : [] })
const files = new Map(built.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]))
const vendorRoot = await realpath(process.env.TW_V2_CHARTING_LIBRARY_DIR || path.join(root, '../../static/charting_library'))
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/')) {
      assert.ok(api, 'Synthetic API must be intercepted')
      assert.ok(req.method === 'GET' || (req.method === 'POST' && url.pathname.startsWith(sessionPath + '/orders/')) || (url.pathname.endsWith('/activity') && req.method === 'POST'), 'Only the disposable replay may mutate')
      const upstream = httpRequest(new URL(req.url, api), { method: req.method, headers: { ...req.headers, host: new URL(api).host } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
      upstream.on('error', error => { res.writeHead(502); res.end(error.message) }); req.pipe(upstream); res.on('close', () => upstream.destroy()); return
    }
    assert.equal(req.method, 'GET')
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    let data = files.get(pathname)
    if (data === undefined) {
      const vendor = pathname.startsWith('/charting_library/')
      const base = vendor ? vendorRoot : path.join(root, 'public')
      const file = await realpath(path.resolve(base, '.' + (vendor ? pathname.slice('/charting_library'.length) : pathname)))
      assert.ok(file.startsWith(base + path.sep) && (await stat(file)).isFile())
      data = await readFile(file)
      if (vendor && pathname.endsWith('/charting_library.standalone.js') && url.searchParams.get('iframe') === 'srcdoc') data = compatibleAdvancedCharts(data.toString())
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
    res.writeHead(200, { 'Content-Type': mime[path.extname(pathname)] || 'application/octet-stream' }); res.end(data)
  } catch (error) { res.writeHead(404); res.end(error.message) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
await mkdir(path.dirname(output), { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1368, height: 790 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ['blob:', 'data:', 'about:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await context.addInitScript(() => {
    localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark')
    document.addEventListener('load', event => {
      if (!event.target.src?.includes('charting_library.standalone.js')) return
      const Original = window.TradingView.widget
      window.TradingView.widget = function (...args) {
        const widget = new Original(...args)
        widget.onChartReady(() => {
          window.__qaChart = widget.activeChart()
          const create = window.__qaChart.createOrderLine.bind(window.__qaChart)
          window.__qaPriceWrites = 0
          window.__qaChart.createOrderLine = (...values) => {
            const line = create(...values), write = line.setPrice.bind(line)
            line.setPrice = price => { window.__qaPriceWrites++; return write(price) }
            return line
          }
        }); return widget
      }
    }, true)
    document.addEventListener('click', event => { if (event.target.closest('button.buy, button.sell')) window.__qaClick = performance.now() }, true)
  })
  if (!api) await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url())
    if (req.method() === 'GET') {
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
      return route.fulfill({ json: url.pathname === sessionPath ? replay : url.pathname === '/api/v2/data/datasets' ? fixture.datasets : { items: [], available: false } })
    }
    if (url.pathname.endsWith('/activity')) return route.fulfill({ status: 204 })
    assert.ok(url.pathname.startsWith(sessionPath + '/orders/'))
    const body = req.postDataJSON(), suffix = url.pathname.split('/').at(-1)
    assert.equal(body.expected_revision, replay.revision)
    let execution = replay.payload.execution || structuredClone(initial)
    if (['quick', 'market'].includes(suffix)) {
      execution = { ...execution, position: { ...body, position_id: 'fixture-position', entry_fill: String(replay.visible_rows.at(-1).close + (body.side === 'BUY' ? .0001 : -.0001)), opened_time_utc: replay.cutoff_timestamp } }
    } else if (suffix === 'protection') execution = { ...execution, position: { ...execution.position, stop_loss: body.stop_loss, take_profit: body.take_profit } }
    else if (suffix === 'close') execution = { ...execution, position: null, floating_pl: '0' }
    else assert.fail(`Unexpected mutation ${suffix}`)
    replay = { ...replay, revision: replay.revision + (suffix === 'quick' ? 2 : 1), payload: { ...replay.payload, execution } }
    return route.fulfill({ json: replay })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  let historyReads = 0
  page.on('request', req => { if (req.method() === 'GET' && /chart-window|\/bars/.test(req.url())) historyReads++ })
  const responses = []
  page.on('requestfinished', req => { if (req.method() === 'POST' && req.url().includes('/orders/')) responses.push({ path: new URL(req.url()).pathname, timing: req.timing() }) })
  await page.goto(`${origin}/?workspace=${api ? workspace : fixture.workspace}&view=replay&surface=workspace&session=${replay.record_id}`)
  await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  const iframe = await page.locator('.advanced-chart-host iframe').elementHandle(), frame = await iframe.contentFrame()
  await frame.evaluate(() => {
    window.__qaFrames = []; window.__qaPaints = []
    let last
    const sample = now => { if (last) window.__qaFrames.push(now - last); last = now; requestAnimationFrame(sample) }; requestAnimationFrame(sample)
    new MutationObserver(() => {
      const entry = document.querySelector('[data-order-kind=entry]')
      if (entry && !entry.hidden && entry.textContent.includes('USD')) requestAnimationFrame(() => {
        if (parent.__qaClick && !window.__qaPaints.some(item => item.click === parent.__qaClick)) window.__qaPaints.push({ click: parent.__qaClick, paint: parent.performance.now() })
      })
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
  await page.locator('.legacy-quantity-control input').fill('0.12')
  for (let i = -1; i < samples; i++) {
    const side = i % 2 === 0 ? 'BUY' : 'SELL'
    const start = await metrics()
    const response = page.waitForResponse(res => /\/orders\/(quick|market)$/.test(res.url()) && res.request().method() === 'POST')
    await page.locator(side === 'BUY' ? 'button.buy' : 'button.sell').click()
    assert.equal((await response).status(), 200)
    await frame.waitForFunction(() => document.querySelector('[data-order-kind=entry]')?.textContent.includes('USD') && !document.querySelector('[data-order-drag=stop]')?.disabled)
    await frame.waitForFunction(() => window.__qaPaints.some(item => item.click === parent.__qaClick))
    const paint = await frame.evaluate(() => window.__qaPaints.at(-1))
    const range = await page.evaluate(() => window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange())
    const beforeDrag = await page.evaluate(() => ({ writes: window.__qaPriceWrites, at: performance.now() }))
    const beforeFrames = await frame.evaluate(() => window.__qaFrames.length)
    const beforeReads = historyReads, dragMetrics = await metrics()
    const handle = frame.locator('[data-order-drag=target]'), box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    // Deliberately include sub-tick moves to measure duplicate native writes.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (side === 'BUY' ? -75 : 75), { steps: 72 })
    const saving = page.waitForResponse(res => res.url().endsWith('/orders/protection') && res.request().method() === 'POST')
    await page.mouse.up(); assert.equal((await saving).status(), 200)
    await frame.waitForFunction(() => !document.querySelector('[data-order-drag=target]').disabled)
    const after = await metrics(), afterDrag = await page.evaluate(() => ({ writes: window.__qaPriceWrites, at: performance.now() }))
    const afterRange = await page.evaluate(() => window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange())
    const pane = await frame.locator('td.chart-markup-table.pane div.chart-gui-wrapper').boundingBox()
    const scaleMovementPixels = Math.max(Math.abs(afterRange.from - range.from), Math.abs(afterRange.to - range.to)) / (range.to - range.from) * pane.height
    assert.ok(scaleMovementPixels < .1, `Price scale moved ${scaleMovementPixels} px`)
    assert.equal(await iframe.evaluate(node => node.isConnected), true)
    assert.equal(historyReads, beforeReads)
    if (api) { const stored = await apiRequest(sessionPath); assert.equal(stored.payload.execution.pending_market_order, null); assert.equal(stored.payload.execution.position.side, side) }
    const frames = await frame.evaluate(from => window.__qaFrames.slice(from), beforeFrames)
    if (i >= 0) report.samples.push({ sample: i, side, clickToConfirmedPaintMs: paint.paint - paint.click, drag: { durationMs: afterDrag.at - beforeDrag.at, priceWrites: afterDrag.writes - beforeDrag.writes, frames, layoutCount: after.LayoutCount - dragMetrics.LayoutCount, layoutSeconds: after.LayoutDuration - dragMetrics.LayoutDuration, scriptSeconds: after.ScriptDuration - dragMetrics.ScriptDuration }, journeyLayoutCount: after.LayoutCount - start.LayoutCount, historyReads: 0, iframeRetained: true, scaleRetained: true, scaleMovementPixels, range, afterRange })
    await frame.locator('.wm-order-marker-close').click(); await page.locator('.chart-order-close-dialog button.is-destructive').click(); await frame.locator('[data-order-kind=entry]').waitFor({ state: 'hidden' })
  }
  report.requests = responses
  report.resources = await page.evaluate(() => performance.getEntriesByType('resource').map(item => ({ path: new URL(item.name).pathname, bytes: item.encodedBodySize, durationMs: item.duration })))
  assert.deepEqual(report.errors, [])
  report.status = 'PASS'
  const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)]
  report.summary = Object.fromEntries(['clickToConfirmedPaintMs', 'drag.layoutCount', 'drag.priceWrites'].map(key => {
    const values = report.samples.map(sample => key.split('.').reduce((value, part) => value[part], sample))
    return [key, { p50: quantile(values, .5), sampleP95: quantile(values, .95) }]
  }))
  await page.screenshot({ path: path.join(path.dirname(output), path.basename(output, '.json') + '.png') })
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; throw error }
finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await writeFile(output, JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ output, status: report.status, summary: report.summary }))
