// GET-only synthetic accounts; never reaches the broker or writes to the API.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { brokerSnapshot, fixtureConnection } from './liveJournal.fixture.mjs'

const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
await mkdir(out, { recursive: true })
const browser = await chromium.launch(), report = { cases: [], errors: [], writes: [], scope: 'Live sidebar units, privacy, missing data and layout; synthetic GET only' }
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
      await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=${section}&lang=${lang}&mt5_connection=${fixtureConnection}&live_account=broker:${fixtureConnection}`)
      const side = page.locator('.live-analytics-side'), rows = side.locator('.live-analytics-chart-row')
      await rows.first().waitFor()
      const text = await side.innerText()
      assert(!/Expectancy comparison|per trade|Trades by direction|Balance curve/.test(lang === 'vi' ? text : ''))
      assert.match(await rows.nth(2).innerText(), /33[,.]33%/)
      assert.match(await rows.nth(2).locator('.fxa-chart-legend').innerText(), lang === 'vi' ? /Hòa vốn\s+1/ : /Breakeven\s+1/)
      // The curve is filtered PnL, not invented balance history.
      const curve = rows.first().locator('.fxa-viz svg')
      await curve.waitFor()
      assert.match(await curve.getAttribute('aria-label'), /PnL/)
      assert.match(await rows.first().locator('.live-analytics-chart-value').innerText(), /12[.,]345/)
      const curveDetails = await curve.locator('[data-tooltip]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tooltip')).join(' '))
      assert(!curveDetails.includes('10.100') && !curveDetails.includes('10,100'))
      const selector = side.getByRole('combobox')
      await selector.selectOption('percent')
      const comparison = rows.nth(1).locator('.fxa-expectancy-comparison')
      assert.match(await comparison.innerText(), /1%/)
      assert.match(await comparison.innerText(), /-0[,.]5%/)
      assert(!/\$/.test(await comparison.getAttribute('aria-label')))
      assert.match(await curve.locator('[data-tooltip]').first().getAttribute('data-tooltip'), /%/)
      const heading = side.locator('h2').first()
      assert(await heading.evaluate(el => { const r = el.getBoundingClientRect(); return [...el.children].every(child => { const c = child.getBoundingClientRect(); return c.left >= r.left && c.right <= r.right && c.top >= r.top && c.bottom <= r.bottom }) }))
      await side.getByRole('button', { name: lang === 'vi' ? 'Ẩn giá trị' : 'Hide values', exact: true }).click()
      assert.equal(await side.locator('svg[role="img"], svg[role="group"], [data-tooltip]').count(), 0, 'Hidden chart values must not leak via tooltips or accessible chart labels')
      assert(!/12[.,]345|33[,.]33%|0[,.]5%/.test(await side.innerText()))
      await side.getByRole('button', { name: lang === 'vi' ? 'Hiện giá trị' : 'Show values', exact: true }).click()
      await curve.waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await side.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${out}/${section}-${width}-${theme}-${lang}.png` })
      report.cases.push({ section, width, theme, lang, units: true, private: true })
    }
    if (width === 1440) {
      broker.deals[1].fee = null
      await page.reload()
      const side = page.locator('.live-analytics-side'), rows = side.locator('.live-analytics-chart-row')
      await rows.first().waitFor()
      assert.match(await rows.nth(2).locator('.fxa-chart-heading').innerText(), /N\/A/)
      assert.match(await rows.nth(2).locator('.fxa-chart-legend').innerText(), /Chưa rõ\s+1/)
      assert.equal(await rows.nth(1).locator('.fxa-average-labels').innerText(), 'N/A\nN/A')
      broker.account.opening_balance = null
      broker.deals[1].fee = 0
      await page.reload()
      await rows.first().waitFor()
      await side.getByRole('combobox').selectOption('percent')
      assert.equal(await rows.nth(1).locator('.fxa-average-labels').innerText(), 'N/A\nN/A')
      assert.equal(await rows.first().locator('.fxa-viz').count(), 0, 'Missing capital cannot create a percentage curve')
      broker.balance_baseline = { amount: 10000, currency: 'USD', captured_at_utc: '2026-10-01T00:00:00Z' }
      await page.reload()
      await side.getByRole('combobox').selectOption('percent')
      assert.match(await rows.nth(1).locator('.fxa-average-labels').innerText(), /1%/)
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
      await side.getByRole('combobox').waitFor()
      assert.match(await side.getByRole('combobox').innerText(), /EUR/)
      assert(!/USD/.test(await side.getByRole('combobox').innerText()))
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
