import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_LIVE_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_LIVE_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/calendar-partial-ui'
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
const report = { scope: 'Labeled multi-account GET fixtures; broker access blocked', cases: [], errors: [], mutations: [] }
try {
  for (const width of [1920, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    const connections = [a, b].map((id, index) => ({ id, name: ['Alpha', 'Beta'][index], login_hint: `…${index + 1}`, server: 'Fixture-Demo', account: { currency: 'USD' }, status: 'connected' }))
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url())
      if (request.method() !== 'GET') { report.mutations.push(url.pathname); return route.abort() }
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      if (url.pathname === '/api/v2/live/status') {
        const id = url.searchParams.get('connection_id') || a
        return route.fulfill({ json: { status: 'ready', connection_id: id, connections, source: 'Fixture', account: { account_ref: id, currency: 'USD', balance: 1000 },
          history_from_utc: id === a ? '2026-10-01T00:00:00Z' : '2026-10-20T00:00:00Z', captured_at_utc: '2026-10-23T00:00:00Z',
          deals: id === a ? [{ ticket: 1, symbol: 'EURUSD', type: 0, time_msc: Date.parse('2026-10-12T12:00:00Z'), profit: 25, commission: 0, swap: 0, fee: 0 }] : [] } })
      }
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=calendar&lang=vi&theme=dark`)
    await page.locator('.live-month-total strong').filter({ hasText: '25' }).waitFor()
    const partial = page.locator('.live-calendar-cell').filter({ has: page.locator('.live-day-number', { hasText: /^12$/ }) })
    assert.equal(await partial.locator('strong').textContent(), '25')
    assert.equal(await partial.getByText('Một phần', { exact: true }).count(), 1)
    const week = page.locator('.live-calendar-week').filter({ has: partial })
    assert.match(await week.locator('.live-week-total strong').textContent(), /25/)
    assert.equal(await week.locator('.live-week-total').getByText('Một phần', { exact: true }).count(), 1)
    assert.equal(await page.locator('.live-month-total').getByText('Một phần', { exact: true }).count(), 1)
    const unknown = page.locator('.live-calendar-cell').filter({ has: page.locator('.live-day-number', { hasText: /^30$/ }) }).first()
    assert.equal(await unknown.locator('strong').count(), 0)
    await partial.click()
    await page.locator('.live-day-detail').getByText('EURUSD · #1', { exact: true }).waitFor()
    await page.screenshot({ path: `${out}/partial-${width}.png`, animations: 'disabled' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    report.cases.push({ width, observedSubtotal: 25, dayWeekMonthPartial: true, unknownDayBlank: true, dayDetails: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.mutations, [])
  report.passed = true
} catch (error) { report.failure = error.stack; throw error }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)) }
