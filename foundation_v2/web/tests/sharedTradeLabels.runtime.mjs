// Owner-runtime read-only smoke: no assignment, terminal or broker mutations.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const [origin,out] = process.argv.slice(2)
assert.equal(origin,'http://127.0.0.1:5180');await mkdir(out,{recursive:true})
const browser=await chromium.launch(),errors=[],writes=[]
const context=await browser.newContext({viewport:{width:1920,height:940},reducedMotion:'reduce'})
await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(url.pathname);return route.abort()}return route.continue()})
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
let report
try {
 const headers={'X-Workspace-Id':'tenant-a'}
 const catalog=await (await context.request.get(`${origin}/api/v2/trade-labels`,{headers})).json()
 assert.equal(catalog.schema_version,'trade-labels-v1');assert(Array.isArray(catalog.groups));assert(Array.isArray(catalog.assignments))
 const index=await (await context.request.get(origin)).text()
 await page.goto(`${origin}/?workspace=tenant-a&view=settings&settings_tab=labels&lang=vi`)
 const manager=page.getByRole('region',{name:'Quản lý nhãn'});await manager.waitFor()
 const active=catalog.items.filter(item=>!item.archived)
 for(const label of active)await manager.locator('.wm-trade-label').getByText(label.name,{exact:true}).waitFor()
 await page.screenshot({path:`${out}/settings.png`,fullPage:true})
 await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=trades&lang=vi`)
 const grid=page.getByTestId('live-trade-grid');await grid.waitFor()
 const headersText=await grid.locator('thead th').allTextContents(),gross=headersText.findIndex(x=>x.includes('PnL trước phí'))
 assert(gross>=0);assert.equal(await grid.locator('tbody tr').first().locator('td').nth(gross).locator('.wm-return-badge').count(),1)
 const labels=grid.getByRole('button',{name:/Nhãn giao dịch position:/});await labels.first().click()
 const dialog=page.getByRole('dialog',{name:'Nhãn giao dịch',exact:true});await dialog.waitFor()
 for(const label of active)await dialog.getByRole('checkbox',{name:label.name,exact:true}).waitFor()
 await page.keyboard.press('Escape')
 await page.locator('.live-win-rate-row').screenshot({path:`${out}/win-rate.png`})
 await page.screenshot({path:`${out}/trades.png`,fullPage:true})
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
 report={passed:true,scope:'actual localhost5180/API8010 read-only; no tag/broker writes',activeLabels:active.length,tradeRows:await grid.locator('tbody tr').count(),index_sha256:createHash('sha256').update(index).digest('hex'),errors,writes}
} catch(error) {report={passed:false,error:error.stack,errors,writes};process.exitCode=1;await page.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{})}
finally {await browser.close();await writeFile(`${out}/runtime.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
