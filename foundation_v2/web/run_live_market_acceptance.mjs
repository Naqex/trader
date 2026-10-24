import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {installBrowserAnnotationFixture,checkBrowserChartAnnotations} from './tests/browserChartAnnotationChecks.mjs'
const origin=process.env.TW_LIVE_UI_ORIGIN||'http://127.0.0.1:5180',output=process.env.TW_LIVE_UI_EVIDENCE||'E:/BACKUP-TRADINGWORKSPACE/live-market-ui'
await mkdir(output,{recursive:true})
let phase='ready',connections=0,holdHourly=false
const sockets=new Set()
const value=url=>{const symbol=url.searchParams.get('symbol')||'EURUSDm',timeframe=url.searchParams.get('timeframe')||'M1';const step={M1:60,M5:300,M15:900,H1:3600,H4:14400,D1:86400}[timeframe],start=Math.floor(Date.now()/1000/step)*step-119*step
return {status:phase==='unavailable'?'unavailable':'ready',reason:phase==='unavailable'?'mt5_connection_not_ready':'demo_ready',mode:'demo',symbol,timeframe,execution_enabled:phase!=='unavailable',account:phase==='unavailable'?undefined:{login:'fixture',server:'Fixture-Demo',trade_mode:'demo',currency:'USD',balance:10000,equity:10000,margin_free:10000},symbols:phase==='empty'?[]:['EURUSDm','GBPUSDm','XAUUSDm','BTCUSDm','AAPLm','USOILm'],instrument:{asset_class:'fx',quantity_min:0.01,quantity_max:10,quantity_step:0.01,tick_size:0.00001},policy:{source:'broker',max_quote_age_ms:5000},capabilities:{market:true},quote:{bid:1.1,ask:1.1002,time_msc:phase==='invalid'?1e20:Date.now()-(phase==='stale'?21600000:phase==='future'?-60000:0)},positions:[],orders:[],requests:Array.from({length:23},(_,i)=>({request_id:`fixture-${i}`,action:'protect',status:'done'})),bars:phase==='unavailable'?[]:Array.from({length:120},(_,i)=>({timestamp:start+i*step,open:1.1+Math.sin(i/8)*0.001,close:1.1+Math.sin((i+1)/8)*0.001,high:1.102,low:1.098,volume:100}))}}
const server=createServer((req,res)=>{connections++;sockets.add(res);res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','access-control-allow-origin':'*'});const url=new URL(req.url,'http://localhost');const send=()=>{if(holdHourly&&url.searchParams.get('timeframe')==='H1')return;res.write(`event: snapshot\ndata: ${JSON.stringify(value(url))}\n\n`)};send();const timer=setInterval(send,500);req.on('close',()=>{clearInterval(timer);sockets.delete(res)})})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port
const browser=await chromium.launch(),report={cases:[],errors:[],mutations:[],fixture:true}
let current
try{
 for(const [width,theme] of [[1920,'dark'],[1440,'light'],[768,'dark'],[390,'dark']]){
 phase='ready';const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce',timezoneId:'Asia/Ho_Chi_Minh'}),page=await context.newPage();current=page
 page.on('pageerror',e=>report.errors.push(e.message))
 if(process.env.TW_TEST_BROWSER_ANNOTATIONS==='1')await installBrowserAnnotationFixture(context)

 await context.route('**/api/**',async r=>{const req=r.request(),url=new URL(req.url());if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.mutations.push(req.url());return r.abort()}if(url.pathname==='/api/v2/live/status')return r.fulfill({json:{status:'ready',connection_id:'492ec8a5-3938-41a3-8a26-8c0f7f59ed43',account:{currency:'USD'},account_binding:{login:'fixture'},history_from_utc:new Date(Date.now()-86400000).toISOString(),captured_at_utc:new Date().toISOString(),deals:[{type:0,profit:100,commission:-2,swap:-1,fee:0,time_msc:Date.now()-60000},{type:2,profit:10000}]}});if(url.pathname==='/api/v2/live/trading/events')return r.continue({url:`http://127.0.0.1:${port}/events${url.search}`});return r.continue()})
 let mounts=0,detaches=0;page.on('frameattached',()=>mounts++);page.on('framedetached',()=>detaches++)
 await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=terminal&lang=vi&mt5_connection=492ec8a5-3938-41a3-8a26-8c0f7f59ed43&surface=workspace&mt5_timeframe=M1&mt5_symbol=EURUSDm`)
 await page.locator('[data-chart-status="ready"]').waitFor({timeout:30000});const frame=page.frameLocator('.advanced-chart-host iframe')
 if(process.env.TW_TEST_BROWSER_ANNOTATIONS==='1')await checkBrowserChartAnnotations(page)
 if(await page.locator('.fx-app').getAttribute('data-theme')!==theme)await frame.getByTestId('theme-toggle').click()
 assert.equal(await page.locator('.chart-trading-account .live-badge').count(),0)
 await page.getByRole('button',{name:'Thông tin tài khoản',exact:true}).click()
 const wallet=page.locator('.legacy-account-details')
 await wallet.waitFor();assert.equal(await wallet.locator('dd').count(),3);await wallet.locator('dd.is-gain').waitFor();assert.equal(await wallet.locator('dd.is-gain').count(),1);assert.match(await wallet.innerText(),/97\.00/);assert.match(await wallet.innerText(),/PnL đã chốt/);assert.match(await wallet.innerText(),/PnL chưa chốt/)
 assert.match(await wallet.innerText(),/10,000\.00/)
 await page.screenshot({path:`${output}/wallet-${width}-${theme}.png`})
 await page.keyboard.press('Escape');await wallet.waitFor({state:'hidden'})
 assert.equal(await frame.locator('.legacy-native-tools .legacy-divider').count(),0)
 assert.equal(await frame.locator('.legacy-live-interval').count(),0)
 await frame.locator('#header-toolbar-intervals').waitFor()
 await page.getByRole('button',{name:'Danh sách đối tượng biểu đồ',exact:true}).click()
 await page.locator('#live-objects-panel').waitFor();await page.locator('#live-objects-panel .legacy-object-tree').waitFor();assert.equal(await page.getByRole('dialog').count(),0)
 await page.screenshot({path:`${output}/objects-${width}-${theme}.png`})
 await page.locator('#live-objects-panel').getByRole('button',{name:'Đóng bảng điều khiển',exact:true}).click()
 await page.getByRole('button',{name:'Mở danh sách lệnh',exact:true}).click()
 await page.getByRole('tab',{name:'Yêu cầu',exact:true}).click()
 const ledger=page.locator('#mt5-position-panel');assert.equal(await ledger.locator('tbody tr').count(),10)
 await ledger.getByRole('button',{name:'Trang sau',exact:true}).click();await ledger.getByRole('button',{name:'Trang sau',exact:true}).click();assert.equal(await ledger.locator('tbody tr').count(),3)
 await page.screenshot({path:`${output}/requests-${width}-${theme}.png`})
 await page.getByRole('button',{name:'Thu gọn danh sách lệnh',exact:true}).click()
 const before=await page.locator('.chart-canvas').boundingBox();const initialMounts=mounts,initialDetaches=detaches
 phase='stale';await page.locator('.live-terminal-state').filter({hasText:'Giá cũ: tạm khóa gửi lệnh'}).waitFor();assert.match(await page.locator('.live-terminal-state').innerText(),/6 giờ trước/);
 assert.equal(await page.locator('.wm-notifications .live-terminal-state').count(),1)
 const noticeBox=await page.locator('.live-terminal-state').boundingBox();assert.ok(noticeBox.x>=0&&noticeBox.x<width/2);assert.ok(noticeBox.y>470&&noticeBox.y+noticeBox.height<940);assert.ok(noticeBox.x+noticeBox.width<=width);assert.ok(noticeBox.y+noticeBox.height<=(await page.locator('.legacy-trading-bar').boundingBox()).y)
 assert.equal(await page.locator('.live-trading > .live-terminal-state').count(),0);assert.equal(await page.locator('.legacy-trading-bar button.buy').isDisabled(),true);await assert.doesNotReject(async()=>assert.deepEqual(await page.locator('.chart-canvas').boundingBox(),before));await page.screenshot({path:`${output}/stale-${width}-${theme}.png`})
 phase='unavailable';await page.locator('.live-terminal-state').filter({hasText:'chưa sẵn sàng'}).waitFor();assert.equal(await page.locator('.legacy-trading-bar button.buy').isDisabled(),true);assert.equal(await page.locator('[data-chart-status="ready"]').count(),1)
 phase='ready';await page.locator('.live-terminal-state').waitFor({state:'hidden'});assert.equal(await page.locator('.legacy-trading-bar button.buy').isDisabled(),false);assert.deepEqual(await page.locator('.chart-canvas').boundingBox(),before);assert.equal(mounts,initialMounts);assert.equal(detaches,initialDetaches)
 await frame.locator('.legacy-symbol').click();const popup=page.getByRole('dialog',{name:'Chọn mã giao dịch MT5',exact:true}),search=popup.getByRole('searchbox');await search.waitFor();await search.evaluate(n=>new Promise(resolve=>requestAnimationFrame(()=>resolve(n===n.ownerDocument.activeElement)))) .then(value=>assert.equal(value,true))
 const box=await popup.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(box.y+box.height<=941);assert.ok(Math.abs(box.x+box.width/2-width/2)<=1);assert.ok(Math.abs(box.y+box.height/2-470)<=1);assert.equal(await popup.getAttribute('aria-modal'),'true');assert.equal(await popup.getByRole('button',{name:'M1',exact:true}).count(),0)
 await popup.getByRole('button',{name:'Forex',exact:true}).click();assert.equal(await popup.getByRole('option').count(),2)
 await popup.getByRole('button',{name:'Kim loại',exact:true}).click();assert.equal(await popup.getByRole('option').count(),1);assert.match(await popup.getByRole('option').innerText(),/XAUUSDm/)
 await popup.getByRole('button',{name:'Crypto',exact:true}).click();assert.equal(await popup.getByRole('option').count(),1)
 await popup.getByRole('button',{name:'Chưa phân loại',exact:true}).click();assert.equal(await popup.getByRole('option').count(),2)
 await popup.getByRole('button',{name:'Tất cả',exact:true}).click();await search.fill('ZZZ');await popup.getByRole('status').waitFor();assert.equal(await popup.getByRole('option').count(),0)
 await search.fill('');await page.screenshot({path:`${output}/picker-${width}-${theme}.png`});await search.press('Escape');await popup.waitFor({state:'hidden'});assert.equal(await frame.locator('.legacy-symbol').evaluate(n=>n===n.ownerDocument.activeElement),true)
 await frame.locator('.legacy-symbol').click();await popup.getByRole('searchbox').fill('GBP');await popup.getByRole('searchbox').press('ArrowDown');await page.keyboard.press('Enter');await page.waitForURL(/mt5_symbol=GBPUSDm/);await page.locator('[data-chart-status="ready"]').waitFor();assert.match(await frame.locator('.legacy-symbol').innerText(),/GBPUSDm/)
 assert.equal(new URL(page.url()).searchParams.get('mt5_timeframe'),'M1')
 const timeframeMounts=mounts,timeframeDetaches=detaches
 const five=frame.locator('#header-toolbar-intervals > [data-value="5"]')
 if(await five.isVisible())await five.click();else{await frame.locator('#header-toolbar-intervals [class*=menu-]').click();await frame.getByText('5 phút',{exact:true}).click()}
 await page.waitForURL(/mt5_timeframe=M5/);await frame.locator('#header-toolbar-intervals > [data-value="5"][class*=isActive]').waitFor();await page.locator('.live-terminal-state').waitFor({state:'hidden'})
 assert.equal(new URL(page.url()).searchParams.get('mt5_symbol'),'GBPUSDm');assert.equal(mounts,timeframeMounts);assert.equal(detaches,timeframeDetaches)
 await frame.locator('.legacy-symbol').click();await popup.getByRole('searchbox').fill('XAU');phase='unavailable';await popup.getByRole('status').filter({hasText:'Đang kết nối lại'}).waitFor();assert.equal(await popup.getByRole('option').isDisabled(),true);await popup.getByRole('searchbox').press('Enter');assert.equal(await popup.count(),1)
 phase='ready';await popup.getByRole('option').waitFor();await popup.getByRole('searchbox').press('Escape');await popup.waitFor({state:'hidden'})
 phase='future';await page.locator('.live-terminal-state').filter({hasText:'đi trước đồng hồ máy'}).waitFor();assert.equal(await page.locator('.legacy-trading-bar button.buy').isDisabled(),true)
 phase='invalid';await page.locator('.live-terminal-state').filter({hasText:'đã cũ hoặc lệch thời gian'}).waitFor();assert.equal(await page.locator('[data-chart-status="ready"]').count(),1)
 phase='empty';await page.locator('.live-terminal-state').waitFor({state:'hidden'});await frame.locator('.legacy-symbol').click();await popup.getByRole('status').filter({hasText:'Chưa có danh sách mã'}).waitFor();assert.equal(await popup.getByRole('option').count(),0);await popup.getByRole('searchbox').press('Escape');phase='ready'

 for(const socket of sockets)socket.end();await page.locator('.live-terminal-state').waitFor();await page.locator('.live-terminal-state').waitFor({state:'hidden'});assert.equal(await page.locator('[data-chart-status="ready"]').count(),1)
 await page.screenshot({path:`${output}/chart-${width}-${theme}.png`});
 if(width===1920){
   await page.reload();await page.locator('[data-chart-status=ready]').waitFor();await frame.locator('#header-toolbar-intervals > [data-value="5"][class*=isActive]').waitFor()
   let releaseLibrary, libraryRequested
   const libraryWait=new Promise(resolve=>{libraryRequested=resolve}),libraryHold=new Promise(resolve=>{releaseLibrary=resolve})
   const delayedLibrary=async route=>{libraryRequested();await libraryHold;await route.continue()}
   await page.route('**/charting_library.standalone.js*',delayedLibrary)
   await page.reload({waitUntil:'domcontentloaded'});await libraryWait
   await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('mt5_timeframe','H1');history.pushState({},'',url);dispatchEvent(new PopStateEvent('popstate'))})
   await page.waitForURL(/mt5_timeframe=H1/);holdHourly=true;releaseLibrary()
   await page.locator('.advanced-chart-host iframe').waitFor({state:'attached'})
   holdHourly=false
   await page.locator('[data-chart-status=ready]').waitFor();await frame.locator('#header-toolbar-intervals > [data-value="60"][class*=isActive]').waitFor()
   assert.equal(new URL(page.url()).searchParams.get('mt5_timeframe'),'H1')
   await page.unroute('**/charting_library.standalone.js*',delayedLibrary)
   const lightUrl=new URL(page.url());lightUrl.searchParams.set('chart_engine','lightweight');await page.goto(lightUrl.href)
   const picker=page.locator('.live-terminal-toolbar').getByRole('button',{name:'Khung thời gian MT5',exact:true});await picker.click();await page.getByRole('option',{name:'H1',exact:true}).click();await page.waitForURL(/mt5_timeframe=H1/)
   await page.locator('.live-terminal-toolbar').getByRole('button',{name:'Chọn mã giao dịch MT5',exact:true}).click();await popup.waitFor();await popup.getByRole('searchbox').fill('BTC');await popup.getByRole('searchbox').press('Enter');await page.waitForURL(/mt5_symbol=BTCUSDm/);assert.equal(new URL(page.url()).searchParams.get('mt5_timeframe'),'H1')
 }
 report.cases.push({width,theme,browserAnnotations:process.env.TW_TEST_BROWSER_ANNOTATIONS==='1'?'fixture-pass':'not-tested',stableGeometry:true,retainsChartOnUnavailable:true,blocksOrders:true,keyboardSearchAndFocus:true,centeredDialog:true,categoryFiltering:true,unclassifiedAndEmpty:true,unavailableSelectionBlocked:true,quoteAgeAndFutureWarning:true,symbolNavigationPreservesTimeframe:true,reconnect:true})
 await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[])
}catch(e){report.failure=e.stack;await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});process.exitCode=1}
finally{await browser.close();for(const socket of sockets)socket.end();await new Promise(resolve=>server.close(resolve));report.connections=connections;await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
