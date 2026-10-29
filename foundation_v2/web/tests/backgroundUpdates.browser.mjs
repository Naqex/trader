import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_BACKGROUND_UI_ORIGIN || 'http://127.0.0.1:5188'
const output = process.env.TW_BACKGROUND_UI_EVIDENCE || fileURLToPath(new URL('../.artifacts/backgroundUpdates.browser', import.meta.url))
await mkdir(output, { recursive: true })
const report = { fixture: true, checks: [], errors: [], mutations: [] }
const streams = new Set()
let propRevision = 1, researchRevision = 1, connections = 0, available = true, delaySnapshot = false
const snapshot = () => ({ schema_version: 'workspace-events-v1', workspace_id: 'tenant-a', revision: `${propRevision}:${researchRevision}`,
  downloads: { qdm: { jobs: [] }, dukascopy: { jobs: [] } }, research: { recent_jobs: [] },
  resources: { prop: { revision: String(propRevision) }, research: { revision: String(researchRevision) }, sessions: { revision: 'unchanged' }, datasets: { revision: 'unchanged' } } })
const emit = () => { for (const res of streams) res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`) }
const server = createServer((req, res) => {
  connections++
  if (!available) { res.writeHead(503); res.end(); return }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
  streams.add(res); if (!delaySnapshot) emit()
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 1000)
  req.on('close', () => { clearInterval(timer); streams.delete(res) })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const browser = await chromium.launch()
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
const propReport = balance => ({ schema_version: 'prop-attempt-report-v1', mode: 'simulation', broker_execution_capability: false,
  session: { session_id: 'fixture-prop' }, attempt: { attempt_id: 'fixture-attempt', revision: propRevision },
  profile: { profile_id: 'Fixture', terms_version: 'fixture-v1' }, outcome: { status: 'running' },
  phase: { phase_index: 1, currency: 'USD', balance, equity: balance, floating_pl: 0, qualifying_days: 0, virtual_time_utc: '2026-10-01T00:00:00Z' } })
let page
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 940 } })
    page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    let propReads = 0, jobReads = 0, balance = 10000, status = 'running', release, held = false, deny = false
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.mutations.push(url.pathname); return route.abort() }
      if (url.pathname === '/api/v2/events') return route.continue({ url: `http://127.0.0.1:${port}/events` })
      if (url.pathname === '/api/v2/prop/reports') { propReads++; return json(route, { schema_version: 'prop-report-list-v1', broker_execution_capability: false, items: [propReport(balance)] }) }
      if (url.pathname === '/api/v2/research/jobs/fixture-job') {
        jobReads++
        const captured = { job_id: 'fixture-job', dataset_id: 'fixture-data', status, starting_balance: 10000, strategy_version: 'close-delta-v1' }
        if (held) await new Promise(resolve => { release = resolve })
        return deny ? json(route, { detail: 'fixture_denied' }, 403) : json(route, captured)
      }
      if (url.pathname.endsWith('/fixture-job/checkpoint')) return json(route, { checkpoint: { phase: 'fixture' }, progress: { percent: 50 } })
      return route.continue()
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=analytics&analytics_source=prop&lang=vi`)
    await page.locator('[data-testid=prop-analytics][data-state=ready]').waitFor()
    await page.waitForFunction(() => document.querySelector('[data-testid=prop-analytics]')?.getAttribute('aria-busy') === 'false')
    // Allow the single initial race reconciliation to settle, then count quiet traffic.
    await page.waitForTimeout(2500)
    const quietProp = propReads, streamCount = connections
    emit(); emit(); await page.waitForTimeout(2500)
    assert.equal(propReads, quietProp); assert.equal(connections, streamCount)
    balance = 12345.67; propRevision++; emit()
    await page.waitForFunction(() => /12[.,]345[.,]67/.test(document.querySelector('.fxa-prop-page')?.textContent))
    assert.equal(propReads, quietProp + 1)
    await page.screenshot({ path: `${output}/prop-${width}.png` })
    report.checks.push({ width, propRevisionRefresh: true, unchangedSnapshotNoReads: true, sharedStream: true })

    // Hold the first GET's old result while the first snapshot already observes completion.
    held = true; delaySnapshot = true
    await page.goto(`${origin}/?workspace=tenant-a&view=research&job=fixture-job&lang=vi`)
    for (let attempt = 0; !release && attempt < 100; attempt++) await page.waitForTimeout(20)
    assert.ok(release)
    status = 'failed'; researchRevision++; delaySnapshot = false; emit(); held = false; release()
    await page.getByTestId('research-terminal-result').waitFor({ timeout: 15000 })
    const quietJob = jobReads
    await page.waitForTimeout(3000)
    assert.equal(jobReads, quietJob)
    assert.ok(quietJob >= 2 && quietJob <= 3)
    // Research updates are not limited to the server's recent-job ID list.
    status = 'canceled'; researchRevision++; emit()
    await page.getByTestId('research-terminal-result').filter({ hasText: 'Đã hủy' }).waitFor()
    const beforeReconnect = jobReads
    for (const stream of streams) stream.end()
    await page.waitForFunction(() => document.querySelector('.rs-result-terminal')?.textContent.includes('Đã hủy'))
    await page.waitForTimeout(3500)
    assert.ok(jobReads > beforeReconnect)
    if (width === 1440) {
      available = false
      for (const stream of streams) stream.end()
      const beforeFallback = jobReads
      await page.waitForTimeout(16500)
      assert.ok(jobReads > beforeFallback, 'disconnected stream must have bounded read fallback')
      available = true
    }
    deny = true; researchRevision++; emit()
    for (let attempt = 0; !streams.size && attempt < 220; attempt++) await page.waitForTimeout(100)
    await page.waitForFunction(() => !document.querySelector('[data-testid=research-terminal-result]'), null, { timeout: 15000 })
    await page.screenshot({ path: `${output}/denied-${width}.png` })
    report.checks.push({ width, initialReadRaceReconciled: true, noHealthyPolling: true, absentRecentJobStillUpdates: true, reconnectReadsOnly: true, deniedClearsData: true })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.mutations, [])
} catch (error) {
  report.failure = error.stack
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  for (const stream of streams) stream.end()
  await new Promise(resolve => server.close(resolve))
  report.connections = connections
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
