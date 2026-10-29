import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const origin=process.argv[2] || process.env.SESSIONS_ORIGIN || 'http://127.0.0.1:5197'
const out=process.argv[3] || process.env.SESSIONS_EVIDENCE || fileURLToPath(new URL('../.artifacts/sessionReference.browser', import.meta.url))
const session='6428cf18b3f54a36b2e90207ef12392e', api='http://127.0.0.1:8010'
const get=async path=>{const r=await fetch(api+path,{headers:{'X-Workspace-Id':'tenant-a'}});assert.equal(r.status,200);return r.json()}
const baseline=await get(`/api/v2/replay/sessions/${session}/analytics?timezone=Asia%2FHo_Chi_Minh&time_basis=market`)
const metadata=await get(`/api/v2/replay/sessions/${session}/metadata`)
await mkdir(out,{recursive:true})
const report={scope:'Sessions read-only runtime plus labeled browser response fixtures; no saved data mutations',cases:[],errors:[],writes:[]}
const browser=await chromium.launch({executablePath:process.env.TW_UI_QA_CHROMIUM})
function fixture(mode){
 const payload=structuredClone(baseline),record=structuredClone(metadata)
 const dates=['2024-01-01T01:00:00Z','2024-01-01T02:00:00Z','2024-01-08T01:00:00Z','2025-01-06T01:00:00Z','2025-03-03T01:00:00Z']
 const pnl=mode==='zero'?[0,0,0,0,0]:[10,20,-10,0,40]
 payload.ledger=mode==='empty'?[]:dates.map((date,i)=>({...baseline.ledger[0],trade_id:`fixture-${i}`,close_time_utc:date,net_pnl:pnl[i],gross_pnl:pnl[i],fees:0}))
 const m=payload.metrics,total=payload.ledger.reduce((a,t)=>a+t.net_pnl,0),count=payload.ledger.length
 Object.assign(m,{net_pnl:total,closed_trade_count:count,wins:mode==='zero'||!count?0:3,losses:mode==='zero'||!count?0:1,breakeven:mode==='zero'?count:count?1:0,win_rate_pct:count?mode==='zero'?0:60:null,payoff_ratio_after_cost:count&&mode!=='zero'?7/3:null,starting_balance:100000,ending_closed_trade_balance:100000+total})
 payload.scope.selected_trade_count=payload.scope.total_trade_count=count
 payload.scope.time_basis='market'
 let balance=100000
 payload.equity_curve={...baseline.equity_curve,points:[{time_utc:'2024-01-01T00:59:00Z',equity:balance,balance,segment:0},...payload.ledger.map(t=>({time_utc:t.close_time_utc,equity:balance+=t.net_pnl,balance,segment:0}))]}
 record.portfolio_account={...record.portfolio_account,starting_balance:'100000',balance:String(100000+total)}
 if(mode==='unknown')payload.ledger[0].close_time_utc=null
 if(mode==='partial')payload.partial=true
 return {payload,record}
}
try{
 for(const [width,lang,theme,mode] of [[1920,'vi','dark','fixture'],[1366,'en','light','fixture'],[390,'vi','light','fixture'],[320,'en','dark','fixture'],[1920,'vi','dark','zero'],[390,'en','light','empty'],[1920,'en','light','unknown'],[390,'vi','dark','partial'],[1920,'vi','dark','denied'],[390,'en','light','error'],[1920,'vi','dark','actual'],[390,'en','light','actual']]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce',hasTouch:width<=390})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-timezone','Asia/Ho_Chi_Minh')},theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  const data=fixture(mode)
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url())
   if(!['GET','HEAD'].includes(request.method())){report.writes.push(url.pathname);return route.abort()}
   if(url.origin!==origin||/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(url.pathname))return route.abort()
   if(mode!=='actual'&&url.pathname===`/api/v2/replay/sessions/${session}/analytics`){
    if(['denied','error'].includes(mode))return route.fulfill({status:mode==='denied'?403:503,json:{detail:'reference_qa_fixture'}})
    return route.fulfill({json:data.payload})
   }
   if(mode!=='actual'&&url.pathname===`/api/v2/replay/sessions/${session}/metadata`)return route.fulfill({json:data.record})
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=replay&lang=${lang}&area=testing&section=sessions&select=1&session=${session}`)
  const name=`${width}-${lang}-${theme}-${mode}`
  if(['denied','error'].includes(mode)){
   await page.getByRole('alert').waitFor()
   assert.equal(await page.getByTestId('session-performance').count(),0)
  }else{
   const performance=page.getByTestId('session-performance');await performance.waitFor()
   const values=performance.locator('.fxs-metric > strong')
   assert.equal(await values.count(),6)
   const expected=mode==='actual'?null:mode==='zero'?[0,0,0]:['unknown','empty'].includes(mode)?['-','-','-']:[20,15,15]
   const money=n=>new Intl.NumberFormat(lang==='vi'?'vi-VN':'en-US',{maximumFractionDigits:2}).format(n)
   for(let i=0;i<3;i++){
    const label=await performance.locator('.fxs-metric').nth(3+i).locator('span').innerText()
    assert.ok(label.includes(lang==='vi'?'PnL TB/':'Avg.'),label)
    if(expected)assert.ok((await values.nth(3+i).innerText()).includes(String(expected[i]==='-'?'-':money(expected[i]))))
   }
   assert.equal(await performance.locator('.fxs-metrics .wm-report-info').count(),6)
   if(mode==='fixture'){
    assert.equal(await performance.locator('.fxs-charts .wm-report-info').count(),2)
    // Focus, click/tap, Escape and accessible description all use the shared tooltip layer.
    const infos=await performance.locator('.wm-report-info').all()
    for(const [index,info] of infos.entries()){
     report.currentHint={case:name,index,label:await info.getAttribute('aria-label')}
     await page.mouse.move(0,0);await info.scrollIntoViewIfNeeded()
     await info.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
     await info.focus()
     await page.getByRole('tooltip').waitFor()
     assert.ok(await info.getAttribute('aria-describedby'))
     const text=await page.getByRole('tooltip').innerText()
     assert.ok(text.length>40)
     if(lang==='en')assert.doesNotMatch(text,/[àáạảãâầấậẩẫăằắặẳẵđèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹ]/i)
     await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'hidden'})
     await info.click();await page.getByRole('tooltip').waitFor()
     const bounds=await page.getByRole('tooltip').boundingBox()
     assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1)
     if(info===infos.at(-1))await page.screenshot({path:`${out}/${name}-tooltip.png`})
     await page.keyboard.press('Escape')
    }
   }
   if(mode==='partial')await page.getByRole('status').filter({hasText:lang==='vi'?'Dữ liệu một phần.':'Partial data.'}).waitFor()
   if(mode==='actual'){
    const total=baseline.ledger.reduce((sum,t)=>sum+t.net_pnl,0)
    assert.ok((await values.first().innerText()).includes(money(total)))
    assert.equal(await performance.locator('tbody tr').count(),Math.min(5,baseline.ledger.length))
   }
   await performance.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${name}.png`})
   await page.getByRole('button',{name:lang==='vi'?'Cài đặt phiên':'Session settings',exact:true}).click()
   await page.getByRole('tab',{name:lang==='vi'?'Số dư và tài sản':'Balance and assets',exact:true}).click()
   const initial=page.getByLabel(lang==='vi'?'Số dư ban đầu':'Initial balance',{exact:true}),current=page.getByLabel(lang==='vi'?'Số dư hiện tại':'Current balance',{exact:true})
   await initial.waitFor();assert.ok((await initial.inputValue()).includes(money(100000)))
   const balance=mode==='actual'?Number(metadata.portfolio_account.balance):mode==='empty'||mode==='zero'?100000:100060
   await page.waitForFunction(({label,amount})=>[...document.querySelectorAll('label')].find(e=>e.textContent.trim()===label)?.querySelector('input')?.value.includes(amount),{label:lang==='vi'?'Số dư hiện tại':'Current balance',amount:money(balance)})
   assert.equal(await initial.getAttribute('readonly'),'')
   assert.equal(await current.getAttribute('readonly'),'')
   if(mode==='actual')await page.screenshot({path:`${out}/${name}-balances.png`})
   await page.getByRole('tab',{name:lang==='vi'?'Khoảng ngày':'Date range',exact:true}).click()
   await page.getByLabel(lang==='vi'?'Ngày bắt đầu dữ liệu':'Dataset start',{exact:true}).waitFor()
   await page.getByLabel(lang==='vi'?'Ngày kết thúc dữ liệu':'Dataset end',{exact:true}).waitFor()
   await page.getByLabel(lang==='vi'?'Thời điểm replay':'Replay position',{exact:true}).waitFor()
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.ok(await page.locator('.fx-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),940,'shell remains the only vertical scroll owner')
  report.cases.push({width,lang,theme,mode,status:'PASS'});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;const p=browser.contexts().at(-1)?.pages().at(-1);if(p){await p.screenshot({path:`${out}/failure.png`});await writeFile(`${out}/failure-dom.txt`,await p.locator('body').innerText())}}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
