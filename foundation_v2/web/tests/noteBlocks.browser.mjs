import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'

const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Production candidate; owner GETs only, journal reads/writes simulated',cases:[],errors:[]}
let page
try {
 for(const [width,theme] of [[1920,'dark'],[1440,'light'],[390,'dark']]) {
  const context=await browser.newContext({viewport:{width,height:940},deviceScaleFactor:width===1440?1.25:1,reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let journals=[],sequence=0
  const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,sorted(item)])):value
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname
   if(url.origin!==origin)return route.abort()
   if(path==='/api/v2/note-templates' && request.method()==='GET')return route.fulfill({json:{version:'note-templates-v1',items:[],preferences:{revision:0,favorites:['beginner','daily-report'],defaults:{}}}})
   if(path==='/api/v2/journal' && request.method()==='GET')return route.fulfill({json:{items:journals}})
   if(request.method()==='POST' && /^\/api\/v2\/journal(?:\/[^/]+\/revisions)?$/.test(path)) {
    const body=request.postDataJSON(),current=path.endsWith('/revisions')?journals.find(item=>item.record_id===path.split('/').at(-2)):null
    const record=sorted({record_id:current?.record_id||`rich-${++sequence}`,revision:(current?.revision||0)+1,payload:current?body.payload:body,deleted:false,updated_at_utc:'2026-10-30T05:00:00Z'})
    if(current)journals=journals.map(item=>item===current?record:item);else journals.push(record)
    return route.fulfill({json:record})
   }
   if(!['GET','HEAD','OPTIONS'].includes(request.method()))return route.abort()
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.stack))
  const url=origin+'/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all&lang=en'
  await page.goto(url);const row=page.getByTestId('analytics-ledger').locator('tbody tr').first()
  await row.locator('[data-column=symbol]').click()
  const drawer=page.locator('dialog.fxa-trade-inspector'),editor=drawer.locator('.bn-editor'),menu=drawer.getByRole('listbox')
  await editor.waitFor();console.log(`editor ${width}`);assert.equal(await drawer.locator('.as-provenance-details').count(),0)
  for(const value of await drawer.locator('.fx-live-trade-details dd').allTextContents())assert(!/[—$]/.test(value))
  await editor.fill('/');await menu.waitFor()
  assert((await menu.innerText()).includes('Beginner'));assert((await menu.innerText()).includes('Heading 3'))
  await page.screenshot({path:`${out}/slash-${width}-${theme}.png`})
  await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert.equal(await drawer.count(),1)
  assert.equal(await editor.evaluate(node=>getComputedStyle(node).outlineStyle),'none')
  await editor.fill('Original analysis before template ');await page.keyboard.press('End');await page.keyboard.type('/Beginner')
  await menu.getByRole('option').filter({hasText:'Beginner'}).click()
  assert((await editor.innerText()).includes('Original analysis before template'));assert.equal(await editor.locator('h2').count(),2)
  await drawer.locator('[data-state=saved]').waitFor()
  assert(journals[0].payload.note.includes('Original analysis before template'));assert(journals[0].payload.note_document.blocks.some(block=>block.type==='heading'))
  const before=await editor.innerText()
  await drawer.getByRole('button',{name:'Templates',exact:true}).click()
  const templates=page.locator('dialog.wm-note-templates');await templates.waitFor()
  await templates.getByRole('searchbox').fill('Daily');assert.equal(await templates.locator('.wm-note-template-list > button').count(),2)
  await page.screenshot({path:`${out}/templates-${width}-${theme}.png`})
  console.log('closing templates');await page.keyboard.press('Escape');await templates.waitFor({state:'detached'});console.log('templates closed');assert.equal(await drawer.count(),1);assert.equal(await editor.innerText(),before)
  const side=drawer.locator('.bn-side-menu')
  for(const block of [editor.locator('.bn-block-content').first(),editor.locator('h2').first()]) {
   await block.hover();await side.waitFor()
   const geometry=await side.evaluate(node=>{
    const line=document.querySelector('.bn-block-content:hover .bn-inline-content') || document.querySelector('.bn-inline-content:hover')
    const rect=line.getBoundingClientRect(),height=parseFloat(getComputedStyle(line).lineHeight)
    return {center:rect.top+height/2,buttons:[...node.querySelectorAll('button')].map(button=>{
     const b=button.getBoundingClientRect(),svg=button.querySelector('svg').getBoundingClientRect()
     return {width:b.width,height:b.height,center:b.y+b.height/2,svgWidth:svg.width,svgHeight:svg.height}
    })}
   })
   for(const button of geometry.buttons){assert.equal(button.width,24);assert.equal(button.height,24);assert.equal(button.svgWidth,button.svgHeight);assert(Math.abs(button.center-geometry.center)<1,JSON.stringify(geometry))}
   await page.waitForTimeout(650);assert(await side.isVisible())
   for(const button of await side.getByRole('button').all()){await button.hover();await page.waitForTimeout(150);assert(await side.isVisible())}
  }
  await page.screenshot({path:`${out}/side-controls-${width}-${theme}.png`})
  if(width===1920) {
   await editor.locator('.bn-block-content').first().hover()
   await side.waitFor()
   assert.equal(await side.getByRole('button').count(),2)
   console.log('click plus');await side.getByRole('button').first().click({position:{x:1,y:1}});await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});console.log('plus closed')
   for(const key of ['Enter','Space']) {
    await editor.locator('.bn-block-content').first().hover();await side.waitFor()
    await side.getByRole('button').first().focus();await side.getByRole('button').first().press(key);await menu.waitFor()
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'})
   }
   const first=editor.locator('.bn-block-content').first(),last=editor.locator('.bn-block-content').last()
   const beforeDrag=await editor.innerText()
   console.log('drag');await first.hover();await side.waitFor()
   const handle=await side.getByRole('button').last().boundingBox(),target=await last.boundingBox()
   await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2)
   await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2+8,{steps:3})
   await page.mouse.move(target.x+target.width/2,target.y+target.height-2,{steps:12})
   await page.mouse.move(target.x+target.width/2,target.y+target.height-2);await page.mouse.up()
   await page.waitForFunction(before=>document.querySelector('.bn-editor').innerText!==before,beforeDrag,{timeout:12000});console.log('drag done')
   assert((await editor.innerText()).includes('Original analysis before template'))
   // Keep the NodeSelection left by drag-and-drop: no click into text first.
   assert.equal(await editor.evaluate(node=>node.editor.state.selection.toJSON().type),'node')
   await page.keyboard.press('Enter');await page.keyboard.insertText('After drag Enter')
   await editor.evaluate(node=>node.editor.state.doc.check())
   assert((await editor.innerText()).includes('After drag Enter'))
   assert((await editor.innerText()).includes('Original analysis before template'))
   const afterEnter=await editor.innerText()
   await page.keyboard.press('Control+z')
   await editor.evaluate(node=>node.editor.state.doc.check())
   assert((await editor.innerText()).includes('Original analysis before template'))
   await page.keyboard.press('Control+Shift+z')
   await editor.evaluate(node=>node.editor.state.doc.check())
   assert.equal(await editor.innerText(),afterEnter)
  }
  // A small scroll can happen without leaving the hovered block. It must update
  // the anchor rather than dismiss the controls and wait for a new mousemove.
  console.log('long content');await editor.locator('.bn-inline-content').last().click();await editor.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('Long paragraph '.repeat(500))
  const scroller=drawer.locator('.fx-trade-note-draft')
  const longBlock=editor.locator('.bn-block-content').filter({hasText:'Long paragraph'}).first()
  await longBlock.hover({position:{x:100,y:80}});await side.waitFor()
  await scroller.evaluate(node=>node.scrollTop=0)
  await editor.locator('.bn-block-content').first().hover();await side.waitFor()
  assert(await scroller.evaluate(node=>node.scrollHeight>node.clientHeight+100))
  await scroller.evaluate(node=>node.scrollTop=1)
  await page.waitForTimeout(350);assert(await side.isVisible(),'Same-block scroll dismissed side controls')
  await scroller.evaluate(node=>node.scrollTop=0)
  await editor.press('ArrowRight');await side.waitFor({state:'hidden'})
  await editor.locator('.bn-block-content').first().hover();await side.waitFor()
  await drawer.locator('[data-state=saved]').waitFor()
  await drawer.locator('.fx-trade-window-controls button').first().focus()
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'})
  await row.locator('[data-column=symbol]').click();await drawer.locator('[data-state=saved]').waitFor()
  assert((await editor.innerText()).includes('Original analysis before template'));assert.equal(await editor.locator('h2').count(),2)
  await page.screenshot({path:`${out}/editor-${width}-${theme}.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.equal(await drawer.evaluate(node=>node.scrollWidth>node.clientWidth+1),false)
  report.cases.push({width,theme,slashAndEscape:true,templatePreservesText:true,templatesEscape:true,structuredReload:true,plus:width===1920,dragReorders:width===1920,dragEnterPreservesContent:width===1920,sideControlGeometry:true,sameBlockHover:true,sameBlockScroll:true,keyboardDismiss:true})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
