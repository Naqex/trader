import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/analytics-loading-20261028'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const report = { scope: 'Labeled analytics/path fixtures in the production UI; GET only, no simulations or broker writes', cases: [], errors: [], writes: [] }
const context = await browser.newContext({ viewport: { width: 1920, height: 940 }, reducedMotion: 'reduce' })
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin !== origin) return route.abort()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
  return route.continue()
})
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', error => report.errors.push(error.message))
const reads = []
let releaseDelayed, delayNext = false, failNext = false, revision = 1, missingRisk = false
const provenance = session => ({ session_id: session, dataset_id: 'loading-fixture', dataset_sha256: 'fixture-hash', revision, cursor_index: 100, execution_event_sequence: revision, account_currency: 'USD' })
const ledger = [100, -50].map((net_pnl, index) => ({ trade_id: `fixture-${index}`, status: 'closed', side: 'buy', symbol: 'EURUSD', quantity: 1, net_pnl, planned_risk_budget: 50, realized_r: net_pnl / 50, open_time_utc: 1767600000 + index * 86400, close_time_utc: 1767603600 + index * 86400, report_time_utc: 1767603600 + index * 86400, starting_balance: 10000 }))
await page.route('**/api/v2/journal/context*', route => route.fulfill({ json: { schema_version: 'replay-journal-context-v1', workspace_id: route.request().headers()['x-workspace-id'], session_id: new URL(route.request().url()).searchParams.get('session_id'), record_count: 0, trades: [] } }))
await page.route(/\/api\/v2\/replay\/sessions\/[^/]+\/analytics(?:\/experiments)?(?:\?.*)?$/, async route => {
  const url = new URL(route.request().url()), session = url.pathname.split('/')[5]
  const source = provenance(session)
  if (!url.pathname.endsWith('/experiments')) return route.fulfill({ json: { schema_version: 'analytics-read-model-v1', analytics_available: true, provenance: source, ledger: ledger.map(row => missingRisk ? { ...row, realized_r: null, planned_risk_budget: null } : row), scope: { total_trade_count: 2, selected_trade_count: 2, time_basis: 'market' }, metrics: { starting_balance: 10000, closed_trade_count: 2 } } })
  const value = url.searchParams.get('side') === 'buy' ? 8.5 : 4.5
  reads.push({ path: url.pathname, side: url.searchParams.get('side'), revision: source.revision, workspace: route.request().headers()['x-workspace-id'] })
  if (delayNext) { delayNext = false; await new Promise(resolve => { releaseDelayed = resolve }) }
  if (failNext) { failNext = false; return route.fulfill({ status: 422, json: { detail: 'fixture_path_unavailable' } }) }
  return route.fulfill({ json: { schema_version: 'replay-analytics-experiments-v1', read_only: true, provenance: source, config: Object.fromEntries(['stop_distance_ticks', 'stop_multiplier', 'target_r'].map(key => [key, Number(url.searchParams.get(key))])), rows: ledger.map(row => ({ trade_id: row.trade_id, realized_r: row.realized_r, excursion: { r_basis: 'initial_stop_distance', mae_r: .3 }, ideal: { status: 'complete_week', value_r: value, could_have_profit_or_breakeven: true } })) } })
})
const href = tab => `${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&surface=workspace&session=loading-fixture&lang=vi&analytics_tab=${tab}`
const navigateQuery = changes => page.evaluate(changes => {
  const url = new URL(location.href)
  for (const [key, value] of Object.entries(changes)) value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value)
  history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'))
}, changes)
const ideal = () => page.locator('.fxa-risk-panels > section').nth(1).locator('strong').first()
try {
  await page.goto(href('simulation'))
  await page.getByTestId('monte-carlo-simulator').waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(), 0)
  assert.equal(await page.getByTestId('analytics-drawdown').count(), 0)
  await page.locator('.fxa-monte-controls input[name="trades"]').fill('321')
  assert.equal(reads.length, 0)
  report.cases.push('Direct Simulation mounts only its panel and does not request default price experiments')

  delayNext = true
  await page.locator('#fxa-tab-performance').click()
  await page.locator('.fxa-risk-panels').scrollIntoViewIfNeeded()
  const calendar = page.getByTestId('analytics-calendar')
  await calendar.locator('.wm-calendar-day[data-date="2026-01-05"]').click()
  await page.getByTestId('calendar-day-detail').waitFor()
  assert.equal(typeof releaseDelayed, 'function')
  releaseDelayed()
  await page.waitForFunction(() => document.querySelectorAll('.fxa-risk-panels > section')[1]?.querySelector('strong')?.textContent === '4,5')
  assert.equal(await page.getByTestId('calendar-day-detail').count(), 1)
  report.cases.push('Delayed price-path enrichment preserves the selected calendar day in the same report scope')
  assert.equal(reads.length, 1)
  assert.equal(await page.getByTestId('analytics-drawdown').count(), 0)
  await page.locator('#fxa-tab-performance').focus(); await page.keyboard.press('ArrowRight')
  await page.getByTestId('analytics-drawdown').waitFor()
  await page.locator('.fxa-mae-panel').scrollIntoViewIfNeeded()
  await page.locator('.fxa-winning-mae-panel').getByText('0,3', { exact: true }).first().waitFor()
  assert.equal(reads.length, 1)
  await page.locator('#fxa-tab-simulation').click()
  assert.equal(await page.locator('.fxa-monte-controls input[name="trades"]').inputValue(), '321')
  report.cases.push('Visible RR receives path data; keyboard Drawdown reuses it for MAE; Monte Carlo input survives tab revisit')

  await navigateQuery({ analytics_tab: 'performance', side: 'buy' })
  await page.locator('.fxa-risk-panels').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelectorAll('.fxa-risk-panels > section')[1]?.querySelector('strong')?.textContent === '8,5')
  assert.equal(reads.length, 2)
  assert.equal(await page.getByTestId('calendar-day-detail').count(), 0)
  await page.goBack()
  await page.getByTestId('analytics-simulation').waitFor()
  report.cases.push('External query navigation mounts the right tab and filter scope; browser Back has no blank panel')

  // Each fresh document starts with one panel; offscreen MAE waits for scrolling.
  await page.setViewportSize({ width: 390, height: 844 })
  const before = reads.length
  await page.goto(href('drawdown'))
  await page.getByTestId('analytics-drawdown').waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(), 0)
  assert.equal(await page.getByTestId('analytics-simulation').count(), 0)
  assert.equal(reads.length, before)
  await page.locator('.fxa-mae-panel').scrollIntoViewIfNeeded()
  await page.locator('.fxa-winning-mae-panel').getByText('0,3', { exact: true }).first().waitFor()
  assert.equal(reads.length, before + 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.screenshot({ path: `${out}/drawdown-390.png` })
  report.cases.push('390px direct Drawdown defers offscreen MAE read until visible; no overflow')

  await page.setViewportSize({ width: 1920, height: 940 })
  delayNext = true
  await navigateQuery({ analytics_tab: 'performance', side: 'buy' })
  await page.locator('.fxa-risk-panels').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.fxa-risk-panels'))
  await assert.doesNotReject(async () => { for (let i = 0; i < 50 && !releaseDelayed; i++) await page.waitForTimeout(50); assert.ok(releaseDelayed) })
  revision++
  await navigateQuery({ side: 'sell' })
  await page.locator('.fxa-risk-panels').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelectorAll('.fxa-risk-panels > section')[1]?.querySelector('strong')?.textContent === '4,5')
  releaseDelayed(); releaseDelayed = null
  await page.waitForTimeout(150)
  assert.equal(await ideal().textContent(), '4,5')
  report.cases.push('Delayed old filter/revision response cannot replace current RR')

  failNext = true
  await navigateQuery({ analytics_tab: 'drawdown', side: null, outcome: 'loss' })
  await page.locator('.fxa-mae-panel').scrollIntoViewIfNeeded()
  await page.locator('.fxa-mae-panel [role="alert"]').getByText(/fixture_path_unavailable/).waitFor()
  await navigateQuery({ session: 'loading-fixture-next', outcome: null })
  await page.locator('.fxa-mae-panel').scrollIntoViewIfNeeded()
  await page.locator('.fxa-winning-mae-panel').getByText('0,3', { exact: true }).first().waitFor()
  assert.equal(await page.locator('.fxa-mae-panel [role="alert"]').count(), 0)
  assert.equal(reads.at(-1).path, '/api/v2/replay/sessions/loading-fixture-next/analytics/experiments')
  assert.equal(reads.at(-1).workspace, 'tenant-a')
  report.cases.push('Path error is explicit; source change clears old errors/data and retains workspace authorization')

  missingRisk = true
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(href('performance') + '&analytics_outcomes=' + encodeURIComponent('["win"]'))
  await page.getByTestId('analytics-performance').waitFor()
  const thresholdReads = reads.length
  await page.locator('.fxa-threshold input').fill('0.1')
  await page.locator('.fxa-threshold button[type="submit"]').click()
  await page.getByTestId('analytics-performance').waitFor()
  await page.waitForFunction(() => document.querySelector('.fxa-risk-panels strong')?.textContent === '2')
  assert.equal(reads.length, thresholdReads + 1)
  report.cases.push('Nonzero breakeven threshold requests R before viewport demand; win filter recovers instead of staying empty')

  await page.goto(`${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&demo=1&lang=vi`)
  await page.getByTestId('analytics-calendar').locator('.wm-calendar-day:not(:disabled)').first().click()
  await page.getByTestId('calendar-day-detail').waitFor()
  await page.locator('.fxa-session-trigger').click()
  await page.locator('.fxa-session-options button:not(.is-selected)').first().click()
  assert.equal(await page.getByTestId('calendar-day-detail').count(), 1, 'Draft session preserves the current day')
  await page.locator('.fxa-apply-button').click()
  await page.getByTestId('calendar-day-detail').waitFor({ state: 'hidden' })
  report.cases.push('Demo session draft preserves calendar selection; Apply closes details for the new report scope')

  assert.deepEqual(report.errors, []); assert.deepEqual(report.writes, [])
  report.status = 'PASS'; console.log(`PASS ${report.cases.length} analytics loading journeys`)
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true })
  throw error
} finally {
  report.reads = reads
  await writeFile(`${out}/browser.json`, JSON.stringify(report, null, 2))
  releaseDelayed?.(); await browser.close()
}
