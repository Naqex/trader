import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { verifyNativePortfolioRules, verifyNativePortfolioCalendar } from './nativeMultiassetRules.mjs'

const [origin, out] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1368, height: 790 } })
page.setDefaultTimeout(15000)
const headers = { 'X-Workspace-Id': 'tenant-a' }
const errors = [], cases = [], requests = []
page.on('pageerror', error => errors.push(error.stack || error.message))
page.on('request', request => {
  if (request.url().includes('/api/') && request.method() === 'POST') {
    const body = request.postDataJSON()
    if (body?.csv_text) { body.csv_rows = body.csv_text.split('\n').length - 1; delete body.csv_text }
    requests.push({ path: new URL(request.url()).pathname, body })
  }
})
const near = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - Number(expected)) < 0.000001, `${label}: ${actual} != ${expected}`)
async function request(method, route, body, status = 200, workspace = 'tenant-a') {
  const response = method === 'GET'
    ? await page.request.get(origin + route, { headers: { 'X-Workspace-Id': workspace } })
    : await page.evaluate(async ({ route, method, body, workspace }) => {
      const { scopedMutation } = await import('/src/scopedMutation.js')
      const result = await scopedMutation(route, workspace, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: result.status, body: await result.json() }
    }, { route, method, body, workspace })
  const result = method === 'GET' ? { status: response.status(), body: await response.json() } : response
  assert.equal(result.status, status, `${method} ${route}: ${JSON.stringify(result.body)}`)
  return result.body
}
const replayPath = record => `/api/v2/replay/sessions/${record.record_id}`
const read = record => request('GET', replayPath(record))
const frame = async () => (await page.locator('iframe[id^="tradingview_"]').elementHandle()).contentFrame()
function executions(record) { return Object.values(record.payload.asset_states).map(state => state.execution).filter(Boolean) }
function checkAccount(record) {
  const account = record.portfolio_account, states = executions(record)
  const initial = Number(record.payload.starting_balance || 10000)
  const balance = initial + states.reduce((sum, state) => sum + Number(state.balance) - initial, 0)
  const floating = states.reduce((sum, state) => sum + Number(state.floating_pl || 0), 0)
  near(account.balance, balance, 'initial capital counted once plus each realized result')
  near(account.equity, balance + floating, 'equity sums all floating positions')
  assert.equal(account.open_position_count, states.filter(state => state.position).length)
}
async function synced(record, attemptPath) {
  if (!attemptPath) return null
  await page.waitForFunction(() => { const step = document.querySelector('[data-testid=step-1]'); return step && !step.disabled })
  const bundle = await request('GET', attemptPath)
  const aggregate = record.payload.portfolio_execution
  assert.ok(aggregate, 'native multiasset aggregate execution exists')
  assert.equal(bundle.resume_state.replay_binding.last_replay_event_sequence, aggregate.event_sequence)
  assert.equal(bundle.attempt.data_version, aggregate.primary_dataset_sha256)
  assert.equal(bundle.resume_state.replay_binding.dataset_sha256, aggregate.dataset_sha256)
  near(bundle.phase.balance, record.portfolio_account.balance, 'Prop uses portfolio balance')
  near(bundle.phase.equity, record.portfolio_account.equity, 'Prop uses portfolio equity')
  assert.equal(bundle.phase.open_positions, record.portfolio_account.open_position_count)
  if (bundle.phase.evaluation_quality !== 'full_for_declared_model') {
    assert.equal(bundle.resume_state.prop_lifecycle.last_objectives.technical_status, 'blocked_by_data')
    assert.equal(bundle.attempt.status, 'running', 'incomplete BAR intrabar coverage does not claim a pass or breach')
  }
  return bundle
}
async function mutateFromUi(record, suffix, click) {
  const suffixes = Array.isArray(suffix) ? suffix : [suffix]
  const response = page.waitForResponse(r => suffixes.some(value => new URL(r.url()).pathname === replayPath(record) + '/' + value) && r.request().method() === 'POST')
  await click()
  const saved = await response
  assert.equal(saved.status(), 200, await saved.text())
  await page.waitForFunction(() => { const step = document.querySelector('[data-testid=step-1]'); return step && !step.disabled })
  return read(record)
}
async function choose(record, symbol) {
  await (await frame()).locator('.legacy-symbol').click()
  const selected = await mutateFromUi(record, 'asset', () => page.locator('.replay-watchlist').getByRole('button', { name: new RegExp('^' + symbol) }).click())
  const close = page.getByRole('button', { name: 'Đóng panel', exact: true })
  if (await close.isVisible()) await close.click()
  await page.locator('[data-chart-status="ready"]').waitFor({ timeout: 30000 })
  await (await frame()).locator('.legacy-symbol').filter({ hasText: symbol }).waitFor()
  return selected
}
async function protect(record, kind, delta) {
  const handle = (await frame()).locator(`[data-order-kind=${kind}] [data-order-drag]`)
  const bounds = await handle.boundingBox()
  assert.ok(bounds)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + delta, { steps: 10 })
  return mutateFromUi(record, 'orders/protection', () => page.mouse.up())
}
async function create(mode, name) {
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${mode}`)
  const dialog = page.locator('.quick-session-dialog')
  await dialog.waitFor()
  await dialog.locator('input[required]').first().fill(name)
  for (const symbol of ['EURUSD', 'GBPUSD']) {
    await dialog.locator('.dataset-asset-select .fx-select-trigger').click()
    await page.getByRole('option', { name: new RegExp(symbol) }).click()
  }
  assert.equal(await dialog.locator('.fx-select-tag').count(), 2, `${mode} supports multiple selected assets`)
  await dialog.getByRole('textbox', { name: 'Ngày bắt đầu phiên (UTC)', exact: true }).fill('02/01/2020 00:00')
  await dialog.getByRole('button', { name: 'Tạo phiên', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('surface') === 'workspace', { timeout: 30000 })
  await page.locator('[data-chart-status="ready"]').waitFor({ timeout: 30000 })
  await page.waitForFunction(() => { const step = document.querySelector('[data-testid=step-1]'); return step && !step.disabled })
  const url = new URL(page.url())
  const record = await request('GET', `/api/v2/replay/sessions/${url.searchParams.get('session')}`)
  assert.equal(record.payload.dataset_ids.length, 2)
  const attemptPath = mode === 'prop' ? `/api/v2/prop/sessions/${url.searchParams.get('prop_session')}/attempts/${url.searchParams.get('prop_attempt')}` : null
  return { record, attemptPath }
}
try {
  await page.goto(origin)
  const datasets = []
  for (const [symbol, start, direction] of [['EURUSD', 1.1, 1], ['GBPUSD', 1.5, -1]]) {
    const csv = 'time,open,high,low,close,volume\n' + Array.from({ length: 2880 }, (_, i) => {
      const price = start + direction * i * .0001
      return `${1577923200 + i * 60},${price.toFixed(5)},${(price + .0004).toFixed(5)},${(price - .0004).toFixed(5)},${price.toFixed(5)},10`
    }).join('\n')
    const result = await request('POST', '/api/v2/data/csv/import', {
      csv_text: csv, source: { source_id: `native-multiasset-${symbol}`, provider: 'fixture', instrument_mapping: { [symbol]: symbol }, license_use: 'qa-only', retrieved_at_utc: '2026-10-18T00:00:00Z', export_settings: 'generated synthetic trend' },
      instrument: { instrument_id: symbol, asset_class: 'fx', base_ccy: symbol.slice(0, 3), quote_ccy: 'USD', account_ccy: 'USD', contract_size: '100000', tick_size: '0.00001', pip_size: '0.0001', quantity_min: '0.01', quantity_step: '0.01', effective_from_utc: '2020-01-01T00:00:00Z', effective_to_utc: '' },
      timeframe_seconds: 60, holdout_policy: { mode: 'none' },
    }, 201)
    datasets.push(result.dataset)
  }
  let propTemplate
  for (const mode of ['backtest', 'prop']) {
    let { record, attemptPath } = await create(mode, 'MULTI-' + mode)
    if (attemptPath) propTemplate = await request('GET', attemptPath)
    record = await mutateFromUi(record, ['orders/quick', 'orders/market'], () => page.locator('.legacy-trading-bar button.buy').click())
    assert.equal(record.payload.execution.position.side, 'BUY')
    assert.equal(record.payload.execution.pending_market_order, null)
    const firstAsset = record.payload.dataset_id
    const firstPosition = record.payload.execution.position.position_id
    checkAccount(record)
    await synced(record, attemptPath)
    const firstAccount = structuredClone(record.portfolio_account), clock = record.payload.replay_clock_utc
    record = await choose(record, 'GBPUSD')
    assert.equal(record.payload.replay_clock_utc, clock)
    assert.deepEqual(record.portfolio_account, firstAccount, 'asset switch never resets or adds capital')
    record = await mutateFromUi(record, ['orders/quick', 'orders/market'], () => page.locator('.legacy-trading-bar button.sell').click())
    assert.equal(record.payload.execution.position.side, 'SELL')
    assert.equal(record.portfolio_account.open_position_count, 2)
    checkAccount(record)
    const bundle = await synced(record, attemptPath)
    if (bundle) {
      assert.equal(bundle.resume_state.open_positions.length, 2)
      assert.deepEqual(new Set(bundle.resume_state.open_positions.map(position => position.dataset_id)), new Set(record.payload.dataset_ids))
    }
    const beforeStep = record.payload.replay_clock_utc
    record = await mutateFromUi(record, 'step', () => page.getByTestId('step-1').click())
    assert.ok(record.payload.replay_clock_utc > beforeStep)
    assert.ok(Object.values(record.payload.asset_states).every(state => state.cursor_index > 0), 'one clock advances both assets')
    checkAccount(record)
    await synced(record, attemptPath)
    // Move SELL protection by its real chart handles, then preserve both through switching.
    record = await protect(record, 'target', 45)
    record = await protect(record, 'stop', -180)
    const protectedPosition = record.payload.execution.position
    assert.ok(Number(protectedPosition.take_profit) < Number(protectedPosition.entry_fill))
    assert.ok(Number(protectedPosition.stop_loss) > Number(protectedPosition.entry_fill))
    await synced(record, attemptPath)
    const beforeSwitch = structuredClone(record.portfolio_account)
    record = await choose(record, 'EURUSD')
    assert.equal(record.payload.dataset_id, firstAsset)
    assert.equal(record.payload.execution.position.position_id, firstPosition)
    assert.deepEqual(record.portfolio_account, beforeSwitch)
    const entry = (await frame()).locator('[data-order-kind=entry]')
    await entry.waitFor()
    await (await frame()).locator('[data-order-kind=entry] .wm-order-marker-close').click()
    record = await mutateFromUi(record, 'orders/close', () => page.locator('.chart-order-close-dialog button.is-destructive').click())
    assert.equal(record.portfolio_account.open_position_count, 1)
    checkAccount(record)
    await synced(record, attemptPath)
    record = await choose(record, 'GBPUSD')
    assert.equal(record.payload.execution.position.take_profit, protectedPosition.take_profit)
    assert.equal(record.payload.execution.position.stop_loss, protectedPosition.stop_loss)
    await page.reload()
    await page.locator('[data-chart-status="ready"]').waitFor({ timeout: 30000 })
    await page.waitForFunction(() => { const step = document.querySelector('[data-testid=step-1]'); return step && !step.disabled })
    const restored = await read(record)
    assert.deepEqual(restored.portfolio_account, record.portfolio_account)
    assert.deepEqual(restored.payload.asset_states, record.payload.asset_states)
    await synced(restored, attemptPath)
    await page.screenshot({ path: path.join(out, `${mode}-two-assets-resumed.png`) })
    if (mode === 'prop') {
      await page.setViewportSize({ width: 390, height: 844 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'portfolio chart stays within mobile viewport')
      await page.screenshot({ path: path.join(out, 'prop-two-assets-mobile.png') })
      await page.setViewportSize({ width: 1368, height: 790 })
    }
    record = restored
    await (await frame()).locator('[data-order-kind=entry] .wm-order-marker-close').click()
    record = await mutateFromUi(record, 'orders/close', () => page.locator('.chart-order-close-dialog button.is-destructive').click())
    checkAccount(record)
    const flat = await synced(record, attemptPath)
    assert.equal(record.portfolio_account.open_position_count, 0)
    if (flat) {
      assert.equal(flat.phase.evaluation_quality, 'insufficient', 'flat current quote cannot certify an unresolved historical equity path')
      assert.equal(flat.resume_state.prop_lifecycle.last_objectives.technical_status, 'blocked_by_data', 'later flat quote cannot erase an earlier unknown intrabar path')
    }
    if (mode === 'backtest') {
      const beforeRead = await read(record)
      await request('GET', replayPath(record) + '?cursor_index=0')
      assert.deepEqual(await read(record), beforeRead, 'portfolio historical read preserves canonical state')
      const branch = await request('POST', replayPath(record) + '/branch', { expected_revision: record.revision, cursor_index: 0 }, 201)
      assert.notEqual(branch.record_id, record.record_id)
      assert.equal(branch.payload.parent_session_id, record.record_id)
      assert.equal(branch.payload.dataset_ids.length, 2)
      checkAccount(branch)
      assert.deepEqual(await read(record), beforeRead, 'portfolio branch cannot alter parent account')
      cases.push('Backtest multiasset historical read and new branch retain both datasets without mutating parent')
    }
    cases.push(`${mode}: real multi-select creation, instant BUY/SELL on separate assets, aggregate account, shared clock, TP/SL drag, both closes, switch and reload`)
  }
  await verifyNativePortfolioRules({ request, datasets, template: propTemplate, cases })
  await verifyNativePortfolioCalendar({ request, datasets, template: propTemplate, cases })
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'browser.json'), JSON.stringify({ passed: true, cases, page_errors: errors, requests }, null, 2))
  console.log(JSON.stringify({ passed: true, cases }))
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  await writeFile(path.join(out, 'browser-failed.json'), JSON.stringify({ error: String(error.stack), cases, page_errors: errors, requests }, null, 2))
  throw error
} finally { await browser.close() }
