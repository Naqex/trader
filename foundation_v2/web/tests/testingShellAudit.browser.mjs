import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = '../evidence/testing-overall-audit-20261012/shell-market'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Testing shell and Market Data: labeled GET fixtures, preview parity, no owner mutations', cases: [], errors: [], writes: [] }
const href = (view, extra = '') => `${origin}/?workspace=audit-fixture&area=testing&view=${view}&select=1${extra}`
async function setup(width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
  await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
  await context.route('**/*', route => {
    const request = route.request()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
    return new URL(request.url()).origin === origin ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  return { context, page }
}
try {
  for (const width of [1440, 768, 360]) for (const theme of ['dark', 'light']) {
    const { context, page } = await setup(width, theme)
    for (const view of ['overview', 'replay', 'trade', 'analytics', 'market-data']) {
      await page.goto(href(view, '&demo=1'))
      await page.getByTestId('view-state-preview').waitFor()
      const readyContent = { overview: '.fx-dashboard-session-list', replay: '.fxr-session-cards', trade: '.fxa-trades', analytics: '.fxa-report', 'market-data': '.rd-table' }
      await page.locator(readyContent[view]).waitFor()
      assert.equal(await page.locator('main,[role=main]').count(), 1, `${view}: one main landmark`)
      const switcher = await page.locator('.wm-view-state-select .fx-select-trigger').boundingBox()
      assert.ok(switcher.x >= 0 && switcher.x + switcher.width <= width + 1, `${view}: preview switch stays inside viewport`)
      const ready = await page.locator('.fx-subnav').boundingBox()
      for (const state of ['offline', 'reconnecting']) {
        await page.goto(href(view, `&demo=1&ui_state=${state}`))
        const indicator = page.getByTestId('workspace-connection')
        await indicator.locator('summary').waitFor()
        assert.equal((await indicator.boundingBox()).width, 24)
        const current = await page.locator('.fx-subnav').boundingBox()
        assert.equal(current.height, ready.height, `${view}/${state}: connection state cannot add a subheader row`)
        await indicator.locator('summary').click()
        await page.waitForTimeout(100)
        const popup = await indicator.locator('.wm-resource-status-detail').boundingBox()
        assert.ok(popup.x >= 0 && popup.x + popup.width <= width + 1)
        await page.keyboard.press('Escape')
        assert.equal(await indicator.locator('details').getAttribute('open'), null)
      }
      report.cases.push({ view, width, theme, mainLandmark: true, stableConnectionSlot: true })
    }
    await page.goto(href('market-data', '&demo=1'))
    await page.locator('.rd-table tbody tr').first().waitFor()
    assert.equal(await page.locator('.rd-table tbody').getByText('Forex', { exact: true }).count(), 2)
    assert.equal(await page.locator('.rd-table tbody').getByText('Kim loại', { exact: true }).count(), 1)
    report.cases.push({ width, theme, case: 'Preview uses real asset-class contract' })
    await page.route('**/api/v2/**', route => route.fulfill({ json: { items: [], available: false } }))
    await page.route('**/api/v2/data/datasets', route => route.fulfill({ json: { items: [], catalog_items: [{ instrument_id: 'EURUSD', asset_class: 'fx', provider_id: 'Dukascopy' }] } }))
    await page.goto(href('market-data'))
    await page.locator('[data-empty-kind=datasets]').waitFor()
    assert.equal(await page.locator('[data-empty-kind=filtered-datasets]').count(), 0)
    report.cases.push({ width, theme, case: 'Unsaved catalog is empty library, not unmatched filters' })
    await page.route('**/api/v2/data/datasets', route => route.fulfill({ status: 403, json: { detail: 'labeled_denied_fixture' } }))
    await page.goto(href('market-data'))
    await page.locator('[data-empty-kind=denied]').waitFor()
    assert.equal(await page.locator('.data-library-toolbar,.rd-table').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Nhập CSV', exact: true }).count(), 0)
    report.cases.push({ width, theme, case: 'Denied GET purges table and actions, uses shared lock state' })
    await page.route('**/api/v2/data/datasets', route => route.fulfill({ status: 503, json: { detail: 'labeled_transient_fixture' }, headers: { 'Retry-After': '30' } }))
    await page.goto(href('market-data'))
    const notice = page.locator('.wm-read-state[role=alert]')
    await notice.waitFor()
    assert.ok((await notice.boundingBox()).y >= (await page.locator('.data-library-toolbar').boundingBox()).y)
    if (width === 360) {
      const [message, recovery] = await Promise.all([notice.locator('p').boundingBox(), notice.getByTestId('read-recovery').boundingBox()])
      assert.ok(recovery.y >= message.y + message.height - 1, 'Mobile error countdown follows message')
      assert.ok(Math.abs(message.x - recovery.x) <= 1, 'Mobile message and countdown share the content gutter')
    }
    await page.screenshot({ path: `${output}/market-error-${theme}-${width}.png` })
    report.cases.push({ width, theme, case: 'Localized failure with readable mobile countdown' })
    await page.route('**/api/v2/data/datasets', route => route.fulfill({ json: { items: [], catalog_items: [] } }))
    await page.route('**/api/v2/data/downloads', route => route.fulfill({ status: 503, json: { detail: 'labeled_progress_failure' } }))
    await page.goto(href('market-data'))
    await page.locator('[data-empty-kind=datasets]').waitFor()
    const progressStatus = page.locator('.data-library-toolbar .wm-resource-status')
    await progressStatus.locator('summary').waitFor()
    assert.equal(await page.locator('.data-library-download-error').count(), 0, 'Progress read error cannot insert a layout row')
    const beforePopup = await page.locator('.data-library-grid').boundingBox()
    await progressStatus.locator('summary').click()
    await progressStatus.getByText('Không đọc được tiến độ tải. Hệ thống sẽ tự kết nối lại.').waitFor()
    const afterPopup = await page.locator('.data-library-grid').boundingBox()
    assert.deepEqual(afterPopup, beforePopup)
    assert.equal(await page.locator('.fx-content').getByRole('button', { name: 'Thử lại', exact: true }).count(), 0)
    report.cases.push({ width, theme, case: 'Progress read failure uses reserved status and preserves dataset layout' })
    await context.close()
  }
  const { context, page } = await setup(1440, 'dark')
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/api/v2/**', route => route.fulfill({ json: { items: [], available: false } }))
  await page.route('**/api/v2/data/datasets', async route => { await gate; await route.fulfill({ json: { items: [], catalog_items: [] } }) })
  await page.goto(href('market-data'), { waitUntil: 'domcontentloaded' })
  await page.locator('.wm-page-skeleton').waitFor()
  assert.equal(await page.locator('.wm-skeleton-toolbar').count(), 1)
  assert.equal(await page.locator('.data-library-toolbar').count(), 0)
  const [content, skeleton] = await Promise.all([page.locator('.fx-content').boundingBox(), page.locator('.wm-page-skeleton').boundingBox()])
  assert.ok(Math.abs(content.y + content.height - skeleton.y - skeleton.height) <= 1)
  await page.screenshot({ path: `${output}/market-initial-loading.png` })
  release()
  await page.locator('[data-empty-kind=datasets]').waitFor()
  report.cases.push({ case: 'Real initial loading has one toolbar skeleton and fills content viewport' })
  await context.close()
  for (const failed of [false, true]) {
    const { context, page } = await setup(390, 'dark')
    let releaseChunk
    const chunkGate = new Promise(resolve => { releaseChunk = resolve })
    await page.route('**/api/v2/**', route => route.fulfill({ json: { items: [], catalog_items: [], available: false } }))
    await page.route('**/src/DataDeskWorkspace.jsx*', async route => {
      await chunkGate
      return failed ? route.fulfill({ contentType: 'application/javascript', body: "throw new Error('labeled_route_chunk_failure')" }) : route.continue()
    })
    await page.goto(href('market-data'), { waitUntil: 'domcontentloaded' })
    await page.locator('.wm-page-skeleton').waitFor()
    await page.evaluate(() => { window.__shellAudit = [document.querySelector('.fx-topbar'), document.querySelector('.fx-rail')] })
    const [content, skeleton] = await Promise.all([page.locator('.fx-content').boundingBox(), page.locator('.wm-page-skeleton').boundingBox()])
    assert.ok(Math.abs(content.y + content.height - skeleton.y - skeleton.height) <= 1, 'Lazy chunk pending fills the content viewport')
    releaseChunk()
    await page.locator(`[data-empty-kind=${failed ? 'page-error' : 'datasets'}]`).waitFor()
    assert.equal(await page.locator('.fx-content').getByRole('button', { name: 'Thử lại', exact: true }).count(), 0)
    if (failed) {
      await page.locator('.fx-subnav a[href*="view=overview"]').click()
      await page.locator('[data-testid=dashboard-recent]').waitFor()
    }
    assert.equal(await page.evaluate(() => window.__shellAudit[0] === document.querySelector('.fx-topbar') && window.__shellAudit[1] === document.querySelector('.fx-rail')), true)
    await page.screenshot({ path: `${output}/lazy-${failed ? 'failure-navigation' : 'success'}.png` })
    report.cases.push({ case: `Cold lazy chunk ${failed ? 'failure preserves shell and navigation' : 'success preserves shell'}` })
    await context.close()
  }
  {
    const { context, page } = await setup(1440, 'dark')
    await page.route('**/api/v2/**', route => route.fulfill({ json: { items: [], available: false } }))
    await page.goto(href('trade', '&intent=order'))
    await page.locator('main.trade-workspace').waitFor()
    assert.equal(await page.locator('main,[role=main]').count(), 1, 'Order form retains its own main landmark')
    report.cases.push({ case: 'Order form does not nest main landmarks' })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.result = 'PASS'
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, writes: report.writes }))
