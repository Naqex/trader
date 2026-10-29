// Local GET-only journeys; fixture data and owner runtime are reported separately.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { brokerSnapshot, completedDealFills } from './liveJournal.fixture.mjs'
const [origin,out,mode='fixture']=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={mode,checks:[],errors:[],writes:[]}
let page
const borderless=async menu=>{
 const surface=await menu.evaluate(el=>{const s=getComputedStyle(el);return {borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],background:s.backgroundColor,shadow:s.boxShadow,light:el.closest('[data-theme]')?.dataset.theme==='light'}})
 assert.deepEqual(surface.borders,['0px','0px','0px','0px'])
 assert.equal(surface.background,surface.light?'rgb(250, 250, 250)':'rgb(29, 29, 29)')
 assert.equal(surface.shadow,'rgba(0, 0, 0, 0.2) 0px 8px 24px 0px')
}
try {
 for(const [width,theme] of mode==='runtime'?[[1920,'dark']]:[[1920,'dark'],[1920,'light'],[390,'light']]) {
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  const broker=brokerSnapshot();broker.deals=completedDealFills(broker.deals.slice(0,3))
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.origin!==origin)return route.abort()
   if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.writes.push(url.pathname);return route.abort()}
   if(mode==='fixture'&&url.pathname.startsWith('/api/')) {
    if(url.pathname==='/api/v2/live/status')return route.fulfill({json:broker})
    if(url.pathname==='/api/v2/live/connections')return route.fulfill({json:{items:broker.connections}})
    if(url.pathname==='/api/v2/live/records')return route.fulfill({json:{version:'live-records-v1',items:[]}})
    return route.fulfill({json:{items:[],available:false}})
   }
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message))
  const visit=query=>page.goto(`${origin}/?workspace=${mode==='fixture'?'fixture':'tenant-a'}&lang=vi&${query}`)
  await visit('view=live&area=live&section=trades')
  const grid=page.getByTestId('live-trade-grid');await grid.locator('tbody tr').first().waitFor()
  const center=grid.locator('th.is-center').filter({has:page.locator('.wm-table-heading-label')}).first()
  const label=center.locator('.wm-table-heading-label'),sort=center.locator('.wm-table-sort')
  let initialCenter
  const measure=async state=>{
   await center.scrollIntoViewIfNeeded()
   const geometry=await center.evaluate(el=>{
    const rect=node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,center:b.x+b.width/2}}
    return {cell:rect(el),label:rect(el.querySelector('.wm-table-heading-label')),indicator:rect(el.querySelector('.wm-table-sort-indicator')),clear:el.querySelector('.wm-table-sort-clear')?rect(el.querySelector('.wm-table-sort-clear')):null}
   })
   assert(Math.abs(geometry.cell.center-geometry.label.center)<.6,`${state}: ${JSON.stringify(geometry)}`)
   if(initialCenter===undefined)initialCenter=geometry.cell.center
   assert(Math.abs(initialCenter-geometry.cell.center)<.6,`${state}: sort changed column geometry`)
   assert(geometry.indicator.left>=geometry.label.right,`${state}: icon overlaps text`)
   if(geometry.clear)assert(geometry.clear.left>=geometry.indicator.right,`${state}: clear overlaps indicator`)
   report.checks.push({width,theme,state,geometry})
  }
  await measure('inactive');await sort.hover();await measure('hover')
  await sort.click();await measure('ascending');assert.equal(await center.getAttribute('aria-sort'),'ascending')
  await sort.click();await measure('descending');assert.equal(await center.getAttribute('aria-sort'),'descending')
  const other=grid.locator('th.is-center').filter({has:page.locator('.wm-table-heading-label')}).nth(1)
  await other.locator('.wm-table-sort').click();await measure('multiple')
  await center.locator('.wm-table-sort-clear').click();await measure('cleared')
  assert.equal(await center.getAttribute('data-sort-active'),null)
  await center.screenshot({path:`${out}/center-${width}-${theme}.png`})
  await page.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).click()
  await borderless(page.locator('.fx-select-menu'))
  const checkColor=await page.locator('.fx-select-menu .fx-select-check').evaluate(el=>getComputedStyle(el).color)
  const chevron=await page.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).locator('.fx-select-chevron').evaluate(el=>({color:getComputedStyle(el).color,stroke:el.getAttribute('stroke-width'),rotate:getComputedStyle(el).rotate}))
  await page.keyboard.press('Escape')
  assert(await page.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).evaluate(el=>el===document.activeElement))
  await page.locator('.live-account-picker .fxa-session-trigger').click()
  const account=page.locator('.fxa-session-menu');await borderless(account)
  assert.equal(await account.locator('.fx-select-check').evaluate(el=>getComputedStyle(el).color),checkColor,'Single-account selection uses shared check color')
  assert.deepEqual(await page.locator('.live-account-picker .fx-select-chevron').evaluate(el=>({color:getComputedStyle(el).color,stroke:el.getAttribute('stroke-width'),rotate:getComputedStyle(el).rotate})),chevron,'Account chevron shares color, stroke and expanded rotation')
  await account.locator('input').fill('not-an-account');assert.equal(await account.locator('.fxa-session-options > button').count(),0)
  await account.locator('input').fill('');await page.keyboard.press('Escape')
  await visit('view=trade&area=testing&section=trades&demo=1&sessions=all&select=1')
  await page.locator('.fxa-session-trigger').first().click();await borderless(page.locator('.fxa-session-menu'))
  await page.keyboard.press('Escape')
  await visit('ui_reference=1#controls')
  const anchoredTrigger=page.getByRole('button',{name:'Mở menu bám nút',exact:true})
  await anchoredTrigger.click();await borderless(page.locator('.legacy-popover'))
  await page.locator('.legacy-popover').screenshot({path:`${out}/anchored-${width}-${theme}.png`})
  await page.keyboard.press('Escape');assert(await anchoredTrigger.evaluate(el=>el===document.activeElement))
  if(mode==='runtime') {
   await visit('view=replay&area=testing&section=sessions&select=1')
   const trigger=page.getByRole('button',{name:'Chọn phiên replay',exact:true})
   await trigger.click();const picker=page.getByRole('dialog',{name:'Chọn phiên replay',exact:true});await borderless(picker)
   await picker.locator('input').fill('unmatched-ui-boundary');await picker.getByRole('status').waitFor()
   await picker.locator('input').fill('');await page.keyboard.press('ArrowDown')
   assert.equal(await picker.getByRole('option').evaluateAll(nodes=>nodes.some(el=>el===document.activeElement)),true)
   await picker.screenshot({path:`${out}/replay-picker.png`})
   await page.keyboard.press('Escape');assert(await trigger.evaluate(el=>el===document.activeElement))
   await visit('view=live&area=live&section=calendar&live_accounts=all')
   const weeks=page.locator('.live-week-total');await weeks.first().waitFor()
   const semantic=weeks.filter({has:page.locator('strong')}).and(page.locator('.is-gain,.is-loss')).first()
   await semantic.waitFor();await semantic.hover()
   const seam=await semantic.evaluate(el=>{const s=getComputedStyle(el),pane=el.closest('.live-calendar-section'),side=pane.nextElementSibling;return {edge:s.borderRightWidth,color:s.borderRightColor,value:getComputedStyle(el.querySelector('strong')).color,right:el.getBoundingClientRect().right,paneRight:pane.getBoundingClientRect().right,sidebar:getComputedStyle(side).borderLeftWidth}})
   assert.equal(seam.edge,'1px');assert.equal(seam.color,seam.value);assert.equal(seam.sidebar,'0px');assert(Math.abs(seam.right-seam.paneRight)<1)
   await page.screenshot({path:`${out}/calendar.png`})
   const box=await semantic.boundingBox();await page.screenshot({path:`${out}/calendar-seam.png`,clip:{x:box.x+box.width-5,y:box.y,width:10,height:box.height}})
   report.checks.push({actualCalendar:seam})
   report.index_sha256=createHash('sha256').update(await (await context.request.get(origin)).text()).digest('hex')
  }
  await page.screenshot({path:`${out}/menus-${width}-${theme}.png`})
  report.checks.push({width,theme,borderless:true,searchEscapeFocus:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
} catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{})}
finally{await browser.close();await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
