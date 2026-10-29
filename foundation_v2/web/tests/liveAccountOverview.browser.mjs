// Isolated synthetic GET-only fixtures. Never reaches a terminal or broker.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const [origin,output]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
await mkdir(output,{recursive:true})
const report={cases:[],errors:[],mutations:[],scope:'Synthetic accounts and history; no broker'},browser=await chromium.launch()
const accounts={a:{login:111,server:'FIXTURE',account_ref:'…111',currency:'USD',balance:10000,equity:10024,profit:24,margin:100,margin_free:9924},b:{login:222,server:'FIXTURE',account_ref:'…222',currency:'EUR',balance:20000,equity:20000,profit:0,margin:0,margin_free:20000}}
const rows=Array.from({length:7},(_,i)=>({ticket:i+1,type:i%2,entry:1,symbol:'EURUSD',volume:.1,time_msc:Date.UTC(2026,9,20,i),profit:10,commission:-1,swap:0,fee:0}))
const snapshot=(id)=>({status:'ready',mode:'demo',summary:true,connection_id:id,account:accounts[id],symbol:'EURUSD',timeframe:'M1',bars:[],positions:[],orders:[],requests:[],capabilities:{}})
const url=(extra='')=>`${origin}/?workspace=fixture&view=live&area=live&section=terminal&lang=vi${extra}`
async function setup(scenario='ready',width=1440,theme='dark'){
 let catalogReads=0,tradingReads=0
 const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 await context.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()),id=path.searchParams.get('connection_id')||'a'
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.mutations.push(req.url());return route.abort()}
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  if(path.pathname==='/api/v2/live/connections'){
   catalogReads++
   if(scenario==='catalog-error')return json({detail:'fixture_unavailable'},503)
   const order=scenario==='reordered'&&catalogReads>1?['b','a']:Object.keys(accounts)
   return json({items:scenario==='empty'?[]:order.map(id=>({id,name:scenario==='long-name'?'Account'.repeat(20):id==='a'?'Alpha':'Beta',server:'FIXTURE',login_hint:accounts[id].account_ref,status:scenario==='disconnected'||scenario==='reordered'&&catalogReads>1&&id==='a'?'disconnected':'connected',requested_mode:'trading',verified_permissions:scenario==='unknown'?{}:{read:true,trade:true}}))})
  }
  if(path.pathname==='/api/v2/live/trading'){
   tradingReads++
   if(scenario==='summary-error'&&tradingReads>1)return json({detail:'fixture_unavailable'},503)
   return json(scenario==='empty'||!accounts[id]?{status:'unavailable',mode:'demo',bars:[],positions:[],orders:[]}:snapshot(id))
  }
  if(path.pathname==='/api/v2/live/status'){
   if(scenario==='history-error')return json({detail:'fixture_unavailable'},503)
   return json({status:'ready',connection_id:scenario==='wrong-binding'?'b':id,account:accounts[id],history_from_utc:'2026-10-01T00:00:00Z',captured_at_utc:'2026-10-24T00:00:00Z',stale:scenario==='disconnected',deals:scenario==='no-deals'?[]:id==='b'?[]:rows.map(row=>scenario==='partial'?{...row,commission:null}:row)})
  }
  return json({items:[],available:false})
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
 return {context,page}
}
try{
 for(const width of [1440,390])for(const theme of ['dark','light']){
  const {context,page}=await setup('ready',width,theme);await page.goto(url())
  await page.getByTestId('mt5-account-balance').getByText('$10.000',{exact:true}).waitFor()
  const picker=page.getByRole('button',{name:'Chọn tài khoản MT5',exact:true})
  await picker.click();await page.getByRole('searchbox').fill('Beta')
  await page.getByRole('option',{name:/Beta/}).click()
  await page.getByTestId('mt5-account-balance').getByText('20.000 EUR',{exact:true}).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('mt5_connection'),'b')
  assert.equal(new URL(page.url()).searchParams.get('live_account'),'broker:b')
  assert.equal(await page.locator('.mt5-report').getByText('$63',{exact:true}).count(),0)
  await page.reload();await page.getByTestId('mt5-account-balance').getByText('20.000 EUR',{exact:true}).waitFor()
  await picker.click();await page.getByRole('searchbox').fill('Alpha');await page.getByRole('option',{name:/Alpha/}).click()
  await page.locator('.mt5-report .fxs-metric').first().getByText('$63',{exact:true}).waitFor()
  assert.equal(await page.locator('.mt5-report tbody tr').count(),5)
  await page.getByRole('button',{name:'Trang sau',exact:true}).click();assert.equal(await page.locator('.mt5-report tbody tr').count(),2)
  await page.getByRole('button',{name:'Trang trước',exact:true}).click()
  const region=page.locator('.mt5-report .fxs-recent'),row=region.locator('tbody tr').first()
  const colors=()=>row.evaluate(node=>({row:getComputedStyle(node).backgroundColor,cells:[...node.cells].map(cell=>getComputedStyle(cell).backgroundColor)}))
  await page.mouse.move(0,0);const bg=await colors();await row.hover();const hover=await colors()
  assert.equal(hover.row,bg.row);assert(hover.cells.every(color=>color===hover.cells[0]));assert.notEqual(hover.cells[0],bg.cells[0],'Recent executions use the shared neutral cell hover')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`${output}/report-${width}-${theme}.png`,fullPage:true})
  await page.locator('.fxr-session-toolbar').scrollIntoViewIfNeeded()
  await page.screenshot({path:`${output}/overview-${width}-${theme}.png`,fullPage:true})
  await page.getByRole('button',{name:'Mở biểu đồ',exact:true}).click()
  const chart=new URL(page.url());assert.equal(chart.searchParams.get('surface'),'workspace');assert.equal(chart.searchParams.get('mt5_connection'),'a')
  report.cases.push({width,theme,searchSwitchReload:true,noPreviousCurrency:true,pagination:true,chartAccount:true});await context.close()
 }
 for(const scenario of ['empty','catalog-error','history-error','wrong-binding','partial','no-deals','disconnected','unknown','missing','reordered','summary-error','long-name']){
  const {context,page}=await setup(scenario,390,'light');await page.goto(url(scenario==='missing'?'&mt5_connection=removed':scenario==='catalog-error'?'&mt5_connection=a':''))
  if(scenario==='empty'){await page.getByText('Chưa có tài khoản MT5. Thêm tài khoản trong Quản lý tài khoản.',{exact:true}).waitFor();assert.equal(await page.locator('.mt5-account-card').count(),0)}
  else if(scenario==='catalog-error')await page.getByRole('alert').getByText('Không tải được danh sách tài khoản.',{exact:true}).waitFor()
  else if(['history-error','wrong-binding'].includes(scenario))await page.getByText('Chưa có lịch sử giao dịch đã đồng bộ.',{exact:true}).waitFor()
  else if(scenario==='partial'){await page.getByText('Chưa đủ thời gian hoặc phí để vẽ biểu đồ PnL.',{exact:true}).waitFor();assert.equal(await page.locator('.mt5-pnl-curve svg').count(),0);assert.equal(await page.locator('.mt5-report .fxs-metric').first().locator('strong').innerText(),'-')}
  else if(scenario==='no-deals')await page.getByText('Chưa có lượt khớp trong khoảng đã đồng bộ.',{exact:true}).waitFor()
  else if(scenario==='disconnected'){await page.locator('.mt5-connection-card').getByText('Đã ngắt kết nối',{exact:true}).waitFor();await page.locator('.mt5-report').getByText('Dữ liệu trước đó · đang mất kết nối',{exact:true}).waitFor()}
  else if(scenario==='unknown')await page.locator('.mt5-connection-card').getByText('Chưa xác định',{exact:true}).waitFor()
  else if(scenario==='missing'){await page.getByText('Tài khoản đã chọn không còn trong danh sách. Chọn tài khoản khác.',{exact:true}).waitFor();assert.equal(await page.locator('.mt5-account-card').count(),0)}
  else if(scenario==='reordered'){
   await page.getByTestId('mt5-account-balance').getByText('$10.000',{exact:true}).waitFor()
   await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/live/connections')
   await page.locator('.mt5-connection-card').getByText('Đã ngắt kết nối',{exact:true}).waitFor()
   assert.equal(await page.getByTestId('mt5-account-balance').innerText(),'$10.000')
   assert.match(await page.locator('.mt5-account-card h2').innerText(),/Alpha$/)
  }
  else if(scenario==='summary-error'){
   await page.locator('.mt5-connection-card').getByText('Được phép',{exact:true}).waitFor()
   await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/live/trading')
   await page.getByText('Mất kết nối dữ liệu giao dịch. Đang giữ ảnh chụp trước đó.',{exact:true}).waitFor()
   assert.equal(await page.locator('.mt5-connection-card').getByText('Chưa xác định',{exact:true}).count(),1)
  }
  else if(scenario==='long-name')await page.locator('.mt5-account-card h2').filter({hasText:'Account'.repeat(20)}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`${output}/${scenario}.png`,fullPage:true});report.cases.push({scenario,knownState:true});await context.close()
 }
 {
  const {context,page}=await setup('ready',1440,'light')
  await page.goto(url().replace('lang=vi','lang=en'))
  await page.getByRole('button',{name:'Choose MT5 account',exact:true}).waitFor()
  await page.getByRole('columnheader',{name:'Execution date',exact:true}).waitFor()
  await page.locator('.fxr-session-toolbar').scrollIntoViewIfNeeded()
  await page.screenshot({path:`${output}/overview-en.png`,fullPage:true})
  report.cases.push({language:'en',localized:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[]);report.passed=true
}catch(error){report.failure=error.stack;process.exitCode=1;for(const [i,page]of browser.contexts().flatMap(c=>c.pages()).entries())await page.screenshot({path:`${output}/failure-${i}.png`,fullPage:true}).catch(()=>{})}
finally{await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failure:report.failure,errors:report.errors,mutations:report.mutations}))}
