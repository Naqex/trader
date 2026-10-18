import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {assetTradingDefaults} from '../src/sessionTradingOptions.js'
import {sessionPresetKey} from '../src/sessionPresets.js'

const origin=process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out=process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-presets-db-20261018/groups'
await mkdir(out,{recursive:true})
const browser=await chromium.launch()
const report={scope:'Production UI with isolated browser storage, in-memory preset HTTP fixture and a labeled catalog fixture: real local EUR/USD cloned as a second Forex asset. No owner backend writes.',cases:[],errors:[],writes:[]}
try {
 for(const mode of ['backtest','prop']) for(const language of ['vi','en']) {
  const en=language==='en',context=await browser.newContext({viewport:{width:1368,height:790}})
  await context.addInitScript(language=>{localStorage.setItem('tw-language',language);localStorage.setItem('tw-theme','dark')},language)
  let selected,presetItems=[]
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==origin) return route.abort()
   if(url.pathname.startsWith('/api/v2/session-presets')) {
    if(request.method()==='GET') return route.fulfill({json:{version:'session-presets-v1',items:presetItems}})
    const body=request.postDataJSON(),id=url.pathname.split('/')[4]
    const item={...body,id:id||crypto.randomUUID(),revision:1}
    presetItems=[...presetItems.filter(value=>value.id!==item.id),item]
    return route.fulfill({status:201,json:item})
   }
   if(!['GET','HEAD','OPTIONS'].includes(request.method())) {report.writes.push(url.pathname);return route.abort()}
   if(url.pathname==='/api/v2/data/datasets') {
    const response=await route.fetch(),payload=await response.json()
    const eur=payload.items.find(item=>item.instrument_id==='EUR/USD'),gold=payload.items.find(item=>item.instrument_id==='XAU/USD')
    assert.ok(eur && gold,'local EUR/USD and XAU/USD fixtures are available')
    const second={...structuredClone(eur),dataset_id:'qa-group-gbp',instrument_id:'GBP/USD',name:'GBP/USD',asset_class:'forex'}
    selected=[eur,second,gold]
    return route.fulfill({response,json:{...payload,items:selected}})
   }
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000)
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${mode}`)
  const dialog=page.locator('.quick-session-dialog'),trigger=dialog.locator('.session-preset-trigger')
  await trigger.waitFor();await page.waitForFunction(()=>!document.querySelector('.session-preset-trigger')?.disabled)
  const values=Object.fromEntries(selected.map(asset=>[asset.dataset_id,assetTradingDefaults()]))
  values[selected[0].dataset_id].slippage={mode:'fixed',fixed_steps:2}
  values[selected[1].dataset_id].slippage={mode:'light'}
  const key=sessionPresetKey('tenant-a',mode)
  await page.evaluate(({key,ids,values})=>localStorage.setItem(key,JSON.stringify({version:'session-presets-v1',items:[{id:'qa-group',name:'GROUP TEST',config:{balance:'10000',datasets:ids,strategy:'',propDraft:{profileKind:'generic',targetPercent:'10',dailyLoss:'500',overallLoss:'1000',durationDays:''},tradingOptions:{version:'session-trading-options-v2',costs_enabled:false,assets:values}}}]})),{key,ids:selected.map(asset=>asset.dataset_id),values})
  await page.reload();await trigger.click();await dialog.locator('.session-preset-apply').click()
  await dialog.locator('.quick-session-sections button').nth(1).click()
  const groups=dialog.locator('[data-option=slippage] .session-slippage-asset')
  const fx=dialog.locator('[data-option=slippage] [data-category=fx]'),metal=dialog.locator('[data-option=slippage] [data-category=metal]')
  assert.equal(await groups.count(),2,'three assets produce two category rows')
  assert.equal(await fx.locator('.session-option-asset strong').textContent(),'Forex')
  assert.match(await fx.locator('.session-option-asset small').textContent(),/EUR\/USD, GBP\/USD/)
  assert.equal(await fx.locator('button[aria-pressed=true]').count(),0,'mixed presets are not presented as uniform')
  assert.match(await fx.locator('p').textContent(),en?/Mixed settings/:/Thiết lập khác nhau/)
  await fx.getByRole('button',{name:en?'Medium':'Vừa',exact:true}).click()
  assert.equal(await fx.getByRole('button',{name:en?'Medium':'Vừa',exact:true}).getAttribute('aria-pressed'),'true')
  await fx.getByRole('button',{name:en?'Fixed':'Cố định',exact:true}).click()
  await fx.locator('input').fill('3')
  assert.equal(await metal.getByRole('button',{name:en?'Off':'Tắt',exact:true}).getAttribute('aria-pressed'),'true','other categories retain their settings')
  if(mode==='backtest' && !en) for(const width of [1368,360]) {
   await page.setViewportSize({width,height:790})
   await groups.first().scrollIntoViewIfNeeded()
   assert.ok(await dialog.locator('.quick-session-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
   await dialog.screenshot({animations:'disabled',path:`${out}/groups-${width}.png`})
   await dialog.locator('[data-option=slippage]').screenshot({animations:'disabled',path:`${out}/slippage-${width}.png`})
  }
  await page.setViewportSize({width:1368,height:790})
  await trigger.click();await dialog.locator('.session-preset-create').click()
  await dialog.locator('input[maxlength="160"]').first().fill('GROUP SAVED')
  await dialog.locator('.quick-session-submit').click()
  const saved=presetItems.find(item=>item.name==='GROUP SAVED')
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null,'legacy browser presets are removed only after verified server import')
  for(const asset of selected.slice(0,2)) assert.deepEqual(saved.config.tradingOptions.assets[asset.dataset_id].slippage,{mode:'fixed',fixed_steps:3})
  assert.deepEqual(saved.config.tradingOptions.assets[selected[2].dataset_id].slippage,{mode:'off'})
  await page.reload();await trigger.click();await dialog.locator('.session-preset-apply').filter({hasText:'GROUP SAVED'}).click()
  await dialog.locator('.quick-session-sections button').nth(1).click()
  assert.equal(await fx.locator('input').inputValue(),'3','uniform group survives preset reload')
  report.cases.push(`${mode}/${language}: category grouping, mixed preset, shared mode/fixed amount, other category unchanged, persisted per-asset values and reload`)
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.result='PASS'
} catch(error) {report.result='FAIL';report.failure=error.stack;throw error}
finally {await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({result:report.result,cases:report.cases.length,failure:report.failure}))}
