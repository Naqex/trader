// Recorded demo history, read-only fixture interception. No broker commands.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [origin, fixturePath, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { cases: [], errors: [], writes: [] }
let page
try {
  for (const [width, theme] of [[1920, 'dark'], [1440, 'light'], [390, 'dark']]) {
    let payload = structuredClone(fixture), failChunk = false, chunkFailures = 0, navigations = 0
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(url.pathname); return route.abort() }
      if (failChunk && /LiveJournalSurfaces-.*\.js$/.test(url.pathname)) { failChunk = false; chunkFailures++; return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: payload })
      if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: payload.connections } })
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      if (url.pathname === '/api/v2/playbooks') return route.fulfill({ json: { items: [] } })
      return route.fulfill({ json: { items: [], available: false } })
    })
    page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
    const url = section => `${origin}/?workspace=tenant-a&view=live&lang=vi&area=live&section=${section}`
    await page.goto(url('trades'))
    const grid = page.getByTestId('live-trade-grid')
    await grid.locator('tbody tr').first().waitFor()
    assert.equal(await grid.locator('tbody tr').count(), 10)
    assert((await grid.locator('[data-column=account]').allTextContents()).every(value => value === 'MT5 464104926 - demo'))
    assert(await grid.locator('[data-column=account]').first().evaluate(el => el.scrollWidth <= el.clientWidth))
    assert((await grid.locator('[data-column=entry_type]').allTextContents()).every(value => value === 'market'))
    const badges = await grid.evaluate(el => ['.is-closed', '.is-sync'].map(selector => { const style = getComputedStyle(el.querySelector(selector)); return [style.color, style.backgroundColor] }))
    assert.notDeepEqual(badges[0], badges[1])
    const tags = grid.locator('[data-column=tags] .wm-label-cell').first()
    await tags.scrollIntoViewIfNeeded()
    await tags.hover()
    assert.equal(await tags.locator('.wm-label-placeholder').evaluate(el => getComputedStyle(el).opacity), '1')
    await tags.focus()
    assert.equal(await tags.locator('.wm-label-placeholder').evaluate(el => getComputedStyle(el).opacity), '1')
    const side = page.locator('.live-analytics-side')
    const assertSummary = async () => {
      await side.locator('.live-balance-summary').waitFor()
      assert.match(await side.locator('.live-balance-summary > div').last().innerText(), /14$/)
      assert.match(await side.locator('.live-balance-summary > div').first().innerText(), /\$10\.001,01/)
      assert.equal(await side.locator('.live-analytics-curve-label').count(), 0)
      assert.match(await side.locator('.live-analytics-expectancy-heading > strong').innerText(), /\$0,07/)
      assert.match(await side.locator('.fxa-average-labels').innerText(), /\$0,22\s+\$-0,14/)
      assert(await side.locator('.fxa-average-bar').evaluate(el => Math.abs(el.lastElementChild.getBoundingClientRect().right - el.getBoundingClientRect().right) < 1), 'Contributions below $1 still fill the comparison track')
      assert.match(await side.locator('.live-win-rate-copy > strong').innerText(), /14,29%/)
      assert.equal(await side.locator('.live-win-rate-counts strong').count(), 0)
      assert.match(await side.locator('.live-win-rate-counts').innerText(), /Thắng\s+Thua\s+Hòa vốn/)
    }
    await assertSummary()
    await grid.evaluate(el => { el.scrollLeft = 0 })
    await page.screenshot({ path: `${out}/trades-${width}-${theme}.png`, fullPage: width < 1000 })
    await page.goto(url('calendar'))
    await page.locator('.live-month-total').waitFor()
    await assertSummary()
    assert.match(await page.locator('.live-month-total').innerText(), /14 giao dịch/)
    const week = page.locator('.live-week-total.is-gain').last()
    await week.waitFor()
    const paint = await week.evaluate(el => { const s = getComputedStyle(el); return { color: getComputedStyle(el.querySelector('strong')).color, border: s.borderTopColor, bg: s.backgroundColor, shadow: s.boxShadow } })
    assert.equal(paint.color, paint.border)
    assert.equal(paint.shadow, 'none')
    await week.hover()
    assert.equal(await week.evaluate(el => getComputedStyle(el).borderTopColor), paint.border)
    await page.screenshot({ path: `${out}/calendar-${width}-${theme}.png`, fullPage: width < 1000 })
    await page.getByRole('button', { name: 'Tháng trước', exact: true }).click()
    await assertSummary()
    assert.match(await page.locator('.live-month-total').innerText(), /0 giao dịch/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    report.cases.push({ width, theme, rows: 10, completedTrades: 14, expectancy: .07, gainWeek: true, monthIndependent: true })
    if (width === 1920) {
      // Force one lazy-page transport failure, then let the same URL succeed.
      await context.clearCookies()
      failChunk = true
      const before = navigations
      await page.goto(url('notes'))
      await page.locator('.live-notes').waitFor({ timeout: 20000 })
      assert.equal(chunkFailures, 1)
      assert.equal(navigations - before, 2, 'One automatic reload recovers the rejected lazy import')
      assert.equal(await page.locator('[data-empty-kind=page-error]').count(), 0)
      await page.locator('.fx-subnav a[href*="section=trades"]').click()
      await grid.locator('tbody tr').first().waitFor()
      await page.locator('.fx-subnav a[href*="section=notes"]').click()
      await page.locator('.live-notes').waitFor()
      report.cases.push({ transientChunkFailureRecovered: true, notesNavigation: true })
      payload.deals = payload.deals.map(deal => ({ ...deal, profit: deal.profit > 0 ? -deal.profit : deal.profit }))
      await page.goto(url('calendar'))
      await page.locator('.live-week-total.is-loss').last().waitFor()
      const loss = page.locator('.live-week-total.is-loss').last()
      assert(await loss.evaluate(el => getComputedStyle(el.querySelector('strong')).color === getComputedStyle(el).borderTopColor))
      report.cases.push({ lossWeek: true })
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, errors: report.errors, writes: report.writes }))
}
