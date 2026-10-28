// Synthetic GET-only fixtures; no broker calls, writes or personal browser profile.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { journalRecords, brokerSnapshot, fixtureAccount } from './liveJournal.fixture.mjs'

const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert(out)
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'Synthetic Live analytics and transaction layout', cases: [], errors: [], writes: [] }
try {
  for (const [width, theme] of [[1920, 'dark'], [1440, 'light'], [1280, 'dark'], [390, 'dark']]) {
    const ctx = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await ctx.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    const records = journalRecords(), broker = brokerSnapshot()
    broker.account.opening_balance = 10000
    await ctx.routeWebSocket('**/*', socket => socket.close())
    await ctx.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.writes.push(url.pathname); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: records } })
      if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: broker })
      if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: broker.connections } })
      if (url.pathname.startsWith('/api/v2/mt5')) return route.abort()
      return route.fulfill({ json: { items: [], available: false } })
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => report.errors.push(error.message))
    const url = section => `${origin}/?workspace=fixture&view=live&lang=vi&area=live&section=${section}`
    await page.goto(`${url('trading-accounts')}&account_tab=transactions&live_account=${fixtureAccount}`)
    const sidebar = page.locator('.is-transactions .live-add-account')
    await sidebar.locator('.live-cash-summary dd').first().waitFor()
    await sidebar.scrollIntoViewIfNeeded()
    assert(await sidebar.evaluate(el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 }), 'Account details remain reachable on narrow screens')
    const geometry = await sidebar.evaluate(el => {
      const box = el.getBoundingClientRect(), picker = el.querySelector('.fx-select-trigger').getBoundingClientRect(), style = getComputedStyle(el)
      const divider = parseFloat(style.borderLeftWidth)
      const rows = [...el.querySelectorAll('.live-cash-summary > div')].map(row => {
        const bounds = row.getBoundingClientRect(), label = row.querySelector('dt').getBoundingClientRect(), value = row.querySelector('dd').getBoundingClientRect(), valueStyle = getComputedStyle(row.querySelector('dd'))
        return { left: bounds.left - box.left - divider, right: box.right - bounds.right, valueBelowLabel: value.top >= label.bottom, valueAlign: valueStyle.textAlign, valueBorder: valueStyle.borderLeftWidth, separator: getComputedStyle(row).borderBottomWidth }
      })
      return { divider, topDivider: style.borderTopWidth, pickerLeft: picker.left - box.left, pickerRight: box.right - picker.right, rows }
    })
    assert(geometry.pickerLeft >= 16 && geometry.pickerRight >= 16, 'Picker keeps content gutters')
    assert.equal(geometry.divider, width > 1000 ? 1 : 0, 'One vertical divider separates desktop panes; stacked panes have no side divider')
    if (width <= 1000) assert.equal(geometry.topDivider, '1px', 'Stacked sidebar has one top separator')
    assert(geometry.rows.every(row => Math.abs(row.left) < 1 && Math.abs(row.right) < 1 && row.valueBelowLabel && row.valueAlign === 'left' && row.valueBorder === '0px' && row.separator === '1px'), 'Each full-width row stacks label and value above a single horizontal separator')
    await page.screenshot({ path: `${out}/accounts-${width}-${theme}.png` })
    report.cases.push({ name: 'account-details-boundaries', width, theme, geometry })
    await page.goto(`${url('analytics')}&live_accounts=${fixtureAccount}`)
    const filters = page.getByTestId('analytics-filters')
    await filters.waitFor()
    await page.locator('.fxa-report-tabs').waitFor()
    const controls = await filters.locator('.fxa-analytics-filter-row > *').allTextContents()
    const layout = await page.locator('.fxa-report-tabs').evaluate(el => {
      const tabs = el.getBoundingClientRect(), pane = el.closest('.live-workspace').getBoundingClientRect()
      return { left: tabs.left - pane.left, right: pane.right - tabs.right }
    })
    assert(Math.abs(layout.left) <= 1 && Math.abs(layout.right) <= 1, 'Tabs span the pane edges')
    assert.equal(await filters.locator('.fxa-export-button').count(), 0)
    assert.equal(await page.locator('.live-filters').count(), 0)
    await writeFile(`${out}/probe-${width}.json`, JSON.stringify({controls,layout,text:await page.locator('.live-analytics-report').innerText()}, null, 2))
    await page.screenshot({ path: `${out}/analytics-${width}-${theme}.png` })
    report.cases.push({ name: 'analytics-shared-filter-layout', width, theme, controls, layout })
    assert.deepEqual(controls.filter(Boolean), ['Tài sản', 'Hướng lệnh', 'Kết quả', 'Nhãn', 'Tài khoản · 1', 'Ngày', 'Múi giờ (UTC+0)', 'Khoảng ngày', 'Áp dụng'])
    // Locate by its actual metric label, independent of the surrounding chart layout.
    const tradeCount = page.locator('[data-testid="analytics-performance"] .fxa-metric').filter({ has: page.locator('span', { hasText: /^Tổng giao dịch$/ }) }).locator('strong').first()
    await assert.doesNotReject(() => tradeCount.waitFor())
    assert.equal((await tradeCount.innerText()).split('\n')[0], '65')
    const apply = filters.getByRole('button', { name: 'Áp dụng', exact: true })
    await filters.getByRole('button', { name: 'Tài sản', exact: true }).click()
    await filters.getByRole('option', { name: 'EURUSD', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal((await tradeCount.innerText()).split('\n')[0], '65', 'Draft asset does not change the report')
    await apply.click()
    assert.equal((await tradeCount.innerText()).split('\n')[0], '32', 'Apply filters to the selected asset')
    await filters.locator('.fxa-filter-chip').filter({ hasText: 'EURUSD' }).click()
    assert.equal((await tradeCount.innerText()).split('\n')[0], '65', 'Removing a chip restores scope')
    await filters.locator('.fxa-session-trigger').click()
    await filters.locator('.fxa-session-all').click()
    await page.keyboard.press('Escape')
    assert.equal((await tradeCount.innerText()).split('\n')[0], '65', 'Account selection stays staged')
    await apply.click()
    assert.equal((await tradeCount.innerText()).split('\n')[0], '130', 'Both same-currency accounts aggregate')
    await filters.locator('.fxa-session-trigger').click()
    await filters.locator('.fxa-session-all').click()
    await page.keyboard.press('Escape')
    // A refresh of the applied array must not replace an in-progress empty draft.
    await page.waitForResponse(response => new URL(response.url()).pathname === '/api/v2/live/status')
    await filters.locator('.fxa-session-trigger').click()
    assert.equal(await filters.locator('.fxa-session-all').getAttribute('aria-checked'), 'false')
    await page.keyboard.press('Escape')
    await apply.click()
    await page.locator('.live-analytics-report .live-empty').waitFor()
    assert.equal(await filters.count(), 1, 'Filters remain reachable when no account is selected')
    await filters.locator('.fxa-session-trigger').click()
    await filters.locator('.fxa-session-all').click()
    await page.keyboard.press('Escape')
    await apply.click()
    assert.equal((await tradeCount.innerText()).split('\n')[0], '130', 'Account selection recovers from empty')
    report.cases.push({ name: 'filters-stage-apply-remove-account-empty-recover', width, theme })
    if (width === 1920) {
      broker.account.currency = 'EUR'
      await page.reload()
      await filters.waitFor()
      await page.getByRole('status').filter({ hasText: 'Các tài khoản khác tiền tệ' }).waitFor()
      assert.equal(await page.getByTestId('analytics-performance').count(), 0, 'Mixed currencies never show a combined report')
      report.cases.push({ name: 'mixed-currency-unavailable', width, theme })
    }
    await ctx.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} finally {
  await browser.close()
  await writeFile(`${out}/browser.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, errors: report.errors, writes: report.writes }))
