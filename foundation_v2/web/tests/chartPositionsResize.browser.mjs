import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const [href, output] = process.argv.slice(2)
if (!href || !output) throw Error('Usage: node tests/chartPositionsResize.browser.mjs <local replay URL> <evidence directory>')
const origin = new URL(href).origin
assert.equal(new URL(href).hostname, '127.0.0.1')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'Real local chart and native canvas, UI-only; API writes blocked; no playback or trading', cases: [], rendering: [], errors: [] }
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const layout = page => page.evaluate(() => {
  const panel = document.querySelector('.legacy-resizable-positions')
  return { height: panel.hidden ? 0 : panel.getBoundingClientRect().height, chart: document.querySelector('.chart-frame').offsetHeight, toolbar: getComputedStyle(document.querySelector('.legacy-replay-toolbar')).visibility, top: document.querySelector('.legacy-trading-bar').getBoundingClientRect().top, resizing: document.querySelector('.legacy-trading-workspace').classList.contains('is-resizing'), maximized: document.querySelector('.legacy-trading-workspace').classList.contains('is-maximized') }
})
async function begin(page) {
  const box = await page.locator('.legacy-positions-grip').boundingBox()
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await frame(page)
  return point
}
try {
  for (const [width, dpr] of [[1710, 1], [1440, 1.25], [390, 2]]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, deviceScaleFactor: dpr, hasTouch: width < 600 })
    await context.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(href)
    await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('.advanced-chart-host iframe')?.contentDocument?.querySelector('canvas')?.width > 0)
    const grip = page.locator('.legacy-positions-grip')
    assert.ok(await page.locator('.chart-trading-account > :is(button,a)').evaluateAll(nodes => nodes.every(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth })), 'account actions fit the viewport')
    if (width === 390) assert.ok(await page.locator('.chart-trading-account').evaluate(node => node.getBoundingClientRect().height <= 40), 'mobile account actions fit one row')
    const initial = await layout(page)
    const iframe = await page.locator('.advanced-chart-host iframe').elementHandle()
    const point = await begin(page)
    const samples = []
    for (let distance = 10; distance <= 320; distance += 10) {
      await page.mouse.move(point.x, point.y - distance); await frame(page)
      const current = await layout(page)
      assert.ok(Math.abs(current.height - distance) <= 1, `drag ${distance}px -> ${current.height}px at ${width}`)
      assert.ok(current.chart <= initial.chart && current.chart >= 240, `native chart follows the drag without crossing its minimum height at ${width}`)
      assert.equal(current.toolbar, 'visible', 'floating controls do not flash hidden/visible during a drag')
      samples.push(current)
    }
    await page.mouse.up(); await frame(page)
    assert.equal((await layout(page)).height, 320)
    assert.ok(await iframe.evaluate(node => node.isConnected), 'native iframe is preserved')
    await page.screenshot({ path: path.join(output, `positions-${width}.png`) })
    report.cases.push({ width, dpr, case: 'continuous 10px steps; chart tracks the panel until its minimum; same iframe after release', samples })

    const edge = await begin(page)
    for (let y = edge.y - 20; y >= 10; y -= 20) {
      await page.mouse.move(edge.x, y); await frame(page)
      const current = await layout(page)
      assert.ok(Math.abs(current.top + 24 - y) <= (width < 600 ? 60 : 3), `grip follows pointer near top: y=${y}, bar=${current.top} at ${width}`)
      assert.ok(current.chart >= 240)
      assert.equal(await page.evaluate(() => document.querySelector('.legacy-resizable-positions').getBoundingClientRect().bottom <= innerHeight + 1), true, 'table remains inside viewport throughout the drag')
    }
    await page.mouse.move(edge.x, 0); await frame(page)
    assert.equal((await layout(page)).top, 0, 'drag can reach the viewport ceiling')
    await page.screenshot({ path: path.join(output, `positions-edge-${width}.png`) })
    await page.keyboard.press('Escape'); await page.mouse.up(); await frame(page)
    assert.equal((await layout(page)).height, 320)
    const full = await begin(page)
    await page.mouse.move(full.x, 0); await frame(page)
    const beforeRelease = await layout(page)
    await page.mouse.up(); await frame(page)
    assert.equal((await layout(page)).maximized, true)
    assert.equal((await layout(page)).top, beforeRelease.top, 'release at the ceiling does not jump')
    await page.getByRole('button', { name: 'Thu nhỏ danh sách lệnh', exact: true }).click()
    assert.equal((await layout(page)).height, 320)

    // Every termination path must release the preview and restore the old size.
    for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
      const from = await begin(page)
      await page.mouse.move(from.x, from.y - 100); await frame(page)
      if (cancel === 'Escape') await page.keyboard.press('Escape')
      else if (cancel === 'blur') await page.evaluate(() => dispatchEvent(new Event('blur')))
      else await grip.dispatchEvent(cancel)
      await page.mouse.up(); await frame(page)
      assert.equal((await layout(page)).height, 320, cancel)
      assert.equal((await layout(page)).resizing, false)
    }
    const back = await begin(page)
    await page.mouse.move(back.x, back.y - 80); await frame(page)
    await page.mouse.move(back.x, back.y); await frame(page)
    await page.mouse.up(); await frame(page)
    assert.equal((await layout(page)).height, 320, 'return to origin updates the last drag value')
    const beforeViewport = await begin(page)
    await page.mouse.move(beforeViewport.x, beforeViewport.y - 100); await frame(page)
    await page.setViewportSize({ width, height: 887 }); await frame(page)
    await page.mouse.up()
    assert.equal((await layout(page)).resizing, false)
    assert.equal((await layout(page)).height, 320)
    await page.setViewportSize({ width, height: 987 }); await frame(page)

    await page.locator('.legacy-positions').getByRole('tab').nth(2).click()
    await page.getByRole('button', { name: 'Thu gọn danh sách lệnh', exact: true }).click()
    await page.getByRole('button', { name: 'Mở danh sách lệnh', exact: true }).click()
    assert.equal((await layout(page)).height, 320)
    assert.equal(await page.locator('.legacy-positions [role=tab][aria-selected=true]').getAttribute('id'), 'position-tab-closed')
    await page.getByRole('button', { name: 'Mở rộng danh sách lệnh', exact: true }).click()
    assert.equal((await layout(page)).maximized, true)
    await page.getByRole('button', { name: 'Thu nhỏ danh sách lệnh', exact: true }).click()
    assert.equal((await layout(page)).height, 320)
    await grip.focus(); await page.keyboard.press('ArrowUp'); await frame(page)
    assert.equal((await layout(page)).height, 350)
    await page.keyboard.press('End'); await frame(page)
    assert.equal((await layout(page)).maximized, true)
    const fromMax = await begin(page)
    const fullHeight = (await layout(page)).height
    await page.mouse.move(fromMax.x, fromMax.y + 100); await frame(page)
    assert.equal((await layout(page)).height, fullHeight - 100)
    await page.mouse.up(); await frame(page)
    await grip.focus(); await page.keyboard.press('Home'); await frame(page)
    assert.equal((await layout(page)).height, 0)
    const fromClosed = await begin(page)
    await page.mouse.move(fromClosed.x, fromClosed.y - 180); await frame(page)
    await page.mouse.move(fromClosed.x, fromClosed.y + 10); await frame(page)
    await page.mouse.up(); await frame(page)
    assert.equal((await layout(page)).height, 0)
    const nearClosed = await begin(page)
    await page.mouse.move(nearClosed.x, nearClosed.y - 20); await frame(page)
    assert.equal((await layout(page)).height, 20)
    await page.mouse.up(); await frame(page)
    assert.equal((await layout(page)).height, 0, 'tiny panel closes only on release')
    if (width < 600) {
      const session = await context.newCDPSession(page)
      const box = await grip.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 180 }] }); await frame(page)
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await frame(page)
      assert.equal((await layout(page)).height, 180)
      await grip.focus(); await page.keyboard.press('Home'); await frame(page)
      await session.detach()
    }
    report.cases.push({ width, case: 'cancel/lost capture/Escape/blur/viewport change, reversal, collapse/reopen retaining tab, maximize/restore, keyboard, touch and drag from maximized' })

    const rendering = await page.evaluate(() => {
      const host = document.querySelector('.advanced-chart-host')
      return { dpr: devicePixelRatio, scale: visualViewport.scale, ancestors: [host, ...function* () { let node = host.parentElement; while (node) { yield node; node = node.parentElement } }()].map(node => { const css = getComputedStyle(node); return { transform: css.transform, zoom: css.zoom, filter: css.filter } }), canvases: [...host.querySelector('iframe').contentDocument.querySelectorAll('canvas')].filter(node => node.clientWidth > 100 && node.clientHeight > 0).map(node => ({ width: node.width, height: node.height, cssWidth: node.clientWidth, cssHeight: node.clientHeight })) }
    })
    assert.ok(rendering.ancestors.every(node => node.transform === 'none' && node.zoom === '1' && node.filter === 'none'))
    for (const canvas of rendering.canvases) {
      assert.ok(Math.abs(canvas.width - canvas.cssWidth * dpr) <= 2)
      assert.ok(Math.abs(canvas.height - canvas.cssHeight * dpr) <= 2)
    }
    report.rendering.push(rendering)

    if (await page.getByTestId('prop-rules-button').count()) {
      await page.getByTestId('prop-rules-button').click()
      await page.getByTestId('prop-rules-dialog').waitFor()
      const flat = await page.locator('.prop-rules-objective-stat,.prop-rules-detail-panel').evaluateAll(nodes => nodes.every(node => { const css = getComputedStyle(node); return css.borderRadius === '0px' && css.borderBottomWidth === '0px' }))
      assert.equal(flat, true, 'flat sections without rounded card wrappers')
      assert.equal(await page.locator('.prop-rules-restrictions dl > div').count(), 6)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: path.join(output, `rules-${width}.png`) })
      if (width === 1710) {
        await page.evaluate(() => localStorage.setItem('tw-language', 'en'))
        await page.reload()
        await page.locator('[data-chart-status=ready]').waitFor()
        await page.getByTestId('prop-rules-button').click()
        await page.getByRole('heading', { name: 'Stats & Rules', exact: true }).waitFor()
        assert.equal(await page.getByText('Trading restrictions', { exact: true }).isVisible(), true)
        await page.screenshot({ path: path.join(output, 'rules-en.png') })
        report.cases.push({ width, case: 'English locale uses translated Stats & Rules labels' })
      }
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
