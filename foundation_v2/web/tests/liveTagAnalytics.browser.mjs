import assert from 'node:assert/strict'
import {chromium,request} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'

const [origin,out,api]=process.argv.slice(2)
for(const value of [origin,api]){assert.equal(new URL(value).hostname,'127.0.0.1');assert(!['5180','8010'].includes(new URL(value).port))}
await mkdir(out,{recursive:true})
const client=await request.newContext({baseURL:api,extraHTTPHeaders:{'X-Workspace-Id':'tenant-a'}})
const fixture=await (await client.get('/fixture')).json()
fixture.live_payload.deals.find(fill=>fill.position_id===123 && fill.entry===1).profit=-3
const post=async body=>{const response=await client.post('/api/v2/trade-labels',{data:body});assert.equal(response.status(),200,await response.text());return response.json()}
const catalog=await post({action:'create_group',name:'QA Rating'})
const group=catalog.groups.find(group=>group.name==='QA Rating')
await post({action:'create',name:'QA Bad',color:'red',group_id:group.id})
await post({action:'create',name:'QA Good',color:'green',group_id:group.id})
for(const [trade,tags] of [['123',['QA Bad','QA Good']],['124',['QA Good']]])await post({action:'assign',session_id:`live:${fixture.live_payload.connection_id}`,trade_id:`position:${trade}`,expected_revision:0,tags})
await client.dispose()
const browser=await chromium.launch(),report={scope:'Isolated Rust Router/PostgreSQL, synthetic broker snapshot; no owner writes',cases:[],errors:[]}
let page
try{
 for(const [width,theme,language] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]){
  const vi=language==='vi',text=(a,b)=>vi?a:b
  const context=await browser.newContext({viewport:{width,height:940},deviceScaleFactor:width===1440?1.25:1})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let catalogFail=false,empty=false
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.origin!==origin)return route.abort()
   if(url.pathname==='/api/v2/events')return route.fulfill({status:204,body:''})
   if(url.pathname==='/api/v2/live/status')return route.fulfill({json:empty?{...fixture.live_payload,deals:[]}:fixture.live_payload})
   if(url.pathname.startsWith('/api/')){
    if(catalogFail && url.pathname==='/api/v2/trade-labels')return route.fulfill({status:503,json:{detail:'fixture_catalog_error'}})
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})})
   }
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.stack))
  const root=`${origin}/?workspace=tenant-a&view=live&area=live&section=tag-analytics&lang=${language}`
  await page.goto(root)
  const table=page.locator('.live-tag-grid-table'),picker=page.locator('.live-tag-picker-card'),chart=page.locator('.live-tag-chart-card')
  await picker.getByText('QA Rating',{exact:true}).waitFor()
  const overall=table.locator('tbody tr').first()
  assert.equal((await overall.locator('td').nth(2).innerText()).trim(),'2')
  const groupRow=table.locator('tr.is-group').filter({hasText:'QA Rating'})
  assert.equal((await groupRow.locator('td').nth(2).innerText()).trim(),'2')
  assert(await groupRow.evaluate(row=>row.classList.contains('is-loss')))
  assert.equal(await table.locator('tr.is-child').count(),0)
  await groupRow.getByRole('button').click()
  assert.equal(await table.locator('tr.is-child').count(),2)
  assert(await groupRow.locator('td').first().evaluate(cell=>getComputedStyle(cell).backgroundColor!==getComputedStyle(document.documentElement).backgroundColor))
  const indices=await table.locator('tbody .wm-table-row-number').allTextContents()
  assert.deepEqual(indices,indices.map((_,index)=>String(index+1)))
  assert.equal(await page.locator('.live-journal-tags .wm-pagination').count(),0)
  const colors=await picker.locator('label').filter({hasText:'QA Bad'}).evaluateAll(nodes=>nodes.map(n=>{const probe=document.createElement('i');probe.style.color='var(--report-negative)';n.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {dot:getComputedStyle(n.querySelector('i')).backgroundColor,expected}}))
  assert.equal(colors.length,1);assert.equal(colors[0].dot,colors[0].expected)
  const geometry=await page.evaluate(()=>{
   const rect=selector=>document.querySelector(selector).getBoundingClientRect(),legend=rect('.live-tag-legend'),heading=rect('.live-tag-chart-card h2'),toolbar=document.querySelector('.live-tag-main > .fxa-filters')
   return {legendX:legend.x,headingX:heading.x,legendY:legend.y,headingBottom:heading.bottom,padding:parseFloat(getComputedStyle(toolbar).paddingLeft),overflow:document.documentElement.scrollWidth>innerWidth+1}
  })
  assert(Math.abs(geometry.legendX-geometry.headingX)<1);assert(geometry.legendY>geometry.headingBottom);assert(geometry.padding>0);assert(!geometry.overflow,JSON.stringify(geometry))
  await picker.locator('section').filter({has:page.getByText('QA Rating',{exact:true})}).getByRole('button').click()
  assert.equal(await picker.getByRole('checkbox',{checked:true}).count(),2)
  await table.locator('thead th').nth(2).getByRole('button').first().click()
  await table.locator('thead th').nth(4).getByRole('button').first().click()
  assert.equal(await table.locator('th[data-sort-active=true]').count(),2)
  await table.locator('.wm-table-sort-clear-all').click()
  assert.equal(await table.locator('th[data-sort-active=true]').count(),0)
  await picker.getByRole('searchbox').fill('QA Bad')
  assert.equal(await picker.getByRole('checkbox').count(),1)
  await picker.getByRole('searchbox').fill('not-a-tag')
  await picker.getByText(text('Không tìm thấy nhãn.','No tags found.'),{exact:true}).waitFor()
  await picker.getByRole('searchbox').fill('')
  const before=await chart.boundingBox()
  await chart.getByRole('button',{name:text('Ẩn danh sách nhãn','Hide tag list'),exact:true}).click()
  assert(await picker.isHidden())
  if(width>900)assert((await chart.boundingBox()).width>before.width+200)
  await page.screenshot({path:`${out}/tags-hidden-${width}-${theme}.png`})
  await chart.getByRole('button',{name:text('Hiện danh sách nhãn','Show tag list'),exact:true}).click()
  await overall.getByRole('button').click();assert.equal(await table.locator('tr.is-group').count(),0)
  await overall.getByRole('button').click()
  await page.screenshot({path:`${out}/tags-${width}-${theme}.png`,fullPage:true})
  if(width===1920){
   catalogFail=true;await page.reload();await page.getByRole('alert').filter({hasText:'Không tải được nhãn.'}).waitFor()
   assert.equal(await table.locator('tr.is-group').count(),0)
   await chart.getByRole('button',{name:'Ẩn danh sách nhãn',exact:true}).click()
   assert(await page.getByRole('alert').filter({hasText:'Không tải được nhãn.'}).isVisible())
   catalogFail=false;await page.getByRole('button',{name:'Thử lại',exact:true}).click();await groupRow.waitFor()
   empty=true;await page.reload();await picker.getByText('QA Rating',{exact:true}).waitFor()
   assert.equal((await table.locator('tbody tr').first().locator('td').nth(2).innerText()).trim(),'0')
   empty=false
   report.cases.push('catalog error never invents Ungrouped, error survives hidden picker, retry and empty snapshot')
  }
  await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=trades&lang=${language}`)
  await page.getByTestId('live-trade-grid').locator('tbody tr').first().locator('[data-column=symbol]').click()
  const drawer=page.locator('dialog.fxa-trade-inspector')
  await drawer.locator('.bn-editor').waitFor()
  const menu=drawer.getByRole('button',{name:text('Thêm thao tác giao dịch','More trade actions'),exact:true})
  assert(await menu.isEnabled());assert.equal(await menu.locator('svg circle').count(),3)
  assert.equal(await drawer.locator('.wm-trade-return-parts svg').count(),0)
  await drawer.getByRole('button',{name:text('Nhiều lần vào/thoát lệnh','Multiple entries/exits'),exact:true}).click()
  const modal=page.getByRole('dialog',{name:text('Nhiều lần vào/thoát lệnh','Multiple entries/exits'),exact:true})
  assert.equal(await modal.locator('.wm-trade-fill-row').count(),1)
  assert.equal(await modal.locator('input:not([readonly])').count(),0)
  await modal.getByRole('tab',{name:text('Thoát lệnh','Exit'),exact:true}).click()
  assert.equal(await modal.locator('.wm-trade-fill-row').count(),1)
  await modal.getByRole('tab').evaluateAll(nodes=>Promise.all(nodes.flatMap(node=>node.getAnimations().map(animation=>animation.finished.catch(()=>{})))))
  const tabStyles=await modal.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>({selected:node.getAttribute('aria-selected'),background:getComputedStyle(node).backgroundColor})))
  assert.equal(tabStyles[0].background,'rgba(0, 0, 0, 0)');assert.notEqual(tabStyles[0].background,tabStyles[1].background)
  assert(await modal.getByRole('button',{name:text('Lưu','Save'),exact:true}).isDisabled())
  assert.equal(await modal.locator('.wm-trade-fills-summary > div').count(),4)
  await page.screenshot({path:`${out}/fills-${width}-${theme}.png`})
  await modal.getByRole('button',{name:text('Hủy','Cancel'),exact:true}).click()
  await page.screenshot({path:`${out}/live-details-${width}-${theme}.png`})
  if(width===1920){
   const positions=await drawer.locator('.fx-live-trade-details dl').first().locator('dd').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().x))
   assert(Math.max(...positions)-Math.min(...positions)<1)
   await page.goto(`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all&lang=vi`)
   await page.getByTestId('analytics-ledger').locator('tbody tr').first().locator('[data-column=symbol]').click()
   const disabled=drawer.getByRole('button',{name:'Thêm thao tác giao dịch',exact:true})
   assert(await disabled.isDisabled());assert.equal(await disabled.locator('svg circle').count(),3)
   report.cases.push('Live value columns align; Testing ellipsis remains visible and disabled')
  }
  report.cases.push({width,theme,language,hierarchy:true,dedupCounts:true,multiSort:true,index:true,noPagination:true,hideShow:true,search:true,colors:true,toolbar:true,liveEllipsis:true,fillsReadOnly:true})
  await context.unrouteAll({behavior:'wait'});await context.close()
 }
 assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'wait'});await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
