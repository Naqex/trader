import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const origin=process.env.TW_LIVE_UI_ORIGIN||'http://127.0.0.1:5180',output=process.env.TW_LIVE_UI_EVIDENCE||'E:/BACKUP-TRADINGWORKSPACE/live-market-ui'
await mkdir(output,{recursive:true})
let phase='ready',connections=0
const sockets=new Set()
const value=url=>{const symbol=url.searchParams.get('symbol')||'EURUSDm',timeframe=url.searchParams.get('timeframe')||'M1';const step={M1:60,M5:300,M15:900,H1:3600,H4:14400,D1:86400}[timeframe],start=Math.floor(Date.now()/1000/step)*step-119*step
return {status:phase==='unavailable'?'unavailable':'ready',reason:phase==='unavailable'?'mt5_connection_not_ready':'demo_ready',mode:'demo',symbol,timeframe,execution_enabled:phase!=='unavailable',account:phase==='unavailable'?undefined:{login:'fixture',server:'Fixture-Demo',trade_mode:'demo',currency:'USD',balance:10000,equity:10000,margin_free:10000},symbols:['EURUSDm','GBPUSDm','XAUUSDm'],instrument:{asset_class:'fx',quantity_min:0.01,quantity_max:10,quantity_step:0.01,tick_size:0.00001},policy:{source:'broker',max_quote_age_ms:5000},capabilities:{market:true},quote:{bid:1.1,ask:1.1002,time_msc:Date.now()-(phase==='stale'?10000:0)},positions:[],orders:[],requests:[],bars:phase==='unavailable'?[]:Array.from({length:120},(_,i)=>({timestamp:start+i*step,open:1.1+Math.sin(i/8)*0.001,close:1.1+Math.sin((i+1)/8)*0.001,high:1.102,low:1.098,volume:100}))}}
const server=createServer((req,res)=>{connections++;sockets.add(res);res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','access-control-allow-origin':'*'});const url=new URL(req.url,'http://localhost');const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(value(url))}\n\n`);send();const timer=setInterval(send,500);req.on('close',()=>{clearInterval(timer);sockets.delete(res)})})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port
const browser=await chromium.launch(),report={cases:[],errors:[],mutations:[],fixture:true}
let current
try{
 for(const [width,theme] of [[1920,'dark'],[1440,'light'],[768,'dark'],[390,'dark']]){
 phase='ready';const context=await browser.newContext({viewport:{width,height:940}}),page=await context.newPage();current=page
 page.on('pageerror',e=>report.errors.push(e.message))

 await context.route('**/api/**',async r=>{const req=r.request(),url=new URL(req.url());if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.mutations.push(req.url());return r.abort()}if(url.pathname==='/api/v2/live/trading/events')return r.continue({url:`http://127.0.0.1:${port}/events${url.search}`});return r.continue()})
 let mounts=0,detaches=0;page.on('frameattached',()=>mounts++);page.on('framedetached',()=>detaches++)
 await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=terminal&lang=vi&mt5_connection=492ec8a5-3938-41a3-8a26-8c0f7f59ed43&surface=workspace&mt5_timeframe=M1&mt5_symbol=EURUSDm`)
 await page.locator('[data-chart-status="ready"]').waitFor({timeout:30000});const frame=page.frameLocator('.advanced-chart-host iframe')
 if(await page.locator('.fx-app').getAttribute('data-theme')!==theme)await frame.getByTestId('theme-toggle').click()
 const before=await page.locator('.chart-canvas').boundingBox();const initialMounts=mounts,initialDetaches=detaches
 phase='stale';await page.locator('.live-terminal-state').waitFor();await assert.doesNotReject(async()=>assert.deepEqual(await page.locator('.chart-canvas').boundingBox(),before))
 phase='unavailable';await page.locator('.live-terminal-state').filter({hasText:'chưa sẵn sàng'}).waitFor();assert.equal(await page.locator('.legacy-trading-bar button.buy').isDisabled(),true);assert.equal(await page.locator('[data-chart-status="ready"]').count(),1)
 phase='ready';await page.locator('.live-terminal-state').waitFor({state:'hidden'});assert.deepEqual(await page.locator('.chart-canvas').boundingBox(),before);assert.equal(mounts,initialMounts);assert.equal(detaches,initialDetaches)
 await frame.locator('.legacy-symbol').click();const popup=frame.getByRole('dialog',{name:'Chọn mã giao dịch MT5',exact:true}),search=popup.getByRole('searchbox');await search.waitFor();assert.equal(await search.evaluate(n=>n===n.ownerDocument.activeElement),true)
 const box=await popup.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(box.y+box.height<=941)
 await search.fill('ZZZ');await popup.getByRole('status').waitFor();assert.equal(await popup.getByRole('option').count(),0)
 await search.fill('GBP');await page.screenshot({path:`${output}/picker-${width}-${theme}.png`});await search.press('Escape');await popup.waitFor({state:'hidden'});assert.equal(await frame.locator('.legacy-symbol').evaluate(n=>n===n.ownerDocument.activeElement),true)
 await frame.locator('.legacy-symbol').click();await popup.getByRole('searchbox').fill('GBP');await popup.getByRole('searchbox').press('ArrowDown');await page.keyboard.press('Enter');await page.waitForURL(/mt5_symbol=GBPUSDm/);await page.locator('[data-chart-status="ready"]').waitFor();assert.match(await frame.locator('.legacy-symbol').innerText(),/GBPUSDm/)
 await frame.locator('.legacy-symbol').click();await popup.getByRole('button',{name:'M5',exact:true}).click();await page.waitForURL(/mt5_timeframe=M5/);await page.locator('[data-chart-status="ready"]').waitFor()
 for(const socket of sockets)socket.end();await page.locator('.live-terminal-state').waitFor();await page.locator('.live-terminal-state').waitFor({state:'hidden'});assert.equal(await page.locator('[data-chart-status="ready"]').count(),1)
 await page.screenshot({path:`${output}/chart-${width}-${theme}.png`});report.cases.push({width,theme,stableGeometry:true,retainsChartOnUnavailable:true,blocksOrders:true,keyboardSearchAndFocus:true,symbolAndTimeframeNavigation:true,reconnect:true})
 await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[])
}catch(e){report.failure=e.stack;await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});process.exitCode=1}
finally{await browser.close();for(const socket of sockets)socket.end();await new Promise(resolve=>server.close(resolve));report.connections=connections;await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
