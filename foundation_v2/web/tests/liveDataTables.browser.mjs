// Labeled synthetic fixtures; local GET-only UI regression. No broker calls.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import{mkdir,writeFile}from'node:fs/promises'
import{journalRecords,brokerSnapshot,fixtureAccount,fixtureConnection}from'./liveJournal.fixture.mjs'

const [origin,out]=process.argv.slice(2)
assert(origin && out,'Pass explicit UI origin and evidence directory')
assert.equal(new URL(origin).hostname,'127.0.0.1')
await mkdir(out,{recursive:true})
const records=journalRecords(),account=records.find(r=>r.kind==='account');account.payload.name='ACCOUNT 00'
for(let i=1;i<35;i++)records.push({...structuredClone(account),record_id:`account-${i}`,payload:{...account.payload,name:`ACCOUNT ${String(i).padStart(2,'0')}`}})
const broker=brokerSnapshot();broker.cashflows=Array.from({length:35},(_,i)=>({ticket:1000+i,type:2,time_msc:Date.parse('2026-10-01T00:00:00Z')+i*60000,profit:100+i,comment:'Synthetic deposit'}))
const browser=await chromium.launch(),report={checks:[],errors:[],writes:[],scope:'Synthetic Live GET fixtures; no broker connection'};let page
try{
for(const [width,theme]of[[1440,'dark'],[390,'light']]){
 const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});await ctx.addInitScript(t=>localStorage.setItem('tw-theme',t),theme)
 await ctx.routeWebSocket('**/*',s=>s.close());await ctx.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin)return route.abort();if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}
 if(!u.pathname.startsWith('/api/'))return route.continue()
 const json=body=>route.fulfill({json:body})
 if(u.pathname==='/api/v2/live/records')return json({version:'live-records-v1',items:records})
 if(u.pathname==='/api/v2/live/status')return json(broker)
 if(u.pathname==='/api/v2/live/connections')return json({items:broker.connections})
 if(u.pathname.startsWith('/api/v2/mt5'))return route.abort()
 return json({items:[],available:false})})
 page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
 for(const[name,query,selector]of[
 ['accounts','section=trading-accounts','.live-accounts-main'],
 ['cashflow',`section=trading-accounts&account_tab=transactions&live_account=broker:${fixtureConnection}`,'.live-accounts-main'],
 ['broker',`section=trades&live_account=broker:${fixtureConnection}`,'.live-broker'],
 ['manual',`section=trades&live_account=${fixtureAccount}`,'.live-broker'],
 ['labels',`section=tag-analytics&live_account=${fixtureAccount}`,'.live-journal-tags']]){
 await page.goto(`${origin}/?workspace=fixture&lang=vi&view=live&area=live&${query}`,{waitUntil:'domcontentloaded'})
 const root=page.locator(selector);await root.locator('.wm-data-table tbody tr').first().waitFor();const footer=root.locator('.wm-pagination').first();await footer.waitFor()
 if(name==='accounts'){
  assert.match(await footer.innerText(),/1–10 \/ 36/);await footer.getByRole('button',{name:'Trang sau',exact:true}).click()
  await page.getByRole('button',{name:'Lọc tài khoản',exact:true}).click();await page.getByRole('option',{name:'Đồng bộ',exact:true}).click();await page.keyboard.press('Escape');assert.match(await footer.innerText(),/1–1 \/ 1/)
 }
 if(name==='broker'||name==='manual'){await footer.getByRole('button',{name:'Trang sau',exact:true}).click();assert.match(await footer.innerText(),/21–40 \/ 65/)}
 const g=await root.evaluate(el=>{const v=el.querySelector('.wm-table-scroll'),f=el.querySelector('.wm-pagination'),r=f.getBoundingClientRect(),c=f.querySelector('.wm-pagination-controls').getBoundingClientRect(),s=f.querySelector('.wm-pagination-size').getBoundingClientRect();return{rows:el.querySelectorAll('tbody tr').length,collapse:getComputedStyle(v.querySelector('table')).borderCollapse,footerWidth:r.width,docOverflow:document.documentElement.scrollWidth>innerWidth+1,pagerOverlap:c.right>s.left+1,brokenButtons:[...f.querySelectorAll('.wm-pagination-meta button')].some(b=>b.scrollWidth>b.clientWidth+1),headerWidths:[...v.querySelectorAll('th:has(>.wm-table-sort)')].map(h=>Math.abs(h.getBoundingClientRect().width-h.querySelector('button').getBoundingClientRect().width))}})
 assert.equal(g.collapse,'separate');assert.equal(g.docOverflow,false);assert.equal(g.pagerOverlap,false);assert.equal(g.brokenButtons,false);assert(g.headerWidths.every(w=>w<1));report.checks.push({name,width,theme,...g});await page.screenshot({path:`${out}/${name}-${width}-${theme}.png`})
 }
 await ctx.close()
}
assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{})}finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
