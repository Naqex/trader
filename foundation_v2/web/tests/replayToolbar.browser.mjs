import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [href, output] = process.argv.slice(2)
assert.ok(href && output, 'Pass the installed replay URL and evidence directory')
const url = new URL(href)
assert.equal(url.origin, 'http://127.0.0.1:5180')
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Installed native chart; owner writes blocked; no trades or playback', cases: [] }
await mkdir(output, { recursive: true })
try {
  for (const width of [1368, 768, 360]) {
    const height = 790, result = { width, errors: [], blocked: [] }
    report.cases.push(result)
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 360, reducedMotion: 'reduce' })
    try {
      await context.route('**/*', route => {
        const request = route.request(), target = new URL(request.url())
        if (target.origin !== url.origin) return route.abort()
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { result.blocked.push(target.pathname); return route.abort() }
        return route.continue()
      })
      await context.addInitScript(({ theme }) => {
        localStorage.setItem('tw-theme', theme)
        localStorage.setItem('tw-language', 'vi')
      }, { theme: width === 768 ? 'light' : 'dark' })
      const page = await context.newPage()
      page.on('pageerror', error => result.errors.push(error.message))
      await page.goto(href)
      await page.locator('[data-chart-engine=advanced][data-chart-status=ready]').waitFor({ timeout: 30000 })
      const toolbar = page.locator('.legacy-replay-toolbar'), grip = toolbar.locator('.chart-float-grip')
      assert.equal(await toolbar.evaluate(node => getComputedStyle(node).position), 'fixed')
      const chart = await page.locator('.chart-canvas').boundingBox()
      result.chart = chart
      const moveTo = async (x, y) => {
        const rect = await grip.boundingBox(), old = await toolbar.boundingBox()
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
        await page.mouse.down()
        await page.mouse.move(x + rect.x + rect.width / 2 - old.x, y + rect.y + rect.height / 2 - old.y, { steps: 12 })
        await page.mouse.up()
      }
      const visible = async () => {
        const rect = await toolbar.boundingBox(), size = page.viewportSize()
        assert.ok(rect.x >= 7 && rect.y >= 7 && rect.x + rect.width <= size.width - 7 && rect.y + rect.height <= size.height - 7, JSON.stringify(rect))
        assert.equal(await grip.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), true, 'Grip stays visible and interactive above application chrome')
        return rect
      }
      await moveTo(8, 8)
      result.top = await visible()
      await page.screenshot({ path: `${output}/${width}-top.png` })
      assert.equal(result.top.x, 8, 'Viewport edges replace the former chart rail insets')
      assert.equal(result.top.y, 8, 'Toolbar can reach the viewport top instead of the chart minimum Y')
      await grip.focus()
      await page.keyboard.press('ArrowDown')
      assert.equal((await toolbar.boundingBox()).y, result.top.y + 12)
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp')
      assert.equal((await toolbar.boundingBox()).y, 8)
      await moveTo(width - result.top.width - 8, height - result.top.height - 8)
      result.bottom = await visible()
      assert.ok(result.bottom.y + result.bottom.height > chart.y + chart.height, 'Toolbar can move below the chart')
      await page.screenshot({ path: `${output}/${width}-bottom.png` })
      await page.reload()
      await toolbar.waitFor()
      result.reloaded = await visible()
      assert.ok(Math.abs(result.reloaded.y - result.bottom.y) < 1, 'Viewport position survives reload')
      await page.setViewportSize({ width: 360, height: 600 })
      await page.waitForFunction(() => { const r = document.querySelector('.legacy-replay-toolbar')?.getBoundingClientRect(); return r && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7 })
      result.resized = await visible()
      const interval = toolbar.locator('.legacy-replay-interval')
      await interval.click()
      await page.locator('.legacy-replay-intervals').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await interval.evaluate(node => document.activeElement === node), true)
      if (width === 360) {
        const client = await context.newCDPSession(page), rect = await grip.boundingBox()
        const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: 20 }] })
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        result.touch = await visible()
        assert.ok(result.touch.y < 30, 'Touch drag crosses the chart boundary')
        await client.detach()
      }
      assert.deepEqual(result.errors, [])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      result.passed = true
    } finally { await context.close() }
  }
  report.passed = true
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ passed: report.passed, widths: report.cases.map(({ width, passed }) => ({ width, passed })) }))
