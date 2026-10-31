import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const [origin,out,api]=process.argv.slice(2)
for(const value of [origin,api]){assert.equal(new URL(value).hostname,'127.0.0.1');assert(!['5180','8010'].includes(new URL(value).port))}
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),client=await browser.newContext(),report={scope:'Disposable Rust Router/PostgreSQL; synthetic trades, no owner writes',cases:[],errors:[]}
let page
const closingContexts=new WeakSet()
const native=async(method,path,body,status=200,workspace='tenant-a')=>{
 const response=await client.request.fetch(api+path,{method,headers:{'X-Workspace-Id':workspace,'Idempotency-Key':crypto.randomUUID()},data:body})
 const result=await response.json();assert.equal(response.status(),status,JSON.stringify(result));return result
}
try{
 const account=await native('POST','/api/v2/live/records',{kind:'account',payload:{name:'Review fixture',currency:'USD',opening_balance:'10000'}},201)
 const trade=await native('POST','/api/v2/live/records',{kind:'trade',payload:{account_id:account.record_id,symbol:'EURUSD',side:'BUY',quantity:'1',entry_price:'1.1',exit_price:'1.11',gross_pnl:'100',commission:'-1',swap:'0',fee:'0',opened_at_utc:'2026-10-30T03:00:00Z',closed_at_utc:'2026-10-30T04:00:00Z',tags:[],note:''}},201)
 const plain={title:'Legacy plain note',note:'Preserve plain text',tags:[],account_id:null,playbook_id:null,playbook_revision:null}
 const legacy=await native('POST','/api/v2/live/records',{kind:'note',payload:plain},201)
 const recovered=await native('POST','/api/v2/live/records',{kind:'note',payload:{...plain,title:'Recovered legacy'}},201)
 const doc={format:'blocknote',version:1,blocks:[{type:'heading',content:'Rich fixture'}]}
 const contract={title:'Rich contract',note:'Rich fixture',note_document:doc,note_type:'weekly_review',review_from:'2026-10-01',review_to:'2026-10-30',review_timezone:'Asia/Ho_Chi_Minh',linked_trades:[{account_id:account.record_id,trade_id:trade.record_id}]}
 const saved=await native('POST','/api/v2/live/records',{kind:'note',payload:contract},201)
 assert.deepEqual(saved.payload.note_document,doc)
 for(const payload of [{...contract,note:'Mismatch'},{...contract,review_to:'2026-09-30'},{...contract,linked_trades:[{account_id:crypto.randomUUID(),trade_id:trade.record_id}]},{...contract,linked_trades:[contract.linked_trades[0],contract.linked_trades[0]]}])await native('POST','/api/v2/live/records',{kind:'note',payload},422)
 await native('POST','/api/v2/live/records',{kind:'note',payload:contract},422,'tenant-b')
 await native('POST',`/api/v2/live/records/${saved.record_id}/revisions`,{kind:'note',expected_revision:999,payload:contract},409)
 const fixture=await native('GET','/fixture'),brokerLink={account_id:`broker:${fixture.live_payload.connection_id}`,trade_id:'position:123'}
 await native('POST','/api/v2/live/records',{kind:'note',payload:{...contract,linked_trades:[brokerLink]}},201)
 await native('POST','/api/v2/live/records',{kind:'note',payload:{...contract,linked_trades:[{...brokerLink,trade_id:'position:999'}]}},404)
 await native('POST','/api/v2/live/records',{kind:'note',payload:{...contract,linked_trades:[brokerLink]}},404,'tenant-b')
 report.cases.push('native rich consistency, legacy, date validation, manual/broker ownership, tenant isolation, CAS')
 for(const [width,theme,language] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]){
  const vi=language==='vi',label=(a,b)=>vi?a:b
  const context=await browser.newContext({viewport:{width,height:940},deviceScaleFactor:width===1440?1.25:1,reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  if(width===1920)await context.addInitScript(record=>{
   const base={...record.payload,connection_id:null}
   const key='naqex-draft-v1:'+JSON.stringify(['live-note','tenant-a',record.record_id])
   sessionStorage.setItem(key,JSON.stringify({base,value:{...base,note:'Retained legacy recovery'},record,attempt:{value:{...base,note:'Pending legacy write'},record,startedAt:Date.now()}}))
  },recovered)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let failWrites=false,recordWrites=0,manyRows=false
  await context.route('**/*',async route=>{
   try {
   const req=route.request(),url=new URL(req.url())
   if(url.origin!==origin)return await route.abort()
   if(url.pathname==='/api/v2/events')return await route.fulfill({status:204,body:''})
   if(url.pathname==='/api/v2/live/status')return await route.fulfill({json:fixture.live_payload})
   if(url.pathname.startsWith('/api/')){
    if(req.method()==='POST' && url.pathname.startsWith('/api/v2/live/records'))recordWrites++
    if(failWrites && req.method()==='POST' && url.pathname.startsWith('/api/v2/live/records'))return await route.fulfill({status:503,json:{detail:'fixture_failure'}})
    const response=await route.fetch({url:api+url.pathname+url.search})
    if(manyRows && req.method()==='GET' && url.pathname==='/api/v2/live/records'){
     const body=await response.json();body.items.push(...Array.from({length:501},()=>({...trade,record_id:crypto.randomUUID()})));return await route.fulfill({response,json:body})
    }
    return await route.fulfill({response})
   }
   return await route.continue()
   } catch(error) { if(!closingContexts.has(context)){report.errors.push(error.stack);await route.abort().catch(()=>{})} }
  })
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.stack));page.on('console',message=>{if(message.type()==='error')report.lastConsoleError=message.text()})
  await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=notes&lang=${language}`)
  await page.locator('.live-note-create').click()
  const drawer=page.locator('.is-note-editor'),editor=drawer.locator('.bn-editor'),title=drawer.getByRole('textbox',{name:label('Tiêu đề','Title'),exact:true})
  await editor.waitFor();await page.waitForFunction(()=>!document.querySelector('.wm-live-note-title input').disabled)
  assert(Math.abs((await drawer.boundingBox()).width-Math.min(width,width>1000?Math.min(1440,width*.7):width))<=1)
  assert.equal(await drawer.locator('textarea').count(),0)
  assert.equal(await drawer.locator('.wm-live-note-editor-layout').evaluate(node=>getComputedStyle(node).display),width<=680?'flex':'grid')
  assert.equal(await drawer.locator('.wm-review-extra').count(),0)
  assert.equal(await drawer.locator('.wm-review-navigation button').count(),3)
  assert(await drawer.getByRole('button',{name:label('Ghi chú trước','Previous note'),exact:true}).isDisabled())
  assert(await drawer.getByRole('button',{name:label('Ghi chú tiếp theo','Next note'),exact:true}).isDisabled())
  const summaryLayout=await drawer.locator('.wm-review-summary').evaluate(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,parentLeft:node.parentElement.getBoundingClientRect().left,parentRight:node.parentElement.getBoundingClientRect().right,radius:getComputedStyle(node).borderRadius,top:getComputedStyle(node).borderTopWidth,bottom:getComputedStyle(node).borderBottomWidth}))
  assert.equal(summaryLayout.radius,'0px');assert.equal(summaryLayout.top,'1px');assert.equal(summaryLayout.bottom,'1px')
  assert(Math.abs(summaryLayout.left-summaryLayout.parentLeft)<=1&&Math.abs(summaryLayout.right-summaryLayout.parentRight)<=1)
  await drawer.getByRole('button',{name:label('Thêm thao tác ghi chú','More note actions'),exact:true}).click()
  await page.getByRole('menuitem',{name:label('Đổi tên ghi chú','Rename note'),exact:true}).click()
  assert(await title.evaluate(node=>node===document.activeElement))
  await page.screenshot({path:`${out}/fresh-${width}-${theme}.png`})
  const beforeFreshClose=recordWrites
  await drawer.getByRole('button',{name:label('Đóng','Close'),exact:true}).click();await drawer.waitFor({state:'detached'})
  assert.equal(recordWrites,beforeFreshClose)
  await page.locator('.live-note-create').click();await editor.waitFor();await page.waitForFunction(()=>!document.querySelector('.wm-live-note-title input').disabled)
  await title.fill(`Review browser ${width}`);await editor.fill('Retain this paragraph')
  await page.keyboard.press('ControlOrMeta+End');await page.keyboard.press('Enter');await page.keyboard.press('ControlOrMeta+b');await page.keyboard.type('Bold retained');await page.keyboard.press('ControlOrMeta+b')
  await drawer.locator('[data-state=saved]').waitFor()
  if(width>680){
   const titleBox=await title.boundingBox(),timeBox=await drawer.locator('.wm-live-note-title time').boundingBox()
   assert(Math.abs(titleBox.y+titleBox.height/2-timeBox.y-timeBox.height/2)<3,'Saved time shares the title row')
  }
  await drawer.getByRole('button',{name:label('Mẫu ghi chú','Templates'),exact:true}).click()
  const templates=page.locator('dialog.wm-note-templates');await templates.waitFor()
  await templates.getByRole('button',{name:label('Áp dụng vào','Apply to'),exact:true}).click()
  await templates.getByRole('menuitem',{name:label('Ghi chú này','This note'),exact:true}).click()
  await templates.waitFor({state:'detached'});await drawer.locator('[data-state=saved]').waitFor()
  assert((await editor.innerText()).includes('Bold retained'))
  await drawer.getByRole('button',{name:label('Mẫu ghi chú','Templates'),exact:true}).click();await templates.waitFor();await page.keyboard.press('Escape');await templates.waitFor({state:'detached'});assert(await drawer.isVisible())
  const range=drawer.getByRole('textbox',{name:label('Khoảng ngày','Date range'),exact:true})
  await range.fill('01/10/2026 – 30/10/2026');await range.press('Tab')
  await drawer.getByRole('button',{name:label('Loại ghi chú','Note type'),exact:true}).click()
  await page.getByRole('option',{name:label('Đánh giá tuần','Weekly review'),exact:true}).click()
  await drawer.getByRole('button',{name:label('Thêm giao dịch','Add trade'),exact:true}).first().click()
  const picker=page.locator('.wm-review-trade-picker');await picker.waitFor()
  const pickerBox=await picker.boundingBox();assert(Math.abs(pickerBox.x+pickerBox.width/2-width/2)<2)
  const pickerRange=picker.getByRole('textbox',{name:label('Khoảng ngày giao dịch','Trade date range'),exact:true})
  await pickerRange.fill('31/02/2026 – 30/10/2026');await pickerRange.press('Tab')
  assert(await picker.getByRole('button',{name:label('Áp dụng','Apply'),exact:true}).isDisabled())
  await pickerRange.fill('01/10/2025 – 30/10/2025');await pickerRange.press('Tab')
  assert.equal(await picker.locator('.wm-review-picker-row').count(),0)
  await pickerRange.fill('01/10/2026 – 30/10/2026');await pickerRange.press('Tab')
  await picker.getByRole('searchbox').fill('EURUSD')
  await picker.locator('.wm-review-picker-row').filter({hasText:'Review fixture'}).getByRole('checkbox').check()
  await page.screenshot({path:`${out}/picker-${width}-${theme}.png`})
  await picker.getByRole('button',{name:label('Áp dụng','Apply'),exact:true}).click()
  await picker.waitFor({state:'detached'});await drawer.locator('[data-state=saved]').waitFor()
  assert.equal(await drawer.locator('.wm-review-summary dd').nth(0).innerText(),'$99')
  await page.screenshot({path:`${out}/linked-${width}-${theme}.png`})
  const note=(await native('GET','/api/v2/live/records')).items.find(row=>row.payload.title===`Review browser ${width}`)
  assert(note);assert.equal(note.payload.note_type,'weekly_review');assert.equal(note.payload.linked_trades.length,1)
  assert(note.payload.note_document.blocks.some(block=>JSON.stringify(block).includes('"bold":true')))
  const recorded=structuredClone(note.payload.note_document)
  await page.reload();await page.locator('.live-note-row').filter({hasText:`Review browser ${width}`}).click()
  await editor.waitFor();await drawer.locator('[data-state=saved]').waitFor()
  assert((await editor.innerText()).includes('Bold retained'))
  assert.equal(await drawer.locator('.wm-review-linked .wm-review-trade-row').count(),1)
  const beforeCancel=recordWrites
  await drawer.getByRole('button',{name:label('Tìm giao dịch liên kết','Find linked trades'),exact:true}).click();await picker.waitFor()
  await picker.locator('.wm-review-picker-row').filter({hasText:'Review fixture'}).getByRole('checkbox').uncheck()
  await page.keyboard.press('Escape');await picker.waitFor({state:'detached'})
  assert(await drawer.isVisible());assert.equal(await drawer.locator('.wm-review-linked .wm-review-trade-row').count(),1);assert.equal(recordWrites,beforeCancel)
  assert.deepEqual((await native('GET','/api/v2/live/records')).items.find(row=>row.record_id===note.record_id).payload.note_document,recorded)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if(width===1920){
   await editor.fill('Flush before navigating');await drawer.getByRole('button',{name:'Ghi chú tiếp theo',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('.wm-live-note-title input')?.value!=='Review browser 1920')
   assert.equal((await native('GET','/api/v2/live/records')).items.find(row=>row.record_id===note.record_id).payload.note,'Flush before navigating')
   await drawer.getByRole('button',{name:'Đóng',exact:true}).click();await drawer.waitFor({state:'detached'})
   await page.locator('.live-note-row').filter({hasText:'Review browser 1920'}).click();await editor.waitFor();await drawer.locator('[data-state=saved]').waitFor()
   failWrites=true;await editor.fill('Retained on failed close');await drawer.getByRole('button',{name:'Đóng',exact:true}).click()
   await drawer.locator('[data-state=error]').waitFor();assert(await drawer.isVisible());assert.equal((await editor.innerText()).trim(),'Retained on failed close')
   failWrites=false;await drawer.getByRole('button',{name:'Thử lại',exact:true}).click();await drawer.locator('[data-state=saved]').waitFor()
   const record=(await native('GET','/api/v2/live/records')).items.find(row=>row.record_id===note.record_id)
   await native('POST',`/api/v2/live/records/${record.record_id}/revisions`,{kind:'note',expected_revision:record.revision,payload:{...record.payload,note:'External update',note_document:null}})
   await editor.fill('Keep conflict draft');await drawer.getByRole('button',{name:'Đóng',exact:true}).click();await drawer.locator('[data-state=conflict]').waitFor()
   assert.equal((await editor.innerText()).trim(),'Keep conflict draft');await page.screenshot({path:`${out}/conflict.png`})
   page.once('dialog',dialog=>dialog.accept());await drawer.getByRole('button',{name:'Tải bản đã lưu',exact:true}).click();await drawer.locator('[data-state=saved]').waitFor()
   assert.equal((await editor.innerText()).trim(),'External update')
   report.cases.push('failed close retains draft; retry; stale revision conflict; reload server recovery')
  }
  await drawer.getByRole('button',{name:label('Đóng','Close'),exact:true}).click();await drawer.waitFor({state:'detached'})
  const beforeLegacy=recordWrites
  await page.locator('.live-note-row').filter({hasText:'Legacy plain note'}).click();await editor.waitFor();await drawer.locator('[data-state=saved]').waitFor();assert.equal((await editor.innerText()).trim(),'Preserve plain text');assert.equal(recordWrites,beforeLegacy)
  await drawer.getByRole('button',{name:label('Đóng','Close'),exact:true}).click();await drawer.waitFor({state:'detached'});assert.equal(recordWrites,beforeLegacy)
  if(width===1920){
   await page.locator('.live-note-row').filter({hasText:'Recovered legacy'}).click();await editor.waitFor();await drawer.locator('[data-state=saved]').waitFor()
   assert.equal((await editor.innerText()).trim(),'Retained legacy recovery')
   const latest=(await native('GET','/api/v2/live/records')).items.find(row=>row.record_id===recovered.record_id)
   assert.equal(latest.payload.note,'Retained legacy recovery')
   await drawer.getByRole('button',{name:'Đóng',exact:true}).click();await drawer.waitFor({state:'detached'})
   report.cases.push('legacy sessionStorage draft and unresolved old write retain exact payload, drain later edits')
   manyRows=true;await page.reload();await page.locator('.live-note-row').filter({hasText:`Review browser ${width}`}).click();await editor.waitFor();await drawer.locator('[data-state=saved]').waitFor()
   await drawer.getByRole('button',{name:'Thêm giao dịch',exact:true}).first().click();await picker.waitFor()
   const all=picker.locator('.wm-review-picker-count input')
   await all.click();await all.click()
   assert.equal(await all.evaluate(node=>node.indeterminate),true)
   assert((await picker.locator('.wm-review-picker-count').innerText()).includes('500'))
   await all.click();assert((await picker.locator('.wm-review-picker-count').innerText()).includes('Đã chọn 0 giao dịch'))
   await picker.getByRole('button',{name:'Hủy',exact:true}).click();await picker.waitFor({state:'detached'})
   await drawer.getByRole('button',{name:'Đóng',exact:true}).click();await drawer.waitFor({state:'detached'});manyRows=false
   report.cases.push('large-catalog UI fixture: 500 limit, mixed state, deselect visible, cancel preserves links')
   await page.goto(`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all&lang=vi`)
   await page.getByTestId('analytics-ledger').locator('tbody tr').first().locator('[data-column=symbol]').click()
   const tradeDrawer=page.locator('dialog.fxa-trade-inspector'),tradeEditor=tradeDrawer.locator('.bn-editor')
   await tradeEditor.waitFor();await tradeEditor.fill('Shared editor regression')
   await tradeDrawer.locator('[data-state=saved]').waitFor();await page.reload()
   await page.getByTestId('analytics-ledger').locator('tbody tr').first().locator('[data-column=symbol]').click();await tradeEditor.waitFor();assert.equal((await tradeEditor.innerText()).trim(),'Shared editor regression')
   report.cases.push('Testing trade shared-editor save/reload regression')
  }
  report.cases.push(`${width}/${theme}/${language}: shared editor, format/template, save+reload, dates/type, links+summary, legacy, no overflow`)
  closingContexts.add(context);await context.close()
 }
 assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;if(page){report.snapshot=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:`${out}/failure.png`}).catch(()=>{})}throw error}
finally{for(const context of browser.contexts())closingContexts.add(context);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()}
