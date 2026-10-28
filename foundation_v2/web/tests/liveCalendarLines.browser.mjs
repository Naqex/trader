import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const origin=process.env.TW_UI_ORIGIN||'http://127.0.0.1:5180',out=process.env.TW_UI_EVIDENCE_DIR||'E:/BACKUP-TRADINGWORKSPACE/palette-calendar-20261028/calendar'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.TW_UI_QA_CHROMIUM||'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const report={scope:'Live calendar GET fixtures; external/broker access and writes blocked',cases:[],errors:[],writes:[]}
let page
try{
 for(const [width,theme] of [[1920,'dark'],[1920,'light'],[1240,'dark'],[1241,'dark'],[768,'dark'],[390,'dark'],[390,'light']]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-timezone','UTC')},theme)
  await context.route('**/*',route=>{
   const q=route.request(),u=new URL(q.url())
   if(!['GET','HEAD','OPTIONS'].includes(q.method())){report.writes.push(u.pathname);return route.abort()}
   if(u.origin!==origin)return route.abort()
   if(u.pathname==='/api/v2/live/status')return route.fulfill({json:{status:'ready',connection_id:'calendar-fixture',connections:[{id:'calendar-fixture',name:'Calendar fixture',status:'connected',account:{currency:'USD'}}],account:{account_ref:'calendar-fixture',currency:'USD',balance:1000,opening_balance:1000},history_from_utc:'2026-01-01T00:00:00Z',captured_at_utc:'2026-10-31T23:00:00Z',deals:[['2026-10-12',25],['2026-10-13',-10],['2026-10-14',5],['2026-10-31',-5]].map(([date,profit],i)=>({ticket:i+1,symbol:'EURUSD',type:0,time_msc:Date.parse(date+'T12:00:00Z'),profit,commission:0,swap:0,fee:0}))}})
   if(u.pathname==='/api/v2/live/records')return route.fulfill({json:{version:'live-records-v1',items:[]}})
   if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{detail:'fixture_unavailable'}})
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=calendar&lang=vi`)
  const day=page.locator('.live-calendar-cell[data-date="2026-10-15"]'),grid=page.locator('.live-calendar-grid'),footer=page.locator('.live-month-total')
  await day.waitFor();await page.locator('.live-calendar-cell.is-gain').first().waitFor()
  const measure=()=>grid.locator('.live-calendar-week').evaluateAll(weeks=>weeks.map(week=>[...week.children].map(el=>{const b=el.getBoundingClientRect();return {date:el.dataset.date,top:b.top,bottom:b.bottom,height:b.height,opacity:getComputedStyle(el).opacity}})))
  const assertRows=async()=>{const rows=await measure();for(const row of rows){assert.equal(row.length,8);assert.ok(Math.max(...row.map(c=>c.top))-Math.min(...row.map(c=>c.top))<.1);assert.ok(Math.max(...row.map(c=>c.bottom))-Math.min(...row.map(c=>c.bottom))<.1,JSON.stringify(row));assert.ok(row.every(c=>c.opacity==='1'))}return rows.length}
  assert.equal(await assertRows(),5)
  const rest=await day.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor,height:el.getBoundingClientRect().height}))
  await day.hover();const hover=await day.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor,height:el.getBoundingClientRect().height,edge:getComputedStyle(el,'::after').opacity,add:getComputedStyle(el.querySelector('.wm-calendar-add')).opacity}))
  assert.notEqual(hover.bg,rest.bg);assert.equal(hover.border,rest.border);assert.equal(hover.height,rest.height);assert.equal(hover.edge,'1');assert.equal(hover.add,'1')
  const stateEdges=await page.locator('.live-calendar-cell.is-gain').first().evaluate(el=>{const s=getComputedStyle(el);return {top:s.borderTopColor,left:s.borderLeftColor,pseudo:getComputedStyle(el,'::after').content}})
  assert.deepEqual(stateEdges,{top:theme==='dark'?'rgb(32, 212, 147)':'rgb(8, 125, 80)',left:theme==='dark'?'rgb(32, 212, 147)':'rgb(8, 125, 80)',pseudo:'none'})
  assert.equal(await grid.locator('.live-week-total').first().locator('strong').textContent(),'$0')
  assert.equal(await grid.locator('.live-week-total').first().locator('span').first().textContent(),'0 giao dịch')
  const sideHeading=page.locator('.live-analytics-side > h2'), sideIcon=sideHeading.locator('svg')
  assert.equal(await sideHeading.evaluate(el=>getComputedStyle(el).alignItems),'center')
  const headingBox=await sideHeading.boundingBox(), iconBox=await sideIcon.boundingBox()
  const alignment=Math.abs((headingBox.y+headingBox.height/2)-(iconBox.y+iconBox.height/2))
  assert.ok(alignment<1,`icon center drift ${alignment}`)
  await day.screenshot({path:`${out}/hover-${width}-${theme}.png`})
  const outside=page.locator('.live-calendar-cell[data-date="2026-11-01"]')
  assert.equal(await outside.isDisabled(),true);assert.equal(await outside.evaluate(el=>getComputedStyle(el).opacity),'1')
  assert.equal(await outside.evaluate(el=>getComputedStyle(el).borderTopColor),rest.border)
  const border=await footer.evaluate(el=>{const s=getComputedStyle(el);return {widths:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],colors:[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor],radius:s.borderRadius}})
  assert.deepEqual(border.widths,['1px','1px','1px','1px']);assert.ok(border.colors.every(c=>c==='rgb(255, 154, 31)'));assert.equal(border.radius,'0px')
  const edges=await grid.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,footer:el.closest('.live-calendar-content').querySelector('.live-month-total').getBoundingClientRect().top}))
  assert.ok(Math.abs(edges.bottom-edges.footer)<1,JSON.stringify(edges))
  for(const date of ['2026-10-12','2026-10-13','2026-10-31']){
   const cell=page.locator(`[data-date="${date}"]`);await cell.hover()
   assert.equal(await cell.evaluate(el=>getComputedStyle(el,'::after').opacity),'1')
   assert.equal(await cell.evaluate(el=>getComputedStyle(el).borderTopWidth),'1px')
  }
  await grid.evaluate(el=>el.closest('.live-calendar-scroll').scrollLeft=10000)
  await page.locator('.live-week-total').last().hover();await page.locator('.live-calendar-scroll').screenshot({path:`${out}/seams-${width}-${theme}.png`})
  await day.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
  assert.equal(await day.evaluate(el=>getComputedStyle(el).outlineWidth),'2px')
  await day.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await day.evaluate(el=>document.activeElement===el),true)
  await page.mouse.move(0,0);await page.screenshot({path:`${out}/grid-${width}-${theme}.png`})
  if(width===1920&&theme==='dark'){
   await page.getByRole('button',{name:'Tháng trước',exact:true}).click();await page.getByRole('button',{name:'Tháng trước',exact:true}).click();assert.equal(await assertRows(),6)
   await grid.screenshot({path:`${out}/six-weeks.png`})
   for(let i=0;i<6;i++)await page.getByRole('button',{name:'Tháng sau',exact:true}).click()
   assert.equal(await assertRows(),4);await grid.screenshot({path:`${out}/four-weeks.png`})
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  report.cases.push({width,theme,rowsStretch:true,outsideBorder:true,monthBorder:true,hover,focus:true,drawer:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw e}
finally{await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close();console.log(`${report.status} ${report.cases.length} calendar geometry/hover journeys`)}
