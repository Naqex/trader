import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const origin = process.env.REPORT_CHART_ORIGIN || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.REPORT_CHART_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/report-tooltips-20261025/browser')
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'Actual demo fixtures, no response substitution or mutations', checks: [], errors: [], writes: [] }
async function reveal(target, page) {
  await target.scrollIntoViewIfNeeded()
  // Scroll deliberately dismisses tooltips; let its queued event finish before interacting.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
try {
  for (const [width, theme, lang, touch] of [[1920, 'dark', 'vi', false], [390, 'light', 'vi', true], [390, 'dark', 'en', false]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, hasTouch: touch })
    await context.addInitScript(({ theme, lang }) => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', lang)
      localStorage.setItem('tw-timezone', 'UTC')
    }, { theme, lang })
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&lang=${lang}&demo=1&area=testing&section=dashboard`)
    await page.waitForLoadState('networkidle')
    const gold = page.locator('[data-session-id="demo-gold"]')
    await gold.locator('.fx-dashboard-card-expand').click()
    const monthly = gold.locator('.report-chart').nth(1), daily = gold.locator('.report-chart').nth(2)
    const cells = monthly.locator('.report-month-cell')
    await cells.first().waitFor()
    await gold.locator('.fx-dashboard-card-disclosure').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    assert.equal(await cells.count(), 60)
    assert.equal(await monthly.locator('.is-missing').count(), 0)
    assert.equal(await monthly.locator('.is-flat').count(), 12)
    assert.equal(await cells.allTextContents().then(text => text.every(value => value === '')), true)
    assert.ok(await monthly.locator('.report-month-matrix').evaluate(node => node.clientHeight) < 200)
    await monthly.screenshot({ path: path.join(out, `matrix-${width}-${lang}.png`) })
    await reveal(cells.first(), page)
    await cells.first().hover()
    await page.getByRole('tooltip').filter({ hasText: '2021-01' }).waitFor()
    await page.getByRole('tooltip').screenshot({ path: path.join(out, `matrix-tooltip-${width}-${lang}.png`), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.getByRole('tooltip').waitFor({ state: 'hidden' })
    await cells.first().press('Enter')
    const bars = monthly.locator('.report-bar')
    await bars.first().waitFor()
    assert.equal(await bars.count(), 12)
    assert.equal(await monthly.locator('.report-bar-segment.is-negative rect').count(), 10)
    assert.equal(await monthly.locator('.report-bar-segment.is-positive rect').count(), 10)
    assert.equal(await monthly.locator('.report-bar-value').count(), 0)
    assert.equal(await monthly.locator('.report-svg').evaluate(node => node.clientHeight), 296)
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), lang === 'vi' ? 'Năm hiệu suất' : 'Performance year')
    await reveal(bars.first().locator('.report-hit'), page)
    if (touch) await bars.first().locator('.report-hit').tap()
    else { await page.mouse.move(0, 0); await bars.first().locator('.report-hit').hover() }
    const tip = page.getByRole('tooltip')
    await tip.filter({ hasText: '2021-01' }).waitFor()
    assert.match(await tip.innerText(), /160/)
    assert.match(await tip.innerText(), /290/)
    assert.match(await tip.innerText(), /130/)
    const tipBounds = await tip.boundingBox()
    assert.ok(tipBounds.x >= 0 && tipBounds.x + tipBounds.width <= width)
    await tip.screenshot({ path: path.join(out, `bar-tooltip-${width}-${lang}.png`), animations: 'disabled' })
    await monthly.screenshot({ path: path.join(out, `year-${width}-${lang}.png`) })
    await page.screenshot({ path: path.join(out, `context-${width}-${lang}.png`) })
    await page.keyboard.press('Escape')
    await tip.waitFor({ state: 'hidden' })
    // The third month contains two real zero trades; it still exposes its value.
    const zero = bars.nth(2)
    assert.equal(await zero.locator('.report-bar-segment rect').count(), 0)
    await reveal(zero.locator('.report-hit'), page)
    await zero.focus()
    await tip.filter({ hasText: '2021-03' }).waitFor()
    assert.match(await tip.innerText(), /\$0/)
    if (touch) {
      await page.keyboard.press('Escape')
      await zero.locator('.report-hit').tap()
      await tip.filter({ hasText: '2021-03' }).waitFor()
      await page.locator('.report-heading h3').first().tap()
      await tip.waitFor({ state: 'hidden' })
    }
    await monthly.getByRole('button', { name: lang === 'vi' ? 'Năm hiệu suất' : 'Performance year', exact: true }).click()
    await page.getByRole('option', { name: lang === 'vi' ? 'Tất cả các năm' : 'All years' }).click()
    await cells.first().waitFor()
    assert.equal(await cells.count(), 60)
    assert.equal(await daily.locator('.report-bar').count(), 7)
    assert.equal(await daily.locator('.report-bar-segment.is-positive, .report-bar-segment.is-negative').count(), 0)
    const colors = await daily.locator('.report-bar-segment rect').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill))
    assert.ok(colors.length > 0)
    assert.equal(new Set(colors).size, 1)
    assert.equal(colors[0], await daily.locator('.report-bar-segment rect').first().evaluate(node => {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      probe.style.fill = 'var(--report-blue)'; node.parentElement.append(probe)
      const color = getComputedStyle(probe).fill; probe.remove(); return color
    }))
    await daily.screenshot({ path: path.join(out, `daily-${width}-${lang}.png`) })
    await reveal(daily.locator('.report-hit').first(), page)
    await daily.locator('.report-bar').first().focus()
    await tip.waitFor()
    await page.keyboard.press('Escape')
    await tip.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.report-bar-value').count(), 0)
    assert.equal(await page.locator('.report-plot, .report-month-matrix').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    report.checks.push({ width, theme, lang, touch, fiveCompleteYears: true, yearDrilldown: true, monthlySplit: true, dailyNetBlue: true, hiddenBarValues: true, zeroTooltip: true, hoverFocusEscape: true, noScroll: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify(report))
