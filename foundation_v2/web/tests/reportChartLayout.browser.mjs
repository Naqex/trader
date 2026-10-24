import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5194'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/report-chart-layout'
await mkdir(out, { recursive: true })
const browser = await chromium.launch(), report = { scope: 'synthetic dense report data, browser resize, GET only', checks: [], errors: [], writes: [] }
const months = Array.from({ length: 24 }, (_, i) => ({ month: `${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, win_rate_pct: i * 4, time_invested_seconds: (i + 1) * 3600 }))
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 940 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(url.pathname); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/overview') return route.fulfill({ json: { performance: {
        schema_version: 'dashboard-replay-performance-v1', status: 'ready', scope: { session_count: 1, readable_session_count: 1 },
        metrics: { closed_trade_count: 48, win_rate_pct: 50 }, time_invested_seconds: 3600, historical_time_replayed_seconds: 86400,
        months, activity_months: months, symbols: Array.from({ length: 24 }, (_, i) => ({ symbol: `PAIR${i + 1}`, closed_trade_count: 12345 + i * 1000 })), sessions: [], sources: [], excluded: [],
      } } })
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=chart-layout-fixture&view=overview&area=testing&section=dashboard&dashboard_source=all`)
    await page.locator('.report-svg').first().waitFor()
    for (const width of [1920, 1440, 768, 390, 1920]) {
      await page.setViewportSize({ width, height: 940 })
      await page.waitForFunction(() => [...document.querySelectorAll('.report-plot')].every(el => el.firstElementChild.viewBox.baseVal.width === el.clientWidth))
      const charts = await page.locator('.report-plot').evaluateAll(nodes => nodes.map(el => {
        const svg = el.firstElementChild
        const ticks = [...svg.querySelectorAll(':scope > g:not(.report-bar) > text')].map(text => text.getBoundingClientRect())
        const horizontal = [...svg.querySelectorAll('.report-bar')].length > 0 && ticks.every(tick => Math.abs(tick.y - ticks[0].y) < 1)
        return { width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight, bars: svg.querySelectorAll('.report-bar').length,
          tickOverlap: horizontal && ticks.some((tick, i) => i > 0 && tick.left < ticks[i - 1].right + 3) }
      }))
      assert.equal(charts.length, 3)
      for (const chart of charts) {
        assert.equal(chart.bars, 24, 'resize must retain every data bar')
        assert.ok(chart.scrollWidth <= chart.width + 1 && chart.scrollHeight <= chart.height + 1, 'chart must fit without nested scroll')
        assert.equal(chart.tickOverlap, false, 'horizontal numeric ticks must not overlap')
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      report.checks.push({ theme, width, charts: charts.length, barsPerChart: 24, noNestedScroll: true, noTickOverlap: true })
      if (width === 390) await page.locator('.report-chart').last().screenshot({ path: `${out}/${theme}-390.png` })
    }
    await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.writes, []); report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
console.log(JSON.stringify(report))
