import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { DEMO_DATASETS } from '../src/demoFixtures.js'

const origin = 'http://127.0.0.1:5180'
const output = process.env.TW_UI_EVIDENCE_DIR || '../evidence/testing-realtime-20261012/market'
await mkdir(output, { recursive:true })
const report = { scope:'Shared Market Data empty states: preview and labeled intercepted GET fixtures of real component; no mutation', cases:[], errors:[], writes:[] }
const browser = await chromium.launch({ headless:true, ignoreDefaultArgs:['--hide-scrollbars'] })
try {
  for (const width of [1563,390]) for (const theme of ['dark','light']) {
    const context = await browser.newContext({viewport:{width,height:987}})
    await context.addInitScript(theme => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language','vi') },theme)
    const page = await context.newPage()
    page.on('pageerror',error => report.errors.push(error.message))
    await context.route('**/*',route => {
      if (new URL(route.request().url()).origin !== origin) return route.abort()
      if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
      return route.continue()
    })
    const href = extra => `${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data${extra}`
    for (const state of ['empty','filtered']) {
      await page.goto(href(`&demo=1&ui_state=${state}`))
      const empty = page.locator(`[data-empty-kind=${state === 'empty' ? 'datasets' : 'filtered-datasets'}]`)
      await empty.waitFor()
      assert.equal(await page.locator('[data-testid=data-desk-dataset-table]').count(),0)
      assert.equal(await page.getByRole('navigation',{name:'Phân trang kho dữ liệu'}).count(),0)
      assert.equal(await page.locator('.wm-testing-welcome').count(),0)
      assert.ok(await page.getByRole('searchbox',{name:'Tìm tài sản'}).isVisible())
      const grid = await page.locator('.data-library-grid').boundingBox()
      const heading = await empty.locator('h2').boundingBox()
      assert.ok(Math.abs(heading.x + heading.width/2 - (grid.x + grid.width/2)) < 2,'Empty heading centered horizontally in content')
      assert.ok(grid.y + grid.height >= 975,'Empty region fills remaining viewport')
      await page.screenshot({path:`${output}/${width}-${theme}-${state}.png`,animations:'disabled'})
      if (state === 'filtered') {
        await empty.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click()
        await page.locator('[data-testid=data-desk-dataset-table]').waitFor()
        assert.equal(await page.locator('.rd-table tbody tr').count(),3)
        const layout = await page.locator('.data-library').evaluate(el => {
          const content = el.closest('.fx-content').getBoundingClientRect(), table = el.querySelector('.rd-table-wrap').getBoundingClientRect()
          return {left:table.left-content.left,right:content.right-table.right,wide:el.querySelector('.rd-table').getBoundingClientRect().width,available:table.width}
        })
        assert.ok(layout.left >= 15 && layout.right >= 15,'Dataset table shares Testing content gutters')
        assert.ok(layout.wide > layout.available,'Wide populated table retains its own horizontal scrolling')
      }
      report.cases.push({width,theme,mode:'preview',state})
    }
    await page.route('**/api/v2/data/downloads*',route => route.fulfill({json:{items:[],available:false}}))
    await page.route('**/api/v2/data/datasets*',route => route.fulfill({json:{items:[],catalog_items:[],catalog_state:null,download_state:null}}))
    await page.goto(href(''))
    await page.locator('[data-empty-kind=datasets]').waitFor()
    assert.equal(await page.locator('.rd-table,.wm-pagination').count(),0)
    report.cases.push({width,theme,mode:'real-component GET fixture',state:'empty'})
    await page.unroute('**/api/v2/data/datasets*')
    await page.route('**/api/v2/data/datasets*',route => route.fulfill({json:{items:DEMO_DATASETS,catalog_items:[],catalog_state:null,download_state:null}}))
    await page.goto(href(''))
    await page.locator('.rd-table tbody tr').first().waitFor()
    await page.getByRole('searchbox',{name:'Tìm tài sản'}).fill('not-an-asset')
    const empty = page.locator('[data-empty-kind=filtered-datasets]')
    await empty.waitFor()
    assert.equal(await page.locator('.rd-table,.wm-pagination').count(),0)
    await empty.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click()
    await page.locator('.rd-table tbody tr').first().waitFor()
    assert.equal(await page.locator('.rd-table tbody tr').count(),3)
    report.cases.push({width,theme,mode:'real-component GET fixture',state:'filtered; clearing restores independently saved datasets'})
    await context.close()
  }
  assert.deepEqual(report.errors,[])
  assert.deepEqual(report.writes,[])
  report.passed = true
} finally {
  await writeFile(`${output}/market-browser.json`,JSON.stringify(report,null,2))
  await browser.close()
}
console.log(`Market shared states: ${report.cases.length} cases passed; no writes`)
