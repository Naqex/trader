// GET-only recorded payload on an isolated preview. No broker or API writes.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [origin, fixturePath, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { cases: [], errors: [], writes: [], scope: 'Recorded account snapshot + placement facts; isolated preview, GET only' }
try {
  for (const [width, theme, lang] of [[1920, 'dark', 'vi'], [1440, 'light', 'en'], [390, 'dark', 'vi']]) {
    let payload = structuredClone(fixture)
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.writes.push(url.pathname); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: payload })
      if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: payload.connections } })
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      return route.fulfill({ json: { items: [], available: false } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=trades&lang=${lang}&mt5_connection=${fixture.connection_id}`)
    const grid = page.getByTestId('live-trade-grid'), rows = grid.locator('tbody tr')
    await rows.first().waitFor()
    assert.equal(await rows.count(), 10)
    await page.getByRole('button', { name: lang === 'vi' ? 'Số dòng mỗi trang' : 'Rows per page' }).click()
    await page.getByRole('option', { name: '20', exact: true }).click()
    assert.equal(await rows.count(), 14)
    const accounts = grid.locator('[data-column=account]')
    assert((await accounts.allTextContents()).every(text => text === `MT5 ${fixture.account_login} - ${fixture.account_environment}`))
    assert(await accounts.first().evaluate(el => el.clientWidth >= el.scrollWidth))
    assert((await grid.locator('[data-column=source]').allTextContents()).every(text => text === 'Sync'))
    assert((await grid.locator('[data-column=entry_type]').allTextContents()).every(text => text === 'market'))
    assert((await grid.locator('[data-column=status]').allTextContents()).every(text => /^(Đã đóng|Closed)$/.test(text)))
    for (const column of ['price_open', 'price_close', 'stop_loss', 'take_profit', 'realized_r']) {
      assert((await grid.locator(`[data-column=${column}]`).allTextContents()).every(text => text && text !== '-'), column)
    }
    const rCells = await grid.locator('[data-column=realized_r]').allTextContents()
    assert(rCells.some(value => /^1[,.]27$/.test(value)))
    assert(rCells.some(value => /^1[,.]39$/.test(value)))
    const eur = rows.filter({ has: page.locator('[data-column=price_open]').filter({ hasText: /^1[,.]11541$/ }) })
    assert.match(await eur.locator('[data-column=price_open]').innerText(), /1[,.]11541/)
    assert.match(await eur.locator('[data-column=side]').innerText(), /Bán|Sell/)
    const curve = page.locator('.live-analytics-balance-row .fxa-line-viz')
    assert.equal(await curve.getAttribute('data-show-points'), 'false')
    assert(await curve.locator('[data-tooltip]').count() > 0)
    assert(await curve.locator('circle').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).fill === 'rgba(0, 0, 0, 0)' && getComputedStyle(el).stroke === 'none')))
    assert.equal(await page.locator('.live-analytics-expectancy-heading .fxa-info').count(), 1)
    assert.equal(await page.locator('.live-win-rate-row .fxa-info').count(), 1)
    assert.equal(await page.locator('.live-win-rate-row .fxa-ring.is-concentric').count(), 1)
    assert.equal(await page.locator('.live-win-rate-row .live-win-rate-counts span').count(), 3)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `${out}/trades-${width}-${theme}-${lang}.png` })
    await eur.locator('[data-column=realized_r]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/risk-${width}-${theme}-${lang}.png` })
    report.cases.push({ width, theme, lang, lifecycleRows: 14, referenceR: ['1.27', '1.39'], visibleMarkers: 0, fullAccount: true })
    if (width === 1920) {
      payload.trade_placements = []
      await page.reload(); await rows.first().waitFor()
      await page.getByRole('button', { name: lang === 'vi' ? 'Số dòng mỗi trang' : 'Rows per page' }).click()
      await page.getByRole('option', { name: '20', exact: true }).click()
      assert((await grid.locator('[data-column=realized_r]').allTextContents()).every(text => text === '-'))
      assert((await grid.locator('[data-column=entry_type]').allTextContents()).every(text => text === '-'))
      assert((await grid.locator('[data-column=price_open]').allTextContents()).every(text => text !== '-'))
      report.cases.push({ state: 'missing placement provenance', unavailableR: true, genuineEntryRetained: true })
      payload = structuredClone(fixture)
      const opening = payload.deals.find(deal => deal.entry === 0)
      payload.deals.push({ ...opening, ticket: 999001, order: 999001, position_id: 999001, profit: 0, commission: -5 })
      payload.positions = [{ ticket: 999001, identifier: 999001, volume: opening.volume }]
      await page.reload(); await rows.first().waitFor()
      await page.getByRole('button', { name: lang === 'vi' ? 'Số dòng mỗi trang' : 'Rows per page' }).click()
      await page.getByRole('option', { name: '20', exact: true }).click()
      assert.equal(await rows.count(), 15)
      assert.equal(await grid.locator('.fxa-badge.is-open').count(), 1)
      assert.match(await page.locator('.live-balance-summary').innerText(), /14/)
      assert.match(await page.locator('.live-win-rate-row .live-analytics-chart-value').innerText(), /14[,.]29%/)
      report.cases.push({ state: 'open with entry fee plus closed trades', ledgerRows: 15, completedOutcomes: 14, winRate: '14.29%' })
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack
  throw error
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
