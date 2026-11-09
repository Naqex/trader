// GET-only runtime review, or stateful synthetic label mutations on a preview.
import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { brokerSnapshot,completedDealFills } from './liveJournal.fixture.mjs'
const [origin,out,mode='fixture']=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
if(mode==='fixture')assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={mode,checks:[],errors:[],blockedWrites:[]}
let page
try {
 for(const [width,theme] of mode==='runtime'?[[1920,'dark'],[390,'light']]:[[1920,'dark'],[1920,'light'],[1241,'dark'],[390,'light']]) {
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce',hasTouch:width===390})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  let catalog={schema_version:'trade-labels-v1',groups:[],assignments:[],items:['Excellent','test','Good','Average','Poor','Bad'].map((name,i)=>({id:`label-${i}`,name,color:['green','blue','cyan','gray','orange','red'][i],revision:1,archived:false}))},conflict=false
  const broker=brokerSnapshot();broker.deals=completedDealFills(broker.deals.slice(0,3))
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url()),json=(body,status=200)=>route.fulfill({json:body,status})
   if(url.origin!==origin)return route.abort()
   if(mode==='fixture'&&url.pathname==='/api/v2/trade-labels') {
    if(req.method()==='GET')return json(catalog)
    const body=req.postDataJSON()
    if(conflict){conflict=false;return json({detail:'label_revision_conflict'},409)}
    let assignment
    if(body.action==='update') {
     const item=catalog.items.find(x=>x.id===body.id),old=item.name
     Object.assign(item,{name:body.name,color:body.color,revision:item.revision+1})
     catalog.assignments.forEach(x=>x.tags=x.tags.map(tag=>tag===old?item.name:tag))
    } else if(body.action==='assign') {
     assignment={session_id:body.session_id,trade_id:body.trade_id,revision:body.expected_revision+1,tags:body.tags}
     catalog.assignments=[...catalog.assignments.filter(x=>x.trade_id!==body.trade_id||x.session_id!==body.session_id),assignment]
    } else if(body.action==='create')catalog.items.push({id:'created-label',name:body.name,color:body.color,revision:1})
    else if(body.action==='delete'){const item=catalog.items.find(x=>x.id===body.id);catalog.items=catalog.items.filter(x=>x!==item);catalog.assignments.forEach(x=>x.tags=x.tags.filter(tag=>tag!==item.name))}
    else throw new Error(`Unexpected fixture action ${body.action}`)
    return json({...catalog,...assignment?{assignment}:{}})
   }
   if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.blockedWrites.push(url.pathname);return route.abort()}
   if(mode==='fixture'&&url.pathname.startsWith('/api/')) {
    if(url.pathname==='/api/v2/live/status')return json(broker)
    if(url.pathname==='/api/v2/live/records')return json({version:'live-records-v1',items:[]})
    if(url.pathname==='/api/v2/live/connections')return json({items:broker.connections})
    return json({items:[]})
   }
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  const visit=section=>page.goto(`${origin}/?workspace=${mode==='runtime'?'tenant-a':'fixture'}&view=live&lang=vi&area=live&section=${section}`)
  const geometry=async section=>{
   const filter=page.locator(section==='calendar'?'.live-filters':'.live-trades-section > .fxa-filters'),side=page.locator('.live-analytics-side > h2')
   await side.waitFor();await page.locator('.live-analytics-content').waitFor()
   const [a,b]=await page.evaluate(selector=>[document.querySelector(selector),document.querySelector('.live-analytics-side > h2')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}),section==='calendar'?'.live-filters':'.live-trades-section > .fxa-filters')
   if(width>1240){assert(Math.abs(a.y-b.y)<.6);assert(Math.abs(a.y+a.height-b.y-b.height)<.6,JSON.stringify({section,a,b}))}
   if(section==='trades')assert.equal(await filter.evaluate(el=>getComputedStyle(el,'::after').content),'none')
   assert.equal(await (section==='calendar'?filter.locator('.live-toolbar'):filter).evaluate(el=>getComputedStyle(el).borderBottomWidth),'1px')
   assert.equal(await side.evaluate(el=>getComputedStyle(el).borderBottomWidth),'1px')
   const content=page.locator('.live-analytics-content')
   const seam=await content.evaluate(el=>{const controls=el.querySelector('.live-analytics-controls'),balance=el.querySelector('.live-analytics-balance-row');return {controlBottom:controls.getBoundingClientRect().bottom,balanceTop:balance.getBoundingClientRect().top,border:getComputedStyle(balance).borderTopWidth,controlsBorder:getComputedStyle(controls).borderBottomWidth}})
   assert.equal(seam.border,'1px');assert.equal(seam.controlsBorder,'0px');assert(Math.abs(seam.controlBottom-seam.balanceTop)<.6)
   await content.locator('.live-win-rate-row').scrollIntoViewIfNeeded()
   await content.locator('.live-analytics-controls').scrollIntoViewIfNeeded()
   report.checks.push({width,theme,section,a,b})
  }
  await visit('calendar');await geometry('calendar');await page.screenshot({path:`${out}/calendar-${width}-${theme}.png`})
  await visit('trades');await page.getByTestId('live-trade-grid').locator('tbody tr').first().waitFor();await geometry('trades')
  const cell=page.locator('.wm-label-cell').first();await cell.hover()
  assert.equal(await cell.locator('.wm-label-placeholder').innerText(),'Chọn nhãn…')
  assert.equal(await cell.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  await cell.click();const picker=page.locator('.wm-label-popup');await picker.waitFor()
  const input=picker.getByRole('searchbox'),options=picker.locator('.wm-label-options')
  const i=await input.boundingBox(),o=await options.boundingBox();assert(i.y>=o.y+o.height)
  const average=options.locator('.wm-label-option').filter({has:page.getByRole('checkbox',{name:'Average',exact:true})})
  const rowBox=await average.boundingBox(),badgeBox=await average.getByRole('checkbox').boundingBox()
  assert(badgeBox.width<rowBox.width/2,'Only the small badge is the assignment button')
  await page.mouse.move(rowBox.x+rowBox.width-55,rowBox.y+rowBox.height/2)
  assert.equal(await average.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  assert.equal(await average.getByRole('checkbox').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  await page.mouse.click(rowBox.x+rowBox.width-55,rowBox.y+rowBox.height/2)
  assert.equal(await average.getByRole('checkbox').getAttribute('aria-checked'),'false','Whitespace cannot assign a label')
  assert(await picker.isVisible())
  if(mode==='fixture') {
   const names=()=>options.locator('.wm-label-choice').allTextContents()
   const original=await names(),grip=picker.getByRole('button',{name:'Đổi thứ tự nhãn Excellent',exact:true})
   await grip.focus();await page.keyboard.press('Alt+ArrowDown');await page.keyboard.press('Alt+ArrowDown')
   assert.equal((await names())[2],'Excellent');assert(await grip.evaluate(el=>el===document.activeElement))
   const from=await grip.boundingBox(),first=await options.locator('.wm-label-option').first().boundingBox()
   await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down()
   await page.mouse.move(first.x+10,first.y+2,{steps:8});await page.mouse.up()
   assert.deepEqual(await names(),original,'Pointer handle reorders back to the first position')
   await grip.focus();await page.keyboard.press('Alt+ArrowDown')
   await page.reload();await cell.hover();await cell.click();await picker.waitFor()
   assert.equal((await names())[1],'Excellent','Display order survives reload')
   const restored=picker.getByRole('button',{name:'Đổi thứ tự nhãn Excellent',exact:true})
   await restored.focus();await page.keyboard.press('Alt+ArrowUp');assert.deepEqual(await names(),original)
   const start=await restored.boundingBox(),last=await options.locator('.wm-label-option').last().boundingBox()
   await page.mouse.move(start.x+10,start.y+10);await page.mouse.down();await page.mouse.move(last.x+10,last.y+last.height-2,{steps:8})
   await page.keyboard.press('Escape');await page.mouse.up()
   assert(await picker.isVisible());assert.deepEqual(await names(),original,'Escape cancels drag without closing picker')
   if(width===390) {
    const touch=await context.newCDPSession(page),a=await restored.boundingBox(),b=await options.locator('.wm-label-option').nth(1).boundingBox()
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]})
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+10,y:b.y+b.height-2}]})
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    assert.equal((await names())[1],'Excellent','Touch grip reorders without scrolling the page')
    await restored.focus();await page.keyboard.press('Alt+ArrowUp');await touch.detach()
   }
   await page.evaluate(()=>{window.labelSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('tw:trade-labels:'))throw new DOMException('blocked','SecurityError');return window.labelSetItem.call(this,key,value)}})
   await restored.focus();await page.keyboard.press('Alt+ArrowDown')
   await picker.getByRole('status').filter({hasText:'Không lưu được thứ tự'}).waitFor()
   assert.equal((await names())[1],'Excellent','Blocked storage preserves current display state')
   await page.evaluate(()=>{Storage.prototype.setItem=window.labelSetItem;delete window.labelSetItem})
   await page.keyboard.press('Alt+ArrowUp');assert.deepEqual(await names(),original)
   assert.equal(await picker.getByRole('status').count(),0)
  }
  await picker.screenshot({path:`${out}/picker-${width}-${theme}.png`})
  const more=picker.getByRole('button',{name:'Sửa nhãn Bad',exact:true});await more.click()
  const edit=page.locator('.wm-label-edit-popup');await edit.waitFor()
  for(const menu of [picker,edit])assert.equal(await menu.evaluate(el=>getComputedStyle(el).backgroundColor),theme==='light'?'rgb(250, 250, 250)':'rgb(29, 29, 29)')
  assert(await picker.isVisible());assert.equal(await edit.locator('.wm-label-color-list > button').count(),7)
  const marker=edit.locator('.fx-select-check')
  const tokenColor=await edit.evaluate(el=>{const probe=document.createElement('span');probe.className='fx-select-check';el.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color})
  assert.equal(await marker.evaluate(el=>getComputedStyle(el).color),tokenColor,'Color selection uses shared design-system check')
  const remove=edit.locator('.wm-label-delete-trigger'),section=edit.locator('.wm-label-delete-section')
  const removeBox=await remove.boundingBox(),sectionBox=await section.boundingBox()
  assert(removeBox.y>=sectionBox.y+8,'Separator is outside the delete hover target')
  await remove.hover()
  assert.equal(await section.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  const hoverColor=await edit.evaluate(el=>{const probe=document.createElement('span');probe.style.background='var(--wm-hover)';el.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color})
  assert.equal(await remove.evaluate(el=>getComputedStyle(el).backgroundColor),hoverColor)
  assert.equal(await edit.locator('.wm-label-swatch').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).backgroundColor===getComputedStyle(el).color)),true,'Color swatches stay solid in both themes')
  const e=await edit.boundingBox();assert(e.x>=0&&e.y>=0&&e.x+e.width<=width+1&&e.y+e.height<=940)
  await page.screenshot({path:`${out}/nested-${width}-${theme}.png`})
  if(mode==='fixture') {
   await edit.getByLabel('Tên nhãn',{exact:true}).fill('Discard this draft')
   await page.keyboard.press('Escape');await edit.waitFor({state:'hidden'});assert(catalog.items.some(x=>x.name==='Bad'))
   await more.click()
   await edit.getByRole('button',{name:'Xanh dương',exact:true}).click()
   await edit.getByRole('button',{name:'Xanh dương',exact:true,pressed:true}).waitFor();assert(await picker.isVisible())
   await edit.getByLabel('Tên nhãn',{exact:true}).fill('Bad renamed');await edit.getByLabel('Tên nhãn',{exact:true}).press('Enter');await edit.waitFor({state:'hidden'})
   await picker.getByRole('checkbox',{name:'Bad renamed',exact:true}).click()
   await cell.getByText('Bad renamed',{exact:true}).waitFor()
   await picker.getByRole('button',{name:'Sửa nhãn Bad renamed',exact:true}).click()
   await edit.getByRole('button',{name:'Xóa nhãn',exact:true}).click();assert(catalog.items.some(x=>x.name==='Bad renamed'))
   await edit.getByRole('button',{name:'Hủy',exact:true}).click()
   conflict=true;await edit.getByRole('button',{name:'Đỏ',exact:true}).click();await edit.waitFor({state:'hidden'});await picker.getByRole('alert').waitFor()
   await picker.getByRole('button',{name:'Sửa nhãn Bad renamed',exact:true}).click()
  }
  await page.keyboard.press('Escape');await edit.waitFor({state:'hidden'});assert(await picker.isVisible())
  assert(await picker.locator('.wm-label-more[aria-expanded=false]').evaluateAll(nodes=>nodes.some(el=>el===document.activeElement)))
  await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});assert(await cell.evaluate(el=>el===document.activeElement))
  if(mode==='fixture'&&width===1920&&theme==='dark') {
   for(const section of ['trades','calendar']) {
    await visit(section);await page.locator('.live-analytics-side > h2').waitFor()
    await page.getByRole('button',{name:'Cơ bản',exact:true}).click()
    const drawer=page.locator('dialog.fxl-filter-drawer')
    const side=drawer.locator('details').filter({has:page.getByRole('group',{name:/Hướng/,includeHidden:true})})
    await side.locator('summary').click()
    await side.getByLabel('Mua',{exact:true}).check()
    await drawer.locator('footer .is-primary').click()
    await page.locator(section==='calendar'?'.live-filter-chips':'.fxl-applied-filters').waitFor()
    await geometry(section)
    await page.screenshot({path:`${out}/chips-${section}.png`})
   }
  }
  if(mode==='runtime') {
   for(const section of ['notes','tag-analytics','analytics','trading-accounts','terminal']) {
    await visit(section)
    const surface={notes:'.live-notes','tag-analytics':'.live-journal-tags',analytics:'.live-analytics-report','trading-accounts':'.live-accounts-toolbar',terminal:'.fxs-charts'}[section]
    await page.locator(surface).waitFor()
    await page.locator('.wm-skeleton:visible').last().waitFor({state:'hidden'})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:`${out}/${section}-${width}-${theme}.png`})
    report.checks.push({width,theme,section,surfaceReady:true,noGlobalOverflow:true})
   }
  }
  report.checks.push({width,theme,transparentLabelHover:true,bottomSearch:true,nestedEditor:true,focusReturn:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedWrites,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{})}
finally{await browser.close();await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));console.log(`${report.status}: ${report.checks.length} checks`)}
