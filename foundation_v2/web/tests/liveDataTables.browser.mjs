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
const browser=await chromium.launch(),report={checks:[],errors:[],writes:[],scope:'Synthetic Live GET fixtures and demo/reference grids; no broker connection'};let page
async function checkSort(root) {
 const labels=root.locator('.wm-table-heading-label')
 if(await labels.count())assert.equal(await labels.evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1)),true,'Header labels must fit their slots')
 assert.equal(await root.locator('th[data-sort-active],th[aria-sort]').count(),0,'Default order must not look like a chosen sort')
 const button=root.locator('.wm-table-sort').first()
 if(!await button.count())return
 const footer=root.locator('.wm-pagination').first()
 const next=footer.getByRole('button',{name:'Trang sau',exact:true})
 if(await next.count() && await next.isEnabled())await next.click()
 await button.focus();await button.press('Enter')
 const active=root.locator('th[data-sort-active]')
 assert.equal(await active.count(),1)
 assert.equal(await active.getAttribute('aria-sort'),'ascending')
 if(await footer.count())assert.equal(await footer.locator('[aria-current=page]').innerText(),'1','Changing sort resets pagination')
 assert.equal(await active.evaluate(el=>getComputedStyle(el,'::after').content),'none','Chosen header has no vertical separator')
 assert(await active.evaluate(el=>(getComputedStyle(el,'::before').boxShadow.split('inset').length-1)===(el.previousElementSibling?.matches('th:is([data-sort-active],[data-sort-reset])')?3:4)),'Selected header shares its leading edge only with an outlined neighbour')
 const ascending=await root.locator('tbody').first().innerText()
 await button.click()
 assert.equal(await active.getAttribute('aria-sort'),'descending')
 assert.notEqual(await root.locator('tbody').first().innerText(),ascending,'Header click actually changes row order')
 const second=root.locator('.wm-table-sort').nth(1)
 if(await second.count()){
  await second.focus();await second.press('Space')
  assert.equal(await active.count(),2,'Plain activation adds a second sort')
  assert.deepEqual(await active.locator('.wm-table-sort-priority').allTextContents(),['1','2'])
  const clearAll=root.locator('.wm-table-sort-clear-all')
  assert.equal(await clearAll.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px','Reset button delegates its frame to the heading')
  const borders=await root.locator('th:is([data-sort-active],[data-sort-reset])').evaluateAll(headings=>headings.map(h=>({
   shared:h.previousElementSibling?.matches('th:is([data-sort-active],[data-sort-reset])')??false,
   edges:getComputedStyle(h,'::before').boxShadow.split('inset').length-1,
   inset:getComputedStyle(h,'::before').inset,
   clearBorders:[...h.querySelectorAll('.wm-table-sort-clear')].map(b=>[getComputedStyle(b).borderLeftWidth,getComputedStyle(b).borderRightWidth])
  })))
  assert(borders.every(h=>h.edges===(h.shared?3:4)&&h.inset==='0px'),'Each shared boundary has one owner including reset')
  assert(borders.every(h=>h.clearBorders.every(b=>b.every(width=>width==='0px'))),'Clear controls have no internal divider')
  await active.nth(0).locator('.wm-table-sort-clear').click()
  assert.equal(await active.count(),1)
  assert.equal(await active.locator('.wm-table-sort-priority').innerText(),'1','Removal renumbers priority')
  await clearAll.click();assert.equal(await active.count(),0)
  await button.click();await button.click()
 }
}
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
 await page.goto(`${origin}/?workspace=fixture&lang=vi&view=market-data&area=testing&section=market-data&demo=1`,{waitUntil:'domcontentloaded'})
 const library=page.locator('.data-library');await library.locator('tbody tr').first().waitFor()
 assert.match(await library.locator('tbody tr').first().innerText(),/EURUSD/)
 await checkSort(library)
 await library.locator('.wm-table-sort').nth(1).click()
 assert.equal(await library.locator('th[data-sort-active]').count(),2)
 await library.locator('.wm-table-sort').first().blur();await page.mouse.move(0,0)
 await page.screenshot({path:`${out}/library-sorted-${width}-${theme}.png`})
 report.checks.push({name:'library-sort',width,theme,neutralDefault:true,clickOrder:'asc-desc',multiSortPriority:true,clearAll:true,verticalSeparator:false})
 await page.goto(`${origin}/?workspace=fixture&lang=vi&area=testing&ui_reference=1`,{waitUntil:'domcontentloaded'})
 const reference=page.locator('#data-table');await reference.locator('tbody tr').first().waitFor();await checkSort(reference)
 const virtual=page.locator('#virtual-table');await virtual.locator('tbody tr').first().waitFor();await checkSort(virtual)
 report.checks.push({name:'reference-sorts',width,theme,neutralDefault:true,clickOrder:'asc-desc'})
 await page.goto(`${origin}/?workspace=fixture&lang=vi&view=trade&area=testing&section=trades&sessions=all&select=1&demo=1`,{waitUntil:'domcontentloaded'})
 const trades=page.locator('.fxa-trades');await trades.locator('tbody tr').first().waitFor()
 await checkSort(trades)
 await trades.locator('.wm-table-sort-clear-all').click();assert.equal(await trades.locator('th[data-sort-active],th[aria-sort]').count(),0)
 report.checks.push({name:'trades-sort',width,theme,neutralDefault:true,multiSortClear:true})
 for(const[name,query,selector]of[
 ['accounts','section=trading-accounts','.live-accounts-main'],
 ['cashflow',`section=trading-accounts&account_tab=transactions&live_account=broker:${fixtureConnection}`,'.live-accounts-main'],
 ['broker',`section=trades&live_account=broker:${fixtureConnection}`,'.live-broker'],
 ['manual',`section=trades&live_account=${fixtureAccount}`,'.live-broker'],
 ['labels',`section=tag-analytics&live_account=${fixtureAccount}`,'.live-journal-tags']]){
 await page.goto(`${origin}/?workspace=fixture&lang=vi&view=live&area=live&${query}`,{waitUntil:'domcontentloaded'})
 const root=page.locator(selector);await root.locator('.wm-data-table tbody tr').first().waitFor();const footer=root.locator('.wm-pagination').first();await footer.waitFor()
 const initialRow=await root.locator('tbody tr').first().innerText()
 if(name==='accounts')assert.match(initialRow,/ACCOUNT 00/)
 if(name==='cashflow')assert.match(initialRow,/134/)
 if(name==='broker'||name==='manual')assert.match(initialRow,/20\/10\/2026/)
 await checkSort(root)
 if(name==='accounts'){
  assert.match(await footer.locator('.wm-pagination-meta > span').getAttribute('title'),/1–10.*36/);await footer.getByRole('button',{name:'Trang sau',exact:true}).click()
  await page.getByRole('button',{name:'Lọc tài khoản',exact:true}).click();await page.getByRole('option',{name:'Đồng bộ',exact:true}).click();await page.keyboard.press('Escape');assert.match(await footer.locator('.wm-pagination-meta > span').getAttribute('title'),/1–1.*1/)
 }
 if(name==='broker'||name==='manual'){await footer.getByRole('button',{name:'Trang sau',exact:true}).click();assert.match(await footer.locator('.wm-pagination-meta > span').getAttribute('title'),/21–40.*65/)}
 const g=await root.evaluate(el=>{const v=el.querySelector('.wm-table-scroll'),f=el.querySelector('.wm-pagination'),r=f.getBoundingClientRect(),c=f.querySelector('.wm-pagination-controls').getBoundingClientRect(),s=f.querySelector('.wm-pagination-size').getBoundingClientRect();return{rows:el.querySelectorAll('tbody tr').length,collapse:getComputedStyle(v.querySelector('table')).borderCollapse,footerWidth:r.width,docOverflow:document.documentElement.scrollWidth>innerWidth+1,pagerOverlap:c.right>s.left+1,brokenButtons:[...f.querySelectorAll('.wm-pagination-meta button')].some(b=>b.scrollWidth>b.clientWidth+1),headerWidths:[...v.querySelectorAll('th:has(>.wm-table-sort)')].map(h=>Math.abs(h.getBoundingClientRect().width-h.querySelector('button').getBoundingClientRect().width))}})
 assert.equal(g.collapse,'separate');assert.equal(g.docOverflow,false);assert.equal(g.pagerOverlap,false);assert.equal(g.brokenButtons,false);assert(g.headerWidths.every(w=>w<1));report.checks.push({name,width,theme,...g});await page.screenshot({path:`${out}/${name}-${width}-${theme}.png`})
 }
 await ctx.close()
}
assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{})}finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
