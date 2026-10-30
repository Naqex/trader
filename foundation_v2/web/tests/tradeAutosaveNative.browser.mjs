import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const [origin,api,out]=process.argv.slice(2)
for(const value of [origin,api])assert.equal(new URL(value).hostname,'127.0.0.1')
assert.notEqual(new URL(api).port,'8010');assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const report={scope:'Real Rust API and PostgreSQL in disposable cluster; UI trade rows read from local owner API; note writes only disposable API',cases:[],errors:[],writes:[]}
const browser=await chromium.launch();let page
try {
 const context=await browser.newContext({viewport:{width:1920,height:940},reducedMotion:'reduce'})
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin)return route.abort()
  const notePath=/^\/api\/v2\/(journal|live\/records)(\/[^/]+(?:\/revisions)?)?$/.test(url.pathname)
  if(notePath){
   if(req.method()!=='GET')report.writes.push({path:url.pathname,api})
   const response=await context.request.fetch(api+url.pathname+url.search,{method:req.method(),headers:{...req.headers(),host:new URL(api).host},...(req.postData() ? {data:req.postData()} : {})})
   return route.fulfill({response})
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.writes.push({unexpected:url.pathname});return route.abort()}
  return route.continue()
 })
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message))
 const base=origin+'/?workspace=tenant-a&lang=vi',drawer=page.locator('dialog.fxa-trade-inspector')
 for(const [mode,path,id] of [['practice','&view=trade&area=testing&section=trades&select=1&sessions=all','analytics-ledger'],['live','&view=live&area=live&section=trades','live-trade-grid']]) {
  await page.goto(base+path);await page.getByTestId(id).locator('tbody tr').first().locator('[data-column=symbol]').click()
  const textarea=drawer.locator('textarea');await textarea.fill(`Native ${mode} autosave`);await textarea.blur();await drawer.locator('[data-state=saved]').waitFor()
  const savedAt=await drawer.locator('.wm-autosave-status time').getAttribute('datetime');assert(Number.isFinite(Date.parse(savedAt)))
  await page.screenshot({path:`${out}/${mode}.png`})
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});await page.reload()
  await page.getByTestId(id).locator('tbody tr').first().locator('[data-column=symbol]').click();await drawer.locator('[data-state=saved]').waitFor();assert.equal(await textarea.inputValue(),`Native ${mode} autosave`)
  await textarea.fill(`Native ${mode} revised`);await textarea.blur();await drawer.locator('[data-state=saved]').waitFor()
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});report.cases.push(`${mode}-create-reload-revise`)
 }
 await page.goto(base+'&view=live&area=live&section=notes');await page.getByRole('button',{name:'Thêm ghi chú',exact:true}).click()
 const editor=page.locator('.live-record-dialog.is-drawer')
 await editor.locator('input').filter({visible:true}).first().fill('Native standalone note');await editor.locator('textarea').fill('Saved in disposable PostgreSQL');await editor.locator('textarea').blur();await editor.locator('[data-state=saved]').waitFor()
 await page.keyboard.press('Escape');await editor.waitFor({state:'detached'});await page.reload();await page.locator('.live-note-row').filter({hasText:'Native standalone note'}).click();await editor.locator('[data-state=saved]').waitFor();assert.equal(await editor.locator('textarea').inputValue(),'Saved in disposable PostgreSQL')
 await page.screenshot({path:`${out}/standalone.png`});await page.keyboard.press('Escape');report.cases.push('standalone-create-reload')
 const headers={'X-Workspace-Id':'tenant-a'},list=await (await context.request.get(api+'/api/v2/journal',{headers})).json()
 assert.equal(list.items.length,2)
 for(const record of list.items){assert.equal(record.revision,2);assert(record.payload.note.endsWith(' revised'))}
 const remote=await (await context.request.get(api+'/api/v2/journal',{headers:{'X-Workspace-Id':'tenant-other'}})).json();assert.equal(remote.items.length,0)
 const first=list.items[0]
 const rejected=await context.request.post(api+`/api/v2/journal/${first.record_id}/revisions`,{headers:{...headers,'Idempotency-Key':crypto.randomUUID(),'Origin':origin},data:{expected_revision:1,payload:{...first.payload,note:'Must not overwrite'}}})
 assert.equal(rejected.status(),409);report.cases.push('revision-conflict-and-workspace-isolation')
 assert(!report.writes.some(item=>item.unexpected));assert.deepEqual(report.errors,[]);report.status='PASS'
} catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
