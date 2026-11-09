import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'

const [origin,out,api]=process.argv.slice(2)
for(const value of [origin,api]){assert.equal(new URL(value).hostname,'127.0.0.1');assert(!['5180','8010'].includes(new URL(value).port))}
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),client=await browser.newContext(),report={scope:'Disposable native Router/PostgreSQL and synthetic trades; no owner writes',cases:[],errors:[]}
const native=async(method,path,body,status=200)=>{
 const response=await client.request.fetch(api+path,{method,headers:{'X-Workspace-Id':'tenant-a','Idempotency-Key':crypto.randomUUID()},data:body})
 const data=await response.json();assert.equal(response.status(),status,JSON.stringify(data));return data
}
let page
try{
 const fixture=await native('GET','/fixture'),sourceBefore=await native('GET',`/api/v2/replay/sessions/${fixture.session_id}`)
 const account=await native('POST','/api/v2/live/records',{kind:'account',payload:{name:'Merge browser account',currency:'USD',opening_balance:'10000'}},201)
 const payload={account_id:account.record_id,symbol:'EURUSD',side:'BUY',quantity:'1',entry_price:'1.1',exit_price:'1.11',gross_pnl:'100',commission:'-1',swap:'0',fee:'0',opened_at_utc:'2026-10-30T03:00:00Z',closed_at_utc:'2026-10-30T04:00:00Z',tags:['Retain tag'],note:'Retain note'}
 const manuals=[]
 for(let index=0;index<12;index++)manuals.push(await native('POST','/api/v2/live/records',{kind:'trade',payload},201))
 for(const [width,theme,lang] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]){
  const vi=lang==='vi',label=(a,b)=>vi?a:b
  const context=await browser.newContext({viewport:{width,height:940},hasTouch:width===390,isMobile:width===390,reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let failWrites=false,oppositeSide=false
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.origin!==origin)return route.abort()
   if(url.pathname==='/api/v2/events')return route.fulfill({status:204,body:''})
   if(url.pathname==='/api/v2/live/status')return route.fulfill({json:oppositeSide?{...fixture.live_payload,deals:fixture.live_payload.deals.map(fill=>fill.position_id===124?{...fill,type:1-fill.type}:fill)}:fixture.live_payload})
   if(url.pathname.startsWith('/api/')){
    if(req.method()==='POST'){
     assert.equal(url.pathname,'/api/v2/trade-groups','Only grouping is writable from the browser fixture')
     if(failWrites)return route.fulfill({status:503,json:{detail:'fixture_unavailable'}})
    }
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})})
   }
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.stack))
  const goto=route=>page.goto(`${origin}/?workspace=tenant-a&lang=${lang}&${route}`)
  const bar=page.locator('.wm-trade-selection-bar'),dialog=page.locator('.wm-trade-merge-dialog')
  const merge=()=>bar.getByRole('button',{name:label('Gộp','Merge'),exact:true})
  const confirm=()=>dialog.getByRole('button',{name:label('Gộp giao dịch','Merge trades'),exact:true})
  for(const [mode,route,selector] of [
   ['live',`view=live&area=live&section=trades&live_account=broker:${fixture.live_payload.connection_id}`,'[data-testid=live-trade-grid]'],
   ['testing',`view=trade&area=testing&section=trades&sessions=${fixture.session_id}&select=1`,'[data-testid=analytics-ledger]'],
   ['manual',`view=live&area=live&section=trades&live_account=${account.record_id}`,'[data-testid=manual-trade-grid]']
  ]){
   await goto(route)
   const grid=page.locator(selector),checks=grid.locator('tbody input[type=checkbox]')
   if(width===1920&&mode==='live'){
    oppositeSide=true;await page.reload();await checks.nth(1).waitFor();await checks.first().check();await checks.nth(1).check()
    assert(await merge().isDisabled());assert.equal(await merge().getAttribute('data-tooltip'),'Các giao dịch phải cùng hướng lệnh.')
    oppositeSide=false;await page.reload()
   }
   await checks.nth(1).waitFor();await checks.first().check();await bar.waitFor()
   assert.equal(await merge().count(),0,'Merge needs at least two selected trades')
   await checks.nth(1).check()
   await page.waitForFunction(()=>{const b=[...document.querySelectorAll('.wm-trade-selection-actions button')].find(b=>['Gộp','Merge'].includes(b.textContent));return b&&!b.disabled})
   assert.equal(await bar.getByRole('button',{name:/^(Xóa|Xoá|Delete)/}).count(),0)
   assert.equal(await bar.locator('.wm-trade-selection-controls > button').count(),1)
   const geometry=await bar.evaluate(node=>{const r=node.getBoundingClientRect(),c=node.querySelector('.wm-trade-selection-close').getBoundingClientRect(),s=node.querySelector('strong').getBoundingClientRect();return {left:r.left,right:r.right,closeCenter:c.y+c.height/2,summaryCenter:s.y+s.height/2}})
   assert(Math.abs(geometry.closeCenter-geometry.summaryCenter)<1);assert(geometry.left>=0&&geometry.right<=width+1)
   await merge().click();await dialog.waitFor()
   const bounds=await dialog.boundingBox();assert(Math.abs(bounds.x+bounds.width/2-width/2)<2)
   if(width===1920&&mode==='live'){
    failWrites=true;await confirm().click();await dialog.getByRole('alert').waitFor();assert.equal((await native('GET','/api/v2/trade-groups')).items.length,0)
    failWrites=false;await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await merge().click()
    const before=await native('GET','/api/v2/trade-groups')
    const concurrent=await native('POST','/api/v2/trade-groups',{action:'merge',expected_revision:before.revision,members:manuals.slice(0,2).map(row=>({kind:'manual',source_id:account.record_id,trade_id:row.record_id}))})
    await native('POST','/api/v2/trade-groups',{action:'split',expected_revision:concurrent.revision,id:concurrent.items[0].id})
    await confirm().click();await dialog.getByRole('alert').waitFor();assert(await confirm().isDisabled())
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await merge().click()
   }
   await page.screenshot({path:`${out}/${mode}-confirm-${width}-${theme}.png`})
   await confirm().click();await dialog.waitFor({state:'detached'});await bar.waitFor({state:'detached'})
   assert.equal((await native('GET','/api/v2/trade-groups')).items.length,1)
   await page.reload();await grid.locator('.wm-trade-group-row').waitFor()
   const group=grid.locator('.wm-trade-group-row'),expand=group.getByRole('button',{name:label('Mở rộng nhóm giao dịch','Expand trade group'),exact:true})
   assert.equal(await expand.getAttribute('aria-expanded'),'false');await expand.click()
   assert.equal(await grid.locator('tbody input[type=checkbox]').count(),mode==='live'?2:10)
   const split=group.getByRole('button',{name:label('Tách nhóm','Split group'),exact:true})
   await grid.evaluate(node=>node.scrollLeft=node.scrollWidth)
   const splitBounds=await split.boundingBox(),gridBounds=await grid.boundingBox()
   assert(splitBounds.x>=gridBounds.x-1&&splitBounds.x+splitBounds.width<=gridBounds.x+gridBounds.width+1,'Split stays within the grid viewport after horizontal scroll')
   await page.screenshot({path:`${out}/${mode}-expanded-${width}-${theme}.png`})
   if(width===1920&&mode==='manual'){
    const catalog=await native('GET','/api/v2/trade-groups'),member=catalog.items[0].members[0],original=manuals.find(row=>row.record_id===member.trade_id)
    await native('POST',`/api/v2/live/records/${original.record_id}/revisions`,{kind:'trade',expected_revision:original.revision,payload:{...original.payload,side:'SELL'}})
    await page.reload();await group.getByText('Nhóm cần kiểm tra',{exact:true}).waitFor()
    await native('POST',`/api/v2/live/records/${original.record_id}/revisions`,{kind:'trade',expected_revision:original.revision+1,payload:original.payload})
    original.revision+=2
   }
   await split.click();await group.getByRole('button',{name:label('Xác nhận tách nhóm','Confirm split'),exact:true}).click();await group.waitFor({state:'detached'})
   await page.reload();await checks.first().waitFor();assert.equal(await grid.locator('.wm-trade-group-row').count(),0)
   assert.equal((await native('GET','/api/v2/trade-groups')).items.length,0)
   if(mode!=='live'){
    await checks.first().check();await bar.getByRole('button',{name:label('Chọn tất cả','Select all'),exact:true}).click()
    assert.equal(await grid.locator('tbody input:not(:checked)').count(),0)
    await page.getByRole('navigation',{name:mode==='testing'?label('Phân trang giao dịch','Trade ledger pagination'):label('Trang giao dịch','Trade pages'),exact:true}).getByRole('button',{name:label('Trang sau','Next page'),exact:true}).click()
    await checks.first().waitFor();await checks.first().check()
    await bar.getByRole('button',{name:label('Chọn tất cả','Select all'),exact:true}).click()
    await bar.getByRole('button',{name:label('Bỏ chọn tất cả','Deselect all'),exact:true}).click();await bar.waitFor({state:'detached'})
    await page.getByRole('button',{name:label('Trang trước','Previous page'),exact:true}).click();await checks.first().waitFor();assert.equal(await grid.locator('tbody input:checked').count(),0)
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   report.cases.push({mode,width,theme,lang,geometry,behavior:'merge, reload, expand, split, reload, preserved original rows; selection toggle and no delete'})
  }
  await goto('view=live&area=live&section=trading-accounts')
  const accountChecks=page.locator('.live-accounts-main tbody input[type=checkbox]')
  await accountChecks.first().check();await bar.waitFor();assert.equal(await bar.locator('.wm-trade-selection-controls > button').count(),1)
  await bar.getByRole('button',{name:label('Chọn tất cả','Select all'),exact:true}).click()
  await bar.getByRole('button',{name:label('Bỏ chọn tất cả','Deselect all'),exact:true}).click();await bar.waitFor({state:'detached'})
  assert.equal(await accountChecks.locator(':checked').count(),0)
  await context.close()
 }
 assert.deepEqual(await native('GET',`/api/v2/replay/sessions/${fixture.session_id}`),sourceBefore)
 const records=(await native('GET','/api/v2/live/records')).items
 for(const original of manuals)assert.deepEqual(records.find(row=>row.record_id===original.record_id).payload,original.payload)
 assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()}
console.log(`Trade groups: ${report.cases.length} browser journeys PASS`)
