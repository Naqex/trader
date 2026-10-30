import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(), report={scope:'Candidate production UI; real local GETs; all writes simulated in browser',cases:[],errors:[],writes:[]}
let page
try {
 for(const [width,theme] of [[1920,'dark'],[1440,'light'],[390,'dark']]) {
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  const journals=[],notes=[];let sequence=0,fail='',hold=0
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,json=(body,status=200)=>route.fulfill({json:body,status})
   if(url.origin!==origin)return route.abort()
   if(path==='/api/v2/journal' && req.method()==='GET')return json({items:journals})
   if(path==='/api/v2/live/records' && req.method()==='GET')return json({version:'live-records-v1',items:notes})
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue()
   if(!/^\/api\/v2\/(journal|live\/records)(\/[^/]+\/revisions)?$/.test(path)){report.writes.push({unexpected:path});return route.abort()}
   const body=req.postDataJSON(),live=path.includes('live/records'),rows=live ? notes : journals
   report.writes.push({path,fixture:true,body})
   if(hold)await new Promise(resolve=>setTimeout(resolve,hold))
   if(fail==='network'){fail='';return route.abort()}
   const current=path.endsWith('/revisions') ? rows.find(item=>item.record_id===decodeURIComponent(path.split('/').at(-2))) : null
   if(fail==='conflict'){
    fail='';if(current){current.revision++;current.payload.note='Remote newer note';current.payload.note_document=null}
    return json({detail:'revision_conflict'},409)
   }
   if(current && body.expected_revision!==current.revision)return json({detail:'revision_conflict'},409)
   const payload=current ? body.payload : live ? body.payload : body
   const record={record_id:current?.record_id || `note-${++sequence}`,revision:(current?.revision || 0)+1,kind:live?'note':undefined,payload:live ? {...payload,title:payload.title.trim()} : payload,updated_at_utc:'2026-10-30T04:11:58Z',created_at_utc:'2026-10-30T04:11:58Z',deleted:false}
   if(current)rows.splice(rows.indexOf(current),1,record);else rows.push(record)
   return json(record,current?200:201)
  })
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  const base=`${origin}/?workspace=tenant-a&lang=vi`,drawer=page.locator('dialog.fxa-trade-inspector')
  for(const [mode,path,id] of [['practice','&view=trade&area=testing&section=trades&select=1&sessions=all','analytics-ledger'],['live','&view=live&area=live&section=trades','live-trade-grid']]) {
   await page.goto(base+path)
   const row=page.getByTestId(id).locator('tbody tr').first()
   await row.locator('[data-column=symbol]').click();await drawer.waitFor()
   assert.deepEqual(await drawer.locator('.fx-live-trade-details > dl').evaluateAll(groups=>groups.map(group=>group.children.length)),[2,8,3])
   const textarea=drawer.locator('.bn-editor');await textarea.waitFor();await textarea.fill(`${mode} note ${width}`)
   await drawer.locator('.wm-autosave-status[data-state=saved]').waitFor()
   assert.equal(await drawer.locator('.wm-autosave-status time').getAttribute('datetime'),'2026-10-30T04:11:58Z')
   const stored=journals.at(-1);assert.equal(stored.payload.note,`${mode} note ${width}`)
   assert(stored.payload.source.session_id);assert(stored.payload.source.trade_id)
   await page.screenshot({path:`${out}/${mode}-${width}-${theme}.png`})
   await drawer.getByRole('button',{name:'Đóng chi tiết',exact:true}).click();await drawer.waitFor({state:'detached'})
   await row.locator('[data-column=symbol]').click();await drawer.waitFor();assert.equal(await textarea.innerText(),`${mode} note ${width}`)
   if(width===1920 && mode==='practice') {
    hold=250
    await textarea.fill('Closing latest A');await drawer.getByRole('button',{name:'Đóng chi tiết',exact:true}).click()
    await textarea.fill('Closing latest B');await drawer.waitFor({state:'detached'});hold=0
    assert.equal(journals.find(item=>item.record_id===stored.record_id).payload.note,'Closing latest B')
    await row.locator('[data-column=symbol]').click();await drawer.waitFor()
    fail='network';await textarea.fill('Network retry draft');await textarea.blur();await drawer.locator('[data-state=error]').waitFor()
    assert.equal(await textarea.innerText(),'Network retry draft');await drawer.getByRole('button',{name:'Thử lại',exact:true}).click();await drawer.locator('[data-state=saved]').waitFor()
    fail='conflict';await textarea.fill('Local conflict draft');await textarea.blur();await drawer.locator('[data-state=conflict]').waitFor()
    assert.equal(await textarea.innerText(),'Local conflict draft');await page.screenshot({path:`${out}/conflict.png`})
    await drawer.getByRole('button',{name:'Tải bản đã lưu',exact:true}).click();await drawer.locator('[data-state=saved]').waitFor();assert.equal(await textarea.innerText(),'Remote newer note')
    await textarea.fill('');await textarea.blur();await drawer.locator('[data-state=invalid]').waitFor();assert.equal(journals.find(item=>item.record_id===stored.record_id).payload.note,'Remote newer note')
    await textarea.fill('Recovered after clear');await textarea.blur();await drawer.locator('[data-state=saved]').waitFor()
   }
   if(await drawer.count()){await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'})}
  }
  await page.goto(base+'&view=live&area=live&section=notes')
  await page.getByRole('button',{name:'Thêm ghi chú',exact:true}).click()
  const editor=page.locator('.live-record-dialog.is-drawer')
  await editor.locator('input').filter({visible:true}).first().fill('  My saved note  ')
  const body=editor.locator('textarea');await body.fill('Standalone autosave body');await body.blur();await editor.locator('[data-state=saved]').waitFor()
  assert.equal(notes[0].payload.title,'My saved note')
  const tags=editor.getByLabel('Nhãn',{exact:true});await tags.fill('London, breakout');await tags.blur();await editor.locator('[data-state=saved]').waitFor();assert.deepEqual(notes[0].payload.tags,['London','breakout'])
  await page.screenshot({path:`${out}/standalone-${width}-${theme}.png`});await page.keyboard.press('Escape');await editor.waitFor({state:'detached'})
  await page.locator('.live-note-row').filter({hasText:'My saved note'}).click();await editor.waitFor();assert.equal(await body.inputValue(),'Standalone autosave body');await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  report.cases.push({width,theme,twoEightThree:true,tradePersistenceBoth:true,standalone:true,closeDrains:width===1920,networkAndConflict:width===1920})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert(!report.writes.some(item=>item.unexpected));report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify({status:report.status,cases:report.cases,errors:report.errors,failure:report.failure,writes:report.writes.length}))
