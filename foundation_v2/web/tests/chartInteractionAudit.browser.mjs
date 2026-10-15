import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const [propHref, backtestHref, output] = process.argv.slice(2)
if (!output) throw Error('Usage: node tests/chartInteractionAudit.browser.mjs <prop URL> <backtest URL> <output>')
for (const href of [propHref, backtestHref]) assert.equal(new URL(href).hostname, '127.0.0.1')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'Real local datasets/native chart; isolated browser storage; all API writes blocked; no playback or orders', cases: [], errors: [], measurements: [] }
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
try {
  for (const [mode, href] of [['prop', propHref], ['backtest', backtestHref]]) {
    const context = await browser.newContext({ viewport: { width: 1710, height: 987 }, reducedMotion: 'reduce' })
    await context.addInitScript(() => {
      const createObjectURL = URL.createObjectURL.bind(URL)
      URL.createObjectURL = blob => {
        if (blob.type === 'text/html') throw new Error('QA: blob iframe transport unavailable')
        return createObjectURL(blob)
      }
      // Test-only native API observation, never exposed by product code.
      document.addEventListener('load', event => {
        if (!event.target.src?.includes('charting_library.standalone.js')) return
        const Original = window.TradingView.widget
        window.TradingView.widget = function (...args) {
          const widget = new Original(...args)
          window.__qaWidget = widget
          return widget
        }
      }, true)
    })
    const writes = []
    await context.route('**/api/**', route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue()
      writes.push(new URL(route.request().url()).pathname)
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push({ mode, message: error.message }))
    await page.goto(href)
    await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
    const transport = await page.locator('.advanced-chart-host iframe').evaluate(frame => ({ url: frame.contentWindow.location.href, src: frame.getAttribute('src'), srcdoc: frame.hasAttribute('srcdoc'), canvases: frame.contentDocument.querySelectorAll('canvas').length }))
    assert.equal(transport.url, 'about:srcdoc')
    assert.equal(transport.src, null)
    assert.ok(transport.srcdoc && transport.canvases > 0)
    report.cases.push({ mode, transport })
    const iframe = await page.locator('.advanced-chart-host iframe').elementHandle()
    const native = page.frameLocator('.advanced-chart-host iframe')
    assert.equal(await page.getByTestId('prop-rules-button').count(), mode === 'prop' ? 1 : 0)
    assert.equal(await page.locator('.legacy-replay-reset,.legacy-replay-previous').count(), mode === 'prop' ? 0 : 2)
    const back = new URL(await native.locator('.legacy-native-market a').getAttribute('href'), href)
    assert.equal(back.searchParams.get('view'), 'overview')
    assert.equal(back.searchParams.get('section') || 'dashboard', 'dashboard')
    const volume = await page.evaluate(() => window.__qaWidget.activeChart().getAllStudies().filter(study => study.name === 'Volume'))
    assert.equal(volume.length, 0, 'fresh isolated storage has no default volume indicator')

    const balance = page.locator('.legacy-balance-pill')
    await balance.hover()
    await page.locator('.legacy-account-details').waitFor()
    assert.ok((await page.locator('.legacy-account-details').innerText()).includes('$'))
    await page.keyboard.press('Escape')
    await page.locator('.legacy-account-details').waitFor({ state: 'detached' })
    const chartBox = await page.locator('.chart-frame').boundingBox()
    for (const action of [page.locator('.chart-utility-actions').getByRole('button', { name: 'Lệnh mô phỏng', exact: true })]) {
      await action.click()
      await page.locator('.legacy-order-modal').waitFor()
      assert.deepEqual(await page.locator('.chart-frame').boundingBox(), chartBox, 'order modal does not expand the right dock')
      await page.keyboard.press('Escape')
      await page.locator('.legacy-order-modal').waitFor({ state: 'detached' })
      assert.equal(await page.locator('.fx-app').evaluate(node => node.inert), false)
    }
    for (let i = 0; i < 5; i++) {
      await page.locator('.legacy-scalper-button').click()
      await page.locator('.legacy-scalper-modal').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.legacy-scalper-button').evaluate(node => document.activeElement === node), true)
    }
    await page.locator('.chart-utility-actions').getByRole('button', { name: 'Đi tới mốc replay', exact: true }).click()
    if (mode === 'prop') assert.equal(await page.locator('.legacy-popover').count(), 0, 'Prop does not expose historical cutoff navigation')
    else await page.locator('.legacy-popover').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.chart-utility-actions').getByRole('button', { name: 'Tin tức', exact: true }).click()
    await page.getByRole('heading', { name: 'Bộ dữ liệu này chưa có lịch tin', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.ok(await iframe.evaluate(node => node.isConnected), 'dialog journeys preserve the chart iframe')
    report.cases.push({ mode, checks: 'correct mode, dashboard back link, volume off, account popup, rail order modal (quick orders tested on disposable fixtures), repeated scalper focus, date jump, news, same iframe' })

    const before = await page.evaluate(() => ({ range: window.__qaWidget.activeChart().getVisibleRange(), cutoff: document.querySelector('.advanced-replay-chart').getAttribute('aria-label') }))
    await page.evaluate(() => {
      const view = document.querySelector('.advanced-chart-host iframe').contentWindow
      window.__qaTiming = { samples: [], running: true, resizeEvents: 0 }
      const timing = window.__qaTiming
      let last
      const sample = at => { if (!timing.running) return; if (last !== undefined) timing.samples.push(at - last); last = at; view.requestAnimationFrame(sample) }
      view.requestAnimationFrame(sample)
      view.addEventListener('resize', () => timing.resizeEvents++)
    })
    // Drag inside the plot, away from controls and price/time scales.
    await page.mouse.move(500, 480); await page.mouse.down()
    for (let i = 1; i <= 90; i++) { await page.mouse.move(500 + i * 2, 480); await frame(page) }
    await page.mouse.up(); await frame(page)
    const timing = await page.evaluate(() => {
      const timing = window.__qaTiming; timing.running = false
      const sorted = [...timing.samples].sort((a, b) => a - b)
      return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], sampleP95Ms: sorted[Math.floor(sorted.length * .95)], over50ms: sorted.filter(value => value > 50).length, resizeEvents: timing.resizeEvents, range: window.__qaWidget.activeChart().getVisibleRange(), cutoff: document.querySelector('.advanced-replay-chart').getAttribute('aria-label') }
    })
    assert.notDeepEqual(timing.range, before.range, 'native chart actually pans')
    assert.equal(timing.cutoff, before.cutoff, 'panning cannot advance the replay cutoff')
    assert.ok(await iframe.evaluate(node => node.isConnected))
    report.measurements.push({ mode, environment: 'Headless Chromium, Vite dev, native chart, 1710x987 DPR1, 90 paced pointer steps; diagnostic sample, not production FPS', ...timing })
    await page.screenshot({ path: path.join(output, `${mode}-chart.png`) })
    await page.reload()
    await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-chart-status=ready]').getAttribute('aria-label'), before.cutoff, 'reload preserves the causal prefix')
    assert.equal(await page.locator('.advanced-chart-host iframe').evaluate(frame => frame.contentWindow.location.href), 'about:srcdoc')
    report.cases.push({ mode, checks: 'reload restores the same session/cutoff with blob HTML creation blocked' })
    assert.deepEqual(writes.filter(url => !url.endsWith('/activity')), [], 'no data mutations from UI checks')
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
