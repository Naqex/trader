import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Real local API read-only; all HTTP writes and WebSockets blocked',cases:[],errors:[],writes:[]}
let page
try {
 for(const [width,theme] of [[1920,'dark'],[1440,'light'],[390,'dark']]) {
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce',hasTouch:width===390,isMobile:width===390})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==origin)return route.abort()
   if(url.pathname==='/api/v2/events')return route.fulfill({status:204,body:''})
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push(url.pathname);return route.abort()}
   if(origin!=='http://127.0.0.1:5180' && url.pathname.startsWith('/api/'))return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:5180'+url.pathname+url.search})})
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.stack))
  const goto=route=>page.goto(`${origin}/?workspace=tenant-a&lang=vi&${route}`)
  for(const [name,route,gridSelector] of [
   ['live','view=live&area=live&section=trades','[data-testid=live-trade-grid]'],
   ['testing','view=trade&area=testing&section=trades&select=1&sessions=all','[data-testid=analytics-ledger]'],
   ['accounts','view=live&area=live&section=trading-accounts','.live-accounts-main .wm-data-table']
  ]) {
   await goto(route)
   const grid=page.locator(gridSelector),checks=grid.locator('tbody input[type=checkbox]')
   await checks.first().waitFor();await checks.first().check()
   const bar=page.locator('.wm-trade-selection-bar'),all=bar.getByRole('button',{name:'Chọn tất cả',exact:true}),clear=bar.getByRole('button',{name:'Bỏ chọn tất cả',exact:true})
   await bar.waitFor();assert(await all.isVisible());assert(await clear.isVisible())
   if(await checks.count()>1)await checks.nth(1).check()
   const geometry=await bar.evaluate(node=>{
    const box=selector=>{const r=(selector===':scope'?node:node.querySelector(selector)).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,c:r.y+r.height/2}}
    return {bar:box(':scope'),close:box('.wm-trade-selection-close'),summary:box('strong'),all:box('.wm-trade-selection-all'),clear:box('.wm-trade-selection-clear')}
   })
   assert(Math.abs(geometry.close.c-geometry.summary.c)<1,JSON.stringify(geometry))
   assert(Math.abs(geometry.all.c-geometry.clear.c)<1)
   if(width>680)assert(Math.abs(geometry.all.c-geometry.summary.c)<1)
   assert(geometry.bar.x>=0&&geometry.bar.x+geometry.bar.w<=width+1)
   assert(geometry.all.x+geometry.all.w<geometry.clear.x)
   await clear.hover();await page.screenshot({path:`${out}/${name}-selected-${width}-${theme}.png`})
   await all.click();assert.equal(await checks.locator(':not(:checked)').count(),0)
   await clear.click();await bar.waitFor({state:'detached'});assert.equal(await grid.locator('tbody input:checked').count(),0)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   report.cases.push({name,width,theme,geometry,behavior:'select 1/2, select all, explicit deselect all, hover, no page overflow'})
  }
  await goto('view=market-data&area=testing&section=market-data')
  const table=page.locator('.rd-table'),wrap=page.locator('.rd-table-wrap')
  await table.locator('tbody tr').first().waitFor()
  const marketGeometry=await wrap.evaluate(node=>{
   const r=node.getBoundingClientRect(),t=node.querySelector('table').getBoundingClientRect(),p=node.closest('.fx-content').getBoundingClientRect()
   return {left:r.left,right:r.right,tableRight:t.right,tableWidth:t.width,clientWidth:node.clientWidth,parentLeft:p.left,parentRight:p.right,gutter:node.offsetWidth-node.clientWidth}
  })
  assert(Math.abs(marketGeometry.left-marketGeometry.parentLeft)<1)
  assert(Math.abs(marketGeometry.right-marketGeometry.parentRight)<1)
  assert.equal(marketGeometry.gutter,0)
  if(width===1920)assert(Math.abs(marketGeometry.tableRight-marketGeometry.right)<1)
  const centered=table.locator('th.is-center').filter({has:page.locator('.wm-table-sort')})
  for(let index=0;index<await centered.count();index++)await centered.nth(index).locator('.wm-table-sort').click()
  const headings=await centered.evaluateAll(nodes=>nodes.map(node=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {l:r.left,r:r.right,c:r.left+r.width/2}}
   return {cell:rect(node),text:rect(node.querySelector('.wm-table-heading-label')),indicator:rect(node.querySelector('.wm-table-sort-indicator')),clear:rect(node.querySelector('.wm-table-sort-clear'))}
  }))
  for(const h of headings){assert(Math.abs(h.cell.c-h.text.c)<1);assert(h.text.r<=h.indicator.l);assert(h.indicator.r<=h.clear.l+1);assert(h.clear.r<=h.cell.r)}
  await wrap.evaluate(node=>node.scrollLeft=node.scrollWidth)
  const actionBounds=await table.locator('tbody tr').first().locator('td').last().evaluate(node=>{
   const cell=node.getBoundingClientRect(),buttons=[...node.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})
   return {left:cell.left,right:cell.right,buttons}
  })
  for(const button of actionBounds.buttons)assert(button.left>=actionBounds.left&&button.right<=actionBounds.right)
  if(width===390)assert(actionBounds.buttons.at(-1).width>=44)
  await table.locator('th').last().hover();await page.screenshot({path:`${out}/market-sorted-right-${width}-${theme}.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await table.locator('.wm-table-sort-clear').first().click();assert.equal(await table.locator('.wm-table-sort-clear').count(),headings.length-1)
  await table.locator('.wm-table-sort-clear-all').click();assert.equal(await table.locator('.wm-table-sort-clear').count(),0)
  report.cases.push({name:'market',width,theme,marketGeometry,headings,actionBounds,behavior:'full bleed, no empty scrollbar gutter, centered multi-sort, clear one/all, horizontal scroll, touch actions fit'})
  // The captured owner history contains completed trades on this review day.
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'))
  await goto('view=live&area=live&section=notes')
  await page.locator('.live-note-create').click()
  const drawer=page.locator('.is-note-editor')
  await page.waitForFunction(()=>{const title=document.querySelector('.wm-live-note-title input');return title&&!title.disabled})
  await drawer.getByRole('button',{name:'Tìm giao dịch liên kết',exact:true}).click()
  const picker=page.locator('.wm-review-trade-picker'),rows=picker.locator('.wm-review-picker-row'),count=picker.locator('.wm-review-picker-count > span'),checkAll=picker.locator('.wm-review-picker-count input')
  await rows.first().waitFor()
  const total=await rows.count()
  assert.equal(await count.innerText(),`Đã chọn ${total}/${total} giao dịch`)
  await rows.first().locator('input').uncheck();assert.equal(await count.innerText(),`Đã chọn ${total-1}/${total} giao dịch`)
  await checkAll.click();assert.equal(await count.innerText(),`Đã chọn 0/${total} giao dịch`)
  await checkAll.click();assert.equal(await count.innerText(),`Đã chọn ${total}/${total} giao dịch`)
  const search=picker.getByRole('searchbox',{name:'Tìm giao dịch',exact:true})
  await search.fill('unmatched-fixture-search');assert.equal(await count.innerText(),'Đã chọn 0/0 giao dịch')
  assert(await picker.getByText(`${total} giao dịch đã chọn ngoài bộ lọc.`,{exact:true}).isVisible())
  await search.fill('');assert.equal(await count.innerText(),`Đã chọn ${total}/${total} giao dịch`)
  await page.screenshot({path:`${out}/picker-${width}-${theme}.png`})
  await page.keyboard.press('Escape');await picker.waitFor({state:'detached'})
  await drawer.getByRole('button',{name:'Đóng',exact:true}).click();await drawer.waitFor({state:'detached'})
  report.cases.push({name:'note count',width,theme,total,behavior:'all/partial/none, filtered 0/0, hidden selections retained, cancel without writes'})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()}
console.log(`Grid/selection QA: ${report.cases.length} cases PASS; zero writes`)
