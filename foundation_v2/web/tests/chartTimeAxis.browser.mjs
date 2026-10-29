import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const origin=process.env.TW_UI_ORIGIN||'http://127.0.0.1:5191',out=process.env.TW_UI_EVIDENCE_DIR||fileURLToPath(new URL('../.artifacts/chartTimeAxis.browser', import.meta.url))
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.TW_UI_QA_CHROMIUM})
const report={scope:'Labeled raw-observation fixture; no broker calls or writes',cases:[],errors:[],writes:[]}
let page
try{
 for(const width of [1920,800,390]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(()=>localStorage.setItem('tw-timezone','UTC'))
  const session_id='time-axis-fixture',provenance={session_id,dataset_id:session_id,dataset_sha256:'fixture',revision:1,cursor_index:100,execution_event_sequence:1,account_currency:'USD'}
  const times=['2026-05-01T07:18:00Z','2026-05-02T07:18:00Z','2026-05-03T06:18:00Z','2026-05-03T07:03:00Z','2026-05-03T07:17:59.500Z','2026-05-03T07:18:00Z']
  const ledger=times.map((time,i)=>({trade_id:`fixture-${i}`,session_id,status:'closed',side:'buy',symbol:'EURUSD',quantity:1,net_pnl:100,planned_risk_budget:100,realized_r:1,starting_balance:1000,account_currency:'USD',open_time_utc:time,close_time_utc:time,report_time_utc:time}))
  const curve=[{sequence:0,closed_trade_balance:1000},...ledger.map((r,i)=>({sequence:i+1,trade_id:r.trade_id,closed_trade_balance:1100+i*100}))]
  await context.route('**/*',route=>{
   const q=route.request(),u=new URL(q.url())
   if(!['GET','HEAD','OPTIONS'].includes(q.method())){report.writes.push(u.pathname);return route.abort()}
   if(u.origin!==origin||/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname))return route.abort()
   if(u.pathname===`/api/v2/replay/sessions/${session_id}/analytics`)return route.fulfill({json:{schema_version:'analytics-read-model-v1',analytics_available:true,provenance,ledger,scope:{time_basis:'market',total_trade_count:6,selected_trade_count:6},metrics:{starting_balance:1000,ending_closed_trade_balance:1600,closed_trade_count:6,closed_trade_balance_curve:curve}}})
   if(u.pathname.includes('/analytics/experiments'))return route.fulfill({status:422,json:{detail:'fixture_no_price_path'}})
   return route.continue()
  })
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&session=${session_id}&lang=vi`)
  const panel=page.locator('.fxa-profit-panel'),chart=panel.locator('.fxa-line-viz'),svg=chart.locator(':scope>svg'),tabs=panel.locator('.fxa-segmented')
  await chart.locator('.fxa-viz-point').first().waitFor()
  const range=async()=>(await chart.getAttribute('data-chart-range')).split(':').map(Number)
  const ticksFit=async()=>{
   const boxes=await chart.locator('.fxa-time-axis .fxa-x-tick text').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right}}))
   assert.ok(boxes.length>=2);for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].left-boxes[i-1].right>=19)
  }
  assert.equal(await chart.getAttribute('data-time-preset'),'all');assert.deepEqual(await range(),[0,1]);assert.equal(await chart.locator('.fxa-viz-point').count(),7)
  const last=await chart.locator('.fxa-viz-point').last().getAttribute('aria-label');assert.match(last,/600/)
  for(const [name,duration,preset] of [['Ngày',86400000,'day'],['1 giờ',3600000,'hour'],['15 phút',900000,'quarter']]){
   await tabs.getByRole('button',{name,exact:true}).click();await page.waitForFunction(p=>document.querySelector('.fxa-profit-panel .fxa-line-viz')?.dataset.timePreset===p,preset)
   const [a,b]=await range();assert.ok(Math.abs((b-a)*172800000-duration)<.01);assert.equal(await chart.locator('.fxa-viz-point').last().getAttribute('aria-label'),last)
   await ticksFit();if(preset!=='day')assert.match(await chart.locator('.fxa-time-axis-context').textContent(),/2026/)
  }
  await chart.getByRole('button',{name:'Phóng to biểu đồ',exact:true}).click();assert.equal(await chart.getAttribute('data-time-preset'),'custom');assert.equal(await tabs.locator('[aria-pressed=true]').count(),0)
  await svg.focus();await page.keyboard.press('Home');assert.deepEqual(await range(),[0,1]);assert.equal(await chart.getAttribute('data-time-preset'),'all')
  await chart.getByRole('button',{name:'Phóng to biểu đồ',exact:true}).click()
  await chart.getByRole('button',{name:'Kéo biểu đồ',exact:true}).click()
  const before=await range(),box=await svg.boundingBox();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5,{steps:6});await page.mouse.up();assert.notDeepEqual(await range(),before)
  await svg.focus();await page.keyboard.press('Home');await chart.getByRole('button',{name:'Chọn vùng phóng to',exact:true}).click()
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5,{steps:6});await page.mouse.up();assert.equal(await chart.getAttribute('data-time-preset'),'custom');assert.ok((await range())[1]-(await range())[0]<.5)
  const zoom=chart.getByRole('button',{name:'Phóng to biểu đồ',exact:true});for(let i=0;i<25&&await zoom.isEnabled();i++)await zoom.click()
  assert.equal(await zoom.isDisabled(),true);assert.ok(Number(await chart.getAttribute('data-time-step'))<=1001);assert.ok((await chart.locator('.fxa-time-axis .fxa-x-tick text').allTextContents()).some(text=>/\.\d{3}/.test(text)));await ticksFit()
  await chart.screenshot({path:`${out}/seconds-${width}.png`})
  await svg.focus();await page.keyboard.press('Home');await tabs.getByRole('button',{name:'Tất cả',exact:true}).focus();await page.mouse.move(0,0);assert.equal(await chart.locator('.fxa-chart-tools').evaluate(el=>getComputedStyle(el).opacity),'1');await ticksFit()
  await chart.screenshot({path:`${out}/all-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  report.cases.push({width,rawCount:7,allDefault:true,viewPresets:true,pnlInvariant:true,panBrushHome:true,halfSecondTicks:true,noOverlap:true,alwaysToolbar:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS';console.log('PASS 3 responsive time-axis journeys')
}catch(error){report.status='FAIL';report.failure=error.stack;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error}
finally{await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close()}
