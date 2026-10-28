import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

const origin=process.argv[2] || 'http://127.0.0.1:5197'
const out=process.argv[3] || 'E:/BACKUP-TRADINGWORKSPACE/trades-clock-radios-20261026/preview-qa'
const session='6428cf18b3f54a36b2e90207ef12392e'
const base='/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all'
const copy=JSON.parse(await readFile(new URL('../src/testing-copy.json',import.meta.url),'utf8'))
const t=(key,lang='vi')=>copy[key]?.[lang]||key
await mkdir(out,{recursive:true})
const report={scope:'Trades read-only runtime and explicitly labeled response fixtures',cases:[],errors:[],writes:[]}
const browser=await chromium.launch({executablePath:process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
let baseline
async function ready(page){await page.waitForFunction(()=>{const e=document.querySelector('[data-testid="fx-trade-ledger"]');return e&&!e.hidden&&e.getAttribute('aria-busy')!=='true'})}
async function layout(page){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'document overflow')
 assert.ok(await page.locator('.fx-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'content overflow')
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),940,'one shell vertical scroll owner')
}
try{
 for(const [width,lang,theme] of [[1920,'vi','dark'],[1366,'en','light'],[390,'vi','light'],[320,'en','dark']]){
  const name=`actual-${width}-${lang}-${theme}`, context=await browser.newContext({viewport:{width,height:940},hasTouch:width<400,reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-timezone','Asia/Ho_Chi_Minh')},theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let last,requestUrl
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url())
   if(!['GET','HEAD'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}
   if(u.origin!==origin||/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname))return route.abort()
   if(u.pathname==='/api/v2/replay/trades'){
    const response=await route.fetch();last=await response.json();requestUrl=u;return route.fulfill({response})
   }
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(origin+base+`&lang=${lang}`);await ready(page)
  assert.equal(requestUrl.searchParams.get('time_basis'),'market')
  assert.ok(last.facets.years.map(String).includes('2003'));assert.equal(last.pagination.filtered_count,14)
  if(!baseline)baseline=structuredClone(last)
  assert.equal(await page.locator('thead .wm-report-info, thead .fxa-info').count(),0,'Trade headers omit help icons')
  for(const key of ['net_pnl','return_pct','realized_r']){
   const heading=page.locator(`th[data-column="${key}"]`)
   await heading.scrollIntoViewIfNeeded()
   assert.equal(await heading.locator('.wm-table-sort').count(),1)
   assert(await heading.locator('.wm-table-heading-label').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Return labels fit without helper controls')
  }
  assert.equal(await page.locator('button button').count(),0)
  const first=page.locator('tbody tr').first()
  assert.ok((await first.locator('[data-column="net_pnl"]').innerText()).includes(lang==='vi'?'-2,28':'-2.28'))
  assert.equal(await first.locator('[data-column="return_pct"]').innerText(),lang==='vi'?'-0,0023%':'-0.0023%')
  assert.equal(await first.locator('[data-column="realized_r"]').innerText(),'N/A')
  assert.match(await first.locator('[data-column="net_pnl"] [tabindex]').getAttribute('aria-label'),/USD/)
  assert.equal(await page.locator('.fxl-time-basis').count(),0)
  assert.equal(await page.locator('.fxa-filter-toolbar .wm-report-info').count(),0)
  const dialog=page.getByRole('dialog',{name:t('Filters',lang),exact:true})
  const openFilters=()=>page.getByRole('button',{name:t('Basic',lang),exact:true}).click()
  const chart=dialog.getByRole('radio',{name:'Chart',exact:true}), realtime=dialog.getByRole('radio',{name:'Realtime',exact:true})
  const apply=dialog.getByRole('button',{name:t('Apply Filters',lang),exact:true})
  const previewReady=()=>page.waitForFunction(()=>{const button=document.querySelector('dialog.fxl-filter-drawer footer .is-primary');return button&&!button.disabled})
  await openFilters();assert.equal(await chart.isChecked(),true)
  assert.equal(await dialog.getByRole('radio').count(),2)
  await page.screenshot({path:`${out}/${name}-chart-panel.png`})
  const before=page.url()
  await chart.focus();await chart.press('ArrowRight');await previewReady()
  assert.equal(await realtime.isChecked(),true);assert.equal(page.url(),before)
  assert.equal(requestUrl.searchParams.get('time_basis'),'activity');assert.deepEqual(last.facets.years,[])
  assert.equal(await page.getByTestId('fx-trade-ledger').getAttribute('aria-busy'),null)
  assert.equal(await first.locator('[data-column="return_pct"]').innerText(),lang==='vi'?'-0,0023%':'-0.0023%')
  await dialog.locator('summary').filter({hasText:t('Year',lang)}).click()
  assert.equal(await dialog.getByRole('button',{name:t('Year',lang),exact:true}).isDisabled(),true)
  await page.screenshot({path:`${out}/${name}-realtime-panel.png`})
  await page.keyboard.press('Escape');await openFilters();assert.equal(await chart.isChecked(),true)
  await realtime.check();await previewReady();await apply.click();await ready(page)
  assert.equal(new URL(page.url()).searchParams.get('trades_time_basis'),'activity')
  await page.reload();await ready(page);assert.equal(requestUrl.searchParams.get('time_basis'),'activity')
  await openFilters();assert.equal(await realtime.isChecked(),true)
  await dialog.getByRole('button',{name:t('Clear All',lang),exact:true}).click();await previewReady()
  assert.equal(await chart.isChecked(),true)
  await apply.click();await ready(page);assert.equal(requestUrl.searchParams.get('time_basis'),'market')
  assert.equal(new URL(page.url()).searchParams.has('trades_time_basis'),false)
  if(width===1920){
   // The drawer is a draft until Apply. Apply commits base and extra filters together.
   await page.getByRole('button',{name:'Cơ bản',exact:true}).click()
   await dialog.locator('summary').filter({hasText:'Hướng lệnh'}).click();await dialog.getByRole('group',{name:'Hướng lệnh',exact:true}).getByRole('checkbox',{name:'Bán',exact:true}).check()
   await dialog.locator('summary').filter({hasText:'Khoảng ngày'}).click()
   await dialog.getByLabel(t('Analytics from date'),{exact:true}).fill('05/05/2003')
   await dialog.getByLabel(t('Analytics to date'),{exact:true}).fill('05/05/2003')
   await dialog.getByLabel(t('Analytics to date'),{exact:true}).press('Tab')
   assert.equal(new URL(page.url()).searchParams.get('from'),null)
   await dialog.getByRole('button',{name:t('Apply Filters'),exact:true}).click();await ready(page)
   assert.equal(last.pagination.filtered_count,1);assert.equal(new URL(page.url()).searchParams.get('from'),'2003-05-05')
   assert.deepEqual(JSON.parse(requestUrl.searchParams.get('extra_filters')).sides,'["sell"]')
   assert.equal(await page.locator('.fxa-filter-chip').count(),2)
   await page.locator('.fxa-filter-chip').filter({hasText:'Hướng lệnh'}).click();await ready(page)
   assert.equal(await page.locator('.fxa-filter-chip').count(),1);assert.equal(new URL(page.url()).searchParams.get('from'),'2003-05-05')
   await page.reload();await ready(page);assert.equal(last.pagination.filtered_count,1)
   await page.getByRole('button',{name:t('Clear filters'),exact:true}).click();await ready(page)
   assert.equal(last.pagination.filtered_count,14);assert.equal(new URL(page.url()).searchParams.get('sessions'),'all')
   assert.equal(await page.locator('.fxa-filter-chip').count(),0)
   // Clock Apply resets page and preserves the selected session scope.
   await page.getByTestId('analytics-ledger-pagination').locator('button[data-page="2"],button[aria-label="Trang 2"]').click();await ready(page);assert.equal(last.pagination.page,2)
   const open=page.locator('tbody tr').filter({hasText:'Đang mở'});assert.equal(await open.count(),1)
   assert.equal(await open.locator('[data-column="net_pnl"]').innerText(),'N/A')
   await page.goto(origin+base.replace('sessions=all',`session=${session}`)+'&lang=vi&trades_time_basis=activity');await ready(page)
   assert.equal(requestUrl.searchParams.get('time_basis'),'activity')
   assert.deepEqual(last.scope.session_ids,[session]);assert.equal(new URL(page.url()).searchParams.get('session'),session)
   await page.goto(origin+base+'&lang=vi');await ready(page)
   await page.locator('th[data-column="net_pnl"] .wm-table-sort').click();await ready(page)
   assert.equal(JSON.parse(requestUrl.searchParams.get('sort'))[0].key,'net_pnl')
  }
  // Chips wrap; Clear retains language/scope and resets the clock to Chart.
  await page.goto(origin+base+`&lang=${lang}&trades_time_basis=activity&analytics_sides=%5B%22sell%22%5D&analytics_outcomes=%5B%22loss%22%5D`);await ready(page)
  assert.equal(await page.locator('.fxa-filter-chip').count(),2)
  await layout(page);await page.screenshot({path:`${out}/${name}-chips.png`})
  await page.locator('.fxa-clear-filters').click();await ready(page);assert.equal(last.pagination.filtered_count,14)
  assert.equal(new URL(page.url()).searchParams.get('lang'),lang)
  assert.equal(new URL(page.url()).searchParams.has('trades_time_basis'),false)
  assert.equal(requestUrl.searchParams.get('time_basis'),'market')
  await page.locator('.fxa-table-scroll').evaluate(e=>e.scrollLeft=0)
  await layout(page);await page.screenshot({path:`${out}/${name}.png`})
  report.cases.push({name,status:'PASS',clock:'draft radios, preview facets, cancel/Apply/Clear/reload',tooltip:'focus/click/touch/Escape',writeCount:0})
  await context.close()
 }
 for(const mode of ['preview-error','preview-race']){
  const context=await browser.newContext({viewport:{width:390,height:940},reducedMotion:'reduce'})
  await context.routeWebSocket('**/*',socket=>socket.close())
  let activityCalls=0
  const held=[]
  const activityStarted=[]
  const activitySeen=Array.from({length:2},(_,i)=>new Promise(resolve=>{activityStarted[i]=resolve}))
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url())
   if(!['GET','HEAD'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}
   if(u.origin!==origin||/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname))return route.abort()
   if(u.pathname==='/api/v2/replay/trades'){
    const d=structuredClone(baseline)
    if(u.searchParams.get('time_basis')==='activity'){
     activityCalls++
     activityStarted[activityCalls-1]?.()
     if(mode==='preview-error'&&activityCalls===1)return route.fulfill({status:503,json:{detail:'labeled_preview_failure'}})
     d.facets={...d.facets,years:['2099'],date_range:{from:'2099-01-01',to:'2099-12-31'}}
     if(mode==='preview-race')await new Promise(resolve=>held.push(resolve))
    }
    return route.fulfill({json:d}).catch(()=>{})
   }
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(origin+base+'&lang=en');await ready(page)
  const before=page.url(), first=await page.locator('tbody tr').first().innerText()
  await page.getByRole('button',{name:'Basic',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Filters',exact:true}), apply=dialog.getByRole('button',{name:'Apply filters',exact:true})
  const chart=dialog.getByRole('radio',{name:'Chart',exact:true}), realtime=dialog.getByRole('radio',{name:'Realtime',exact:true})
  await realtime.check()
  if(mode==='preview-error'){
   await dialog.getByRole('alert').waitFor();assert.equal(await apply.isDisabled(),true)
   assert.equal(page.url(),before);assert.equal(await page.locator('tbody tr').first().innerText(),first)
   await page.screenshot({path:`${out}/fixture-${mode}.png`})
   await dialog.getByRole('button',{name:t('Thử lại','en'),exact:true}).click()
   await page.waitForFunction(()=>!document.querySelector('dialog footer .is-primary')?.disabled)
   assert.equal(activityCalls,2);assert.equal(await dialog.getByRole('alert').count(),0)
  }else{
   await dialog.getByRole('status').waitFor();assert.equal(await apply.isDisabled(),true)
   await page.waitForFunction(()=>document.querySelector('dialog input[value="activity"]')?.checked)
   // Hold the old read, switch twice, then deliver the cancelled read last.
   await activitySeen[0]
   assert.equal(held.length,1)
   await chart.check();assert.equal(await apply.isEnabled(),true)
   await realtime.check();await dialog.getByRole('status').waitFor()
   await page.waitForFunction(()=>document.querySelector('dialog footer .is-primary')?.disabled)
   // The route callback enters before the UI can receive its response.
   await activitySeen[1]
   assert.equal(held.length,2);held[1]()
   await page.waitForFunction(()=>!document.querySelector('dialog footer .is-primary')?.disabled)
   await chart.check();held[0]()
   await dialog.locator('summary').filter({hasText:'Year'}).click()
   await dialog.getByRole('button',{name:'Year',exact:true}).click()
   await dialog.getByRole('option',{name:'2003',exact:true}).waitFor()
   assert.equal(await dialog.getByRole('option',{name:'2099',exact:true}).count(),0)
   await page.screenshot({path:`${out}/fixture-${mode}.png`})
  }
  assert.equal(page.url(),before);assert.equal(await page.locator('tbody tr').first().innerText(),first)
  report.cases.push({name:`labeled-response-fixture-${mode}`,status:'PASS'})
  await context.close()
 }
 for(const mode of ['empty','unknown','partial','denied','error','stale']){
  const context=await browser.newContext({viewport:{width:390,height:940},reducedMotion:'reduce'})
  await context.routeWebSocket('**/*',socket=>socket.close())
  let calls=0
  await context.route('**/*',route=>{
   const r=route.request(),u=new URL(r.url())
   if(!['GET','HEAD'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}
   if(u.origin!==origin||/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname))return route.abort()
   if(u.pathname==='/api/v2/replay/trades'){
    calls++
    if(['denied','error'].includes(mode)||(mode==='stale'&&calls>1))return route.fulfill({status:mode==='denied'?403:503,json:{detail:'trades_reference_labeled_fixture'}})
    const d=structuredClone(baseline)
    if(['unknown','partial'].includes(mode)){d.status='partial';d.excluded=[{session_id:'fixture-unavailable',reason:'unavailable'}]}
    if(['empty','unknown'].includes(mode)){d.ledger=[];Object.assign(d.pagination,{page:1,returned_count:0,filtered_count:mode==='unknown'?null:0,page_count:mode==='unknown'?null:0})}
    return route.fulfill({json:d})
   }
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(origin+base+'&lang=en')
  if(mode==='denied'){await page.getByText('Access denied',{exact:true}).waitFor();assert.equal(await page.getByTestId('fx-trade-ledger').count(),0)}
  else if(mode==='error'){await page.getByRole('alert').waitFor();assert.equal(await page.getByTestId('fx-trade-ledger').isVisible(),false)}
  else{
   await ready(page)
   if(['empty','unknown'].includes(mode))assert.equal(await page.locator('tbody tr').count(),0)
   else assert.equal(await page.locator('tbody tr').count(),10)
   if(mode==='stale'){
    await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))})
    await page.waitForFunction(()=>document.querySelector('[data-resource-state="stale"]')||document.body.innerText.includes('outdated')||document.body.innerText.includes('Outdated'))
    assert.equal(await page.locator('tbody tr').count(),10)
   }
  }
  await layout(page);await page.screenshot({path:`${out}/fixture-${mode}.png`})
  report.cases.push({name:`labeled-response-fixture-${mode}`,status:'PASS'});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;const p=browser.contexts().at(-1)?.pages().at(-1);if(p){await p.screenshot({path:`${out}/failure.png`});await writeFile(`${out}/failure-dom.txt`,await p.locator('body').innerText())}}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
