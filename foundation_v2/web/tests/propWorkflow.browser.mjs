import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const [origin, out] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1710, height: 987 } })
const errors = [], cases = []
page.on('pageerror', error => errors.push(error.message))
const headers = { 'X-Workspace-Id': 'tenant-a' }
try {
  await page.goto(origin)
  const imported = await page.evaluate(async headers => {
    const { scopedMutation } = await import('/src/scopedMutation.js')
    const payload = {
      csv_text: 'time,open,high,low,close,volume\n' + Array.from({ length: 2880 }, (_, i) => `${1577923200 + i * 60},1.1,1.105,1.099,1.102,10`).join('\n'),
      source: { source_id: 'prop-workflow', provider: 'fixture', instrument_mapping: { EURUSD: 'EURUSD' }, license_use: 'qa-only', retrieved_at_utc: '2026-10-15T00:00:00Z', export_settings: 'synthetic' },
      instrument: { instrument_id: 'EURUSD', asset_class: 'fx', base_ccy: 'EUR', quote_ccy: 'USD', account_ccy: 'USD', contract_size: '100000', tick_size: '0.00001', pip_size: '0.0001', quantity_min: '0.01', quantity_step: '0.01', effective_from_utc: '2020-01-01T00:00:00Z', effective_to_utc: '' },
      timeframe_seconds: 60, holdout_policy: { mode: 'none' },
    }
    const response = await scopedMutation('/api/v2/data/csv/import', 'tenant-a', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(result))
    return result.dataset
  }, headers)

  async function create(kind, name) {
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${kind}`)
    const dialog = page.locator('.quick-session-dialog')
    await dialog.waitFor()
    await dialog.locator('input[required]').first().fill(name)
    await dialog.getByRole('button', { name: 'Chọn tài sản', exact: true }).click()
    await page.getByRole('option', { name: /EURUSD/ }).click()
    await dialog.locator('.quick-session-period-random').click()
    await dialog.getByRole('button', { name: 'Tạo phiên', exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('surface') === 'workspace', { timeout: 30000 })
    await page.locator('[data-chart-status="ready"]').waitFor({ timeout: 30000 })
    console.log(`Created ${kind}: ${name}`)
    return new URL(page.url())
  }
  const prop = await create('prop', 'TEST02')
  assert.ok(prop.searchParams.get('prop_session'))
  assert.ok(prop.searchParams.get('prop_attempt'))
  await page.getByTestId('prop-rules-button').waitFor()
  assert.ok(await page.getByTestId('prop-rules-button').evaluate(button => {
    const rect = button.getBoundingClientRect()
    return rect.width > 100 && rect.height <= 34 && rect.bottom <= innerHeight && button.scrollWidth <= button.clientWidth
  }), 'Prop rules button remains on one line inside the chart account bar')
  assert.equal(await page.locator('.legacy-replay-reset, .legacy-replay-previous').count(), 0)
  await page.getByTestId('prop-rules-button').click()
  await page.getByTestId('prop-rules-dialog').waitFor()
  await page.screenshot({ path: path.join(out, 'prop-chart-rules.png') })
  await page.getByRole('button', { name: 'Đóng Prop Firm Rules' }).click()
  assert.equal(await page.locator('.advanced-chart-save-status').count(), 0)
  cases.push('real dialog creation keeps TEST02; directly opens advanced Prop chart and rules')

  const catalog = await (await page.request.get(`${origin}/api/v2/replay/sessions`, { headers })).json()
  const record = catalog.items.find(item => item.record_id === prop.searchParams.get('session'))
  assert.equal(record.name, 'TEST02')
  assert.equal(record.session_kind, 'prop')
  assert.equal(record.prop_attempt_id, prop.searchParams.get('prop_attempt'))
  await page.goto(`${origin}/?workspace=tenant-a&view=overview`)
  const card = page.locator(`[data-session-id="${record.record_id}"]`)
  await card.waitFor()
  assert.equal(await card.locator('.session-kind-badge').innerText(), 'Prop Firm')
  assert.ok((await card.locator('.fx-dashboard-card-play').getAttribute('href')).includes('prop_attempt='))
  await page.screenshot({ path: path.join(out, 'dashboard.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'dashboard-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1710, height: 987 })
  await card.locator('.fx-dashboard-card-play').click()
  await page.getByTestId('prop-rules-button').waitFor()
  await page.reload()
  await page.getByTestId('prop-rules-button').waitFor()
  cases.push('Dashboard Play and reload keep exact attempt before execution initialization')

  await page.goto(`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${record.record_id}&cursor=0`)
  await page.waitForURL(url => url.searchParams.get('prop_attempt') === record.prop_attempt_id)
  await page.getByTestId('prop-rules-button').waitFor()
  cases.push('bare old replay link resolves durable Prop identity')
  await page.goto(`${origin}/?workspace=tenant-a&view=replay&select=1&mode=Practice&session=${record.record_id}`)
  await page.locator('.fxr-session-summary-card .fxs-go-chart').waitFor()
  assert.equal(await page.locator('.fxr-session-summary-card .session-kind-badge').innerText(), 'Prop Firm')
  await page.waitForFunction(() => /10[.,]000/.test(document.querySelector('.fxs-balance strong')?.textContent || ''))
  await page.screenshot({ path: path.join(out, 'sessions.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'sessions-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1710, height: 987 })
  await page.locator('.fxr-session-summary-card .fxs-go-chart').click()
  await page.getByTestId('prop-rules-button').waitFor()
  cases.push('Sessions summary badge and Go to chart retain Prop context')

  const backtest = await create('backtest', '1')
  assert.equal(backtest.searchParams.has('prop_session'), false)
  assert.equal(await page.getByTestId('prop-rules-button').count(), 0)
  assert.equal(await page.locator('.legacy-replay-reset, .legacy-replay-previous').count(), 2)
  await page.screenshot({ path: path.join(out, 'backtest-chart.png') })
  cases.push('backtest keeps name 1 and ordinary replay without Prop rules')
  const legacy = await page.evaluate(async ({ dataset, propSession }) => {
    const { createReplaySession, fetchReplaySessions, updateSessionMetadata } = await import('/src/sessionCatalog.js')
    const created = await createReplaySession('tenant-a', { dataset_id: dataset, name: `Generic practice · ${propSession}`, starting_balance: '10000' })
    const before = (await fetchReplaySessions('tenant-a')).find(item => item.record_id === created.record_id)
    await updateSessionMetadata('tenant-a', before, { name: 'LEGACY01' })
    const after = (await fetchReplaySessions('tenant-a')).find(item => item.record_id === created.record_id)
    return { before, after }
  }, { dataset: imported.dataset_id, propSession: record.prop_session_id })
  assert.equal(legacy.before.session_kind, 'prop')
  assert.equal(legacy.before.prop_attempt_id, record.prop_attempt_id)
  assert.equal(legacy.after.name, 'LEGACY01')
  assert.equal(legacy.after.prop_attempt_id, record.prop_attempt_id)
  cases.push('legacy generated names recover Prop identity and retain it after rename')
  await page.goto(`${origin}/?workspace=tenant-a&view=testing&prop_setup=1`)
  await page.locator('.quick-session-dialog').waitFor()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'overview')
  cases.push('old setup links open shared dialog instead of technical workspace')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify({ result: 'PASS', scope: 'Disposable PostgreSQL, actual Axum + Python worker + browser; synthetic data only', dataset: imported.dataset_id, cases, errors }, null, 2))
  console.log(JSON.stringify({ result: 'PASS', cases }))
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-1800))
  await page.screenshot({ path: path.join(out, 'failure.png') })
  throw error
} finally { await browser.close() }
