// Synthetic GET-only Live fixtures: account actions never reach a broker.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'synthetic Live UI, GET only, no terminal',checks:[],errors:[],writes:[]}
const accounts={a:{login:111,server:'FIXTURE',account_ref:'…111',currency:'USD',balance:10000,equity:10024,profit:24,margin:100,margin_free:9924},b:{login:222,server:'FIXTURE',account_ref:'…222',currency:'EUR',balance:20000,equity:20000,profit:0,margin:0,margin_free:20000}}
let currentPage
try {
  for(const [scenario,width,theme] of [['ready',1440,'dark'],['ready',390,'light'],['stale',1440,'light'],['error',390,'dark'],['disconnected',1440,'dark']]) {
    let fail=false
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url())
      if(url.origin!==origin)return route.abort()
      if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push(url.pathname);return route.abort()}
      if(!url.pathname.startsWith('/api/'))return route.continue()
      const json=(body,status=200)=>route.fulfill({status,json:body})
      const id=url.searchParams.get('connection_id')||'a'
      if(url.pathname==='/api/v2/live/connections')return json({items:Object.entries(accounts).map(([id,account])=>({id,name:'MT5',account_login:String(account.login),account_environment:'demo',status:scenario==='disconnected'?'disconnected':'connected',requested_mode:'trading',verified_permissions:{read:true,trade:true},account,last_synced_at:new Date().toISOString()}))})
      if(url.pathname==='/api/v2/live/trading') {
        if(fail)return json({detail:'fixture_read_failed'},503)
        return json({status:'ready',mode:'demo',summary:true,stale:scenario==='stale',connection_id:id,account:accounts[id],bars:[],positions:[],orders:[],requests:[],capabilities:{}})
      }
      if(url.pathname==='/api/v2/live/status')return json({status:'ready',connection_id:id,account:accounts[id],history_from_utc:'2026-10-01T00:00:00Z',captured_at_utc:new Date().toISOString(),deals:[]})
      return json({items:[],available:false})
    })
    const page=await context.newPage();currentPage=page;page.setDefaultTimeout(10000)
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=terminal&lang=vi&mt5_connection=a`)
    const overview=page.getByTestId('mt5-overview'),picker=page.getByRole('button',{name:'Chọn tài khoản MT5',exact:true})
    await overview.getByTestId('mt5-account-balance').getByText('$10.000',{exact:true}).waitFor()
    await overview.locator('.mt5-report .fxs-chart-empty').first().waitFor()
    assert.equal(await page.getByRole('alert').filter({hasText:'Không mở được trang này'}).count(),0,'Empty history renders chart empty states without crashing the page')
    assert.match(await picker.innerText(),/MT5 111 - demo/)
    assert.match(await picker.innerText(),/MT5[\s\S]*\$10.000/)
    assert.equal(await picker.getAttribute('aria-haspopup'),'dialog')
    const settings=overview.getByRole('button',{name:'Cài đặt tài khoản',exact:true})
    assert.equal(await settings.isDisabled(),true)
    const analytics=overview.getByRole('link',{name:'Phân tích',exact:true})
    assert.equal(new URL(await analytics.getAttribute('href'),origin).searchParams.get('section'),'analytics')
    assert.equal(await analytics.getAttribute('aria-haspopup'),null)
    assert.equal(await overview.locator('.fxs-go-chart svg path').getAttribute('d'),'m6 3 10 7-10 7Z')
    if(scenario==='ready') {
      await picker.click()
      const popup=page.getByRole('dialog',{name:'Chọn tài khoản MT5',exact:true})
      await popup.getByRole('searchbox').fill('222')
      assert.equal(await popup.getByRole('option').count(),1)
      await popup.getByRole('option',{name:/MT5 222 - demo/}).click()
      await overview.getByTestId('mt5-account-balance').getByText('20.000 EUR',{exact:true}).waitFor()
      assert.equal(new URL(page.url()).searchParams.get('mt5_connection'),'b')
      await page.reload();await overview.getByTestId('mt5-account-balance').getByText('20.000 EUR',{exact:true}).waitFor()
      await overview.getByRole('button',{name:'Xóa tài khoản',exact:true}).click()
      const dialog=page.getByRole('dialog',{name:'Xóa tài khoản',exact:true});await dialog.waitFor()
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
    } else if(scenario==='stale') {
      await overview.locator('.mt5-connection-card').getByText('Dữ liệu cũ',{exact:true}).waitFor()
      await overview.locator('.mt5-connection-card').getByText('Chưa xác định',{exact:true}).waitFor()
    } else if(scenario==='error') {
      fail=true
      // Existing read loop refreshes summary every 10 seconds; no sync/reconnect mutation.
      await overview.locator('.mt5-connection-card').getByText('Không tải được dữ liệu.',{exact:true}).waitFor({timeout:16000})
      assert.equal(await overview.getByTestId('mt5-account-balance').innerText(),'$10.000')
    } else await overview.locator('.mt5-connection-card').getByText('Đã ngắt kết nối',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:`${out}/${scenario}-${width}-${theme}.png`,fullPage:true})
    report.checks.push({scenario,width,theme})
    await context.unrouteAll({behavior:'ignoreErrors'});await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
} catch(error) {
  report.status='FAIL';report.failure=error.stack;process.exitCode=1
  await currentPage?.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{})
} finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
