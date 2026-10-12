import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = '../evidence/testing-empty-trades-20261012'
await mkdir(output, { recursive:true })
const browser = await chromium.launch({ headless:true, ignoreDefaultArgs:['--hide-scrollbars'] })
const context = await browser.newContext({ viewport:{ width:1710, height:987 } })
await context.addInitScript(() => { localStorage.setItem('tw-language','vi'); localStorage.setItem('tw-theme','dark') })
const page = await context.newPage()
const report = { scope:'Preview interactions and actual component GET smoke with labeled intercepted responses; no writes', cases:[], errors:[], writes:[] }
page.on('pageerror', error => report.errors.push(error.message))
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin !== origin) return route.abort()
  if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
  return route.continue()
})
const href = (view, state = 'demo', extra = '') => `${origin}/?workspace=tenant-a&area=testing&view=${view}&select=1&demo=1&ui_state=${state}${extra}`
const empty = page.getByTestId('testing-trades-empty')
try {
  for (const mode of ['&demo=1', '']) {
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=overview${mode}`)
    const card = page.locator('.fx-dashboard-session-card').first()
    await card.waitFor()
    const head = card.locator('.fx-dashboard-session-card-head')
    const title = head.locator('h3')
    for (let click = 0; click < 6; click++) {
      await title.click()
      assert.equal(await card.evaluate(e => e.classList.contains('is-expanded')), click % 2 === 0)
    }
    await title.dblclick()
    assert.equal(await card.evaluate(e => e.classList.contains('is-expanded')), false)
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '')
    assert.equal(await title.evaluate(e => getComputedStyle(e).userSelect), 'none')
    const toggle = head.locator('[aria-expanded]')
    await toggle.focus()
    await toggle.press('Enter')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    await page.mouse.move(250,120)
    await page.waitForTimeout(250)
    const rest = await head.evaluate(e => getComputedStyle(e).backgroundColor)
    await title.hover()
    await page.waitForTimeout(250)
    assert.notEqual(await head.evaluate(e => getComputedStyle(e).backgroundColor), rest)
    assert.notEqual(await head.evaluate(e => getComputedStyle(e).backgroundColor), await card.evaluate(e => getComputedStyle(e).backgroundColor))
    await toggle.press('Space')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    report.cases.push({ actualGET:!mode, preview:Boolean(mode), case:'Repeated header/title clicks and keyboard toggle work; expanded hover stays on header without text selection' })
  }
  await page.goto(href('market-data'))
  const size = page.getByRole('button',{name:'Số dòng mỗi trang'})
  await size.waitFor()
  const padding = await size.evaluate(e => {
    const button = e.getBoundingClientRect(), value = e.querySelector('.fx-select-value').getBoundingClientRect(), arrow = e.querySelector('svg').getBoundingClientRect()
    return { left:value.left-button.left, right:button.right-arrow.right }
  })
  assert.ok(Math.abs(padding.left-padding.right)<1, JSON.stringify(padding))
  await size.click()
  await page.getByRole('option',{name:'50',exact:true}).click()
  assert.equal(await size.textContent(),'50')
  report.cases.push({ case:'Page-size label and chevron are centered as a group; choosing size still works', padding })

  await page.goto(href('replay'))
  await page.getByRole('columnheader',{name:'Phiên',exact:true}).waitFor()
  assert.equal(await page.getByRole('columnheader',{name:'Phiên / giao dịch',exact:true}).count(),0)
  report.cases.push({case:'Recent trades uses Session label without slash'})

  for (const view of ['trade','analytics']) {
    await page.goto(href(view,'no-trades'))
    await empty.waitFor()
    assert.equal(await empty.locator('h2').textContent(),'Chưa có giao dịch đóng')
    assert.equal(await page.locator('.fxa-trades table, .fxa-report-tabs, .fxa-report').count(),0)
    assert.equal(await page.locator('.wm-pagination').count(),0)
    const geometry = await empty.evaluate(e => ({bottom:e.getBoundingClientRect().bottom,contentBottom:e.closest('.fx-content').getBoundingClientRect().bottom}))
    assert.ok(Math.abs(geometry.bottom-geometry.contentBottom)<1,JSON.stringify(geometry))
    await page.screenshot({path:`${output}/dark-1710-${view}-no-trades.png`,animations:'disabled'})
    report.cases.push({view,case:'All sample sessions have zero closed trades; shared empty fills remaining viewport, filters remain, no report/table/pager'})
  }

  await page.goto(href('analytics','new-session'))
  await empty.waitFor()
  await page.locator('.fxa-session-trigger').click()
  await page.locator('.fxa-session-options button').filter({hasText:'New York Reversal'}).click()
  await page.getByRole('button',{name:'Áp dụng',exact:true}).click()
  await page.locator('.fxa-report').first().waitFor()
  assert.equal(await empty.count(),0)
  await page.screenshot({path:`${output}/analytics-old-session.png`,animations:'disabled'})
  report.cases.push({case:'New empty session -> old Analytics session retains existing trades and renders report'})

  await page.goto(href('trade','new-session'))
  await empty.waitFor()
  await page.locator('.fxa-session-trigger').click()
  await page.locator('.fxa-session-menu').getByRole('checkbox',{name:'Tất cả phiên',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.locator('.fxa-trades tbody tr').first().waitFor()
  assert.equal(await empty.count(),0)
  const names = await page.locator('.fxa-trades tbody').textContent()
  assert.ok(!names.includes('London Breakout'))
  assert.ok(names.includes('Gold Swing') && names.includes('New York Reversal'))
  report.cases.push({case:'New empty session -> All Trades retains 40 closed trades from old sessions, excluding empty London'})

  await page.goto(href('trade','filtered'))
  await empty.waitFor()
  assert.equal(await empty.locator('h2').textContent(),'Không có giao dịch khớp bộ lọc.')
  report.cases.push({case:'Filtered zero differs from scope without closed trades'})

  // Keep the actual response contract; replace only this read's ledger/counts.
  await page.route('**/api/v2/replay/trades*', async route => {
    const response = await route.fetch(), payload = await response.json()
    await route.fulfill({json:{...payload,status:'partial',ledger:[],pagination:{...payload.pagination,filtered_count:0,returned_count:0,page:1,page_count:0}}})
  })
  await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=trade&select=1&sessions=all`)
  await empty.waitFor()
  assert.equal(await empty.locator('h2').textContent(),'Chưa đủ dữ liệu giao dịch.')
  report.cases.push({interceptedFixture:true,case:'Partial aggregate zero is uncertain, never presented as no trades or no filter matches'})
  await page.unroute('**/api/v2/replay/trades*')

  for (const partial of [false,true]) {
    const experimentRequests = []
    const track = request => { if (new URL(request.url()).pathname.endsWith('/analytics/experiments')) experimentRequests.push(request.url()) }
    page.on('request',track)
    await page.route('**/api/v2/replay/sessions/*/analytics*', async route => {
      const response = await route.fetch(), payload = await response.json()
      await route.fulfill({json:{...payload,analytics_available:true,blocked_by_data:[],partial,freshness:partial?'partial':'ready',ledger:[],scope:{...payload.scope,total_trade_count:0,selected_trade_count:0},metrics:{...payload.metrics,closed_trade_count:0}}})
    })
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=analytics&select=1&analytics_tab=simulation`)
    await empty.waitFor()
    assert.equal(await empty.locator('h2').textContent(),partial?'Chưa đủ dữ liệu giao dịch.':'Chưa có giao dịch đóng')
    assert.equal(await page.locator('.fxa-report-tabs, .fxa-report').count(),0)
    assert.deepEqual(experimentRequests,[],'Empty sources never start price-path experiments, even with a carried simulation tab')
    page.off('request',track)
    report.cases.push({interceptedFixture:true,partial,case:'Actual Analytics shared empty hides reports and preserves explicit partial status'})
    await page.unroute('**/api/v2/replay/sessions/*/analytics*')
  }
  assert.deepEqual(report.errors,[])
  assert.deepEqual(report.writes,[])
  report.result='PASS'
} catch(error) {
  report.result='FAIL'; report.failure=error.stack
  await page.screenshot({path:`${output}/failure.png`,animations:'disabled'})
  throw error
} finally {
  await writeFile(`${output}/focused-browser.json`,JSON.stringify(report,null,2))
  await browser.close()
  console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors,writes:report.writes}))
}
