import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.env.TW_UI_EVIDENCE_DIR || '../evidence/read-status-layout-20261012'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const report = { scope: 'Preview shared layouts, GET-only; geometry and status interaction', cases: [], errors: [], apiRequests: [] }
const selectors = { overview: '.fx-dashboard-session-list', replay: '.fxr-session-cards', trade: '.fxa-trades', analytics: '.fxa-report', 'market-data': '.data-library-grid' }
try {
  for (const width of [1563, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(() => { localStorage.setItem('tw-theme', 'dark'); localStorage.setItem('tw-language', 'vi') })
    await context.route('**/*', route => {
      if (route.request().url().includes('/api/')) report.apiRequests.push(route.request().url())
      return new URL(route.request().url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    const go = (view, state) => page.goto(`${origin}/?workspace=tenant-a&view=${view}&area=testing&demo=1&ui_state=${state}&select=1&sessions=all`)
    for (const view of Object.keys(selectors)) {
      let ready
      for (const state of ['demo', 'refreshing', 'stale']) {
        await go(view, state)
        const content = page.locator(selectors[view]).first()
        await content.waitFor()
        await page.waitForTimeout(350)
        const box = await content.boundingBox()
        if (!ready) ready = box
        else for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[dimension] - ready[dimension]) <= 1, `${view}/${width}/${state}: ${dimension} shifted ${ready[dimension]} -> ${box[dimension]}`)
        if (state !== 'demo') {
          const contentOffset = await content.evaluate(node => node.offsetTop)
          const indicator = page.locator('.wm-resource-status').first()
          assert.equal(await indicator.getAttribute('data-resource-state'), state)
          await indicator.locator('summary').click()
          await indicator.locator('.wm-resource-status-detail').waitFor()
          await page.waitForTimeout(100)
          const popup = await indicator.locator('.wm-resource-status-detail').boundingBox()
          assert.ok(popup.x >= 0 && popup.x + popup.width <= width + 1, `${view}/${width}/${state}: status popup stays within viewport ${JSON.stringify(popup)}`)
          assert.equal(await content.evaluate(node => node.offsetTop), contentOffset, `${view}/${width}/${state}: opening status detail does not change layout`)
          if (state === 'stale') await indicator.getByTestId('read-recovery').waitFor()
          await indicator.locator('summary').press('Escape')
          assert.equal(await indicator.getAttribute('open'), null)
        }
        report.cases.push({ view, state, width, stable: true })
      }
      if (['trade', 'analytics', 'market-data'].includes(view)) {
        await go(view, 'error')
        const filters = page.locator(view === 'market-data' ? '.data-library-toolbar' : '.fxa-filters').first()
        const notice = page.locator('.wm-read-state[role="alert"]').first()
        await notice.waitFor()
        assert.ok((await notice.boundingBox()).y >= (await filters.boundingBox()).y + (await filters.boundingBox()).height - 1, 'load error follows filter divider')
        await page.screenshot({ path: `${output}/${view}-error-${width}.png` })
        report.cases.push({ view, state: 'error', width, belowFilters: true })
      }
    }
    await go('overview', 'demo')
    const card = page.locator('.fx-dashboard-session-card').first()
    await card.locator('.fx-dashboard-card-expand').click()
    await page.waitForTimeout(350)
    const charts = card.locator('.fx-dashboard-card-charts')
    const cardBox = await card.boundingBox(), chartsBox = await charts.boundingBox()
    assert.ok(Math.abs(chartsBox.width - (cardBox.width - 2)) <= 1, 'expanded divider spans card inner width')
    const separator = await charts.locator('.fxs-chart-panel').nth(1).evaluate(node => { const style = getComputedStyle(node, '::before'); return { width: style.width, height: style.height } })
    assert.equal(width > 1000 ? separator.width : separator.height, '1px')
    await card.hover()
    await page.waitForTimeout(150)
    if (width > 1000) await card.screenshot({ path: `${output}/expanded-${width}.png` })
    else await page.screenshot({ path: `${output}/expanded-${width}.png` })
    report.cases.push({ view: 'overview', state: 'expanded', width, separatorAxis: width > 1000 ? 'vertical' : 'horizontal' })
    await go('market-data', 'demo')
    const table = await page.locator('.data-library .rd-table-wrap').boundingBox()
    const viewport = await page.locator('.fx-content').boundingBox()
    assert.ok(Math.abs(table.x - viewport.x) <= 1 && Math.abs(table.x + table.width - viewport.x - viewport.width) <= 1, 'Market grid spans content viewport')
    await page.screenshot({ path: `${output}/market-data-ready-${width}.png` })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.apiRequests, [])
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: 'PASS', cases: report.cases.length, errors: report.errors }))
} finally { await browser.close() }
