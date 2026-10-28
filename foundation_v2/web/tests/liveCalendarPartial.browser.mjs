import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_LIVE_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_LIVE_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/calendar-partial-ui'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({executablePath:process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
const report = { scope: 'Labeled multi-account GET fixtures; broker access blocked', cases: [], errors: [], mutations: [] }
try {
  for (const width of [1920, 1440, 768, 390]) {
    let capital = null
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    const connections = [a, b].map((id, index) => ({ id, name: ['Alpha', 'Beta'][index], login_hint: `…${index + 1}`, server: 'Fixture-Demo', account: { currency: 'USD' }, status: 'connected' }))
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url())
      if (request.method() !== 'GET') { report.mutations.push(url.pathname); return route.abort() }
      if (url.pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      if (url.pathname === '/api/v2/live/status') {
        const id = url.searchParams.get('connection_id') || a
        return route.fulfill({ json: { status: 'ready', connection_id: id, connections, source: 'Fixture', account: { account_ref: id, currency: 'USD', balance: 1000, opening_balance:capital },
          history_from_utc: id === a ? '2026-10-01T00:00:00Z' : '2026-10-20T00:00:00Z', captured_at_utc: '2026-10-23T00:00:00Z',
          deals: id === a ? [{ ticket: 1, symbol: 'EURUSD', type: 0, time_msc: Date.parse('2026-10-12T12:00:00Z'), profit: 25, commission: 0, swap: 0, fee: 0 }] : [] } })
      }
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=calendar&lang=vi&theme=dark`)
    await page.locator('.live-month-total strong').filter({ hasText: '25' }).waitFor()
    const percentButton = page.locator('.live-toolbar-actions button').filter({ hasText: '%' })
    assert.equal(await percentButton.isDisabled(), false)
    await percentButton.click(); assert.equal(await percentButton.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.live-calendar-cell[data-date="2026-10-12"] strong').textContent(), 'N/A')
    assert.match(await page.locator('.live-calendar-unit-state').innerText(), /vốn ban đầu/)
    await page.locator('.live-toolbar-actions button').filter({ hasText: 'USD' }).click()
    assert.equal(await page.locator('.live-calendar-toolbar .wm-report-info').count(), 0)
    assert.equal(await page.locator('.live-calendar-grid').evaluate(el => getComputedStyle(el).gap), '0px')
    assert.equal(await page.locator('.live-month-total').evaluate(el => getComputedStyle(el).borderRadius), '0px')
    const edges = await page.locator('.live-calendar-content').evaluate(el => {const grid=el.querySelector('.live-calendar-grid').getBoundingClientRect(),scroll=el.querySelector('.live-calendar-scroll').getBoundingClientRect(),footer=el.querySelector('.live-month-total').getBoundingClientRect();return {scrollLeft:scroll.left,scrollRight:scroll.right,footerLeft:footer.left,footerRight:footer.right,gridWidth:grid.width,footerBottom:footer.bottom}})
    assert.ok(Math.abs(edges.scrollLeft-edges.footerLeft)<1 && Math.abs(edges.scrollRight-edges.footerRight)<1)
    if(width>=1241)assert.ok(Math.abs(edges.footerBottom-940)<1)
    const partial = page.locator('.live-calendar-cell').filter({ has: page.locator('.live-day-number', { hasText: /^12$/ }) })
    assert.equal(await partial.locator('strong').textContent(), '25')
    assert.equal(await partial.getByText('Một phần', { exact: true }).count(), 0)
    assert.match(await partial.getAttribute('data-tooltip'), /chưa đủ dữ liệu/i)
    const week = page.locator('.live-calendar-week').filter({ has: partial })
    assert.match(await week.locator('.live-week-total strong').textContent(), /25/)
    assert.equal(await week.locator('.live-week-total').getByText('Một phần', { exact: true }).count(), 0)
    await week.locator('.live-week-total').hover()
    assert.equal(await week.locator('.live-week-total .live-week-add').evaluate(el => getComputedStyle(el).opacity), '1')
    await week.locator('.live-week-total').click()
    const weekDrawer = page.getByRole('dialog'); await weekDrawer.getByText('Đánh giá tuần', { exact: true }).waitFor(); await page.keyboard.press('Escape'); await weekDrawer.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.live-month-total').getByText('Một phần', { exact: true }).count(), 0)
    const unknown = page.locator('.live-calendar-cell[data-date="2026-10-30"]')
    assert.equal(await unknown.locator('strong').count(), 0)
    await partial.focus();assert.equal(await partial.locator('.wm-calendar-add').evaluate(el=>getComputedStyle(el).opacity),'1')
    await partial.click()
    const drawer=page.getByRole('dialog');await drawer.getByText('EURUSD · #1', { exact: true }).waitFor()
    const box=await drawer.boundingBox();assert.ok(Math.abs(box.x+box.width-width)<1);assert.ok(box.height>=939)
    await drawer.getByRole('textbox',{name:'Tiêu đề ghi chú',exact:true}).fill('Nhật ký thử')
    await drawer.getByRole('textbox',{name:'Nội dung ghi chú',exact:true}).fill('Quan sát EURUSD')
    await drawer.getByRole('button',{name:'Mở rộng ghi chú'}).click();assert.ok(Math.abs((await drawer.boundingBox()).width-width)<1)
    await drawer.getByRole('button',{name:'Thu gọn ghi chú'}).click()
    await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});assert.equal(await partial.evaluate(el=>el===document.activeElement),true)
    const empty=page.locator('.live-calendar-cell[data-date="2026-10-21"]');await empty.click();await drawer.getByText('Chưa có giao dịch trong bộ lọc này.',{exact:true}).waitFor()
    assert.equal(await drawer.getByRole('textbox',{name:'Tiêu đề ghi chú',exact:true}).inputValue(),'')
    await drawer.getByRole('button',{name:'Đóng ghi chú'}).click()
    await unknown.click();await drawer.getByText('Chỉ cộng phần dữ liệu đã ghi nhận; chưa đủ dữ liệu cho toàn bộ phạm vi.',{exact:true}).waitFor()
    assert.equal(await drawer.getByText('Chưa có giao dịch trong bộ lọc này.',{exact:true}).count(),0)
    await page.keyboard.press('Escape');await partial.click()
    assert.equal(await drawer.evaluate(el=>el.scrollWidth>el.clientWidth),false)
    if(width===1440){
      await page.keyboard.press('Escape');await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=calendar&lang=en&theme=light`)
      if(await page.locator('.fx-app').getAttribute('data-theme')!=='light')await page.getByTestId('theme-toggle').click()
      await page.locator('.live-calendar-cell[data-date="2026-10-12"]').click()
      await drawer.getByRole('textbox',{name:'Note title',exact:true}).waitFor();await drawer.getByText('Draft',{exact:true}).waitFor();await drawer.getByText('Daily review',{exact:true}).waitFor()
      assert.equal(await drawer.getByRole('textbox',{name:'Note content',exact:true}).getAttribute('placeholder'),'Write a note…')
    }
    const titleStyle=await drawer.locator('.live-day-note-title').evaluate(el=>({font:getComputedStyle(el).fontSize,placeholder:getComputedStyle(el,'::placeholder').fontSize}))
    assert.equal(titleStyle.font,width===390?'20px':'24px');assert.equal(titleStyle.placeholder,titleStyle.font)
    await page.screenshot({ path: `${out}/partial-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `${out}/grid-${width}.png`, animations: 'disabled' })
    if(width===1920){
      capital=1000;await page.reload();await page.locator('.live-month-total strong').filter({hasText:'25'}).waitFor()
      await page.locator('.live-toolbar-actions button').filter({hasText:'%'}).click()
      assert.equal(await page.locator('.live-calendar-cell[data-date="2026-10-12"] strong').innerText(),'1,25%')
      assert.match(await page.locator('.live-calendar-cell[data-date="2026-10-12"]').getAttribute('aria-label'),/1,25%/)
      assert.equal(await page.locator('.live-calendar-unit-state').count(),0)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    report.cases.push({ width, observedSubtotal: 25, dayWeekMonthPartial: true, unknownDayBlank: true, noteDrawer: true, draftOnly:true, focusRestored:true, emptyDay:true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.mutations, [])
  report.passed = true
} catch (error) { report.failure = error.stack; throw error }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)) }
