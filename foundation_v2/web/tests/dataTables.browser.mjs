// Labeled synthetic fixtures; local GET-only UI regression. No broker calls.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import{mkdir,writeFile}from'node:fs/promises'

const [origin,out]=process.argv.slice(2)
assert(origin && out,'Pass explicit UI origin and evidence directory')
assert.equal(new URL(origin).hostname,'127.0.0.1')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={cases:[],errors:[],writes:[],requests:[]};let page
const headers={'X-Workspace-Id':'tenant-a'}
const real=await(await fetch(origin+'/api/v2/replay/trades?page=1&page_size=10',{headers})).json()
assert(real.ledger?.length)
const trades=Array.from({length:35},(_,i)=>({...structuredClone(real.ledger[0]),trade_id:`fixture-${i}`,net_pnl:i-10,symbol:i===34?'XAU/USD':'EUR/USD',tags:i===34?['Kỷ luật tốt']:[],report_time_utc:`2026-10-01T00:${String(34-i).padStart(2,'0')}:00Z`}))
const datasets=Array.from({length:35},(_,i)=>({dataset_id:`fixture-data-${i}`,instrument_id:`CODE${String(i).padStart(2,'0')}`,name:i===34?'Vàng dữ liệu':'Euro',source:{provider:'CSV'},asset_class:i===34?'metal':'fx',first_timestamp:1704067200,last_timestamp:1735689600,row_count:i,size_bytes:1000+i,timeframe_seconds:60,created_at_utc:'2026-10-01T00:00:00Z'}))
async function context(width,theme,fixtures=false){
 const ctx=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'})
 await ctx.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin)return route.abort();if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}
 if(/\/api\/v2\/(mt5|live)/.test(u.pathname))return route.fulfill({json:{items:[],available:false,status:'unavailable'}})
 if(fixtures&&u.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:datasets,catalog_items:[]}})
 if(fixtures&&u.pathname==='/api/v2/replay/trades'){
   const extra=JSON.parse(u.searchParams.get('extra_filters')||'{}'),sort=u.searchParams.get('sort_key'),desc=u.searchParams.get('sort_direction')==='desc',size=Number(u.searchParams.get('page_size')||10)
   let filtered=trades.filter(r=>!extra.assets||JSON.parse(extra.assets).includes(r.symbol));if(extra.search)filtered=filtered.filter(r=>r.tags.includes('Kỷ luật tốt'))
   filtered.sort((a,b)=>{const x=a[sort],y=b[sort];return(typeof x==='number'?x-y:String(x).localeCompare(String(y)))*(desc?-1:1)})
   const total=filtered.length,pages=Math.ceil(total/size),num=Math.min(Number(u.searchParams.get('page')||1),pages||1),ledger=filtered.slice((num-1)*size,num*size)
   report.requests.push({page:num,size,total,extra,sort,returned:ledger.length})
   return route.fulfill({json:{...real,ledger,facets:{...real.facets,assets:['EUR/USD','XAU/USD'],tags:['Kỷ luật tốt']},snapshot_key:'fixture-'+JSON.stringify(extra),pagination:{page:num,page_size:size,returned_count:ledger.length,filtered_count:total,page_count:pages,has_next:num<pages}}})
 }
 return route.continue()})
 page=await ctx.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));return ctx
}
async function checkGeometry(view){return view.evaluate(el=>{const th=el.querySelector('th:has(button.wm-table-sort)'),b=th.querySelector('button'),r=th.getBoundingClientRect(),br=b.getBoundingClientRect(),c=getComputedStyle(th);return{cellWidth:r.width,buttonWidth:br.width,padding:getComputedStyle(th).padding,sticky:c.position,bg:c.backgroundColor,collapse:getComputedStyle(el.querySelector('table')).borderCollapse,maxScroll:el.scrollHeight-el.clientHeight}})}
try{
 for(const [width,theme]of[[1440,'dark'],[390,'light']]){
  const ctx=await context(width,theme);await page.goto(origin+'/?workspace=tenant-a&lang=vi&area=testing&ui_reference=1')
  const ref=page.locator('#data-table'),nav=ref.locator('.wm-pagination');await ref.scrollIntoViewIfNeeded();await ref.locator('tbody tr').first().waitFor()
  assert.match(await nav.innerText(),/1–10 \/ 35/);await nav.getByRole('button',{name:'Trang sau',exact:true}).click();assert.match(await ref.locator('tbody tr').first().innerText(),/Mẫu 11/)
  await page.getByRole('button',{name:'Nhóm minh hoạ',exact:true}).click();await page.getByRole('option',{name:'Nhóm B',exact:true}).click();await page.keyboard.press('Escape')
  assert.match(await ref.locator('tbody').innerText(),/Mẫu 35/);assert.match(await nav.innerText(),/1–1 \/ 1/)
  await page.getByRole('button',{name:'Nhóm minh hoạ',exact:true}).click();await page.getByRole('checkbox',{name:'Chọn tất cả',exact:true}).click();await page.keyboard.press('Escape')
  const geometry=await checkGeometry(ref.locator('.wm-table-scroll'));assert.equal(geometry.collapse,'separate');assert(Math.abs(geometry.cellWidth-geometry.buttonWidth)<1)
  const valueHeading=ref.locator('.wm-table-sort').filter({hasText:'Giá trị'});await valueHeading.focus();await page.keyboard.press('Enter');assert.equal(await valueHeading.locator('xpath=ancestor::th').getAttribute('aria-sort'),'ascending');await page.keyboard.press('Space');assert.equal(await valueHeading.locator('xpath=ancestor::th').getAttribute('aria-sort'),'descending')
  await nav.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).click();await page.getByRole('option',{name:'25',exact:true}).click();assert.match(await nav.innerText(),/1–25 \/ 35/)
  const view=ref.locator('.wm-table-scroll');await view.evaluate(el=>{el.scrollTop=150});assert(await view.evaluate(el=>{const r=el.querySelector('th').getBoundingClientRect(),b=el.getBoundingClientRect();return Math.abs(r.top-b.top)<2&&r.bottom<=b.bottom}))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.screenshot({path:`${out}/reference-${width}-${theme}.png`,fullPage:false})
  for(const state of ['loading','empty','error','stale','unknown']){await page.getByRole('button',{name:'Trạng thái bảng minh hoạ',exact:true}).click();await page.getByRole('option',{name:state,exact:true}).click();if(state==='error')await ref.getByRole('alert').waitFor();else await ref.locator('table').waitFor();if(state==='unknown')assert.equal(await nav.locator('.wm-pagination-meta').innerText(),'')}
  report.cases.push({kind:'reference',width,theme,geometry,states:6});await ctx.close()
 }
 const ctx=await context(1440,'dark',true)
 await page.goto(origin+'/?workspace=tenant-a&lang=vi&view=trade&area=testing&section=trades&sessions=all&select=1')
 const table=page.locator('.fxa-table-scroll'),pager=page.getByTestId('analytics-ledger-pagination');await table.locator('tbody tr').first().waitFor()
 assert.match(await pager.innerText(),/1–10 \/ 35/);assert(!((await table.locator('tbody').innerText()).includes('XAU/USD')));const firstCheck=table.locator('tbody input[type=checkbox]').first();await firstCheck.check();const firstLabel=await firstCheck.getAttribute('aria-label')
 await pager.getByRole('button',{name:'Trang sau',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.wm-pagination-meta')?.textContent.includes('11–20'))
 await pager.getByRole('button',{name:'Trang trước',exact:true}).click();await table.getByRole('checkbox',{name:firstLabel,exact:true}).waitFor();assert(await table.getByRole('checkbox',{name:firstLabel,exact:true}).isChecked())
 await pager.getByRole('button',{name:'Trang sau',exact:true}).click();await page.getByRole('button',{name:/^(Cơ bản|Basic)$/,exact:true}).click();await page.locator('dialog summary').filter({hasText:/^(Tài sản|Assets)$/}).click();await page.getByRole('group',{name:/^(Tài sản|Assets)$/,exact:true}).getByLabel('XAU/USD',{exact:true}).check();await page.getByRole('button',{name:/^(Áp dụng bộ lọc|Apply Filters)$/,exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.wm-pagination-meta')?.textContent.includes('1–1 / 1'));assert.match(await table.locator('tbody').innerText(),/XAU\/USD/);assert.equal(await table.locator('tbody input:checked').count(),0)
 report.cases.push({kind:'remote-trades',lateFilter:true,pageSelection:true,geometry:await checkGeometry(table)});await page.screenshot({path:out+'/trades-filtered.png'})
 await page.goto(origin+'/?workspace=tenant-a&lang=vi&view=market-data&area=testing&section=market-data');const lib=page.locator('.data-library'),lp=lib.locator('.wm-pagination');await lib.locator('tbody tr').first().waitFor();await lp.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).click();await page.getByRole('option',{name:'10',exact:true}).click();await lp.getByRole('button',{name:'Trang sau',exact:true}).click();assert.match(await lp.innerText(),/11–20 \/ 35/)
 await lib.locator('.data-library-filters').getByRole('button',{name:'Danh mục',exact:true}).click();await page.getByRole('option',{name:'Kim loại',exact:true}).click();assert.match(await lp.innerText(),/1–1 \/ 1/);assert.match(await lib.locator('tbody').innerText(),/CODE34/)
 report.cases.push({kind:'library',lateFilter:true,geometry:await checkGeometry(lib.locator('.wm-table-scroll'))});await page.screenshot({path:out+'/library-filtered.png'})
 await ctx.close();assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1}finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
