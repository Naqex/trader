import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import { createServer, request as httpRequest } from 'node:http'
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatibleAdvancedCharts } from '../advancedChartCompatibility.mjs'
import { runPropStepJourney } from './replay_prop_step_journey.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const output = path.resolve(value('--output', '../evidence/step-chart/browser.json'))
const api = value('--api-base'), workspace = value('--workspace'), dataset = value('--dataset-id')
const seedSteps = Number(value('--seed-ledger-steps', 5000)), samples = Number(value('--samples', 6))
const resolutions = value('--resolutions', '1,5').split(',')
assert.ok(api && workspace && dataset && args.includes('--execution-config'))
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(api).hostname))
assert.ok(Number.isInteger(seedSteps) && seedSteps >= 100 && seedSteps <= 5000)
assert.ok(Number.isInteger(samples) && samples >= 2 && samples <= 20)
assert.ok(resolutions.length && resolutions.every(item => ['1', '5', '1D', '1W', '1M'].includes(item)))
const report = { status: 'FAIL', scope: 'Production React/Advanced Charts, owned native HTTP/PG, Practice only. Subscribed bar delivery followed by first rAF is a rendering proxy, not pixel-level paint proof.', samples: [], coldSamples: [], play: [], oracle: [], errors: [], requests: [], assetSha256: {} }
const apiRequest = async (suffix, body) => {
  const response = await fetch(api + suffix, { method: body ? 'POST' : 'GET', headers: { 'X-Workspace-Id': workspace, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  const result = await response.json()
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`)
  return result
}
const configuration = JSON.parse(await readFile(path.resolve(value('--execution-config')), 'utf8'))
let replay = await apiRequest('/api/v2/replay/sessions', { dataset_id: dataset, name: 'Disposable step chart', starting_balance: '10000' })
const sessionPath = `/api/v2/replay/sessions/${replay.record_id}`
report.session = replay.record_id
replay = await apiRequest(sessionPath + '/execution', { ...configuration, expected_revision: replay.revision })
for (let remaining = seedSteps; remaining > 0;) {
  const steps = Math.min(1000, remaining)
  replay = await apiRequest(sessionPath + '/step', { expected_revision: replay.revision, steps })
  remaining -= steps
}
const importStarted = performance.now()
await apiRequest(sessionPath + '/orders/quick?response_view=mutation-v1', { ...configuration, expected_revision: replay.revision, operation_id: 'step-chart-import', side: 'SELL', quantity: '0.12', stop_loss: null, take_profit: null, execution_timing: 'current_quote' })
replay = await apiRequest(sessionPath)
await apiRequest(sessionPath + '/orders/close?response_view=mutation-v1', { expected_revision: replay.revision, operation_id: 'step-chart-close', target_id: replay.payload.execution.position.position_id })
replay = await apiRequest(sessionPath)
report.importMs = performance.now() - importStarted
report.initialLedgerEvents = replay.payload.execution.ledger.length
const built = await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', build: { write: false } })
const files = new Map(built.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]))
const vendorRoot = await realpath(process.env.TW_V2_CHARTING_LIBRARY_DIR || path.join(root, '../../static/charting_library'))
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/')) {
      assert.ok(req.method === 'GET' || (req.method === 'POST' && [sessionPath, report.nullSessionPath, report.propSessionPath].filter(Boolean).some(base => url.pathname.startsWith(base + '/'))), 'Only owned replays may mutate')
      const upstream = httpRequest(new URL(req.url, api), { method: req.method, headers: { ...req.headers, host: new URL(api).host } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
      upstream.on('error', error => { res.writeHead(502); res.end(error.message) }); req.pipe(upstream); res.on('close', () => upstream.destroy()); return
    }
    assert.equal(req.method, 'GET')
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    let data = files.get(pathname)
    if (data === undefined) {
      const vendor = pathname.startsWith('/charting_library/'), base = vendor ? vendorRoot : path.join(root, 'public')
      const file = await realpath(path.resolve(base, '.' + (vendor ? pathname.slice('/charting_library'.length) : pathname)))
      assert.ok(file.startsWith(base + path.sep) && (await stat(file)).isFile())
      data = await readFile(file)
      if (vendor && pathname.endsWith('/charting_library.standalone.js') && url.searchParams.get('iframe') === 'srcdoc') data = compatibleAdvancedCharts(data.toString())
    }
    const assetHash = createHash('sha256').update(data).digest('hex')
    if (report.assetSha256[pathname]) assert.equal(report.assetSha256[pathname], assetHash, 'Served asset changed during acceptance')
    report.assetSha256[pathname] = assetHash
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
    res.writeHead(200, { 'Content-Type': mime[path.extname(pathname)] || 'application/octet-stream' }); res.end(data)
  } catch (error) { res.writeHead(404); res.end(error.message) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true })
await mkdir(path.dirname(output), { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1368, height: 790 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin || ['blob:', 'data:', 'about:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await context.addInitScript(() => {
    localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark')
    window.__qa = { bars: [], history: [], resets: 0, subscriptions: {}, frames: [], active: false }
    document.addEventListener('load', event => {
      if (!event.target.src?.includes('charting_library.standalone.js')) return
      const Original = window.TradingView.widget
      window.TradingView.widget = function (...args) {
        const feed = args[0].datafeed, get = feed.getBars.bind(feed), subscribe = feed.subscribeBars.bind(feed), unsubscribe = feed.unsubscribeBars.bind(feed)
        feed.getBars = (info, resolution, period, callback, error) => get(info, resolution, period, (bars, meta) => { window.__qa.history.push({ resolution, bars: bars.map(item => ({ ...item })) }); callback(bars, meta) }, error)
        feed.subscribeBars = (info, resolution, callback, id, reset) => {
          window.__qa.subscriptions[id] = resolution
          return subscribe(info, resolution, bar => {
            const sample = { resolution, bar: { ...bar }, received: performance.now(), click: window.__qa.click || null }
            window.__qa.bars.push(sample); callback(bar)
            requestAnimationFrame(() => { sample.paint = performance.now() })
          }, id, () => { window.__qa.resets++; reset() })
        }
        feed.unsubscribeBars = id => { delete window.__qa.subscriptions[id]; return unsubscribe(id) }
        const widget = new Original(...args)
        window.__qaWidget = widget; widget.onChartReady(() => { window.__qaChart = widget.activeChart() })
        return widget
      }
    }, true)
    document.addEventListener('click', event => { if (event.target.closest('[data-testid="step-1"], [data-testid="play-toggle"]')) window.__qa.click = performance.now() }, true)
    let previous
    const frame = now => { if (previous && window.__qa.active) window.__qa.frames.push(now - previous); previous = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  })
  const page = await context.newPage(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  let historyReads = 0
  page.on('request', req => { if (req.method() === 'GET' && /chart-window|\/bars/.test(req.url())) historyReads++ })
  page.on('requestfinished', req => { if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/step')) report.requests.push({ path: new URL(req.url()).pathname, responseView: new URL(req.url()).searchParams.get('response_view'), timing: req.timing() }) })
  const ready = async () => {
    await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
    await page.waitForFunction(() => window.__qaChart && Object.keys(window.__qa.subscriptions).length > 0)
    await page.evaluate(() => new Promise(resolve => { if (window.__qaChart.dataReady(resolve)) resolve() }))
    await page.waitForTimeout(150)
  }
  const goto = async id => { await page.goto(`${origin}/?workspace=${workspace}&view=replay&surface=workspace&session=${id}`); await ready() }
  await goto(replay.record_id)
  const iframe = await page.locator('.advanced-chart-host iframe').elementHandle()
  const shape = await page.evaluate(time => window.__qaChart.createShape({ time, price: 1.1 }, { shape: 'horizontal_line', lock: true, disableSave: true }), replay.cutoff_timestamp)
  assert.ok(shape)
  const oracle = async (resolution, emitted, currentPath = sessionPath) => {
    const current = await apiRequest(currentPath)
    const query = new URLSearchParams({ dataset_id: dataset, dataset_sha256: current.dataset_sha256, cursor_index: String(current.canonical_cursor_index), resolution, count_back: '20' })
    const canonical = await apiRequest(currentPath + '/chart-window?' + query)
    const actual = emitted.filter(item => item.resolution === resolution).at(-1)?.bar
    assert.ok(actual, `No subscribed bar ${resolution}`)
    const expected = canonical.bars.find(item => item.time === actual.time)
    assert.ok(expected, 'Delivered bar absent from canonical chart window')
    for (const key of ['time', 'open', 'high', 'low', 'close', 'volume']) assert.equal(actual[key] ?? 0, expected[key] ?? 0, `OHLC ${resolution} ${key}`)
    assert.equal(Number(await page.getByTestId('replay-chart').getAttribute('data-cutoff')), current.cutoff_timestamp)
    report.oracle.push({ resolution, cursor: current.canonical_cursor_index, actual, expected, outsideTiming: true })
    return current
  }
  const interval = async value => {
    const sync = page.getByRole('switch', { name: 'Đồng bộ khung replay với khung chart', exact: true })
    if (await sync.isChecked()) await sync.uncheck()
    await page.getByRole('button', { name: 'Khung thời gian replay', exact: true }).click()
    await page.getByRole('button', { name: value + 'm', exact: true }).click()
  }
  const step = async (resolution, label, cold = false) => {
    const before = await page.evaluate(() => ({ bars: window.__qa.bars.length, resets: window.__qa.resets, frames: window.__qa.frames.length, range: window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange() }))
    const reads = historyReads
    const response = page.waitForResponse(res => new URL(res.url()).pathname === sessionPath + '/step' && res.request().method() === 'POST')
    await page.evaluate(() => { window.__qa.active = true })
    await page.getByTestId('step-1').click()
    const confirmed = await response
    assert.equal(confirmed.status(), 200); assert.equal(new URL(confirmed.url()).searchParams.get('response_view'), 'step-v1')
    const delta = await confirmed.json(); assert.equal(delta.schema_version, 'replay-step-v1')
    await page.waitForFunction(({ count, resolution }) => window.__qa.bars.slice(count).some(item => item.resolution === resolution && item.paint), { count: before.bars, resolution })
    await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled)
    const after = await page.evaluate(({ before, shape }) => ({ bars: window.__qa.bars.slice(before.bars), frames: window.__qa.frames.slice(before.frames), resets: window.__qa.resets, shapeRetained: window.__qaChart.getAllShapes().some(item => item.id === shape), range: window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange() }), { before, shape })
    await page.evaluate(() => { window.__qa.active = false })
    const delivery = after.bars.filter(item => item.resolution === resolution).at(-1)
    assert.equal(after.resets, before.resets, 'Forward step reset subscription cache')
    if (!cold) assert.equal(historyReads, reads, 'Ready forward step refetched chart-window')
    assert.equal(await iframe.evaluate(node => node.isConnected), true); assert.equal(after.shapeRetained, true); assert.deepEqual(after.range, before.range)
    const current = await oracle(resolution, after.bars)
    const sample = { resolution, label, clickToConfirmedFrameMs: delivery.paint - delivery.click, cursor: current.canonical_cursor_index, responseBytes: (await confirmed.body()).length, frames: after.frames, historyReads: historyReads - reads, resets: 0, iframeRetained: true, shapeRetained: true, scaleRetained: true }
    ;(cold ? report.coldSamples : report.samples).push(sample)
    return current
  }
  for (const resolution of resolutions) {
    await page.evaluate(resolution => new Promise(resolve => window.__qaChart.setResolution(resolution, resolve)), resolution); await ready()
    await page.evaluate(() => window.__qaChart.getPanes()[0].getMainSourcePriceScale().setVisiblePriceRange({ from: 1.08, to: 1.13 }))
    await interval('1'); await step(resolution, 'first-ready-forward', true)
    for (let index = 0; index < samples; index++) await step(resolution, 'single-' + index)
    await interval('10'); await step(resolution, 'first-10m-boundary-alignment', true)
    const before = await apiRequest(sessionPath), ten = await step(resolution, 'ten-base-bars')
    assert.equal(ten.canonical_cursor_index - before.canonical_cursor_index, 10)
    await interval('1'); await page.getByLabel('Điều chỉnh tốc độ replay', { exact: true }).press('Home')
    const beforePlay = await page.evaluate(() => ({ bars: window.__qa.bars.length, resets: window.__qa.resets, frames: window.__qa.frames.length, range: window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange() })), responsesBefore = report.requests.length, readsBefore = historyReads
    await page.evaluate(() => { window.__qa.active = true }); await page.getByTestId('play-toggle').click()
    await page.waitForFunction(({ count, resolution }) => window.__qa.bars.slice(count).filter(item => item.resolution === resolution && item.paint).length >= 3, { count: beforePlay.bars, resolution }, { timeout: 15000 })
    await page.getByTestId('play-toggle').click(); await page.waitForFunction(() => !document.querySelector('[data-testid="step-1"]').disabled)
    await page.evaluate(() => { window.__qa.active = false })
    const played = await page.evaluate(from => window.__qa.bars.slice(from), beforePlay.bars), current = await oracle(resolution, played)
    assert.ok(report.requests.length - responsesBefore >= 3, 'Play did not execute successive real HTTP steps')
    assert.equal(historyReads, readsBefore); assert.equal(await page.evaluate(() => window.__qa.resets), beforePlay.resets)
    assert.equal(await iframe.evaluate(node => node.isConnected), true)
    const retained = await page.evaluate(({ shape, from }) => ({ shape: window.__qaChart.getAllShapes().some(item => item.id === shape), range: window.__qaChart.getPanes()[0].getMainSourcePriceScale().getVisiblePriceRange(), frames: window.__qa.frames.slice(from) }), { shape, from: beforePlay.frames })
    assert.equal(retained.shape, true); assert.deepEqual(retained.range, beforePlay.range)
    report.play.push({ resolution, actualStepRequests: report.requests.length - responsesBefore, deliveredBars: played.length, cursor: current.canonical_cursor_index, historyReads: 0, iframeRetained: true, shapeRetained: true, scaleRetained: true, frames: retained.frames })
  }
  const uninitialized = await apiRequest('/api/v2/replay/sessions', { dataset_id: dataset, starting_balance: '10000', name: 'Null execution step' })
  report.nullSessionPath = `/api/v2/replay/sessions/${uninitialized.record_id}`; report.nullSession = uninitialized.record_id
  await goto(uninitialized.record_id)
  await page.evaluate(() => new Promise(resolve => window.__qaChart.setResolution('1', resolve))); await ready()
  await interval('1')
  const nullReads = historyReads, nullBars = await page.evaluate(() => window.__qa.bars.length)
  const nullResponse = page.waitForResponse(res => new URL(res.url()).pathname === report.nullSessionPath + '/step')
  await page.getByTestId('step-1').click(); const nullConfirmed = await nullResponse
  assert.equal(nullConfirmed.status(), 200); assert.equal((await nullConfirmed.json()).schema_version, 'replay-step-v1')
  await page.waitForFunction(count => window.__qa.bars.length > count && window.__qa.bars.at(-1).paint, nullBars)
  const nullCurrent = await oracle('1', await page.evaluate(from => window.__qa.bars.slice(from), nullBars), report.nullSessionPath)
  assert.equal(nullCurrent.payload.execution, null); assert.equal(historyReads, nullReads)
  report.nullInitialization = { cursor: nullCurrent.canonical_cursor_index, historyReads: 0, execution: null }
  const staleBefore = await page.evaluate(() => ({ bars: window.__qa.bars.length, cutoff: document.querySelector('[data-testid="replay-chart"]').dataset.cutoff }))
  await context.route('**' + report.nullSessionPath + '/step?**', async route => {
    const original = route.request().postDataJSON()
    const upstream = await route.fetch({ postData: { ...original, expected_revision: original.expected_revision - 1 } })
    await route.fulfill({ response: upstream })
  }, { times: 1 })
  const staleResponse = page.waitForResponse(res => new URL(res.url()).pathname === report.nullSessionPath + '/step' && res.status() === 409)
  await page.getByTestId('step-1').click(); await staleResponse
  await page.waitForFunction(() => document.querySelector('[data-testid="step-1"]').disabled)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await page.evaluate(() => ({ bars: window.__qa.bars.length, cutoff: document.querySelector('[data-testid="replay-chart"]').dataset.cutoff })), staleBefore)
  assert.equal((await apiRequest(report.nullSessionPath)).revision, nullCurrent.revision)
  report.stale = { rejected409: true, retainedBarsAndCutoff: true, noFinancialRevision: true }
  if (args.includes('--prop-config')) await runPropStepJourney({ page, context, api, workspace, dataset, origin,
    configuration, fixture: JSON.parse(await readFile(path.resolve(value('--prop-config')), 'utf8')),
    report, ready, browserHistoryReads: () => historyReads })
  assert.deepEqual(report.errors, [])
  const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]
  report.summary = { clickToConfirmedFrameMs: { p50: quantile(report.samples.map(item => item.clickToConfirmedFrameMs), .5), sampleP95: quantile(report.samples.map(item => item.clickToConfirmedFrameMs), .95) }, samples: report.samples.length }
  report.status = 'PASS'; await page.screenshot({ path: path.join(path.dirname(output), 'step-chart.png') })
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; const diagnostic = browser.contexts().at(-1)?.pages().at(-1); if (diagnostic) { report.failureUi = await diagnostic.locator('body').innerText().catch(() => 'unavailable'); await diagnostic.screenshot({path:path.join(path.dirname(output), 'failure.png')}).catch(() => {}); } throw error }
finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await writeFile(output, JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ output, status: report.status, summary: report.summary }))
