import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

// Opt-in: writes only uniquely named QA presets; never creates replay/Prop sessions.
assert.equal(process.env.TW_PRESET_PERSISTENCE_QA,'1','Enable explicitly against an authorized local runtime')
const origin=process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname,'127.0.0.1')
const out=process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-presets-db-20261018/persisted'
await mkdir(out,{recursive:true})
const browser=await chromium.launch(), prefix=`QA-preset-${Date.now()}`
const report={scope:'Production UI and real local PostgreSQL through Rust API. Fresh browser contexts, no preset HTTP mocks. Only test-owned presets may be written.',cases:[],errors:[],blockedWrites:[],owned:[]}
const owned=new Set()
const headers={'X-Workspace-Id':'tenant-a'}
async function list(mode) {
 const response=await fetch(`${origin}/api/v2/session-presets?mode=${mode}`,{headers})
 assert.equal(response.status,200)
 return (await response.json()).items
}
async function open(mode) {
 const context=await browser.newContext({viewport:{width:1368,height:790}})
 await context.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin!==origin) return route.abort()
  if(['GET','HEAD','OPTIONS'].includes(request.method())) return route.continue()
  if(url.pathname.startsWith('/api/v2/session-presets') && request.method()==='POST') {
   const body=request.postDataJSON(),id=url.pathname.split('/')[4]
   assert.ok(id ? owned.has(id) : body.name===`${prefix}-${mode}`,'Only test-owned preset mutations are authorized')
   return route.continue()
  }
  report.blockedWrites.push(url.pathname);return route.abort()
 })
 const page=await context.newPage();page.setDefaultTimeout(15000)
 page.on('pageerror',error=>report.errors.push(error.message))
 await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${mode}`)
 const dialog=page.locator('.quick-session-dialog'),trigger=dialog.locator('.session-preset-trigger'),menu=dialog.locator('.session-preset-menu')
 await trigger.waitFor();await page.waitForFunction(()=>!document.querySelector('.session-preset-trigger')?.disabled)
 return {context,page,dialog,trigger,menu}
}
const baseline={}
try {
 for(const mode of ['backtest','prop']) {
  baseline[mode]=await list(mode)
  const name=`${prefix}-${mode}`
  let view=await open(mode)
  await view.trigger.click();await view.menu.locator('.session-preset-create').click()
  await view.dialog.locator('input[maxlength="160"]').first().fill(name)
  const assets=view.dialog.locator('.dataset-asset-select')
  await assets.locator('.fx-select-trigger:not(:disabled)').click()
  await assets.locator('[role=option][aria-selected=false]:not([disabled])').first().click()
  const responsePromise=view.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/session-presets' && response.request().method()==='POST')
  await view.dialog.locator('.quick-session-submit').click()
  const response=await responsePromise;assert.equal(response.status(),201)
  const saved=await response.json();owned.add(saved.id);report.owned.push({id:saved.id,mode})
  await view.dialog.locator('.quick-session-sections').waitFor()
  assert.ok((await view.trigger.textContent()).includes(name))
  await view.context.close()

  // A new context has none of the first browser's local/session storage.
  view=await open(mode)
  await view.trigger.click()
  const row=view.menu.locator('.session-preset-row').filter({has:view.page.getByRole('button',{name,exact:true})})
  await row.locator('.session-preset-apply').click()
  assert.equal(await view.dialog.getByRole('radio',{name:'$10K',exact:true}).getAttribute('aria-checked'),'true')
  await view.trigger.click();await row.getByRole('button',{name:`Sửa preset ${name}`,exact:true}).click()
  await view.dialog.getByRole('radio',{name:'$50K',exact:true}).click()
  await view.dialog.locator('.quick-session-submit').click()
  await view.dialog.locator('.quick-session-sections').waitFor()
  await view.context.close()

  view=await open(mode)
  await view.trigger.click()
  const restored=view.menu.locator('.session-preset-row').filter({has:view.page.getByRole('button',{name,exact:true})})
  await restored.locator('.session-preset-apply').click()
  assert.equal(await view.dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true')
  await view.trigger.click()
  if(mode==='backtest') await view.dialog.screenshot({animations:'disabled',path:`${out}/persisted-preset.png`})
  await restored.getByRole('button',{name:`Xóa preset ${name}`,exact:true}).click()
  const confirmation=view.page.locator('.session-preset-confirm')
  await confirmation.getByRole('button',{name:'Xóa preset',exact:true}).click()
  await confirmation.waitFor({state:'detached'})
  assert.deepEqual(await list(mode),baseline[mode],'Existing user presets must remain unchanged')
  owned.delete(saved.id)
  await view.context.close()
  report.cases.push(`${mode}: create, fresh-browser read/apply, edit, second fresh-browser read/apply, delete; original presets preserved`)
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedWrites,[]);report.result='PASS'
} catch(error) {report.result='FAIL';report.failure=error.stack;throw error}
finally {
 for(const mode of ['backtest','prop']) {
  if(!owned.size) break
  for(const item of await list(mode)) if(owned.has(item.id) && item.name===`${prefix}-${mode}`) {
   const response=await fetch(`${origin}/api/v2/session-presets/${encodeURIComponent(item.id)}/delete`,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({mode,expected_revision:item.revision})})
   assert.equal(response.status,200);owned.delete(item.id)
  }
 }
 report.cleanupComplete=owned.size===0
 await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))
 await browser.close()
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,cleanupComplete:report.cleanupComplete,failure:report.failure}))
}
