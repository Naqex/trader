// Recorded demo history behind GET-only fixtures. No account or broker writes.
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
try {
  for (const [width, theme] of [[1920, 'dark'], [390, 'light']]) {
    for (const scenario of ['ready', 'empty', 'unknown-fees']) {
      const payload = structuredClone(fixture)
      if (scenario === 'empty') payload.deals = []
      if (scenario === 'unknown-fees') payload.deals[0].fee = null
      const ctx = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
      await ctx.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
      await ctx.routeWebSocket('**/*', socket => socket.close())
      await ctx.route('**/*', route => {
        const req = route.request(), url = new URL(req.url())
        if (url.origin !== origin) return route.abort()
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.writes.push(url.pathname); return route.abort() }
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: payload })
        if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: payload.connections } })
        if (url.pathname === '/api/v2/live/trading') return route.fulfill({ json: {
          status: 'ready', mode: 'demo', summary: true, connection_id: payload.connection_id,
          account: { ...payload.account, login: Number(payload.account_login), server: payload.account_binding.server },
          bars: [], positions: [], orders: [], requests: [], capabilities: {},
        } })
        return route.fulfill({ json: { items: [], available: false } })
      })
      const page = await ctx.newPage()
      page.setDefaultTimeout(12000)
      page.on('pageerror', error => report.errors.push(error.message))
      await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=terminal&lang=vi&mt5_connection=${payload.connection_id}`)
      const chart = page.locator('.mt5-report .report-chart').first()
      await chart.waitFor()
      if (scenario === 'ready') {
        await chart.locator('.report-line').waitFor()
        const labels = await chart.locator('.report-svg > text').evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect()
          return { text: node.textContent, left: rect.left, right: rect.right }
        }))
        assert(labels.length > 0)
        assert(labels.every((label, index) => !index || label.left >= labels[index - 1].right - 1), 'Live time-axis labels must not overlap')
      } else {
        await chart.locator('.fxs-chart-empty').waitFor()
        assert.equal(await chart.locator('.report-line').count(), 0, 'Unavailable data does not produce a fabricated curve')
      }
      assert.equal(await page.getByRole('alert').filter({ hasText: 'Không mở được trang này' }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      await chart.screenshot({ path: `${out}/${scenario}-${width}-${theme}.png` })
      report.cases.push({ scenario, width, theme })
      await ctx.close()
    }
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
