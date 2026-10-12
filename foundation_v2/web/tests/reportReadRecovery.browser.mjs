import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { DEMO_SESSIONS, DEMO_LEDGER, demoOverview, demoDashboardAnalytics } from '../src/demoFixtures.js'
const origin = 'http://127.0.0.1:5180', output = '../evidence/read-recovery-20261012/report-consumers'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual report reader components with labeled GET-only HTTP/SSE fixtures; no owner writes', cases: [], errors: [] }
const context = await browser.newContext({ viewport: { width: 1563, height: 987 } })
await context.addInitScript(() => {
  localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark')
  const nativeFetch = window.fetch
  window.fixtureSnapshot = revision => window.fixtureStream?.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify({ schema_version: 'workspace-events-v1', workspace_id: 'tenant-a', resources: { sessions: { revision }, research: { revision: 'r1' } } })}\n\n`))
  window.fetch = (input, init) => String(input).endsWith('/api/v2/events') ? Promise.resolve(new Response(new ReadableStream({ start(controller) { window.fixtureStream = controller; window.fixtureSnapshot('one'); init?.signal?.addEventListener('abort', () => controller.close(), { once: true }) } }), { headers: { 'Content-Type': 'text/event-stream' } })) : nativeFetch(input, init)
})
const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message))
await context.route('**/*', route => new URL(route.request().url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue())
await page.route('**/api/v2/replay/sessions', route => route.fulfill({ json: { items: DEMO_SESSIONS } }))
let mode = 'retry', reads = 0, release, held
const item = DEMO_SESSIONS[0], payload = demoDashboardAnalytics(item, 'tenant-a')
await page.route('**/api/v2/replay/sessions/*/analytics*', async route => {
  reads++
  if (mode === 'retry' && reads === 1) return route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { detail: 'fixture_temporarily_unavailable' } })
  if (mode === 'retry' && reads === 2) { held = true; await new Promise(resolve => { release = resolve }) }
  if (mode === 'stale' && reads === 4) return route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { detail: 'fixture_refresh_unavailable' } })
  if (mode === 'invalid') return route.fulfill({ json: { schema_version: 'bad' } })
  if (mode === 'denied') return route.fulfill({ status: 403, json: { detail: 'fixture_denied' } })
  return route.fulfill({ json: payload })
})
const go = extra => page.goto(`${origin}/?workspace=tenant-a&area=testing&view=analytics&select=1&session=${item.record_id}${extra || ''}`)
try {
  await go()
  await page.getByTestId('read-recovery').first().waitFor()
  assert.match(await page.getByTestId('analytics-workspace').textContent(), /Không (đọc|tải) được kết quả/)
  assert.equal(await page.getByTestId('analytics-blocked').count(), 0, 'HTTP503 is not fabricated blocked capability')
  assert.equal(await page.getByRole('button', { name: 'Thử lại', exact: true }).count(), 0)
  await page.screenshot({ path: `${output}/analytics-error-retry.png`, animations: 'disabled' })
  for (let n = 0; n < 60 && !held; n++) await page.waitForTimeout(100)
  assert.ok(held, 'Automatic retry started')
  assert.match(await page.getByTestId('analytics-workspace').textContent(), /Không (đọc|tải) được kết quả/)
  assert.equal(await page.locator('.wm-skeleton').count(), 0, 'Initial error remains while retry is in flight')
  release()
  await page.locator('.fxa-report').first().waitFor()
  assert.equal(reads, 2)
  report.cases.push('503 + Retry-After automatically recovers, no refresh button and no skeleton on pending retry')
  await page.screenshot({ path: `${output}/analytics-recovered.png`, animations: 'disabled' })
  await page.evaluate(() => window.fixtureSnapshot('two'))
  await page.waitForTimeout(2300)
  assert.equal(reads, 3, 'Session revision reloads visible current-scope report')
  report.cases.push('Current report reconciles matching sessions revision')
  mode = 'stale'
  await page.evaluate(() => window.fixtureSnapshot('three'))
  await page.getByTestId('analytics-workspace').getByText('Dữ liệu chưa cập nhật. Kết quả đã đọc vẫn được giữ trên màn hình.', { exact: true }).waitFor()
  assert.ok(await page.locator('.fxa-report').first().isVisible())
  assert.equal(await page.getByTestId('analytics-workspace').locator('.wm-skeleton').count(), 0)
  await page.getByTestId('read-recovery').first().waitFor()
  await page.screenshot({ path: `${output}/analytics-stale-retained.png`, animations: 'disabled' })
  for (let n = 0; n < 60 && reads < 5; n++) await page.waitForTimeout(100)
  assert.equal(reads, 5)
  await page.waitForFunction(() => !document.querySelector('[data-testid=analytics-workspace] [data-testid=read-recovery]'))
  report.cases.push('Failed background refresh preserves charts/data and retries without skeleton or refresh button')
  mode = 'ready'; reads = 0; await go('&cursor=1400&event_sequence=0')
  await page.locator('.fxa-report').first().waitFor(); assert.equal(reads, 1)
  await page.evaluate(() => window.fixtureSnapshot('two'))
  await page.waitForTimeout(2300)
  assert.equal(reads, 1, 'Pinned historical report ignores current session revision')
  report.cases.push('Pinned cursor/event sequence ignores unrelated current-session revision')
  mode = 'invalid'; reads = 0; await go(); await page.getByTestId('analytics-workspace').getByRole('alert').first().waitFor(); await page.waitForTimeout(2500)
  assert.equal(reads, 1); assert.equal(await page.getByTestId('read-recovery').count(), 0)
  report.cases.push('Invalid read model fails without retry storm')
  mode = 'denied'; reads = 0; await go(); await page.locator('[data-empty-kind=denied]').waitFor(); await page.waitForTimeout(2500)
  assert.equal(reads, 1); assert.equal(await page.getByTestId('read-recovery').count(), 0)
  report.cases.push('403 clears report and has no automatic retry or button')
  mode = 'ready'
  let aggregateReads = 0
  const ledger = DEMO_LEDGER.slice(0, 10).map(row => ({ ...row, source_provenance: { session_id: row.session_id, revision: 1 } }))
  const trades = { schema_version: 'replay-trades-page-v1', status: 'ready', ledger, sources: [], excluded: [], scope: { session_ids: DEMO_SESSIONS.map(item => item.record_id) }, snapshot_key: 'fixture-one', pagination: { page: 1, page_size: 10, filtered_count: 10, returned_count: 10, page_count: 1 }, facets: { assets: [], tags: [], strategies: [], years: [], types: [] } }
  await page.route('**/api/v2/replay/trades?*', route => { aggregateReads++; return aggregateReads === 1 ? route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { detail: 'fixture_trades_unavailable' } }) : route.fulfill({ json: trades }) })
  await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=trade&sessions=all&select=1`)
  await page.getByTestId('aggregate-trades').getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('testing-trades-empty').isVisible(), false, 'Failed read cannot look like empty ledger')
  assert.equal(await page.getByRole('button', { name: 'Thử lại', exact: true }).count(), 0)
  await page.getByTestId('fx-trade-ledger').locator('tbody tr').first().waitFor()
  assert.equal(await page.getByTestId('fx-trade-ledger').locator('tbody tr').count(), 10)
  assert.equal(aggregateReads, 2)
  report.cases.push('Aggregate ledger recovers automatically and does not fabricate empty data on failure')
  await page.screenshot({ path: `${output}/aggregate-recovered.png`, animations: 'disabled' })
  let overviewReads = 0
  await page.route('**/api/v2/overview*', route => { overviewReads++; return overviewReads === 1 ? route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { detail: 'fixture_performance_unavailable' } }) : route.fulfill({ json: demoOverview() }) })
  await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=overview`)
  await page.getByTestId('dashboard-result-group').getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('dashboard-result-group').getByRole('button', { name: 'Thử lại', exact: true }).count(), 0)
  await page.getByTestId('dashboard-performance').waitFor()
  assert.equal(overviewReads, 2)
  report.cases.push('Dashboard Performance auto-recovers initial GET failure without a refresh button')
  await page.screenshot({ path: `${output}/performance-recovered.png`, animations: 'disabled' })
  assert.deepEqual(report.errors, []); report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack; await page.screenshot({ path: `${output}/failure.png`, animations: 'disabled' }); throw error
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors }))
}
