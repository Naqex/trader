import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const origin=process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out=process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-presets-20261018'
await mkdir(out,{recursive:true})
const browser=await chromium.launch()
const report={scope:'Production UI; isolated browser storage. Real catalog GETs, all backend writes blocked except one intercepted 503 failure test. No owner sessions modified.',cases:[],errors:[],writes:[]}
try {
 for(const mode of ['backtest','prop']) for(const language of ['vi','en']) {
  const en=language==='en',context=await browser.newContext({viewport:{width:1368,height:790}})
  await context.addInitScript(language=>{localStorage.setItem('tw-language',language);localStorage.setItem('tw-theme','dark')},language)
  let failCreate=false
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==origin) return route.abort()
   if(!['GET','HEAD','OPTIONS'].includes(request.method())) {
    if(failCreate && url.pathname==='/api/v2/replay/sessions') {
     const body=request.postDataJSON()
     assert.equal(body.starting_balance,'50000')
     assert.equal(Object.values(body.trading_options.assets)[0].spread_price,'0.0002')
     return route.fulfill({status:503,json:{detail:'QA uncertain create'}})
    }
    report.writes.push(url.pathname);return route.abort()
   }
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000)
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${mode}`)
  const dialog=page.locator('.quick-session-dialog'),trigger=dialog.locator('.session-preset-trigger'),menu=dialog.locator('.session-preset-menu')
  await dialog.waitFor();await trigger.waitFor({state:'visible'})
  await page.addStyleTag({content:'*,*::before,*::after{animation:none !important;transition:none !important}'})
  await dialog.locator('input[maxlength="160"]').first().fill('OWNER DRAFT')
  const assets=dialog.locator('.dataset-asset-select .fx-select-trigger:not(:disabled)')
  for(let i=0;i<2;i++) {await assets.click();await dialog.locator('.dataset-asset-select [role=option][aria-selected=false]:not([disabled])').first().click()}
  await dialog.getByRole('radio',{name:'$50K',exact:true}).click()
  await trigger.click()
  if(mode==='backtest' && !en) await dialog.screenshot({animations:'disabled',path:`${out}/empty-menu.png`})
  await menu.locator('.session-preset-create').click()
  assert.equal(await dialog.locator('.quick-session-sections').count(),0)
  assert.equal(await dialog.locator('.quick-session-period-random').count(),0,'presets have no frozen backtest dates')
  await dialog.locator('.quick-session-submit').click()
  assert.ok(await dialog.locator('.wm-field-error').count(),'empty preset name blocks saving')
  await dialog.locator('input[maxlength="160"]').first().fill('TEST')
  await dialog.locator('[data-option=costs] [role=switch]').click()
  const costs=dialog.locator('.session-cost-grid')
  await costs.first().locator('input').first().fill('0.0002')
  await costs.first().locator('input').nth(1).fill('5')
  await costs.last().locator('input').first().fill('0.2')
  if(mode==='backtest' && !en) {
   await dialog.locator('input[maxlength="160"]').first().scrollIntoViewIfNeeded()
   await dialog.screenshot({animations:'disabled',path:`${out}/new-preset.png`})
   await dialog.locator('[data-option=costs]').screenshot({animations:'disabled',path:`${out}/preset-costs.png`})
  }
  await dialog.locator('.quick-session-submit').click()
  await dialog.locator('.quick-session-sections').waitFor()
  assert.ok((await trigger.textContent()).includes('TEST'))
  assert.equal(await dialog.locator('input[maxlength="160"]').first().inputValue(),'OWNER DRAFT')
  await dialog.getByRole('radio',{name:'$10K',exact:true}).click()
  assert.ok(!(await trigger.textContent()).includes('TEST'),'manual config change detaches selected preset')
  await trigger.click();await menu.locator('.session-preset-apply').click()
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true')
  assert.equal(await dialog.locator('input[maxlength="160"]').first().inputValue(),'OWNER DRAFT','applying a preset preserves the session name')
  await trigger.click();await menu.getByRole('button',{name:en?'Edit preset TEST':'Sửa preset TEST',exact:true}).click()
  await dialog.locator('input[maxlength="160"]').first().fill('CANCELLED')
  await dialog.getByRole('radio',{name:'$10K',exact:true}).click()
  await dialog.locator('.session-preset-back').click()
  assert.ok((await trigger.textContent()).includes('TEST'),'cancel restores preset selection and draft')
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true')
  await trigger.click();await menu.getByRole('button',{name:en?'Edit preset TEST':'Sửa preset TEST',exact:true}).click()
  await dialog.locator('input[maxlength="160"]').first().fill('RENAMED')
  await dialog.locator('.quick-session-submit').click()
  await trigger.waitFor();assert.ok((await trigger.textContent()).includes('RENAMED'))
  await page.reload();await trigger.waitFor()
  await trigger.click();await menu.locator('.session-preset-apply').click()
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true','saved configuration survives reload')
  await dialog.locator('.quick-session-sections button').nth(1).click()
  assert.equal(await costs.first().locator('input').first().inputValue(),'0.0002')
  assert.equal(await costs.last().locator('input').first().inputValue(),'0.2')
  await trigger.click()
  if(mode==='backtest' && !en) await dialog.screenshot({animations:'disabled',path:`${out}/selected-menu.png`})
  await menu.getByRole('button',{name:en?'Delete preset RENAMED':'Xóa preset RENAMED',exact:true}).click()
  const confirmation=page.locator('.session-preset-confirm')
  await confirmation.waitFor()
  if(mode==='backtest' && !en) await page.screenshot({animations:'disabled',path:`${out}/delete-confirm.png`})
  await confirmation.getByRole('button',{name:en?"Don't delete":'Không xóa',exact:true}).click()
  assert.equal(await menu.locator('.session-preset-row').count(),1)
  await menu.getByRole('button',{name:en?'Delete preset RENAMED':'Xóa preset RENAMED',exact:true}).click()
  await confirmation.getByRole('button',{name:en?'Delete preset':'Xóa preset',exact:true}).click()
  assert.equal(await menu.locator('.session-preset-row').count(),0)
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),1,'menu Escape does not close session setup')
  await dialog.locator('.quick-session-sections button').nth(0).click()
  assert.equal(await dialog.locator('.session-smooth-candles [role=switch]').count(),mode==='backtest'?1:0)
  if(mode==='backtest') {
   assert.equal(await dialog.locator('.session-smooth-candles [role=switch]').isDisabled(),true)
   await dialog.locator('input[maxlength="160"]').first().fill('FAILURE TEST')
   await dialog.locator('.quick-session-period-random').click()
   failCreate=true;await dialog.locator('.quick-session-submit').click()
   await dialog.locator('.quick-session-error').waitFor()
   assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),true)
   assert.equal(await trigger.isDisabled(),true,'presets cannot bypass uncertain-create guard')
  }
  if(mode==='prop') {
   await dialog.getByRole('tab',{name:'Backtesting',exact:true}).click()
   await trigger.click();assert.equal(await menu.locator('.session-preset-row').count(),0,'mode-specific list')
   await page.keyboard.press('Escape')
  }
  if(!en && mode==='prop') {
   await page.setViewportSize({width:360,height:790})
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
   await trigger.click();await dialog.screenshot({animations:'disabled',path:`${out}/mobile-menu.png`})
  }
  report.cases.push(`${mode}/${language}: create/apply/edit/cancel/reload/delete; independent asset costs; mode scoping; no preset backend writes`)
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.result='PASS'
} catch(error) {report.result='FAIL';report.failure=error.stack;throw error}
finally {await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors,failure:report.failure}))}
