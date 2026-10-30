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
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let journals=[],sequence=0
  const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,sorted(item)])):value
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname
   if(url.origin!==origin)return route.abort()
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
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message))
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
  await drawer.getByRole('button',{name:'♧ /templates',exact:true}).click()
  const templates=page.locator('dialog.wm-note-templates');await templates.waitFor()
  await templates.getByRole('searchbox').fill('Daily');assert.equal(await templates.locator('.wm-note-template-list > button').count(),1)
  await page.screenshot({path:`${out}/templates-${width}-${theme}.png`})
  console.log('closing templates');await page.keyboard.press('Escape');await templates.waitFor({state:'detached'});console.log('templates closed');assert.equal(await drawer.count(),1);assert.equal(await editor.innerText(),before)
  if(width===1920) {
   await editor.locator('.bn-block-content').first().hover()
   const side=drawer.locator('.bn-side-menu');await side.waitFor()
   assert.equal(await side.getByRole('button').count(),2)
   console.log('click plus');await side.getByRole('button').first().click();await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});console.log('plus closed')
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
  }
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'})
  await row.locator('[data-column=symbol]').click();await drawer.locator('[data-state=saved]').waitFor()
  assert((await editor.innerText()).includes('Original analysis before template'));assert.equal(await editor.locator('h2').count(),2)
  await page.screenshot({path:`${out}/editor-${width}-${theme}.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.equal(await drawer.evaluate(node=>node.scrollWidth>node.clientWidth+1),false)
  report.cases.push({width,theme,slashAndEscape:true,templatePreservesText:true,templatesEscape:true,structuredReload:true,plus:width===1920,dragReorders:width===1920})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
