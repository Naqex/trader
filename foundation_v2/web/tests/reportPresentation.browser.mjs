import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const origin = process.env.REPORT_CHART_ORIGIN || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.REPORT_CHART_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/report-months-centered-20261025/browser')
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
    const bars = monthly.locator('.report-bar')
    await bars.first().waitFor()
    await gold.locator('.fx-dashboard-card-disclosure').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    assert.equal(await bars.count(), 12)
    assert.equal(await monthly.locator('.report-month-cell, .report-year-select').count(), 0)
    assert.equal(await monthly.locator('.report-bar-segment.is-negative rect').count(), 12)
    assert.equal(await monthly.locator('.report-bar-segment.is-positive rect').count(), 12)
    assert.equal(await monthly.locator('.report-svg').evaluate(node => node.clientHeight), 418)
    const position = await bars.first().evaluate(node => {
      const hit = node.querySelector('.report-hit'), negative = node.querySelector('.is-negative rect'), positive = node.querySelector('.is-positive rect')
      return { middle: +hit.getAttribute('x') + +hit.getAttribute('width') / 2, negativeEnd: +negative.getAttribute('x') + +negative.getAttribute('width'), positiveStart: +positive.getAttribute('x'), rowY: +hit.getAttribute('y'), rowHeight: +hit.getAttribute('height') }
    })
    assert.ok(Math.abs(position.middle - position.negativeEnd) < 1e-6)
    assert.ok(Math.abs(position.middle - position.positiveStart) < 1e-6)
    assert.ok(position.rowHeight < 40, 'twelve compact horizontal rows')
    const monthTicks = await monthly.locator('.report-svg > g:not(.report-bar) > text').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, x: +node.getAttribute('x') })))
    assert.equal(monthTicks[Math.floor(monthTicks.length / 2)].text, '0')
    const monthStep = monthTicks[1].x - monthTicks[0].x
    assert.ok(monthTicks.slice(1).every((tick, index) => Math.abs(tick.x - monthTicks[index].x - monthStep) < 1e-6))
    await monthly.screenshot({ path: path.join(out, `months-${width}-${lang}.png`) })
    await reveal(bars.first().locator('.report-hit'), page)
    if (touch) await bars.first().locator('.report-hit').tap()
    else { await page.mouse.move(0, 0); await bars.first().locator('.report-hit').hover() }
    const tip = page.getByRole('tooltip')
    await tip.filter({ hasText: '2021–2025' }).waitFor()
    // Jan spans all five years: sums, not a mean or just the last year.
    assert.match(await tip.innerText(), /780/)
    assert.match(await tip.innerText(), /585/)
    assert.match(await tip.innerText(), /195/)
    const tipBounds = await tip.boundingBox()
    assert.ok(tipBounds.x >= 0 && tipBounds.x + tipBounds.width <= width)
    await tip.screenshot({ path: path.join(out, `bar-tooltip-${width}-${lang}.png`), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await tip.waitFor({ state: 'hidden' })
    assert.equal(await daily.locator('.report-bar').count(), 7)
    assert.equal(await daily.locator('.report-bar-segment.is-positive, .report-bar-segment.is-negative').count(), 0)
    const dayTicks = await daily.locator('.report-svg > g:not(.report-bar) > text').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, y: +node.getAttribute('y') })))
    assert.equal(dayTicks[2].text, '0')
    const dayHeight = await daily.locator('.report-svg').evaluate(node => node.viewBox.baseVal.height)
    assert.equal(dayTicks[2].y, (24 + dayHeight - 88) / 2)
    const dayStep = dayTicks[1].y - dayTicks[0].y
    assert.ok(dayTicks.slice(1).every((tick, index) => Math.abs(tick.y - dayTicks[index].y - dayStep) < 1e-6))
    const colors = await daily.locator('.report-bar-segment rect').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill))
    assert.ok(colors.length > 0)
    assert.equal(new Set(colors).size, 1)
    assert.equal(colors[0], await daily.locator('.report-bar-segment rect').first().evaluate(node => {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      probe.style.fill = 'var(--report-blue)'; node.parentElement.append(probe)
      const color = getComputedStyle(probe).fill; probe.remove(); return color
    }))
    await daily.screenshot({ path: path.join(out, `daily-${width}-${lang}.png`) })
    const equity = gold.locator('.report-chart').first()
    assert.ok(await equity.locator('.report-line').evaluate(node => node.getAttribute('d').includes('C')))
    assert.ok(await equity.locator('.report-line').evaluate(node => {
      const length = node.getTotalLength()
      const bottom = node.ownerSVGElement.viewBox.baseVal.height - 42
      return Array.from({ length: 201 }, (_, index) => node.getPointAtLength(length * index / 200)).every(point => point.y >= 24 - 1e-4 && point.y <= bottom + 1e-4)
    }))
    const equityHeight = await equity.locator('.report-svg').evaluate(node => node.viewBox.baseVal.height)
    if (width > 1000) { assert.ok(equityHeight >= 410); assert.ok(dayHeight >= 410) }
    else { assert.equal(equityHeight, 250); assert.equal(dayHeight, 296) }
    await equity.screenshot({ path: path.join(out, `equity-${width}-${lang}.png`) })
    const london = page.locator('[data-session-id="demo-london"]')
    await london.locator('.fx-dashboard-card-expand').click()
    const londonMonth = london.locator('.report-chart').nth(1)
    await londonMonth.locator('.report-bar').first().waitFor()
    await london.locator('.fx-dashboard-card-disclosure').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    assert.equal(await londonMonth.locator('.report-category-year').count(), 3)
    assert.equal(await londonMonth.locator('h3').innerText(), lang === 'vi' ? 'Hiệu suất theo tháng' : 'Monthly Performance')
    const zero = london.locator('.report-chart').nth(2).locator('.report-bar').nth(3)
    assert.equal(await zero.locator('.report-bar-segment rect').count(), 0)
    await reveal(zero.locator('.report-hit'), page)
    await zero.focus()
    await tip.waitFor()
    assert.match(await tip.innerText(), /\$0/)
    if (touch) {
      await page.keyboard.press('Escape')
      await zero.locator('.report-hit').tap()
      await tip.waitFor()
      await londonMonth.locator('h3').tap()
      await tip.waitFor({ state: 'hidden' })
    }
    await page.keyboard.press('Escape')
    await tip.waitFor({ state: 'hidden' })
    const rate = page.locator('.fx-dashboard-secondary-charts .report-chart').first()
    assert.equal(await rate.locator('.report-category-year').count(), 3)
    assert.equal(await page.locator('.report-year, .report-year-select').count(), 0)
    await rate.screenshot({ path: path.join(out, `year-labels-${width}-${lang}.png`) })
    assert.equal(await page.locator('.report-bar-value').count(), 0)
    assert.equal(await page.locator('.report-plot, .report-month-matrix').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    report.checks.push({ width, theme, lang, touch, fiveYearsMerged12Rows: true, symmetricAxes: true, yearOnMonthLabels: true, boundedCurve: true, monthlySplit: true, dailyNetBlue: true, hiddenBarValues: true, zeroTooltip: true, hoverFocusEscape: true, noScroll: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify(report))
