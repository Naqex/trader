// Synthetic GET-only fixtures. No account creation, broker actions or writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { journalRecords, brokerSnapshot, fixtureAccount } from './liveJournal.fixture.mjs'
const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.notEqual(new URL(origin).port, '5180')
await mkdir(out, {recursive:true})
const browser = await chromium.launch(), report = {checks:[], errors:[], writes:[]}
try {
 const ctx = await browser.newContext({viewport:{width:1440,height:940}, reducedMotion:'reduce'})
 const records=journalRecords(), broker=brokerSnapshot()
 await ctx.routeWebSocket('**/*', socket=>socket.close())
 await ctx.route('**/*', route=>{
  const req=route.request(), url=new URL(req.url())
  if(url.origin!==origin) return route.abort()
  if(!['GET','HEAD','OPTIONS'].includes(req.method())) {report.writes.push(url.pathname);return route.abort()}
  if(!url.pathname.startsWith('/api/')) return route.continue()
  const json = url.pathname==='/api/v2/live/records' ? {version:'live-records-v1',items:records} : url.pathname==='/api/v2/live/status' ? broker : url.pathname==='/api/v2/live/connections' ? {items:broker.connections} : {items:[],available:false}
  return route.fulfill({json})
 })
 const page=await ctx.newPage();page.setDefaultTimeout(10000)
 page.on('pageerror', e=>report.errors.push(e.message))
 const href=section=>origin+'/?workspace=fixture&view=live&area=live&lang=vi&section='+section+'&live_account='+fixtureAccount
 for(const [section, selector] of [['trades','.live-broker'],['tag-analytics','.live-journal-tags']]) {
  await page.goto(href(section));await page.locator(selector+' tbody tr').first().waitFor()
  assert.match(await page.locator(selector+' thead').innerText(), /\(\$\)/)
  assert.doesNotMatch(await page.locator(selector).innerText(), /\bUSD\b/)
  report.checks.push(section+' money headers')
 }
 await page.goto(href('trading-accounts'))
 await page.locator('.live-manual-option').click()
 const dialog=page.locator('.live-record-dialog'), picker=dialog.getByRole('button',{name:'Đơn vị tiền tệ',exact:true})
 assert.equal(await picker.innerText(),'$')
 await picker.click()
 const search=page.getByRole('searchbox',{name:'Tìm Đơn vị tiền tệ',exact:true})
 await search.fill('USD')
 await page.getByRole('option',{name:'$',exact:true}).click()
 assert.equal(await picker.innerText(),'$')
 assert.equal(await dialog.getByRole('textbox',{name:'Số tiền ($)',exact:true}).count(),1)
 await picker.click();await search.fill('EUR');await page.getByRole('option',{name:'EUR',exact:true}).click()
 assert.equal(await picker.innerText(),'EUR')
 assert.equal(await dialog.getByRole('textbox',{name:'Số tiền (EUR)',exact:true}).count(),1)
 await page.screenshot({path:out+'/currency-picker.png'})
 report.checks.push('USD search keeps dollar label; EUR identity preserved')
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[])
 report.status='PASS'
} catch(error) {report.status='FAIL';report.failure=error.stack;throw error}
finally {await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
