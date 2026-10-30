import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'

const [origin,out,api]=process.argv.slice(2)
for(const value of [origin,api]){assert.equal(new URL(value).hostname,'127.0.0.1');assert(!['5180','8010'].includes(new URL(value).port))}
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'UI scaffold with isolated native Router/PostgreSQL; no owner writes',cases:[],errors:[],writes:[]}
let page
try{
 for(const [width,theme,language] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]){
  const vi=language==='vi',label=(a,b)=>vi?a:b
  const context=await browser.newContext({viewport:{width,height:940},deviceScaleFactor:width===1440?1.25:1,reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  const fixture=await (await context.request.get(api+'/fixture')).json()
  let manual=false
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.origin!==origin)return route.abort()
   if(url.pathname==='/api/v2/events')return route.fulfill({status:204,body:''})
   if(url.pathname==='/api/v2/live/status')return route.fulfill({json:fixture.live_payload})
   if(manual && url.pathname==='/api/v2/live/records')return route.fulfill({json:{version:'live-records-v1',items:[
    {record_id:'manual-fixture',kind:'account',revision:1,created_at_utc:'2026-01-01T00:00:00Z',payload:{name:'Manual fixture',currency:'USD',opening_balance:'10000',opening_at_utc:'2026-01-01T00:00:00Z'}},
    {record_id:'manual-trade-fixture',kind:'trade',revision:1,created_at_utc:'2026-01-02T12:00:00Z',payload:{account_id:'manual-fixture',symbol:'EURUSD',side:'BUY',quantity:'1',entry_price:'1.1',exit_price:'1.11',gross_pnl:'100',commission:'0',swap:'0',fee:'0',opened_at_utc:'2026-01-02T11:00:00Z',closed_at_utc:'2026-01-02T12:00:00Z',tags:[],note:''}}
   ]}})
   if(url.pathname.startsWith('/api/')){
    if(req.method()!=='GET'){report.writes.push(url.pathname);return route.abort()}
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})})
   }
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message))
  const url=section=>`${origin}/?workspace=tenant-a&view=live&area=live&section=${section}&lang=${language}`
  await page.goto(url('tag-analytics'))
  const table=page.locator('.live-tag-grid-table'),picker=page.locator('.live-tag-picker-card')
  await picker.getByText('Captured fixture',{exact:true}).waitFor()
  assert.equal(await table.locator('tr.is-overall button').getAttribute('aria-expanded'),'true')
  const group=table.locator('tr.is-group').first(),expand=group.getByRole('button')
  assert.equal(await expand.getAttribute('aria-expanded'),'false')
  const before=await group.locator('td').first().evaluate(node=>getComputedStyle(node).backgroundColor)
  await expand.click();assert.equal(await expand.getAttribute('aria-expanded'),'true')
  await page.mouse.move(0,0)
  assert.equal(await group.locator('td').first().evaluate(node=>getComputedStyle(node).backgroundColor),before)
  assert.equal(await table.locator('tr.is-child').count(),1)
  const search=await picker.getByRole('searchbox').evaluate(node=>{const s=getComputedStyle(node);return [s.borderTopWidth,s.borderLeftWidth,s.borderBottomWidth,s.borderRadius,s.backgroundColor]})
  assert.deepEqual(search,['0px','0px','1px','0px','rgba(0, 0, 0, 0)'])
  const panel=page.locator('.wm-report-side-panel')
  assert(await panel.evaluate(node=>node.classList.contains('is-collapsed')))
  assert(await panel.locator('.wm-report-panel-body').isHidden())
  await page.keyboard.press('Escape')
  await panel.getByRole('button',{name:label('Mở Smart Picks','Expand Smart Picks'),exact:true}).evaluate(node=>node.click())
  await panel.getByText(label('Khám phá tổ hợp nhãn','Explore tag combinations'),{exact:true}).waitFor()
  assert(await panel.getByRole('button',{name:label('Tạo Smart Picks','Generate Smart Picks'),exact:true}).isDisabled())
  await page.screenshot({path:`${out}/smart-open-${width}-${theme}.png`})
  await panel.getByRole('button',{name:label('Thu gọn Smart Picks','Collapse Smart Picks'),exact:true}).press('Enter')
  await page.screenshot({path:`${out}/tags-${width}-${theme}.png`})
  for(const section of ['calendar','trades']){
   await page.goto(url(section))
   const side=page.locator('.wm-report-side-panel')
   await side.locator('.wm-report-panel-body').waitFor()
   await side.getByRole('button',{name:label('Thu gọn Phân tích','Collapse Analytics'),exact:true}).click()
   assert(await side.locator('.wm-report-panel-body').isHidden())
   assert.equal(await side.locator('.live-analytics-title').evaluate(node=>getComputedStyle(node).writingMode),'vertical-rl')
   await page.screenshot({path:`${out}/${section}-collapsed-${width}-${theme}.png`})
   await side.getByRole('button',{name:label('Mở Phân tích','Expand Analytics'),exact:true}).evaluate(node=>node.click())
   assert(await side.locator('.wm-report-panel-body').isVisible())
  }
  for(const [mode,target,testid] of [['live',url('trades'),'live-trade-grid'],['practice',`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all&lang=${language}`,'analytics-ledger']]){
   await page.goto(target)
   const grid=page.getByTestId(testid),tools=page.getByRole('group',{name:label('Công cụ nhật ký giao dịch','Trade journal tools'),exact:true})
   await grid.locator('tbody tr .wm-trade-journal-action').first().waitFor()
   const row=grid.locator('tbody tr').first(),amount=await row.locator('[data-column=net_pnl]').innerText()
   const trash=row.locator('.wm-trade-journal-action')
   await trash.click()
   const dialog=page.getByRole('dialog',{name:label('Xóa khỏi nhật ký','Delete from journal'),exact:true})
   await dialog.waitFor();assert(await dialog.getByRole('button',{name:label('Xóa khỏi nhật ký','Delete from journal'),exact:true}).isDisabled())
   assert.notEqual(await row.getAttribute('aria-selected'),'true')
   await page.screenshot({path:`${out}/${mode}-delete-${width}-${theme}.png`})
   await dialog.getByRole('button',{name:label('Hủy','Cancel'),exact:true}).click()
   assert(await trash.evaluate(node=>document.activeElement===node))
   await row.getByRole('checkbox').check()
   await tools.getByRole('button',{name:label('Xóa khỏi nhật ký','Delete from journal'),exact:true}).click()
   await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
   const status=tools.getByRole('button',{name:label('Trạng thái nhật ký','Journal status'),exact:true})
   await status.click();await page.getByRole('option',{name:label('Đã xóa','Deleted'),exact:true}).click()
   await grid.getByText(label('Xóa/khôi phục nhật ký chưa được bật.','Journal deletion and restoration are not enabled yet.'),{exact:true}).waitFor()
   assert(await grid.locator('thead input[type="checkbox"]').isDisabled())
   assert.equal(await tools.locator('.wm-trade-journal-bulk').count(),0)
   await page.screenshot({path:`${out}/${mode}-deleted-${width}-${theme}.png`})
   await status.click();await page.getByRole('option',{name:label('Tất cả','All'),exact:true}).click()
   assert.equal(await row.locator('[data-column=net_pnl]').innerText(),amount)
   assert.equal(await grid.getByRole('checkbox',{checked:true}).count(),0)
   await tools.getByRole('button',{name:label('Bộ dữ liệu','Data set'),exact:true}).click()
   assert(await page.getByRole('option',{name:label('Nhật ký','Journal'),exact:false}).isDisabled())
   await page.keyboard.press('Escape')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
   report.cases.push({width,theme,language,mode,rowAction:true,bulkAction:true,statusPreview:true,clearSelection:true,noFinancialChange:true,noFakeSource:true})
  }
  manual=true
  await page.goto(url('trades')+'&live_account=manual-fixture')
  const manualGrid=page.getByTestId('manual-trade-grid'),manualTools=page.getByRole('group',{name:label('Công cụ nhật ký giao dịch','Trade journal tools'),exact:true})
  await manualGrid.getByRole('button',{name:label('Xóa giao dịch manual-trade-fixture','Delete trade manual-trade-fixture'),exact:true}).click()
  const manualDialog=page.getByRole('dialog',{name:label('Xóa khỏi nhật ký','Delete from journal'),exact:true})
  assert(await manualDialog.getByRole('button',{name:label('Xóa khỏi nhật ký','Delete from journal'),exact:true}).isDisabled())
  await page.screenshot({path:`${out}/manual-delete-${width}-${theme}.png`})
  await page.keyboard.press('Escape');await manualDialog.waitFor({state:'detached'})
  await manualTools.getByRole('button',{name:label('Trạng thái nhật ký','Journal status'),exact:true}).click()
  await page.getByRole('option',{name:label('Đã xóa','Deleted'),exact:true}).click()
  await manualGrid.getByText(label('Xóa/khôi phục nhật ký chưa được bật.','Journal deletion and restoration are not enabled yet.'),{exact:true}).waitFor()
  report.cases.push({width,theme,language,mode:'manual',fixture:'rendered synthetic read response',rowAction:true,statusPreview:true})
  await context.unrouteAll({behavior:'wait'});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'wait'});await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
