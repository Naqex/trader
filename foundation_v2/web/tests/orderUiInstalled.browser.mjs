import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [href, output] = process.argv.slice(2)
assert.ok(href && output, 'Pass the installed local replay URL and evidence directory')
const url = new URL(href)
assert.equal(url.origin, 'http://127.0.0.1:5180')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1368, height: 900 }, reducedMotion: 'reduce' })
const report = { scope: 'Installed production UI and native API, all owner API writes blocked, no trades or playback', blocked: [], errors: [] }
await mkdir(output, { recursive: true })
try {
  await context.route('**/*', route => {
    const request = route.request(), target = new URL(request.url())
    if (target.origin !== url.origin) return route.abort()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blocked.push(target.pathname); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(href)
  await page.locator('[data-chart-engine=advanced][data-chart-status=ready]').waitFor({ timeout: 30000 })
  report.ready = true
  report.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  assert.equal(report.horizontalOverflow, false)
  const native = page.frameLocator('.advanced-chart-host iframe')
  if (await native.locator('.wm-order-marker-quantity').count()) {
    const quantity = native.locator('.wm-order-marker-quantity').first(), close = native.locator('.wm-order-marker-close').first()
    assert.equal(await quantity.getAttribute('aria-label'), 'Chỉnh sửa vị thế')
    assert.equal(await close.getAttribute('aria-label'), 'Đóng một phần vị thế')
    await close.click()
    await page.locator('.partial-close-dialog').waitFor()
    assert.equal(await page.locator('.partial-close-dialog').getByRole('button', { name: '100%', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.partial-close-dialog .partial-close-error').count(), 0)
    assert.equal(await page.locator('.partial-close-dialog').getByRole('button', { name: 'Lưu', exact: true }).isEnabled(), true)
    await page.screenshot({ path: `${output}/installed-partial.png` })
    await page.keyboard.press('Escape')
    await quantity.click()
    await page.locator('.legacy-order-modal').waitFor()
    assert.equal(await page.locator('.partial-close-dialog').count(), 0)
    await page.screenshot({ path: `${output}/installed-edit.png` })
    await page.keyboard.press('Escape')
    report.installedMarkerDialogs = true
  }
  await page.screenshot({ path: `${output}/installed-chart.png` })
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await writeFile(`${output}/installed-browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ passed: report.passed, blockedWrites: report.blocked.length, errors: report.errors }))
