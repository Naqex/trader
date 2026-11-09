// Owner UI feedback screenshots: synthetic GET-only fixtures against a local vite preview. No broker, DB or owner runtime.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import path from 'node:path'

const here=path.dirname(fileURLToPath(import.meta.url))
const web=path.resolve(here,'../../../web')
const {chromium}=createRequire(path.join(web,'package.json'))('playwright')
const {journalRecords,brokerSnapshot,fixtureAccount}=await import(pathToFileURL(path.join(web,'tests/liveJournal.fixture.mjs')).href)
const origin=process.argv[2] || 'http://127.0.0.1:5231', out=here
assert.equal(new URL(origin).hostname,'127.0.0.1');assert(!['5180','8010'].includes(new URL(origin).port))
await mkdir(out,{recursive:true})
const stamp='2026-10-22T12:00:00Z'
const labels={schema_version:'trade-labels-v1',groups:[{id:'g-setup',name:'Setup',revision:1},{id:'g-mistake',name:'Mistakes',revision:1}],items:[
 {id:'l-breakout',name:'Breakout',color:'blue',group_id:'g-setup',revision:1},{id:'l-pullback',name:'Pullback',color:'green',group_id:'g-setup',revision:1},
 {id:'l-fomo',name:'FOMO',color:'red',group_id:'g-mistake',revision:1},{id:'l-late',name:'Late entry',color:'orange',group_id:'g-mistake',revision:1}]}
const templates={version:'note-templates-v1',items:[],preferences:{revision:1,favorites:[],defaults:{}}}
const records=journalRecords(),broker=brokerSnapshot()
const report={scope:'Synthetic GET fixtures on vite preview; writes aborted',shots:[],errors:[],writes:[]}
const browser=await chromium.launch()
try{
 for(const width of [1440,390])for(const theme of ['dark','light']){
  const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'})
  await ctx.addInitScript(t=>localStorage.setItem('tw-theme',t),theme)
  await ctx.routeWebSocket('**/*',s=>s.close())
  await ctx.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin)return route.abort()
   if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.writes.push(r.method()+' '+u.pathname);return route.abort()}
   if(!u.pathname.startsWith('/api/'))return route.continue()
   const json=body=>route.fulfill({json:body})
   if(u.pathname==='/api/v2/events')return route.fulfill({status:204,body:''})
   if(u.pathname==='/api/v2/live/records')return json({version:'live-records-v1',items:records})
   if(u.pathname==='/api/v2/live/status')return json(broker)
   if(u.pathname==='/api/v2/live/connections')return json({items:broker.connections})
   if(u.pathname==='/api/v2/trade-labels')return json(labels)
   if(u.pathname==='/api/v2/note-templates')return json(templates)
   if(u.pathname.startsWith('/api/v2/mt5'))return route.abort()
   return json({items:[],available:false})})
  const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message))
  const url=q=>`${origin}/?workspace=fixture&lang=vi&view=live&area=live&${q}`
  const shot=async name=>{const file=path.join(out,`${name}-${width}-${theme}.png`);await page.screenshot({path:file});report.shots.push(path.basename(file))}
  // 1. Account selection toolbar
  await page.goto(url('section=trading-accounts'),{waitUntil:'domcontentloaded'})
  await page.locator('.live-accounts-main tbody input[type=checkbox]').first().check()
  const accountBar=page.getByRole('region',{name:'Thao tác tài khoản đã chọn',exact:true});await accountBar.waitFor()
  assert.equal(await page.locator('.live-account-selection').count(),0)
  await shot('account-selection')
  // Trades selection toolbar for side-by-side comparison
  await page.goto(url(`section=trades&live_account=${fixtureAccount}`),{waitUntil:'domcontentloaded'})
  const grid=page.getByTestId('manual-trade-grid');await grid.locator('tbody tr').first().waitFor()
  await grid.locator('tbody tr').nth(0).locator('input[type=checkbox]').check()
  await grid.locator('tbody tr').nth(1).locator('input[type=checkbox]').check()
  const bar=page.locator('.wm-trade-selection-bar');await bar.waitFor()
  await shot('trade-selection')
  const [a,b]=[await accountBar.count(),await bar.boundingBox()];void a
  // 2. Bulk tags dialog
  await bar.getByRole('button',{name:'Thêm/xóa nhãn',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Thêm/xóa nhãn',exact:true});await dialog.waitFor()
  await shot('bulk-tags-empty')
  const row=dialog.locator('.wm-trade-bulk-tags-row').first()
  await row.getByRole('button',{name:'Nhóm nhãn',exact:true}).click();await dialog.getByRole('option',{name:'Setup',exact:true}).click()
  await row.getByRole('button',{name:'Nhãn',exact:true}).click();await dialog.getByRole('option',{name:'Breakout',exact:true}).click();await dialog.getByRole('option',{name:'Pullback',exact:true}).click()
  await page.keyboard.press('Escape')
  await dialog.getByRole('button',{name:'Thêm nhóm nhãn',exact:true}).click()
  const second=dialog.locator('.wm-trade-bulk-tags-row').nth(1)
  await second.getByRole('button',{name:'Nhóm nhãn',exact:true}).click();await dialog.getByRole('option',{name:'Mistakes',exact:true}).click()
  const rows=await dialog.locator('.wm-trade-bulk-tags-row').evaluateAll(nodes=>nodes.map(n=>[...n.children].map(c=>Math.round(c.getBoundingClientRect().y))))
  report.bulkRows={width,theme,rows,rowBorders:await dialog.locator('.wm-trade-bulk-tags-row').first().evaluate(n=>getComputedStyle(n).borderTopWidth)}
  await shot('bulk-tags-rows')
  await dialog.getByRole('button',{name:'Hủy',exact:true}).click();await dialog.waitFor({state:'detached'})
  // 3. Template dialog footer from a live note editor
  await page.goto(url(`section=notes&live_account=${fixtureAccount}`),{waitUntil:'domcontentloaded'})
  await page.locator('.live-note-create').click()
  const note=page.locator('.is-note-editor');await note.waitFor()
  await note.getByRole('button',{name:'Mẫu ghi chú',exact:true}).click()
  const tpl=page.locator('.wm-note-templates');await tpl.locator('footer').waitFor()
  report.templateFooter={width,theme,apply:await tpl.locator('footer .wm-note-template-apply').evaluate(n=>({tag:n.tagName,parent:n.parentElement.tagName,text:n.innerText}))}
  await shot('template-footer')
  void b
  await ctx.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}
finally{await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2))}
console.log(JSON.stringify({status:report.status,failure:report.failure?.split('\n').slice(0,3),bulkRows:report.bulkRows,templateFooter:report.templateFooter}))
