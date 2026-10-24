// Synthetic read-state regression for one shared Performance layout across source filters.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const origin=process.env.TESTING_UI_ORIGIN
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
const out=process.env.TW_UI_EVIDENCE_DIR;await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'synthetic source/filter/read-state UI; no broker',checks:[],errors:[],writes:[]}
try {
 for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width:1440,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','en')},theme)
  let mode='ready',lastSource
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==origin)return route.abort()
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push(url.pathname);return route.abort()}
   if(!url.pathname.startsWith('/api/'))return route.continue()
   const json=(body,status=200)=>route.fulfill({status,json:body})
   if(url.pathname==='/api/v2/overview') {
    lastSource=url.searchParams.get('dashboard_source')
    if(mode==='denied')return json({detail:'fixture_denied'},403)
    if(mode==='error')return json({detail:'fixture_unavailable'},503)
    const count=lastSource==='all'?3:lastSource==='prop'?2:1
    return json({performance:{schema_version:'dashboard-replay-performance-v1',status:'ready',scope:{session_count:mode==='empty'?0:1,readable_session_count:1},metrics:{closed_trade_count:count,win_rate_pct:50},time_invested_seconds:60,historical_time_replayed_seconds:120,months:[{month:'2026-10',win_rate_pct:50,closed_trade_count:count}],activity_months:[{month:'2026-10',time_invested_seconds:60}],symbols:[{symbol:'EURUSD',closed_trade_count:count}],sessions:[],sources:[],excluded:[]}})
   }
   if(url.pathname==='/api/v2/replay/sessions')return json({items:[]})
   if(url.pathname==='/api/v2/replay/sessions/page')return json({items:[]},503)
   return json({detail:'fixture_unavailable'},503)
  })
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.message))
  for(const source of ['all','prop','backtest']) {
   await page.goto(origin+'/?workspace=tenant-a&view=overview&area=testing&section=dashboard&dashboard_source='+source)
   // An empty recent catalog uses the welcome layout for Backtest. Performance remains testable for All/Prop.
   if(source==='backtest')continue
   const group=page.getByTestId('dashboard-result-group');await group.locator('.report-chart').first().waitFor()
   assert.equal(lastSource,source);assert.equal(await page.locator('.fx-dashboard-results').count(),1);assert.equal(await group.locator('.report-chart').count(),3)
   assert.equal(await page.getByTestId('prop-analytics').count(),0)
   mode='error';await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
   await page.waitForFunction(()=>document.querySelector('.fx-dashboard-results').textContent.includes('Data is not up to date.')||document.querySelector('.fx-dashboard-results [data-resource-state=stale]'))
   assert.equal(await group.locator('.report-chart').count(),3)
   await page.screenshot({path:out+'/stale-'+source+'-'+theme+'.png'})
   mode='denied';await page.reload();await page.waitForFunction(()=>document.querySelector('[data-testid=dashboard-result-group]')?.dataset.state==='denied')
   assert.equal(await group.locator('.report-chart').count(),0)
   mode='empty';await page.reload();await page.waitForFunction(()=>document.querySelector('[data-testid=dashboard-result-group]')?.dataset.state==='empty')
   assert.equal(await group.locator('.report-chart').count(),0)
   mode='ready';report.checks.push({source,theme,sameLayout:true,staleRetains:true,deniedClears:true,emptyKnown:true})
  }
  await context.unrouteAll({behavior:'ignoreErrors'});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
} catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1}
finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
