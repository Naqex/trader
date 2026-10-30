// Synthetic API reads only; exercise the actual production UI without owner-data writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { brokerSnapshot, completedDealFills, fixtureConnection } from './liveJournal.fixture.mjs'

const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1'); assert.notEqual(new URL(origin).port, '5180')
await mkdir(out, { recursive:true })
const browser = await chromium.launch(), report = { scope:'Production UI with synthetic GET fixtures; no broker or database writes', cases:[], errors:[], writes:[] }
let page
try {
  for (const [width, theme] of [[1440,'dark'], [768,'light'], [360,'dark']]) {
    const context = await browser.newContext({ viewport:{width,height:940}, reducedMotion:'reduce' })
    await context.addInitScript(theme => {localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')}, theme)
    const broker = brokerSnapshot()
    broker.account.opening_balance = 100000
    broker.deals = completedDealFills(broker.deals.slice(0,2))
    broker.deals[1].profit = 1.51; broker.deals[1].commission = -.2
    broker.deals.push({...broker.deals[0],ticket:999,position_id:999,commission:-5})
    broker.positions = [{ticket:999,identifier:999,volume:.01}]
    const catalog = {schema_version:'trade-labels-v1',groups:[],assignments:[],items:[{id:'bad',name:'Bad',color:'red',revision:1,archived:false}]}
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request=route.request(), url=new URL(request.url()), json=body=>route.fulfill({json:body})
      if (url.origin !== origin) return route.abort()
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) {report.writes.push(url.pathname);return route.abort()}
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/live/status') return json(broker)
      if (url.pathname === '/api/v2/live/connections') return json({items:broker.connections})
      if (url.pathname === '/api/v2/live/records') return json({version:'live-records-v1',items:[]})
      if (url.pathname === '/api/v2/live/note-folders') return json({version:'live-note-folders-v1',items:[{id:'folder-a',name:'TEST',note_ids:[]}]})
      if (url.pathname === '/api/v2/trade-labels') return json(catalog)
      return json({items:[],available:false})
    })
    page = await context.newPage(); page.setDefaultTimeout(12000)
    page.on('pageerror', error => report.errors.push(error.message))
    const base=`${origin}/?workspace=fixture&view=live&area=live&lang=vi&mt5_connection=${fixtureConnection}`
    await page.goto(`${base}&section=trades`)
    const grid=page.getByTestId('live-trade-grid'), rows=grid.locator('tbody tr')
    await rows.first().waitFor()
    assert.equal(await rows.count(),3)
    const open=rows.filter({has:page.locator('.fxa-badge.is-open')})
    for (const key of ['net_pnl','gross_pnl','fees','return_pct','realized_r']) assert.equal(await open.locator(`[data-column=${key}]`).innerText(),'N/A')
    assert((await rows.locator('[data-column=return_pct]').allTextContents()).includes('0,0013%'))
    const money=rows.locator('[data-column=net_pnl] .wm-return-badge').first()
    assert.equal(await money.getAttribute('data-tooltip'),'$')
    assert((await money.getAttribute('aria-label')).endsWith('$'))
    const selectAll=grid.locator('thead input[type=checkbox]')
    await selectAll.check();assert.equal(await selectAll.getAttribute('aria-checked'),'true');assert.equal(await selectAll.evaluate(el=>el.indeterminate),false)
    await rows.first().locator('input[type=checkbox]').uncheck();assert.equal(await selectAll.getAttribute('aria-checked'),'mixed');assert.equal(await selectAll.evaluate(el=>el.indeterminate),true)
    await selectAll.check()
    const label=grid.locator('button.wm-label-cell').first()
    await label.click()
    const more=page.getByRole('button',{name:'Sửa nhãn Bad',exact:true})
    await more.click();await page.locator('.wm-label-edit-popup').waitFor()
    assert.equal(await more.getAttribute('aria-expanded'),'true')
    await more.click();await page.locator('.wm-label-edit-popup').waitFor({state:'detached'})
    assert.equal(await more.getAttribute('aria-expanded'),'false')
    await more.click();await page.locator('.wm-label-edit-popup').waitFor();await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    assert(await label.evaluate(el=>el===document.activeElement))
    // UI-only note draft survives tab changes but never advertises a successful save.
    await rows.filter({has:page.locator('.fxa-badge.is-closed')}).first().locator('.fxa-detail-button').click()
    const drawer=page.locator('dialog.fxa-trade-inspector')
    await drawer.waitFor();assert.equal(await drawer.getByRole('tab').count(),3)
    const draft=drawer.locator('textarea');await draft.fill('Synthetic unsaved draft')
    await drawer.getByRole('tab').nth(1).click();await drawer.getByRole('tab').nth(2).click()
    assert.equal(await draft.inputValue(),'Synthetic unsaved draft')
    assert(await drawer.locator('.fx-trade-note-draft button').isDisabled())
    await drawer.getByRole('tab').first().focus();await page.keyboard.press('ArrowRight')
    assert.equal(await drawer.getByRole('tab').nth(1).getAttribute('aria-selected'),'true')
    const bounds=await drawer.boundingBox();assert(bounds.x>=0 && Math.abs(bounds.x+bounds.width-width)<1)
    await page.screenshot({path:`${out}/live-drawer-${width}-${theme}.png`})
    await page.keyboard.press('Escape')
    // Column hiding clears a hidden sort and persists on reload.
    await grid.locator('th').filter({has:page.getByRole('button',{name:'Thêm sắp xếp: Tài sản',exact:true})}).locator('.wm-table-sort').click()
    await page.getByRole('button',{name:'Cột hiển thị',exact:true}).click()
    await page.getByRole('option',{name:'Tài sản',exact:true}).click();await page.keyboard.press('Escape')
    assert.equal(await grid.locator('td[data-column=symbol]').count(),0)
    assert.equal(await grid.locator('th[aria-sort]').count(),0)
    await page.reload();await rows.first().waitFor();assert.equal(await grid.locator('td[data-column=symbol]').count(),0)
    await page.getByRole('button',{name:'Đặt lại cột mặc định',exact:true}).click()
    // Notes navigation and wizard back affordance.
    await page.goto(`${base}&section=notes`)
    const groups=page.locator('.live-notes-groups')
    await groups.getByRole('button',{name:'TEST',exact:true}).waitFor()
    for (const button of await groups.locator('button:not(.fxa-icon-button)').all()) assert.equal(await button.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)',await button.evaluate(el=>el.outerHTML))
    await groups.locator('.fxa-icon-button').click()
    const folder=page.locator('.live-folder-dialog');await folder.locator('button[type=submit]').click()
    const back=folder.getByRole('button',{name:'Quay lại chọn ghi chú',exact:true})
    const backBox=await back.boundingBox(), titleBox=await folder.locator('header h2').boundingBox()
    assert(backBox.x<titleBox.x)
    assert.equal(await folder.locator('footer').getByRole('button',{name:'Quay lại',exact:true}).count(),0)
    await page.screenshot({path:`${out}/folder-${width}-${theme}.png`})
    await back.click();await folder.locator('.live-folder-notes').waitFor();await page.keyboard.press('Escape')
    // Shared filter clear keeps its destructive text color and the neutral DS hover.
    await page.locator('.live-notes-actions').getByRole('button',{name:'Bộ lọc ghi chú',exact:true}).click()
    const clear=page.locator('.fxl-clear'), color=await clear.evaluate(el=>getComputedStyle(el).color)
    await clear.hover();assert.equal(await clear.evaluate(el=>getComputedStyle(el).color),color)
    const hover=await clear.evaluate(el=>({actual:getComputedStyle(el).backgroundColor,token:getComputedStyle(el).getPropertyValue('--wm-hover').trim()}))
    assert.notEqual(hover.actual,'rgba(0, 0, 0, 0)')
    await page.screenshot({path:`${out}/clear-${width}-${theme}.png`});await page.keyboard.press('Escape')
    // Practice uses the same drawer composition, including demo UI.
    await page.goto(`${origin}/?workspace=fixture&view=trade&area=testing&section=trades&sessions=all&demo=1&lang=vi`)
    await page.locator('.fxa-detail-button').first().click();await drawer.waitFor()
    assert.equal(await drawer.getByRole('tab').count(),3)
    await page.screenshot({path:`${out}/practice-drawer-${width}-${theme}.png`});await page.keyboard.press('Escape')
    // Old Journal URLs keep their Practice context and no longer render the old workspace.
    await page.goto(`${origin}/?workspace=fixture&view=journal&session=source-session&trade=source-trade&lang=vi`)
    await drawer.waitFor();assert.equal(await drawer.getAttribute('data-session-id'),'source-session');assert.equal(await drawer.getAttribute('data-trade-id'),'source-trade')
    assert.equal(await page.locator('.ja-story-page,.ja-context-bar').count(),0)
    assert.equal(await page.locator('.live-notes').count(),0)
    await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'})
    assert.equal(new URL(page.url()).searchParams.get('view'),'trade')
    assert.equal(new URL(page.url()).searchParams.get('session'),'source-session')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    report.cases.push({width,theme,smallPercent:'0,0013%',openRealized:'N/A',labelsToggle:true,selection:true,columnPersistence:true,folderBack:true,clearHover:hover,practiceAndLiveDrawer:true,journalContext:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
} catch(error) {report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
