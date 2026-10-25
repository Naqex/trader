import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {displayDate} from '../../web/src/dateFormat.js'
import {formatAmount} from '../../web/src/moneyFormat.js'
const require=createRequire(new URL('../../web/package.json',import.meta.url))
const {chromium}=require('playwright')
const origin=process.env.UI_ORIGIN||'http://127.0.0.1:5196',stage=process.env.UI_STAGE||'candidate'
assert.ok(['http://127.0.0.1:5196','http://127.0.0.1:5180'].includes(origin))
const out=`E:/BACKUP-TRADINGWORKSPACE/trade-data-audit-20261025/${stage}`
await mkdir(out,{recursive:true})
const report={checks:[],errors:[],writes:[]},browser=await chromium.launch()
const keys=['session_id','status','source','recorded_at_utc','open_time_utc','symbol','side','entry_type','net_pnl','return_pct','realized_r','tags','price_open','quantity','stop_loss','take_profit','report_time_utc','close_time_utc','price_close','gross_pnl','fees']
const identity=r=>JSON.stringify([r.session_id,r.trade_id])
function expected(r,k,zone){
 if(k.endsWith('_time_utc')||k==='recorded_at_utc')return displayDate(r[k],{timeStyle:'medium',timeZone:zone})
 if(k==='session_id')return r.session_name||r.session_id
 if(k==='status')return 'Đã đóng'
 if(k==='source')return 'WMReplay'
 if(k==='symbol')return r.symbol
 if(k==='side')return r.side==='BUY'?'Mua':'Bán'
 if(k==='entry_type')return r[k]||'—'
 if(k==='tags')return (r.tags||[]).join('')
 if(k==='return_pct'){const n=r.starting_balance>0?r.net_pnl/r.starting_balance*100:null;return n!=null&&n!==0&&Math.abs(n)<.01?new Intl.NumberFormat('vi-VN',{maximumSignificantDigits:2}).format(n)+'%':formatAmount(n,'%')}
 if(k==='realized_r')return formatAmount(r[k],' R')
 if(['net_pnl','gross_pnl'].includes(k))return r[k]==null?'—':(r[k]>0?'↗':r[k]<0?'↙':'—')+formatAmount(r[k])
 return formatAmount(r[k],k==='fees'?` ${r.account_currency}`:'',['price_open','price_close','stop_loss','take_profit'].includes(k)?6:k==='quantity'?4:2)
}
try{
 for(const [width,theme,zone]of [[1920,'dark','UTC'],[1920,'light','Asia/Ho_Chi_Minh'],[390,'dark','Asia/Ho_Chi_Minh']]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(({theme,zone})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi');localStorage.setItem('tw-timezone',zone)},{theme,zone})
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||/\/api\/v2\/(mt5|live)/.test(u.pathname))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(r.method())){report.writes.push(u.pathname);return route.abort()}return route.continue()})
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message))
  const base=origin+'/?workspace=tenant-a&lang=vi&view=trade&area=testing&section=trades&select=1&sessions=all'
  async function load(url){const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v2/replay/trades'&&r.ok());await page.goto(url);const data=await(await response).json();await page.getByTestId('fx-trade-ledger').locator('tbody .wm-return-badge').first().waitFor();return data}
  const ledger=page.getByTestId('fx-trade-ledger');let payload=await load(base),compared=0,seen=new Set()
  async function compare(data){
   const rows=ledger.locator('tbody tr');assert.equal(await rows.count(),data.ledger.length)
   for(let i=0;i<data.ledger.length;i++){
    const raw=data.ledger[i],row=rows.nth(i),cells=await row.locator('td').allTextContents()
    assert.ok((await row.locator('input').getAttribute('aria-label')).endsWith(identity(raw)))
    for(let j=0;j<keys.length;j++){const k=keys[j];let actual=cells[j+2].trim();if(k==='tags'&&!raw.tags?.length){assert.equal(actual,'Chọn nhãn…');continue}assert.equal(actual,expected(raw,k,zone),`${identity(raw)} ${k}`);compared++}
    for(const badge of await row.locator('.wm-return-badge').all()){assert.ok(!(await badge.textContent()).includes('$'));assert.equal(await badge.getAttribute('data-tooltip'),raw.account_currency);assert.ok((await badge.getAttribute('aria-label')).endsWith(raw.account_currency))}
    seen.add(identity(raw))
   }
  }
  await compare(payload)
  await page.screenshot({path:`${out}/initial-${width}-${theme}.png`})
  if(payload.pagination.has_next){const wait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v2/replay/trades'&&new URL(r.url()).searchParams.get('page')==='2'&&r.ok());await ledger.getByRole('button',{name:'Trang sau',exact:true}).click();payload=await(await wait).json();await page.waitForFunction(n=>document.querySelectorAll('[data-testid="fx-trade-ledger"] tbody .fxa-detail-button').length===n,payload.ledger.length);await compare(payload)}
  assert.equal(seen.size,13)
  // Sort through the actual UI, preserving server row order and all cell values.
  for(const index of [8,19,20]){const wait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v2/replay/trades'&&new URL(r.url()).searchParams.get('sort_key')===keys[index]&&r.ok());await ledger.locator('thead .wm-table-sort').nth(index).click();payload=await(await wait).json();await page.waitForFunction(()=>document.querySelector('[data-testid="fx-trade-ledger"]')?.getAttribute('aria-busy')!=='true');await compare(payload)}
  // Detail identity and replay provenance must refer to the selected row.
  await ledger.locator('.fxa-detail-button').first().click();const dialog=page.getByRole('dialog',{name:'Chi tiết giao dịch'});await dialog.waitFor();const link=new URL(await dialog.locator('a').filter({hasText:'Replay'}).getAttribute('href'),origin),first=payload.ledger[0]
  assert.equal(link.searchParams.get('session'),first.session_id);assert.equal(link.searchParams.get('trade'),first.trade_id);assert.equal(link.searchParams.get('dataset'),first.dataset_id||first.source_provenance.dataset_id);assert.equal(link.searchParams.get('cursor'),String(first.close_cursor_index));assert.equal(link.searchParams.get('event_sequence'),String(first.close_event_sequence));await page.keyboard.press('Escape')
  await ledger.locator('.fxa-table-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth})
  await page.screenshot({path:`${out}/trades-${width}-${theme}.png`})
  report.checks.push({width,theme,zone,rows:seen.size,cellComparisons:compared,sorts:3,detailIdentity:true})
  // Labeled response fixture: portfolio trade asset differs from selected session asset.
  const fixture=structuredClone(payload);fixture.ledger[0].dataset_id='fixture-trade-asset';fixture.ledger[0].source_provenance.dataset_id='fixture-selected-session-asset';fixture.ledger[0].account_currency='EUR';fixture.ledger[0].gross_pnl=null;fixture.ledger[0].fees=null;fixture.ledger[0].net_pnl=1
  await context.route('**/api/v2/replay/trades?*',route=>route.fulfill({json:fixture}))
  await load(base);const fixtureCells=ledger.locator('tbody tr').first().locator('td');assert.equal(await fixtureCells.nth(21).textContent(),'—');assert.equal(await fixtureCells.nth(22).textContent(),'—');assert.equal(await fixtureCells.nth(10).locator('.wm-return-badge').getAttribute('data-tooltip'),'EUR');await ledger.locator('.fxa-detail-button').first().click();assert.equal(new URL(await page.getByRole('dialog').locator('a').filter({hasText:'Replay'}).getAttribute('href'),origin).searchParams.get('dataset'),'fixture-trade-asset')
  report.checks.push({width,fixture:'portfolio replay dataset priority',status:'PASS'})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;process.exitCode=1}
finally{await browser.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
