import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.env.TW_UI_EVIDENCE_DIR || '../evidence/dashboard-card-surface-20261012'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const report = { scope: 'Shared Dashboard card surfaces, preview with writes blocked', cases: [], errors: [] }
try {
  for (const theme of ['dark', 'light']) for (const width of [1563, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => new URL(route.request().url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue())
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&demo=1`)
    const card = page.locator('.fx-dashboard-session-card').first()
    const toggle = card.locator('.fx-dashboard-card-expand')
    await toggle.click()
    await page.mouse.move(10, 10)
    await page.waitForTimeout(350)
    const panels = card.locator('.fxs-chart-panel')
    assert.equal(await panels.count(), 3)
    assert.equal(await panels.first().evaluate(node => getComputedStyle(node).borderTopColor), 'rgba(0, 0, 0, 0)')
    const rest = await card.evaluate(node => getComputedStyle(node).backgroundColor)
    const capture = name => width < 480 ? page.screenshot({ path: `${output}/${theme}-${width}-${name}.png` }) : card.screenshot({ path: `${output}/${theme}-${width}-${name}.png` })
    await capture('expanded')
    await page.mouse.move(10, 10)
    await page.waitForTimeout(200)
    const geometry = await panels.first().boundingBox()
    await panels.last().hover()
    await page.waitForTimeout(200)
    const hover = await card.evaluate(node => getComputedStyle(node).backgroundColor)
    assert.notEqual(hover, rest)
    const hoveredGeometry = await panels.first().boundingBox()
    assert.equal(hoveredGeometry.width, geometry.width)
    assert.equal(hoveredGeometry.height, geometry.height)
    await capture('hover')
    await toggle.press('Space')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    report.cases.push({ theme, width, rest, hover, nestedBorders: 'transparent', geometryStable: true, keyboardCollapse: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: 'PASS', cases: report.cases.length, errors: report.errors }))
} finally { await browser.close() }
