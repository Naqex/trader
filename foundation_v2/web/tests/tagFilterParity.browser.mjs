import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { brokerSnapshot, completedDealFills, fixtureConnection } from './liveJournal.fixture.mjs'

const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const report={scope:'Production UI, synthetic GET fixtures, no owner-data writes',cases:[],errors:[],writes:[]}
const browser=await chromium.launch()
let page
try {
 for(const [width,theme] of [[1440,'dark'],[768,'light'],[360,'dark']]) {
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-timezone','Asia/Ho_Chi_Minh')},theme)
  const broker=brokerSnapshot()
  let records=[]
  const raw=broker.deals.slice(0,3).map((row,i)=>({...row,time_msc:Date.parse(['2026-10-01T00:30:00Z','2026-10-02T22:15:00Z','2025-09-01T12:00:00Z'][i]),profit:[10,-5,20][i],commission:0}))
  broker.deals=completedDealFills(raw)
  broker.deals.push({...broker.deals[0],ticket:900,position_id:900,entry:0,commission:-5}, {...broker.deals[1],ticket:901,position_id:901,entry:1,profit:99})
  broker.positions=[{ticket:900,identifier:900,volume:.01}]
  const catalog={schema_version:'trade-labels-v1',groups:[],items:['Alpha','Beta','Unused'].map(id=>({id,name:id,color:'blue',revision:1})),assignments:[[1,['Alpha','Beta']],[2,['Beta']],[3,['Alpha']]].map(([id,tags])=>({session_id:`live:${fixtureConnection}`,trade_id:`position:${id}`,revision:1,tags}))}
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url()),json=body=>route.fulfill({json:body})
   if(url.origin!==origin)return route.abort()
   if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.writes.push(url.pathname);return route.abort()}
   if(!url.pathname.startsWith('/api/'))return route.continue()
   if(url.pathname==='/api/v2/live/status')return json(broker)
   if(url.pathname==='/api/v2/live/connections')return json({items:broker.connections})
   if(url.pathname==='/api/v2/live/records')return json({version:'live-records-v1',items:records})
   if(url.pathname==='/api/v2/live/note-folders')return json({version:'live-note-folders-v1',items:[]})
   if(url.pathname==='/api/v2/trade-labels')return json(catalog)
   return json({items:[],available:false})
  })
  page=await context.newPage();page.setDefaultTimeout(12000)
  page.on('pageerror',error=>report.errors.push(error.message))
  const base=`${origin}/?workspace=fixture&view=live&area=live&lang=vi&mt5_connection=${fixtureConnection}`
  await page.goto(base+'&section=notes')
  await page.locator('.live-note-group > button').click()
  const heading=page.locator('.live-note-group .fx-filter-title')
  const style=await heading.evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),weight:getComputedStyle(el).fontWeight,color:getComputedStyle(el).color}))
  assert(style.size<=13);assert.equal(style.weight,'500')
  await page.screenshot({path:`${out}/group-${width}-${theme}.png`});await page.keyboard.press('Escape')
  await page.goto(base+'&section=tag-analytics')
  const count=async n=>page.waitForFunction(n=>document.querySelector('.live-tag-grid-table tbody tr')?.cells[1]?.textContent===String(n),n)
  await count(3)
  const overall=page.locator('.live-tag-grid-table tbody tr').first()
  assert((await overall.locator('td').nth(3).innerText()).includes('25'))
  const basic=()=>page.locator('.fxa-filter-group > button').first().click()
  const advanced=()=>page.locator('.fxa-filter-group > button').nth(1).click()
  const drawer=page.locator('dialog.fxl-filter-drawer')
  const apply=()=>drawer.locator('footer .is-primary').click()
  await basic()
  assert.deepEqual(await drawer.locator('summary').allTextContents(),['Tài sản','Hướng lệnh','Kết quả','Khoảng ngày','Năm','Tháng','Thứ','Giờ trong ngày'])
  assert.equal(await drawer.locator('.fxl-clock-options').count(),0)
  await page.screenshot({path:`${out}/basic-${width}-${theme}.png`})
  // Selecting a year/hour/day uses the broker close time in Settings timezone.
  const select=async(title,option)=>{
   const detail=drawer.locator('details').filter({has:page.locator('summary').getByText(title,{exact:true})})
   await detail.locator('summary').click();await detail.locator('.fx-select-trigger').click()
   await detail.getByRole('option',{name:option,exact:true}).click();await page.keyboard.press('Escape')
  }
  await select('Năm','2026');await select('Thứ','T5');await select('Giờ trong ngày','07:00');await apply();await count(1)
  assert((await overall.locator('td').nth(3).innerText()).includes('10'))
  // A Settings change from another tab updates the applied scope without reload.
  const changeZone=zone=>page.evaluate(zone=>{localStorage.setItem('tw-timezone',zone);dispatchEvent(new StorageEvent('storage',{key:'tw-timezone',newValue:zone,storageArea:localStorage}))},zone)
  await changeZone('UTC');await count(0)
  await changeZone('Asia/Ho_Chi_Minh');await count(1)
  await basic();await drawer.locator('.fxl-clear').click();await apply();await count(3)
  await advanced()
  assert.equal(await drawer.getByRole('tab').nth(1).getAttribute('aria-selected'),'true')
  assert.equal(await drawer.locator('.fxl-tag-heading').count(),2)
  assert.equal(await drawer.locator('.fxl-tag-separator').innerText(),'AND')
  await page.screenshot({path:`${out}/advanced-${width}-${theme}.png`})
  const fields=drawer.locator('.fx-select')
  await fields.nth(0).locator('.fx-select-trigger').click()
  for(const name of ['Alpha','Beta'])await fields.nth(0).getByRole('option',{name,exact:true}).click()
  // Catalog options include labels with no assignments.
  assert.equal(await fields.nth(0).getByRole('option',{name:'Unused',exact:true}).count(),1)
  await page.keyboard.press('Escape');await apply();await count(1)
  await advanced();await drawer.locator('.fxl-tag-heading').first().getByRole('button',{name:'OR',exact:true}).click();await apply();await count(3)
  await advanced();await fields.nth(1).locator('.fx-select-trigger').click();await fields.nth(1).getByRole('option',{name:'Beta',exact:true}).click();await page.keyboard.press('Escape');await apply();await count(1)
  assert((await overall.locator('td').nth(3).innerText()).includes('20'))
  await advanced();await drawer.locator('.fxl-clear').click();await apply();await count(3)
  // Unknown money never produces a seemingly known report win rate or total.
  broker.deals[1].commission=null
  await page.reload();await count(3)
  assert.equal(await overall.locator('td').nth(2).innerText(),'-')
  assert.equal(await overall.locator('td').nth(3).innerText(),'-')
  // Malformed imported dates must not silently disappear from a plausible curve.
  records=[{record_id:'manual-a',kind:'account',payload:{name:'Manual fixture',currency:'USD',opening_balance:1000}},
   ...[5,100].map((gross_pnl,index)=>({record_id:`manual-${index}`,kind:'trade',payload:{account_id:'manual-a',symbol:'EURUSD',side:'BUY',quantity:1,entry_price:1,exit_price:2,gross_pnl,commission:0,swap:0,fee:0,tags:[],closed_at_utc:index ? null : '2026-10-01T00:30:00Z'}}))]
  await page.goto(base+'&section=tag-analytics&live_account=manual-a');await count(2)
  assert((await overall.locator('td').nth(3).innerText()).includes('105'))
  await page.locator('.live-tag-chart-card').getByText('Chưa có dữ liệu',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  report.cases.push({width,theme,groupTitle:style,basicSections:8,advancedAndOr:true,closedOnly:true,timezoneFilter:true,timezoneChange:true,unknownMoney:true,missingDatesKeepTotals:true})
  await context.close()
 }
 assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
