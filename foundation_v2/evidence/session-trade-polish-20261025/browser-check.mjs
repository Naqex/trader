import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {displayDate} from '../../web/src/dateFormat.js'
import {formatAmount} from '../../web/src/moneyFormat.js'
const require=createRequire(new URL('../../web/package.json',import.meta.url))
const {chromium}=require('playwright')
const origin=process.env.UI_ORIGIN||'http://127.0.0.1:5180',stage=process.env.UI_STAGE||'candidate'
const out='E:/BACKUP-TRADINGWORKSPACE/session-trade-polish-20261025/'+stage
await mkdir(out,{recursive:true})
const report={checks:[],errors:[],writes:[]},browser=await chromium.launch()
const session='6428cf18b3f54a36b2e90207ef12392e'
try{
 for(const [width,theme,zone,demo,lang] of [[1920,'dark','UTC',false,'vi'],[1920,'light','Asia/Ho_Chi_Minh',false,'vi'],[390,'dark','Asia/Ho_Chi_Minh',true,'vi'],[1440,'light','UTC',true,'en']]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(({theme,zone,lang})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang);localStorage.setItem('tw-timezone',zone)},{theme,zone,lang})
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||/\/api\/v2\/(mt5|live)/.test(u.pathname))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}return route.continue()})
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message))
  const url=(view,section)=>`${origin}/?workspace=tenant-a&lang=${lang}&view=${view}&area=testing&section=${section}&select=1${demo?'&demo=1':`&session=${session}`}`
  await page.goto(url('replay','sessions'))
  const card=page.locator('.fxr-session-summary-card'),trigger=page.locator('.fxr-session-control .fx-select-trigger')
  await card.waitFor()
  await page.waitForFunction(()=>document.querySelector('.fxs-session-range')?.textContent.match(/\d{2}\/\d{2}\/\d{4}/))
  const dates=(await page.locator('.fxs-session-range').innerText()).match(/\d{2}\/\d{2}\/\d{4}/g)
  assert.equal(dates.length,2)
  await page.waitForFunction(dates=>dates.every(date=>document.querySelector('.fxr-session-control .fx-select-trigger')?.textContent.includes(date)),dates)
  assert.equal(await page.getByRole('button',{name:lang==='vi'?'Tạo bản sao':'Duplicate',exact:true}).count(),0)
  assert.ok(!(await trigger.innerText()).includes('Ngày tạo'))
  const size=await card.locator('.session-title-text').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))
  assert.ok(size>=30,`title size ${size}`)
  const titleBox=await card.locator('.session-title-text').boundingBox(),badge=await card.locator('.session-kind-badge').boundingBox()
  assert.ok(badge.x>=0&&badge.x+badge.width<=width)
  if(width>=1440)assert.ok(Math.abs((titleBox.y+titleBox.height/2)-(badge.y+badge.height/2))<2)
  await page.getByTestId('session-performance').waitFor()
  if(await page.locator('.fxs-metric').count())assert.ok((await page.locator('.fxs-metrics').innerText()).includes(lang==='vi'?'Tỉ số lãi/lỗ trung bình':'Average win/loss ratio'))
  await page.screenshot({path:`${out}/sessions-${width}-${theme}-${lang}.png`})
  report.checks.push({screen:'sessions',width,theme,zone,demo,lang,dates,titleSize:size})

  const responsePromise=demo?null:page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v2/replay/trades'&&r.ok())
  await page.goto(url('trade','trades')+'&sessions=all')
  const ledger=page.getByTestId('fx-trade-ledger')
  await ledger.locator('tbody tr .fxa-badge.is-order-type').first().waitFor()
  if(responsePromise){
   const payload=await (await responsePromise).json(),row=payload.ledger[0],cells=ledger.locator('tbody tr').first().locator('td')
   for(const [index,key] of [[5,'recorded_at_utc'],[6,'open_time_utc'],[18,'report_time_utc'],[19,'close_time_utc']])assert.equal(await cells.nth(index).innerText(),displayDate(row[key],{timeStyle:'medium',timeZone:zone}),key)
   assert.ok((await cells.nth(10).innerText()).includes(formatAmount(row.net_pnl,` ${row.account_currency}`,2)))
   const pct=row.starting_balance>0&&row.net_pnl!=null?row.net_pnl/row.starting_balance*100:null
   assert.equal(await cells.nth(11).innerText(),formatAmount(pct,'%',2))
   assert.equal(await cells.nth(12).innerText(),formatAmount(row.realized_r,' R',2))
  }
  const headers=await ledger.locator('thead th').allTextContents()
  assert.ok(headers.includes(lang==='vi'?'Lợi nhuận (%)':'Return (%)'))
  assert.ok(headers.includes(lang==='vi'?'Lợi nhuận (R)':'Return (R)'))
  assert.ok(headers.some(h=>h===(lang==='vi'?'Lợi nhuận':'Return')||h===(lang==='vi'?'Lợi nhuận ($)':'Return ($)')))
  const clocks=await ledger.locator('.wm-time-heading').allTextContents()
  assert.deepEqual(clocks,lang==='vi'?['Vào lệnhThực tế','Vào lệnhChart','Thoát lệnhThực tế','Thoát lệnhChart']:['EntryRealtime','EntryChart','ExitRealtime','ExitChart'])
  assert.ok(headers.every(h=>!h.includes('UTC')))
  assert.equal(await ledger.locator('.wm-ledger-timezone').textContent(),`${lang==='vi'?'Múi giờ':'Timezone'}: ${zone.replaceAll('_',' ')}`)
  const type=ledger.locator('.fxa-badge.is-order-type').first()
  assert.equal(await type.innerText(),'market')
  assert.notEqual(await type.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  const label=ledger.locator('.wm-label-cell').first();await label.hover()
  assert.equal(await label.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  // Local UI-only popup, never save labels to the API.
  if(!demo){await label.click();await page.locator('.wm-label-popup').waitFor();await page.keyboard.press('Escape')}
  await ledger.locator('th .wm-table-sort').filter({hasText:lang==='vi'?'Lợi nhuận (%)':'Return (%)'}).click()
  await page.waitForFunction(()=>document.querySelector('th[aria-sort="ascending"]')!==null)
  await ledger.locator('.fxa-table-scroll').evaluate(el=>{el.scrollLeft=700})
  await page.screenshot({path:`${out}/trades-${width}-${theme}-${lang}.png`})
  report.checks.push({screen:'trades',width,theme,zone,demo,lang,headers,clocks})

  await page.goto(url('overview','dashboard')+'&dashboard_source=all')
  const chart=page.locator('.fx-dashboard-performance-layout > .report-chart')
  await chart.locator('.report-bar').first().waitFor()
  const hit=chart.locator('.report-bar .report-hit').first();await hit.scrollIntoViewIfNeeded();await hit.hover()
  const detail=await chart.locator('.report-bar').first().getAttribute('data-tooltip')
  assert.ok(!/\d[,.]\d+ (giờ|hour)/.test(detail),detail)
  assert.ok(lang==='vi'?/\d+ (giờ|phút)/.test(detail):/\d+ (hr|min)/.test(detail),detail)
  await page.waitForFunction(detail=>document.querySelector('[role="tooltip"]')?.textContent===detail,detail)
  await chart.screenshot({path:`${out}/duration-${width}-${theme}-${lang}.png`})
  report.checks.push({screen:'duration',width,theme,zone,demo,lang,detail})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;process.exitCode=1}
finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2))}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,writes:report.writes,failure:report.failure}))
