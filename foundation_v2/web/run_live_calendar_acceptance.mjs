import assert from 'node:assert/strict'
import{mkdir,writeFile}from'node:fs/promises'
import { chromium } from 'playwright'
const origin=process.env.TW_LIVE_UI_ORIGIN || 'http://127.0.0.1:5180',out=process.env.TW_LIVE_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/live-calendar-ui'
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Labeled multi-account API fixtures; no broker operations',cases:[],errors:[],mutations:[]}
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
try{
for(const [width,lang,theme] of [[1920,'vi','dark'],[768,'en','light'],[390,'vi','dark']]) {
const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
const connections=[{id:a,name:'Alpha',login_hint:'…1111',server:'Test-Demo',account:{currency:'USD'},status:'connected'},{id:b,name:'Beta',login_hint:'…2222',server:'Test-Demo',account:{currency:'USD'},status:'connected'}]
let mixed=false,missing=false
await page.route('**/api/**',async route=>{
const request=route.request(),url=new URL(request.url())
if(request.method()!=='GET'){report.mutations.push(url.pathname);return route.abort()}
if(url.pathname==='/api/v2/live/records')return route.fulfill({json:{version:'live-records-v1',items:[]}})
if(url.pathname==='/api/v2/live/status'){
 const id=url.searchParams.get('connection_id') || a
 if(missing && id===b)return route.fulfill({status:503,json:{detail:'fixture_unavailable'}})
 const profit=id===a?25:-10
 return route.fulfill({json:{status:'ready',connection_id:id,connections,source:'Fixture',account:{account_ref:id===a?'…1111':'…2222',currency:mixed&&id===b?'EUR':'USD',balance:1000},deals:[{ticket:1,symbol:'EURUSD',type:0,time_msc:Date.parse('2026-10-12T12:00:00Z'),profit,commission:0,swap:0,fee:0}],history_from_utc:'2026-10-01T00:00:00Z',captured_at_utc:'2026-10-23T00:00:00Z'}})
}
return route.fulfill({status:503,json:{detail:'fixture_unavailable'}})
})
const href=`${origin}/?workspace=fixture&view=live&area=live&section=calendar&lang=${lang}&theme=${theme}`
await page.goto(href)
const summary=page.locator('.live-month-total strong')
await summary.filter({hasText:'15'}).waitFor()
const trigger=page.locator('.live-account-picker .fxa-session-trigger')
await trigger.click()
const all=page.getByRole('checkbox',{name:lang==='vi'?'Tất cả tài khoản':'All accounts',exact:true})
assert.equal(await all.getAttribute('aria-checked'),'true')
await page.getByRole('checkbox',{name:/Beta/}).click()
await summary.filter({hasText:'25'}).waitFor()
await page.keyboard.press('Escape')
await page.reload()
await summary.filter({hasText:'25'}).waitFor()
await trigger.click()
await page.getByRole('searchbox').fill('2222')
assert.equal(await page.locator('.fxa-session-options [role=checkbox]').count(),1)
await page.getByRole('checkbox',{name:/Beta/}).click()
await summary.filter({hasText:'15'}).waitFor()
await page.getByRole('searchbox').fill('')
await page.getByRole('checkbox',{name:/Alpha/}).click()
await summary.filter({hasText:'10'}).waitFor()
assert.ok((await summary.textContent()).includes('-'))
await page.getByRole('checkbox',{name:lang==='vi'?'Tất cả tài khoản':'All accounts',exact:true}).click()
await summary.filter({hasText:'15'}).waitFor()
await page.getByRole('checkbox',{name:lang==='vi'?'Tất cả tài khoản':'All accounts',exact:true}).click()
await page.locator('.live-month-total strong').filter({hasText:'0'}).waitFor()
assert.ok(new URL(page.url()).searchParams.get('live_accounts')==='none')
await page.getByRole('checkbox',{name:lang==='vi'?'Tất cả tài khoản':'All accounts',exact:true}).click()
await summary.filter({hasText:'15'}).waitFor()
await page.screenshot({path:`${out}/multi-${width}-${lang}-${theme}.png`,animations:'disabled'})
await page.keyboard.press('Escape')
mixed=true;await page.reload()
await page.getByText(lang==='vi'?'Các tài khoản khác tiền tệ chưa thể cộng PnL. Chọn các tài khoản cùng tiền tệ.':'PnL cannot be combined across currencies. Select accounts with the same currency.',{exact:true}).waitFor()
assert.equal((await summary.textContent()).trim(),'—')
mixed=false;missing=true;await page.reload()
await page.getByText(lang==='vi'?'Chưa đủ dữ liệu cho các tài khoản đã chọn.':'Data is incomplete for the selected accounts.',{exact:true}).waitFor()
assert.equal((await summary.textContent()).trim(),'—')
report.cases.push({width,lang,theme,aggregate:15,single:25,reload:true,search:true,selectNone:true,mixedCurrencyDenied:true,incompleteDenied:true})
await context.close()
}
assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[]);report.passed=true
}catch(e){report.failure=e.stack;throw e}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
