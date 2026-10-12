import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {readJournalContext,enrichJournalTags} from '../../../web/src/journalContext.js'
import {filterAnalyticsRows,DEFAULT_EXTRA_FILTERS} from '../../../web/src/tradingAnalyticsModel.js'
import {sessionNavigationHref,reportSessions} from '../../../web/src/sessionCatalog.js'
const fixtures=JSON.parse(await readFile(new URL('./fixtures.json',import.meta.url))),copy=JSON.parse(await readFile(new URL('../../../web/src/testing-copy.json',import.meta.url))),t=k=>copy[k]?.vi||k
const legacy=readJournalContext({schema_version:'replay-journal-context-v1',workspace_id:'a',session_id:'s',record_count:1,trades:[{trade_id:'t',record_count:1,tags:['tag-only']}]},'a','s')
const unknown=enrichJournalTags([{tradeId:'t',trade_id:'t'}],legacy)
assert.equal(unknown[0].has_notes,null)
for(const v of['with','without'])assert.equal(filterAnalyticsRows(unknown,{...DEFAULT_EXTRA_FILTERS,notesPresence:JSON.stringify([v])}).length,0)
const realLink=new URL(sessionNavigationHref('trade','tenant-a',new URLSearchParams('sessions=all&cursor=3'),fixtures.catalog.items[0]),'http://127.0.0.1:5180')
assert.deepEqual(reportSessions(realLink.searchParams),['replay-fixture']);assert.equal(realLink.searchParams.has('cursor'),false)
const out=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:'),browser=await chromium.launch({headless:true}),report={cases:['unknown legacy note excludes With and Without','real session link excludes inherited sessions=all/cursor'],blocked:[],errors:[],scope:'Real components over isolated backend read-model fixtures; no backend dispatch'}
let mode='ready',requests=[]
try{
const context=await browser.newContext({viewport:{width:1440,height:987},reducedMotion:'reduce'})
await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
await context.route('**/*',route=>{
 const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'||u.origin!=='http://127.0.0.1:5180'){report.blocked.push(r.method()+' '+r.url());return route.abort()}
 if(!u.pathname.startsWith('/api/'))return route.continue()
 requests.push(u.pathname+u.search)
 if(u.pathname==='/api/v2/live/status')return route.fulfill({status:404,json:{detail:'unavailable'}})
 if(u.pathname==='/api/v2/replay/sessions')return route.fulfill({json:fixtures.catalog})
 if(u.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[]}})
 if(u.pathname.endsWith('/metadata'))return route.fulfill({json:fixtures.record})
 if(u.pathname==='/api/v2/replay/trades'){
  if(mode==='error')return route.fulfill({status:503,json:{detail:'review_read_failure'}})
  const data=structuredClone(mode==='empty'?fixtures.empty:fixtures.full)
  if(mode==='partial'){data.status='partial';data.excluded=[{session_id:'other-session',reason:'review_partial'}]}
  return route.fulfill({json:data})
 }
 if(u.pathname.endsWith('/analytics'))return route.fulfill({json:fixtures.analytics})
 if(u.pathname==='/api/v2/journal/context')return route.fulfill({json:{schema_version:'replay-journal-context-v1',workspace_id:'tenant-a',session_id:'replay-fixture',record_count:0,trades:[]}})
 return route.fulfill({json:{items:[],available:false}})
})
const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(String(e)))
const trade='http://127.0.0.1:5180/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&session=replay-fixture'
await page.goto(trade+'&analytics_weekday=0&analytics_days=%5B%220%22%5D');await page.locator('tbody tr').first().waitFor();assert.equal(await page.locator('tbody tr').count(),2)
const rp=requests.find(v=>v.startsWith('/api/v2/replay/trades'));const extra=JSON.parse(new URL('http://local'+rp).searchParams.get('extra_filters'));assert.equal(extra.weekday,'all');assert.equal(extra.days,'')
assert.equal(await page.locator('.fxa-filter-actions .wm-resource-status-slot').count(),0);report.cases.push('real aggregate ready2rows, legacy weekday/days normalized')
mode='empty';await page.goto(trade);await page.getByTestId('testing-trades-empty').waitFor();assert.equal(await page.locator('tbody tr').count(),0);report.cases.push('real empty scope renders grouped empty without ledger rows')
mode='error';await page.goto(trade);await page.getByText(/review_read_failure/).waitFor();assert.equal(await page.locator('tbody tr').count(),0);report.cases.push('real error remains visibly explained after toolbar removal')
mode='ready';await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=replay&area=testing&section=sessions&select=1&session=replay-fixture&sessions=all');await page.getByTestId('session-performance').waitFor()
const chart=page.locator('.fxs-go-chart').first();await chart.hover();assert.equal(await chart.evaluate(e=>getComputedStyle(e).textDecorationLine),'none')
const row=page.locator('.fxs-recent tbody a').first(),rowHref=new URL(await row.getAttribute('href'),'http://127.0.0.1:5180');assert.equal(rowHref.searchParams.get('view'),'trade');assert.deepEqual(reportSessions(rowHref.searchParams),['replay-fixture']);assert.ok(rowHref.searchParams.get('trade'))
await row.click();await page.getByTestId('analytics-workspace').waitFor();await page.locator('tbody tr').first().waitFor();assert.equal(await page.locator('tbody tr').count(),2);report.cases.push('real session RecentTrades row→selectedTrade route + chart hover no underline')
await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=live&area=live&section=trades');await page.getByTestId('live-workspace').waitFor();await page.locator('.live-filters').waitFor();assert.equal(await page.getByTestId('live-status').count(),0);assert.equal(await page.locator('.live-retry').count(),0);report.cases.push('Live unavailable404 has no yellow status banner/retry, retains empty surfaces')
assert.deepEqual(report.errors,[]);report.result='PASS';await context.close()
}catch(e){report.result='FAIL';report.failure=String(e.stack);console.error(e)}finally{await browser.close();await writeFile(out+'/real.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.result==='FAIL')process.exitCode=1}
