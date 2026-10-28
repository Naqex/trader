// GET-only local UI checks. Long-list rows are labeled fixtures, never broker data.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
await mkdir(out, { recursive:true })
const browser = await chromium.launch({ executablePath:process.env.TW_UI_QA_CHROMIUM })
const report = { status:'running', cases:[], errors:[], paging:[], scope:'Isolated GET-only contexts, no user-tab navigation' }
let page
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const waitWindow = async (viewport, text) => {
  await viewport.getByText(text, { exact:true }).waitFor()
  await settle()
}
try {
  for (const [width, theme] of [[1920,'dark'], [1440,'light'], [390,'dark']]) {
    const context = await browser.newContext({ viewport:{ width, height:940 }, hasTouch:width === 390, reducedMotion:'reduce' })
    await context.addInitScript(value => localStorage.setItem('tw-theme', value), theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      return url.origin !== origin || !['GET','HEAD'].includes(request.method()) || /^\/api\/v2\/(mt5|live|events)(\/|$)/.test(url.pathname) ? route.abort() : route.continue()
    })
    page = await context.newPage(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('response', async response => {
      if (new URL(response.url()).pathname !== '/api/v2/replay/trades') return
      const payload = await response.json()
      report.paging.push({ width, pagination:payload.pagination, count:payload.ledger.length })
    })
    await page.goto(origin + '/?workspace=tenant-a&lang=vi&area=testing&ui_reference=1#virtual-table')
    const reference = page.locator('#virtual-table'), viewport = reference.locator('.wm-table-scroll')
    await reference.scrollIntoViewIfNeeded(); await waitWindow(viewport, 'Dòng 00001')
    assert.equal(await viewport.locator('table').getAttribute('aria-rowcount'), '10001')
    const geometry = () => viewport.evaluate(element => ({
      top:element.scrollTop, left:element.scrollLeft, clientHeight:element.clientHeight, total:element.scrollHeight,
      mounted:element.querySelectorAll('.wm-virtual-row').length,
      heights:[...element.querySelectorAll('.wm-virtual-row')].map(row => row.getBoundingClientRect().height),
      headerTop:element.querySelector('thead th').getBoundingClientRect().top - element.getBoundingClientRect().top,
      widths:[...element.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
    }))
    const initial = await geometry(); assert.ok(initial.mounted < 25); assert.ok(initial.heights.every(height => height === 60))
    assert.equal(initial.total, 600044)
    await viewport.evaluate(element => {
      window.tableMutations = 0
      window.tableObserver = new MutationObserver(records => { window.tableMutations += records.length })
      window.tableObserver.observe(element.querySelector('tbody'), { childList:true, subtree:true, attributes:true })
      element.scrollLeft = 300
    })
    await settle(); assert.equal(await page.evaluate(() => window.tableMutations), 0, 'Horizontal-only scroll must not rerender virtual rows')
    await page.evaluate(() => window.tableObserver.disconnect())
    const firstButton = viewport.getByRole('button', { name:'Chọn Dòng 00001', exact:true })
    await firstButton.focus(); await settle()
    await viewport.evaluate(element => { element.scrollTop = 300000 })
    await waitWindow(viewport, 'Dòng 05001')
    assert.equal(await firstButton.evaluate(element => element === document.activeElement), true)
    assert.equal(await viewport.locator('[data-virtual-key="sample-5001"]').getAttribute('aria-rowindex'), '5002')
    const middle = await geometry(); assert.ok(middle.mounted < 25); assert.deepEqual(middle.widths, initial.widths)
    await viewport.evaluate(element => { element.style.height = '480px' }); await settle()
    const resized = await geometry(); assert.ok(resized.mounted < 30); assert.ok(resized.heights.every(height => height === 60))
    await viewport.evaluate(element => { element.style.height = '360px' }); await settle()
    const visibleTop = await viewport.locator('[data-virtual-key="sample-5001"]').evaluate(element => element.getBoundingClientRect().top)
    const expectedTop = await viewport.evaluate(element => element.getBoundingClientRect().top + 44)
    assert.ok(Math.abs(visibleTop - expectedTop) < 1)
    await firstButton.evaluate(element => element.blur()); await settle()
    assert.equal(await firstButton.count(), 0)
    await reference.getByRole('button', { name:'Cuối bảng', exact:true }).click(); await waitWindow(viewport, 'Dòng 10000')
    const end = await geometry(); assert.ok(end.mounted < 25); assert.ok(Math.abs(end.headerTop) < 1)
    assert.deepEqual(end.widths, initial.widths)
    await reference.getByRole('button', { name:'Đầu bảng', exact:true }).click(); await waitWindow(viewport, 'Dòng 00001')
    if (width === 390) await firstButton.tap(); else await firstButton.click()
    assert.equal(await firstButton.getAttribute('aria-pressed'), 'true')
    await reference.getByRole('button', { name:'Cuối bảng', exact:true }).click(); await waitWindow(viewport, 'Dòng 10000')
    await reference.getByRole('button', { name:'Đầu bảng', exact:true }).click(); await waitWindow(viewport, 'Dòng 00001')
    assert.equal(await firstButton.getAttribute('aria-pressed'), 'true')
    await viewport.evaluate(element => { element.scrollLeft = 0 })
    assert.equal(await viewport.locator('th[aria-sort]').count(), 0)
    await reference.locator('.wm-table-sort').first().click(); await waitWindow(viewport, 'Dòng 00001')
    assert.equal(await viewport.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending')
    await reference.locator('.wm-table-sort').first().click(); await waitWindow(viewport, 'Dòng 10000')
    assert.equal(await viewport.locator('.wm-virtual-row').first().getAttribute('aria-rowindex'), '2')
    const search = reference.getByRole('searchbox', { name:'Tìm dòng trong bảng dài', exact:true })
    await search.fill('00001'); await waitWindow(viewport, 'Dòng 00001')
    assert.equal(await viewport.locator('.wm-virtual-row').count(), 1); assert.equal(await viewport.locator('table').getAttribute('aria-rowcount'), '2')
    assert.equal(await viewport.evaluate(element => element.scrollTop), 0)
    await search.fill('no-match'); await viewport.getByText('Không có kết quả phù hợp.', { exact:true }).waitFor()
    await search.fill(''); await waitWindow(viewport, 'Dòng 10000')
    await viewport.focus(); await page.keyboard.press('PageDown'); await settle()
    assert.ok(await viewport.evaluate(element => element.scrollTop > 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.screenshot({ path:`${out}/virtual-${width}-${theme}.png` })
    report.cases.push({ kind:'virtual', width, theme, initial, middle, end, fullScopeRows:10000 })

    await page.goto(origin + '/?workspace=tenant-a&lang=vi&view=trade&area=testing&section=trades&select=1&sessions=all')
    const ledger = page.getByTestId('fx-trade-ledger'), table = ledger.locator('.wm-table-scroll'), pager = ledger.getByTestId('analytics-ledger-pagination')
    await table.locator('tbody input[type="checkbox"]').first().waitFor()
    assert.equal(await table.getAttribute('data-contained'), 'true')
    assert.equal(await table.locator('.wm-virtual-body').count(), 0)
    assert.ok(await table.locator('tbody tr').count() <= 10)
    const checkbox = table.locator('tbody input[type="checkbox"]').first(), checkLabel = await checkbox.getAttribute('aria-label')
    await checkbox.check()
    await pager.getByRole('button', { name:'Trang sau', exact:true }).click()
    await table.getByRole('checkbox', { name:checkLabel, exact:true }).waitFor({ state:'detached' })
    await pager.getByRole('button', { name:'Trang trước', exact:true }).click()
    await table.getByRole('checkbox', { name:checkLabel, exact:true }).waitFor()
    assert.equal(await table.getByRole('checkbox', { name:checkLabel, exact:true }).isChecked(), true)
    await pager.getByRole('button', { name:'Số dòng mỗi trang', exact:true }).click()
    await page.getByRole('option', { name:'100', exact:true }).click()
    await table.locator('tbody input[type="checkbox"]').first().waitFor(); await settle()
    const before = await table.evaluate(element => ({ header:element.querySelector('th').getBoundingClientRect().top, outer:document.querySelector('.fx-content').scrollTop }))
    await table.evaluate(element => { element.scrollLeft = 450; element.scrollTop = 250 })
    await settle()
    const native = await table.evaluate(element => ({ rows:element.querySelectorAll('tbody tr').length, top:element.scrollTop, left:element.scrollLeft, header:element.querySelector('th').getBoundingClientRect().top, outer:document.querySelector('.fx-content').scrollTop, contained:getComputedStyle(element).contain }))
    assert.ok(Math.abs(native.header - before.header) < 1); assert.equal(native.outer, 0)
    assert.ok(native.left > 0); assert.ok(native.top > 0); assert.ok(native.rows <= 100)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await table.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0 })
    const detail = table.locator('.fxa-detail-button').first(); await detail.click()
    await page.getByRole('dialog', { name:'Chi tiết giao dịch', exact:true }).waitFor()
    await page.keyboard.press('Escape'); assert.equal(await detail.evaluate(element => element === document.activeElement), true)
    const info = table.locator('th[data-column="net_pnl"] .fxa-info, th[data-column="net_pnl"] .wm-report-info').first()
    await info.scrollIntoViewIfNeeded(); await settle(); await info.focus()
    await page.getByRole('tooltip').waitFor(); await page.keyboard.press('Escape')
    const labelButton = table.locator('.wm-label-cell').first()
    await labelButton.scrollIntoViewIfNeeded(); await settle(); await labelButton.click()
    const labelDialog = page.getByRole('dialog', { name:'Nhãn giao dịch', exact:true }); await labelDialog.waitFor()
    assert.equal(await labelDialog.evaluate(element => element.closest('.wm-table-scroll') === null), true)
    await page.keyboard.press('Escape'); await labelDialog.waitFor({ state:'detached' })
    await page.screenshot({ path:`${out}/trades-${width}-${theme}.png` })
    report.cases.push({ kind:'real-paged-trades', width, theme, native, preservedSelection:true, overlay:true })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.ok(report.paging.every(read => read.count <= read.pagination.page_size)); report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack
  await page?.screenshot({ path:`${out}/failure.png` }).catch(() => {})
  console.error(error); process.exitCode = 1
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ status:report.status, cases:report.cases.length, failure:report.failure }))
