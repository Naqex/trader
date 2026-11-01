// Labeled catalog fixture; all API requests are intercepted, no owner data writes.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { brokerSnapshot, completedDealFills, fixtureConnection } from './liveJournal.fixture.mjs'

const [origin, out, mode = 'candidate'] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
assert(['baseline', 'candidate'].includes(mode))
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'Production UI, synthetic catalog/deals; GET counts and shared state, no database/broker/provider', mode, cases: [], errors: [], blocked: [] }
let activePage
try {
  for (const [width, theme, lang] of [[1920, 'dark', 'vi'], [390, 'light', 'en']]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    const broker = brokerSnapshot()
    broker.deals = completedDealFills(broker.deals.slice(0, 3))
    const freshCatalog = () => ({ schema_version: 'trade-labels-v1', groups: [{ id: 'setup', name: 'Setup', revision: 1 }],
      items: [{ id: 'breakout', name: 'Breakout', color: 'green', group_id: 'setup', revision: 1 }, { id: 'review', name: 'Review', color: 'blue', revision: 1 }],
      assignments: [1, 2, 3].map(id => ({ session_id: `live:${fixtureConnection}`, trade_id: `position:${id}`, tags: ['Breakout'], revision: 1 })) })
    let catalog = freshCatalog(), reads = 0, writes = 0, failCatalog = false
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { report.blocked.push(url.origin); return route.abort() }
      if (url.pathname === '/api/v2/trade-labels') {
        if (request.method() === 'GET') {
          reads++
          return route.fulfill({ status: failCatalog ? 503 : 200, json: failCatalog ? { detail: 'synthetic_catalog_unavailable' } : catalog })
        }
        const body = request.postDataJSON()
        assert.equal(request.method(), 'POST')
        assert.equal(body.action, 'update')
        writes++
        catalog = { ...catalog, items: catalog.items.map(item => item.id === body.id ? { ...item, name: body.name, color: body.color, revision: item.revision + 1 } : item) }
        return route.fulfill({ json: catalog })
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blocked.push(`${request.method()} ${url.pathname}`); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
      if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: broker })
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: broker.connections } })
      return route.fulfill({ json: { items: [] } })
    })
    const page = await context.newPage(); activePage = page
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => report.errors.push(error.message))
    const visit = section => page.goto(`${origin}/?workspace=fixture-label-reuse&view=live&area=live&section=${section}&lang=${lang}`)

    await visit('tag-analytics')
    await page.locator('.live-tag-picker-list .wm-trade-label').filter({ hasText: 'Breakout' }).waitFor()
    const panel = page.locator('.wm-report-side-panel').filter({ hasText: 'Smart Picks' }), toggle = panel.locator('.wm-report-panel-toggle')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    const initialReads = reads
    await toggle.click()
    const select = panel.locator('.fx-select-trigger')
    await select.waitFor({ state: 'visible' })
    assert.equal(await select.isDisabled(), false)
    await select.click()
    await page.getByRole('option', { name: 'Breakout', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(reads, initialReads, 'Expanding the existing panel does not refetch the same catalog')
    if (mode === 'candidate') assert.equal(initialReads, 1, 'One owner loads the catalog for tag analysis and Smart Picks')
    report.cases.push({ width, theme, lang, name: 'tag-analysis-shared-catalog', catalogGETs: initialReads, panelExpandedGETs: reads - initialReads })
    await page.screenshot({ path: `${out}/tags-${width}-${theme}.png` })

    catalog = freshCatalog(); reads = 0
    await visit('trades')
    await page.getByTestId('live-trade-grid').locator('tbody tr').first().waitFor()
    const overview = page.locator('.live-tag-overview'), badge = overview.locator('.wm-trade-label').filter({ hasText: 'Breakout' })
    await badge.waitFor()
    const initialTradesReads = reads
    const cell = page.getByTestId('live-trade-grid').locator('.wm-label-cell').first()
    await cell.click()
    const picker = page.locator('.wm-label-popup')
    await picker.getByRole('button', { name: lang === 'vi' ? 'Sửa nhãn Breakout' : 'Edit label Breakout', exact: true }).click()
    await page.locator('.wm-label-edit-popup').getByRole('button', { name: lang === 'vi' ? 'Cam' : 'Orange', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.wm-label-edit-popup [data-color="orange"][aria-pressed="true"]') !== null)
    const overviewColor = await badge.getAttribute('data-color')
    if (mode === 'candidate') assert.equal(overviewColor, 'orange', 'Catalog mutation updates the sibling summary immediately')
    assert.equal(writes, 1, 'Exactly one intercepted catalog mutation')
    assert.equal(reads, initialTradesReads, 'Mutation receipt is reused without another GET')
    report.cases.push({ width, theme, lang, name: 'trades-shared-mutation', catalogGETs: reads, overviewColor })
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')

    failCatalog = true; reads = 0
    await visit('tag-analytics')
    const failure = page.locator('.live-journal-tags [role="alert"]')
    await failure.waitFor()
    await page.locator('.wm-report-panel-toggle').click()
    assert.equal(await page.locator('.wm-smart-picks-preview .fx-select-trigger').isDisabled(), true)
    failCatalog = false
    await failure.getByRole('button').click()
    await failure.waitFor({ state: 'detached' })
    await page.waitForFunction(() => !document.querySelector('.wm-smart-picks-preview .fx-select-trigger')?.disabled)
    if (mode === 'candidate') assert.equal(reads, 2, 'One failed catalog read and one shared retry')
    report.cases.push({ width, theme, lang, name: 'one-retry-recovers-analysis-and-panel', catalogGETs: reads })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.blocked, [])
} catch (error) {
  report.failure = error.stack
  await activePage?.screenshot({ path: `${out}/failure.png` }).catch(() => {})
  throw error
} finally {
  await writeFile(`${out}/receipt.json`, JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify({ mode, cases: report.cases, errors: report.errors, failed: Boolean(report.failure) }))
}
