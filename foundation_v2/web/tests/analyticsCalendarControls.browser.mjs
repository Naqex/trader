import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const origin=process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
const out=process.env.TW_UI_EVIDENCE_DIR || '../evidence/analytics-calendar-controls-20261028'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const report={scope:'Labeled calendar control/return fixtures, plus real read-only Session page',cases:[],errors:[],writes:[]}
let page
const href=(session,lang='vi',prop=false)=>`${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&session=${session}&lang=${lang}${prop?'&analytics_source=prop&demo=1':''}`
const metric=async(cal,index)=>{await cal.locator('.wm-calendar-metric-toolbar .fx-select-trigger').click();await cal.getByRole('option').nth(index).click()}
try {
  for(const [width,theme,lang] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]){
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url())
      if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push(url.pathname);return route.abort()}
      return url.origin===origin && !/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(url.pathname)?route.continue():route.abort()
    })
    page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message))
    let snapshot=true,missingRisk=false
    const provenance={session_id:'calendar-controls-fixture',dataset_id:'calendar-controls-fixture',dataset_sha256:'fixture-hash',revision:1,cursor_index:100,execution_event_sequence:1,account_currency:'USD'}
    const source=[['2026-05-01',200],['2026-05-02',-100],['2026-05-03',100],['2026-05-04',900],['2026-05-31',-100]]
    await page.route('**/api/v2/journal/context*',route=>route.fulfill({json:{schema_version:'replay-journal-context-v1',workspace_id:'tenant-a',session_id:provenance.session_id,record_count:0,trades:[]}}))
    await page.route(/\/api\/v2\/replay\/sessions\/calendar-controls-fixture\/analytics(?:\?.*)?$/,route=>{
      const ledger=source.map(([date,net_pnl],index)=>({trade_id:`fixture-${index}`,session_id:provenance.session_id,status:'closed',side:'buy',symbol:'EURUSD',quantity:1,net_pnl,planned_risk_budget:missingRisk&&index===0?null:100,realized_r:missingRisk&&index===0?null:net_pnl/100,starting_balance:1000,account_currency:'USD',open_time_utc:`${date}T06:00:00Z`,close_time_utc:`${date}T07:18:00Z`,report_time_utc:`${date}T07:18:00Z`}))
      let balance=1000
      const curve=[{sequence:0,closed_trade_balance:balance},...ledger.map((row,index)=>({sequence:index+1,trade_id:row.trade_id,closed_trade_balance:balance+=row.net_pnl}))]
      return route.fulfill({json:{schema_version:'analytics-read-model-v1',analytics_available:true,provenance,ledger,portfolio_account:snapshot?{balance:2000,starting_balance:1000}:null,scope:{time_basis:'market',total_trade_count:ledger.length,selected_trade_count:ledger.length},metrics:{starting_balance:1000,ending_closed_trade_balance:balance,closed_trade_count:ledger.length,closed_trade_balance_curve:curve}}})
    })
    await page.route('**/api/v2/replay/sessions/calendar-controls-fixture/analytics/experiments*',route=>route.fulfill({status:422,json:{detail:'fixture_no_price_path'}}))
    await page.goto(href(provenance.session_id,lang))
    const cal=page.getByTestId('analytics-calendar');await cal.waitFor()
    const chart=page.locator('.fxa-profit-panel'),radios=cal.locator('.wm-calendar-capital input'),day=cal.locator('[data-date="2026-05-01"] .wm-calendar-result strong')
    await chart.locator('.fxa-x-tick text').first().waitFor()
    assert.equal(await chart.locator('.fxa-segmented button[aria-pressed=true]').textContent(),lang==='en'?'All':'Tất cả')
    const ticks=await chart.locator('.fxa-x-tick text').allTextContents();assert.ok(ticks.some(value=>/\d{2}\/\d{2}/.test(value)));assert.ok(ticks.every(value=>!value.includes(':')))
    assert.equal(await cal.locator('button.wm-calendar-day,[data-date][data-tooltip]').count(),0)
    const cell=cal.locator('[data-date="2026-05-01"]');const border=await cell.evaluate(el=>getComputedStyle(el).borderTopColor);await cell.hover();assert.equal(await cell.evaluate(el=>getComputedStyle(el).borderTopColor),border);assert.equal(await cell.evaluate(el=>getComputedStyle(el).cursor),'default');await cell.click();assert.equal(await cal.locator('.wm-calendar-detail').count(),0)
    assert.equal(await cal.locator('.wm-calendar-capital').isVisible(),true);assert.equal(await radios.count(),2)
    await radios.nth(1).check();assert.equal(await day.textContent(),'$200')
    await metric(cal,1);assert.equal(await day.textContent(),'10%');await radios.nth(0).check();assert.equal(await day.textContent(),'20%')
    assert.equal(await page.locator('.fxa-month-controls fieldset').nth(1).locator('button').count(),0)
    assert.equal(await page.locator('.fxa-month-controls fieldset').nth(0).locator('button.fxa-info').count(),2)
    await cal.locator('.wm-calendar-metric-toolbar .fx-select-trigger').click()
    const option=cal.getByRole('option').nth(2);assert.equal(await option.locator('svg').count(),1);assert.equal(await option.locator('button').count(),0)
    await option.scrollIntoViewIfNeeded();await option.hover();const tip=page.getByRole('tooltip');await tip.waitFor();assert.ok((await tip.textContent()).includes('N/A'));const bounds=await tip.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1)
    await page.keyboard.press('End');await tip.waitFor();assert.equal(await option.evaluate(el=>el===document.activeElement),true)
    await option.click();assert.equal(await day.textContent(),'2 R');await radios.nth(1).check();assert.equal(await day.textContent(),'2 R')
    await cal.scrollIntoViewIfNeeded()
    // Theme/hover transitions can still be finishing after the radios update.
    await cal.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))))
    const geometry=await cal.evaluate(el=>{
      const scroll=el.querySelector(':scope>.wm-calendar-scroll'),panel=el.closest('.fxa-panel'),tones=[...el.querySelectorAll('.wm-calendar-day.is-positive,.wm-calendar-day.is-negative')]
      return {horizontal:scroll.scrollWidth-scroll.clientWidth,vertical:scroll.scrollHeight-scroll.clientHeight,bottom:panel.getBoundingClientRect().bottom-1-scroll.getBoundingClientRect().bottom,tones:tones.map(day=>({border:getComputedStyle(day).borderTopColor,outline:getComputedStyle(day,'::after').borderTopColor,background:getComputedStyle(day).backgroundColor}))}
    })
    assert.equal(geometry.vertical,0);assert.ok(Math.abs(geometry.bottom)<.2);assert.equal(width===390?geometry.horizontal>0:geometry.horizontal===0,true);assert.ok(geometry.tones.every(tone=>tone.border===tone.outline),JSON.stringify({width,geometry}));assert.notEqual(geometry.tones[0].background,geometry.tones[1].background)
    await page.locator('.fxa-calendar-panel').screenshot({path:`${out}/calendar-${width}-${theme}-${lang}.png`})
    await cal.getByRole('button',{name:lang==='en'?'Year':'Năm',exact:true}).click();assert.equal(await cal.locator('.wm-calendar-mini-heading').count(),12);await cal.locator('.wm-calendar-mini-heading').nth(4).click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
    report.cases.push({width,theme,lang,allDefault:true,radioMoneyAndRInvariant:true,snapshotPercent:10,initialPercent:20,rHelp:true,geometry,year:true})
    snapshot=false;missingRisk=true
    await metric(cal,1)
    await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('side','buy');history.pushState({},'',url);dispatchEvent(new PopStateEvent('popstate'))})
    await page.waitForFunction(()=>document.querySelector('.wm-calendar-capital input[value=current]')?.disabled)
    await metric(cal,1);await radios.nth(0).check();assert.equal(await day.textContent(),'20%')
    await metric(cal,2);assert.equal(await day.textContent(),'N/A');report.cases.push({width,missingSnapshotUnavailable:true,initialPercentStillValid:true,missingRiskIsNA:true})
    await context.close()
  }
  // The owner's real, single-day report must use a date even though its only
  // observation has an intraday timestamp. This check does not use fixtures.
  const context=await browser.newContext({viewport:{width:1920,height:940}})
  await context.route('**/*',route=>{const q=route.request(),u=new URL(q.url());return u.origin===origin&&['GET','HEAD','OPTIONS'].includes(q.method())&&!/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname)?route.continue():route.abort()})
  page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto(href('6428cf18b3f54a36b2e90207ef12392e'));await page.getByTestId('analytics-calendar').waitFor()
  const texts=await page.locator('.fxa-profit-panel .fxa-x-tick text').allTextContents();assert.ok(texts.length>=2);assert.match([...texts,...await page.locator('.fxa-profit-panel .fxa-time-axis-context').allTextContents()].join(' '),/05\/05\/2003/);await page.locator('.fxa-profit-panel').screenshot({path:`${out}/real-single-day.png`})
  report.cases.push({realSession:true,singleDayAxis:texts});await context.close()
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS';console.log(`PASS ${report.cases.length} calendar controls journeys`)
}catch(error){report.status='FAIL';report.failure=error.stack;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error}
finally{await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close()}
