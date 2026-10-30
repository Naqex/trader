import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { brokerSnapshot, completedDealFills, fixtureConnection } from './liveJournal.fixture.mjs'

const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Production frontend, synthetic reads, no owner-data writes',cases:[],errors:[],writes:[]}
let page
try {
 for(const [width,theme] of [[1920,'dark'],[1440,'light'],[768,'dark'],[390,'light']]) {
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  const broker=brokerSnapshot();broker.deals=completedDealFills(broker.deals.slice(0,2))
  const catalog={schema_version:'trade-labels-v1',groups:[],assignments:[],items:[{id:'bad',name:'Bad',color:'red',revision:1}]}
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url()),json=body=>route.fulfill({json:body})
   if(url.origin!==origin)return route.abort()
   if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.writes.push(url.pathname);return route.abort()}
   if(!url.pathname.startsWith('/api/'))return route.continue()
   if(url.pathname==='/api/v2/live/status')return json(broker)
   if(url.pathname==='/api/v2/live/connections')return json({items:broker.connections})
   if(url.pathname==='/api/v2/live/records')return json({version:'live-records-v1',items:[]})
   if(url.pathname==='/api/v2/live/note-folders')return json({version:'live-note-folders-v1',items:[{id:'folder-a',name:'TEST',note_ids:[]}]})
   if(url.pathname==='/api/v2/trade-labels')return json(catalog)
   return json({items:[],available:false})
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  const base=`${origin}/?workspace=fixture&view=live&area=live&lang=vi&mt5_connection=${fixtureConnection}`
  await page.goto(base+'&section=notes')
  const active=page.locator('.live-notes-groups .is-active');await active.waitFor()
  const style=await active.evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopWidth,color:s.borderTopColor,shadow:s.boxShadow,background:s.backgroundColor}})
  assert.equal(style.border,'1px');assert.notEqual(style.color,'rgba(0, 0, 0, 0)');assert.equal(style.shadow,'none');assert.equal(style.background,'rgba(0, 0, 0, 0)')
  const brand=page.locator('.fx-wordmark-svg');assert.equal(await brand.getAttribute('viewBox'),'0 0 232 35')
  const href=await brand.locator('use').getAttribute('href')
  assert((await (await context.request.get(new URL(href,origin).href.split('#')[0])).text()).match(/<circle/g).length>80)
  await page.screenshot({path:`${out}/notes-${width}-${theme}.png`})
  await page.goto(base+'&section=trades')
  const grid=page.getByTestId('live-trade-grid'),row=grid.locator('tbody tr').first(),drawer=page.locator('dialog.fxa-trade-inspector')
  await row.waitFor();await row.locator('input[type=checkbox]').check();assert.equal(await drawer.count(),0)
  await row.locator('.wm-label-cell').click();await page.locator('.wm-label-options').waitFor();assert.equal(await drawer.count(),0);await page.keyboard.press('Escape')
  await row.locator('[data-column=symbol]').click();await drawer.waitFor();assert.equal(await drawer.count(),1)
  const textarea=drawer.locator('textarea');assert.equal(await textarea.inputValue(),'')
  const box=await drawer.boundingBox();assert(Math.abs(box.x+box.width-width)<1)
  if(width>1000)assert(Math.abs(box.width-width*.7)<2)
  const sidebar=drawer.locator('.fx-trade-detail-sidebar'),editor=drawer.locator('.fx-trade-note-draft')
  const sideBox=await sidebar.boundingBox(),editBox=await editor.boundingBox()
  if(width>640)assert(editBox.x>=sideBox.x+sideBox.width-1)
  else assert(editBox.y>=sideBox.y+sideBox.height-1)
  assert.equal(await textarea.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px')
  await drawer.getByRole('tab').nth(1).click();await drawer.getByRole('tab').nth(2).click();assert.equal(await textarea.inputValue(),'')
  await drawer.getByRole('tab').first().click();await page.screenshot({path:`${out}/live-${width}-${theme}.png`})
  const toggle=drawer.getByRole('button',{name:'Hiện thông tin giao dịch',exact:true})
  await toggle.click();assert.equal(await sidebar.isVisible(),false);assert.equal(await textarea.inputValue(),'');await toggle.click()
  const expand=drawer.getByRole('button',{name:'Mở rộng chi tiết giao dịch',exact:true})
  await expand.click();assert(Math.abs((await drawer.boundingBox()).width-width)<1);await expand.click()
  await page.keyboard.press('Escape');assert(await row.evaluate(el=>el===document.activeElement))
  await page.keyboard.press('Enter');await drawer.waitFor();assert.equal(await textarea.inputValue(),'');await page.keyboard.press('Escape')
  // Selecting text does not unexpectedly open the drawer on pointer release.
  await row.locator('[data-column=symbol]').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range)})
  await row.locator('[data-column=symbol]').click();assert.equal(await drawer.count(),0);await page.evaluate(()=>getSelection().removeAllRanges())
  await row.locator('.fxa-detail-button').click();await drawer.waitFor();assert.equal(await drawer.count(),1);await drawer.getByRole('button',{name:'Đóng chi tiết',exact:true}).click()
  await page.goto(`${origin}/?workspace=fixture&view=trade&area=testing&section=trades&sessions=all&demo=1&lang=vi`)
  const practice=page.getByTestId('analytics-ledger').locator('tbody tr').first();await practice.waitFor()
  await practice.locator('input[type=checkbox]').check();assert.equal(await drawer.count(),0)
  await practice.locator('[data-column=symbol]').click();await drawer.waitFor();assert.equal(await drawer.count(),1)
  const pSide=await drawer.locator('.fx-trade-detail-sidebar').boundingBox(),pNote=await drawer.locator('.fx-trade-note-draft').boundingBox()
  if(width>640)assert(pNote.x>=pSide.x+pSide.width-1)
  assert(await drawer.locator('.fx-trade-note-draft button').isDisabled())
  await page.screenshot({path:`${out}/practice-${width}-${theme}.png`});await page.keyboard.press('Escape')
  await practice.focus();await page.keyboard.press('Space');await drawer.waitFor();await page.keyboard.press('Escape')
  if(width===1920) {
   await page.goto(`${origin}/?workspace=fixture&view=analytics&area=testing&section=analytics&demo=1&lang=vi`)
   const points=page.locator('.fxa-viz-point[role=button]')
   await points.nth(2).waitFor();await points.nth(1).focus();await page.keyboard.press('Enter')
   const inline=page.locator('section.fxa-trade-inspector textarea');await inline.fill('Draft for trade A')
   await points.nth(2).focus();await page.keyboard.press('Enter');assert.equal(await inline.inputValue(),'')
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  report.cases.push({width,theme,logo:'J',notesActive:style,rowClickBoth:true,keyboardBoth:true,checkboxIsolated:true,labelIsolated:true,selectTextIsolated:true,twoPanes:true,collapseAndExpand:true,draftIsolated:true})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
