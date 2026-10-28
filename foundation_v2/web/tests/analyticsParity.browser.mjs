import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/analytics-parity-20261028'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const cases = [], errors = [], writes = [], reads = []
const context = await browser.newContext({ viewport: { width: 1920, height: 940 } })
await context.route('**/*', route => {
  const request = route.request()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(request.url()); return route.abort() }
  return new URL(request.url()).origin === origin ? route.continue() : route.abort()
})
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
const makeReport = (id, cursor, sequence) => ({
  schema_version: 'prop-attempt-report-v1', mode: 'simulation', broker_execution_capability: false,
  session: { session_id: `challenge-${id}` }, attempt: { attempt_id: `attempt-${id}`, revision: 1, virtual_start_utc: '2026-01-01T00:00:00Z' },
  phase: { phase_index: 1, initial_balance: 10000, currency: 'USD', last_event_sequence: sequence, evaluation_quality: 'full_for_declared_model' },
  profile: { profile_id: `Challenge ${id}`, terms_version: 'fixture' }, outcome: { status: 'running' },
  provenance: { replay_binding: { replay_session_id: `qa-${id}`, dataset_id: 'fixture', dataset_sha256: 'fixture-sha', branch_id: 'main', last_replay_event_sequence: sequence }, replay_cursor: { bar_index: cursor } },
})
const first = makeReport('one', 11, 3), second = makeReport('two', 22, 4), unbound = { ...makeReport('unbound', 0, 0), provenance: {} }
let reports = [first, second, unbound], catalogStatus = 200, holdCatalog = false, releaseCatalog
await page.route('**/api/v2/prop/reports', route => route.fulfill({ json: { schema_version: 'prop-report-list-v1', broker_execution_capability: false, items: reports } }))
await page.route('**/api/v2/replay/sessions', async route => {
  if (holdCatalog) await new Promise(resolve => { releaseCatalog = resolve })
  await route.fulfill({ status: catalogStatus, json: catalogStatus === 200 ? { items: [{ record_id: 'qa-one', revision: 1, name: 'Session one', dataset_id: 'fixture', created_at_utc: '2026-01-01T00:00:00Z' }] } : { detail: 'fixture_catalog_denied' } }).catch(() => {})
})
await page.route('**/api/v2/journal/context*', route => route.fulfill({ json: { schema_version: 'replay-journal-context-v1', workspace_id: 'tenant-a', session_id: new URL(route.request().url()).searchParams.get('session_id'), record_count: 0, trades: [] } }))
await page.route(/\/api\/v2\/replay\/sessions\/[^/]+\/analytics(?:\/experiments)?(?:\?.*)?$/, route => {
  const url = new URL(route.request().url()), session = url.pathname.split('/')[5]
  if (url.pathname.endsWith('/experiments')) return route.fulfill({ status: 422, json: { detail: 'fixture_no_price_path' } })
  reads.push({ session, cursor: url.searchParams.get('cursor_index'), sequence: url.searchParams.get('event_sequence'), workspace: route.request().headers()['x-workspace-id'] })
  const ledger = [100, -50].map((net_pnl, index) => ({ trade_id: `fixture-${index}`, status: 'closed', side: 'buy', symbol: 'EURUSD', quantity: 1, net_pnl, planned_risk_budget: 50, realized_r: net_pnl / 50, open_time_utc: 1767600000 + index * 86400, close_time_utc: 1767603600 + index * 86400, report_time_utc: 1767603600 + index * 86400, starting_balance: 10000, close_phase_index: 1 }))
  return route.fulfill({ json: { schema_version: 'analytics-read-model-v1', analytics_available: true, provenance: { session_id: session, dataset_id: 'fixture', dataset_sha256: 'fixture-sha', branch_id: 'main', phase_index: 1, account_currency: 'USD', execution_event_sequence: Number(url.searchParams.get('event_sequence') || 3), revision: 1, cursor_index: Number(url.searchParams.get('cursor_index') || 11) }, ledger, scope: { selected_trade_count: 2, total_trade_count: 2, time_basis: 'market' }, metrics: { starting_balance: 10000, closed_trade_count: 2 } } })
})
const href = (source, suffix = '') => `${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&lang=vi&analytics_source=${source}${suffix}`
const applied = () => page.getByTestId('analytics-filters').getByRole('button', { name: /^(Áp dụng|Apply)$/ })
const selectSession = async name => {
  await page.locator('.fxa-session-trigger').click()
  await page.getByRole('dialog').getByRole('button').filter({ hasText: name }).click()
}
const go = changes => page.evaluate(changes => {
  const url = new URL(location.href)
  for (const [key, value] of Object.entries(changes)) value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'))
}, changes)
try {
  await page.goto(href('prop', '&prop_session=challenge-one&attempt=attempt-one&analytics_strategy=missing&analytics_reportKinds=%5B%22app%22%5D'))
  await page.getByTestId('analytics-performance').waitFor()
  assert.equal(await page.locator('.fxa-prop-selector').count(), 0)
  const row = page.locator('.fxa-analytics-filter-row')
  assert.equal(await row.getByRole('button', { name: /^(Loại|Type|Chiến lược|Strategy)$/ }).count(), 0)
  const labels = await row.locator(':scope > *').allTextContents()
  const sessionIndex = labels.findIndex(label => /^(Phiên|Session)$/.test(label.trim()))
  assert.ok(/Nhãn|Tags/.test(labels[sessionIndex - 1]))
  assert.ok(/Ngày/.test(labels[sessionIndex + 1]))
  assert.equal(await page.locator('.fxa-filter-chips').getByRole('button', { name: /Loại|Chiến lược/ }).count(), 0)
  cases.push('Prop: Tags -> Session -> Day; no top selector, Type/Strategy, or hidden filter effect')

  const before = reads.length, originalUrl = page.url()
  await selectSession('Challenge two')
  assert.equal(page.url(), originalUrl); assert.equal(reads.length, before)
  await applied().click()
  await page.waitForURL(/attempt=attempt-two/)
  await page.getByTestId('analytics-performance').waitFor()
  assert.deepEqual(reads.at(-1), { session: 'qa-two', cursor: '22', sequence: '4', workspace: 'tenant-a' })
  assert.equal(new URL(page.url()).searchParams.has('analytics_strategy'), false)
  assert.equal(new URL(page.url()).searchParams.has('analytics_reportKinds'), false)
  await go({ prop_session: 'challenge-one', attempt: 'attempt-one' })
  await page.getByTestId('analytics-performance').waitFor()
  assert.equal(reads.at(-1).session, 'qa-one')
  await page.goBack(); await page.getByTestId('analytics-performance').waitFor()
  assert.equal(reads.at(-1).session, 'qa-two')
  cases.push('Prop draft selection waits for Apply; exact attempt cursor/event scope, URL and Back preserved')

  await page.goto(href('prop', '&prop_session=challenge-unbound&attempt=attempt-unbound'))
  await page.getByTestId('prop-analytics-objectives').waitFor()
  await selectSession('Challenge one')
  await page.getByTestId('analytics-performance').waitFor()
  await page.goto(href('prop', '&prop_session=missing&attempt=missing'))
  await page.locator('.fxa-empty').filter({ hasText: /Không tìm thấy/ }).waitFor()
  await selectSession('Challenge two'); await page.getByTestId('analytics-performance').waitFor()
  reports = []
  await page.goto(href('prop'))
  await page.locator('.fxa-empty').filter({ hasText: /Chưa có báo cáo/ }).waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(), 0)
  reports = [first, second, unbound]
  cases.push('Unbound and missing attempts retain recovery picker; no reports shows honest empty state')

  holdCatalog = true
  await page.goto(href('sessions', '&session=qa-one&cursor=11&event_sequence=3'))
  await page.getByTestId('analytics-performance').waitFor()
  assert.ok(releaseCatalog, 'Catalog is still blocked when report is already rendered')
  assert.equal(await page.locator('.fxa-session-trigger').isDisabled(), true)
  const readCount = reads.length
  releaseCatalog(); releaseCatalog = null; holdCatalog = false
  await page.locator('.fxa-session-trigger:not(:disabled)').waitFor()
  assert.equal(reads.length, readCount, 'Catalog metadata must not refetch the report')
  assert.deepEqual(reads.at(-1), { session: 'qa-one', cursor: '11', sequence: '3', workspace: 'tenant-a' })
  cases.push('Explicit Session renders before delayed catalog; metadata arrival causes no extra report read')

  holdCatalog = true
  await context.clearCookies()
  await page.goto(href('sessions'))
  await page.getByRole('status', { name: /Đang tải (danh mục|danh sách) phiên/ }).waitFor()
  assert.equal(reads.length, readCount)
  releaseCatalog(); releaseCatalog = null; holdCatalog = false
  await page.getByTestId('analytics-performance').waitFor()
  assert.equal(reads.at(-1).session, 'qa-one')
  cases.push('Default Session waits for authoritative catalog and chooses valid session')

  holdCatalog = true; catalogStatus = 403
  await page.goto(href('sessions', '&session=qa-one'))
  await page.getByTestId('analytics-performance').waitFor()
  releaseCatalog(); releaseCatalog = null; holdCatalog = false
  await page.locator('[data-empty-kind="denied"]').waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(), 0)
  catalogStatus = 200
  cases.push('Catalog denial removes already rendered explicit report; no stale data remains')

  for (const [width, theme] of [[1920, 'dark'], [390, 'light']]) {
    await page.setViewportSize({ width, height: 940 })
    await page.goto(href('prop', `&prop_session=challenge-one&attempt=attempt-one&theme=${theme}`))
    await page.getByTestId('analytics-performance').waitFor()
    if (await page.locator('.fx-app').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.locator('.fxa-session-trigger').click()
    const bounds = await page.getByRole('dialog').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    await page.screenshot({ path: `${out}/filters-${width}-${theme}.png` })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.fxa-session-trigger').getAttribute('aria-expanded'), 'false')
  }
  cases.push('1920 dark / 390 light: bounded picker, no document overflow, keyboard Escape')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  console.log(JSON.stringify({ status: 'PASS', cases: cases.length }))
} catch (error) {
  await writeFile(`${out}/failure.txt`, await page.locator('body').innerText())
  await page.screenshot({ path: `${out}/failure.png` })
  throw error
} finally {
  releaseCatalog?.()
  await writeFile(`${out}/report.json`, JSON.stringify({ scope: 'Labeled read-only fixtures; no backend/broker writes', cases, errors, writes, reads }, null, 2))
  await browser.close()
}
