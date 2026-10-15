import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const [origin, out, artifactRoot] = process.argv.slice(2)
assert.ok(artifactRoot && path.basename(path.dirname(artifactRoot)).startsWith('tw-browser-qa-'), 'fault injection requires the owned temporary fixture')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1710, height: 987 } })
const headers = { 'X-Workspace-Id': 'tenant-a' }, errors = [], cases = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(origin)
  const fixture = await page.evaluate(async () => {
    const { scopedMutation } = await import('/src/scopedMutation.js')
    const { createReplaySession } = await import('/src/sessionCatalog.js')
    const { createPropChartSession } = await import('/src/propSessionCreation.js')
    async function ingest(count) {
      const response = await scopedMutation('/api/v2/data/csv/import', 'tenant-a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        csv_text: 'time,open,high,low,close,volume\n' + Array.from({ length: count }, (_, i) => `${1577923200+i*60},1.1,1.105,1.099,1.102,10`).join('\n'),
        source: { source_id: 'resilience-fixture', provider: 'fixture', instrument_mapping: { EURUSD: 'EURUSD' }, license_use: 'qa-only', retrieved_at_utc: '2026-10-15T00:00:00Z', export_settings: 'synthetic' },
        instrument: { instrument_id: 'EURUSD', asset_class: 'fx', base_ccy: 'EUR', quote_ccy: 'USD', account_ccy: 'USD', contract_size: '100000', tick_size: '0.00001', pip_size: '0.0001', quantity_min: '0.01', quantity_step: '0.01', effective_from_utc: '2020-01-01T00:00:00Z', effective_to_utc: '' }, timeframe_seconds: 60, holdout_policy: { mode: 'none' },
      }) })
      const result = await response.json()
      if (!response.ok) throw Error(JSON.stringify(result))
      return result.dataset
    }
    const old = await ingest(120)
    const replay = await createReplaySession('tenant-a', { dataset_id: old.dataset_id, name: 'PINNED01', start_index: 20, starting_balance: '10000' })
    const prop = await createPropChartSession('tenant-a', { name: 'PROPPIN', profileKind: 'generic', initialCapital: '10000', currency: 'USD', targetPercent: '10', dailyLoss: '500', overallLoss: '1000', startUtc: '2020-01-02T00:00', durationDays: '30', datasetVersion: old.dataset_id }, [old])
    const updated = await ingest(180)
    return { old, updated, replay, prop: prop.replay }
  })
  assert.notEqual(fixture.old.dataset_id, fixture.updated.dataset_id)
  const replayPath = `${origin}/api/v2/replay/sessions/${fixture.replay.record_id}`
  const before = await (await page.request.get(replayPath, { headers })).json()
  assert.equal(before.payload.dataset_id, fixture.old.dataset_id)
  assert.equal((await page.request.delete(`${origin}/api/v2/data/datasets/${fixture.old.dataset_id}`, { headers })).status(), 409)
  cases.push('updated history creates a new version; linked backtest and Prop data cannot be deleted')
  const file = path.resolve(artifactRoot, fixture.old.artifact_path)
  assert.ok(file.startsWith(path.resolve(artifactRoot) + path.sep))
  const original = await readFile(file)
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  const name = page.getByTestId(`dataset-row-${fixture.old.dataset_id}`)
  await name.hover()
  await name.click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  cases.push('asset name has no hover/click dialog; details remain in the action menu')

  async function repairFromMenu() {
    const row = page.getByTestId(`dataset-row-${fixture.old.dataset_id}`).locator('xpath=ancestor::tr')
    await row.getByRole('button', { name: /Thao tác dữ liệu/ }).click()
    const response = page.waitForResponse(r => r.url().endsWith(`/${fixture.old.dataset_id}/repair`) && r.request().method() === 'POST')
    await page.getByRole('menuitem', { name: 'Kiểm tra & khôi phục' }).click()
    assert.equal((await response).status(), 200)
    await page.getByRole('status').filter({ hasText: 'Đã khôi phục dữ liệu gốc' }).waitFor()
  }
  await unlink(file)
  assert.equal((await page.request.get(replayPath, { headers })).status(), 503)
  await page.reload()
  await name.waitFor()
  await page.getByText('Cần khôi phục', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'missing-data.png') })
  await repairFromMenu()
  assert.deepEqual(await readFile(file), original)
  let after = await (await page.request.get(replayPath, { headers })).json()
  assert.equal(after.revision, before.revision)
  assert.deepEqual(after.payload, before.payload)
  assert.deepEqual(after.visible_rows, before.visible_rows)
  cases.push('missing file returns recoverable 503; UI restores byte-identical data without changing replay state')

  await writeFile(file, 'broken parquet fixture')
  assert.equal((await page.request.get(replayPath, { headers })).status(), 503)
  await repairFromMenu()
  assert.deepEqual(await readFile(file), original)
  after = await (await page.request.get(`${origin}/api/v2/replay/sessions/${fixture.prop.record_id}`, { headers })).json()
  assert.equal(after.prop_attempt_id, fixture.prop.prop_attempt_id)
  assert.equal(after.payload.name, 'PROPPIN')
  cases.push('corrupted file is quarantined and restored; Prop attempt identity and name remain intact')
  await page.screenshot({ path: path.join(out, 'restored-data.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'library-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify({ result: 'PASS', scope: 'Owned disposable PostgreSQL + real Axum/Python HTTP + browser; synthetic file-loss/corruption only', cases, errors }, null, 2))
  console.log(JSON.stringify({ result: 'PASS', cases }))
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') })
  throw error
} finally { await browser.close() }
