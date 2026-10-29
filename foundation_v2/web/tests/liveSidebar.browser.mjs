// GET-only synthetic accounts; never reaches the broker or writes to the API.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { brokerSnapshot, fixtureConnection } from './liveJournal.fixture.mjs'

const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
await mkdir(out, { recursive: true })
const browser = await chromium.launch(), report = { cases: [], errors: [], writes: [], scope: 'Three-chart Live sidebar, monetary display, missing data and layout; synthetic GET only' }
let page
try {
  for (const [width, theme, lang] of [[1440, 'dark', 'vi'], [1920, 'light', 'en'], [390, 'light', 'vi']]) {
    const ctx = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await ctx.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    const broker = brokerSnapshot()
    broker.account.opening_balance = 10000
    // Intentionally differs from the filtered PnL curve's ending value.
    broker.account.balance = 12345
    broker.deals = broker.deals.slice(0, 3).map((deal, i) => ({ ...deal, profit: [100, -50, 1e-13][i], commission: 0 }))
    const sourceDeals = broker.deals
    await ctx.routeWebSocket('**/*', socket => socket.close())
    await ctx.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.writes.push(url.pathname); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: broker })
      if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: broker.connections } })
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      return route.fulfill({ json: { items: [], available: false } })
    })
    page = await ctx.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => report.errors.push(error.message))
    for (const section of ['trades', 'calendar']) {
      broker.deals = section === 'trades' ? sourceDeals.flatMap((deal, i) => [
        { ...deal, ticket: 100000 + i, type: deal.type === 0 ? 1 : 0, entry: 0, profit: 0, time_msc: deal.time_msc - 3600000 },
        deal,
      ]) : sourceDeals
      await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=${section}&lang=${lang}&mt5_connection=${fixtureConnection}&live_account=broker:${fixtureConnection}`)
      const side = page.locator('.live-analytics-side'), rows = side.locator('.live-analytics-chart-row')
      await rows.first().waitFor()
      assert.equal(await rows.count(), 3)
      assert.equal(await side.locator('select, button:not(.fxa-info), .live-analytics-source-line').count(), 0)
      assert.equal(await side.locator('.fxa-info').count(), 2)
      assert.equal(await rows.nth(1).locator('.fxa-viz').count(), 0, 'Expectancy uses one shared horizontal comparison, without another plot')
      const text = await side.innerText()
      assert(!/Expectancy comparison|per trade|Trades by direction|Balance curve/.test(lang === 'vi' ? text : ''))
      assert.match(await rows.nth(2).innerText(), /33[,.]33%/)
      assert.match(await rows.nth(2).locator('.live-win-rate-counts').innerText(), lang === 'vi' ? /Hòa vốn\s+1/ : /Breakeven\s+1/)
      // The curve is filtered PnL, not invented balance history.
      const curve = rows.first().locator('.fxa-viz svg')
      await curve.waitFor()
      assert.match(await curve.getAttribute('aria-label'), /PnL/)
      assert.match(await rows.first().locator('.live-analytics-chart-value').innerText(), /12[.,]345/)
      const curveDetails = await curve.locator('[data-tooltip]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tooltip')).join(' '))
      assert(!curveDetails.includes('10.100') && !curveDetails.includes('10,100'))
      if (section === 'calendar') assert.equal(await page.locator('.live-toolbar-actions button[aria-label="Amount"], .live-toolbar-actions button[aria-label="Số tiền"]').innerText(), '$')
      const comparison = rows.nth(1).locator('.fxa-expectancy-comparison')
      assert.match(await comparison.innerText(), /\$100/)
      assert.match(await comparison.innerText(), /\$-50/)
      assert.match(await rows.nth(1).locator('.live-analytics-chart-value').innerText(), /\$16[,.]67/)
      assert.match(await comparison.getAttribute('aria-label'), /\$/)
      const heading = side.locator('h2').first()
      assert(await heading.evaluate(el => { const r = el.getBoundingClientRect(); return [...el.children].every(child => { const c = child.getBoundingClientRect(); return c.left >= r.left && c.right <= r.right && c.top >= r.top && c.bottom <= r.bottom }) }))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await side.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${out}/${section}-${width}-${theme}-${lang}.png` })
      report.cases.push({ section, width, theme, lang, threeCharts: true, monetary: true })
    }
    if (width === 1440) {
      broker.deals[1].fee = null
      await page.reload()
      const side = page.locator('.live-analytics-side'), rows = side.locator('.live-analytics-chart-row')
      await rows.first().waitFor()
      assert.match(await rows.nth(2).locator('.live-win-rate-copy .live-analytics-chart-value').innerText(), /N\/A/)
      assert.match(await rows.nth(2).locator('.live-win-rate-counts').innerText(), /Chưa rõ\s+1/)
      assert.equal(await rows.nth(1).locator('.fxa-average-labels').innerText(), 'N/A\nN/A')
      broker.account.opening_balance = null
      broker.deals[1].fee = 0
      await page.reload()
      await rows.first().waitFor()
      assert.match(await rows.nth(1).locator('.fxa-average-labels').innerText(), /\$100/)
      await page.locator('.live-toolbar-actions button').filter({ hasText: '%' }).click()
      assert.equal(await page.locator('[data-date="2026-10-01"] strong').innerText(), 'N/A', 'Calendar percentage still requires capital')
      broker.balance_baseline = { amount: 10000, currency: 'USD', captured_at_utc: '2026-10-01T00:00:00Z' }
      await page.reload()
      assert.match(await rows.nth(1).locator('.fxa-average-labels').innerText(), /\$100/)
      await page.locator('.live-toolbar-actions button').filter({ hasText: '%' }).click()
      assert.equal(await page.locator('[data-date="2026-10-01"] strong').innerText(), '1%')
      const calendarUrl = page.url()
      await page.goto(calendarUrl.replace('section=calendar', 'section=analytics'))
      const pnl = page.getByRole('group', { name: 'Lãi/lỗ ròng tích lũy', exact: true })
      await pnl.locator('path[stroke="currentColor"]').first().waitFor()
      assert(await pnl.locator('.fxa-viz-point').count() > 0, 'Shared Analytics uses the same known source capital as Calendar and account transactions')
      assert.match(await page.locator('.fxa-profit-metrics .fxa-metric').filter({ hasText: 'Số dư tài khoản' }).innerText(), /12\.345/, 'Account balance remains the actual snapshot, not capital plus filtered PnL')
      broker.balance_baseline.captured_at_utc = '2026-10-22T00:00:00Z'
      await page.reload()
      await page.locator('.fxa-profit-metrics').waitFor()
      assert.equal(await pnl.locator('.fxa-viz-point').count(), 0, 'A baseline after historical deals must not double-count their PnL')
      broker.balance_baseline.captured_at_utc = '2026-10-01T00:00:00Z'
      await page.goto(calendarUrl)
      broker.account.currency = 'EUR'
      await page.reload()
      await rows.first().waitFor()
      assert.match(await rows.first().locator('.live-analytics-chart-value').innerText(), /EUR/)
      assert(!/USD/.test(await side.innerText()))
      broker.deals = []
      await page.reload()
      await side.locator('.live-empty').waitFor()
      assert.equal(await rows.count(), 0, 'Empty scope does not fabricate three charts')
      report.cases.push({ unknownOutcome: true, unknownCapital: true, accountCurrency: true, sharedBrokerCapital: true })
    }
    await ctx.close()
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
