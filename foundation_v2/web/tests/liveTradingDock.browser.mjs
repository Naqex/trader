import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin=process.env.TW_LIVE_UI_ORIGIN || 'http://127.0.0.1:5188'
assert.equal(new URL(origin).hostname,'127.0.0.1')
const output=process.env.TW_LIVE_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/live-trading-ui-20261024/browser'
await mkdir(output,{recursive:true})
const copy=JSON.parse(await readFile(new URL('../src/testing-copy.json',import.meta.url))),vi=key=>copy[key]?.vi || key
const first='492ec8a5-3938-41a3-8a26-8c0f7f59ed43',second='492ec8a5-3938-41a3-8a26-8c0f7f59ed44'
let phase='ready',populated=false,requests=[],mode='demo',holdCommand=null,commandStatus='unknown'
const sockets=new Set(),report={fixture:true,brokerCalls:0,cases:[],errors:[],blocked:[],previews:[],commands:[]}
function snapshot(url) {
  const symbol=url.searchParams.get('symbol')||'EURUSDm',connection=url.searchParams.get('connection_id')||first
  const start=Math.floor(Date.now()/60000)*60-119*60
  return {status:'ready',mode,connection_id:connection,symbol,timeframe:'M1',reason:phase==='readonly'?'mt5_trading_access_required':'demo_ready',execution_enabled:phase!=='readonly',
    account:{login:connection===first?'fixture':'fixture2',server:'Fixture-Server',trade_mode:mode,currency:'USD',balance:10000,equity:10015,margin_free:9900},
    symbols:['EURUSDm','GBPUSDm'],instrument:{symbol,asset_class:'fx',tick_size:0.00001,quantity_min:0.01,quantity_max:10,quantity_step:0.01},
    policy:{source:'broker',max_quote_age_ms:5000},capabilities:{market:true,close:true,protect:true,cancel:true},
    quote:{bid:1.1,ask:1.1002,time_msc:Date.now()-(phase==='stale'?10000:0)},
    positions:populated?[{ticket:123,symbol,side:'BUY',volume:0.03,price_open:1.099,sl:1.098,tp:1.105,profit:15,managed:true}]:[],orders:[],requests,
    bars:Array.from({length:120},(_,i)=>({timestamp:start+i*60,open:1.1+Math.sin(i/8)*0.001,close:1.1+Math.sin((i+1)/8)*0.001,high:1.102,low:1.098,volume:100}))}
}
const server=createServer((req,res)=>{
  sockets.add(res);res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','access-control-allow-origin':'*'})
  const url=new URL(req.url,'http://localhost'),send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(url))}\n\n`)
  send();const timer=setInterval(send,200);req.on('close',()=>{clearInterval(timer);sockets.delete(res)})
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port,browser=await chromium.launch()
let current
const href=(connection=first,symbol='EURUSDm')=>`${origin}/?workspace=tenant-a&view=live&area=live&section=terminal&lang=vi&mt5_connection=${connection}&mt5_symbol=${symbol}&surface=workspace`
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
async function ready(page) {
  await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  await page.waitForFunction(()=>document.querySelector('.legacy-trading-bar .buy')?.disabled===false)
}
async function order(page,side='buy') {
  await page.locator(`.legacy-trading-bar .${side}`).click()
  const modal=page.getByRole('dialog',{name:'Lệnh mới',exact:true});await modal.waitFor();return modal
}
try {
  for (const [width,theme] of [[1920,'dark'],[1440,'light'],[768,'dark'],[390,'dark']]) {
    phase='ready';populated=false;requests=[];mode='demo'
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'}),page=await context.newPage();current=page
    page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.message))
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url())
      // Never forward MT5 writes. Both endpoints below return synthetic fixture data.
      if(req.method()==='POST'&&url.pathname==='/api/v2/live/trading/preview') {
        report.previews.push(req.postDataJSON());return route.fulfill({json:{passed:true,estimated_stop_risk:2,margin_required:30}})
      }
      if(req.method()==='POST'&&url.pathname==='/api/v2/live/trading/commands') {
        const body=req.postDataJSON();report.commands.push(body)
        if(holdCommand)await holdCommand
        const receipt={request_id:body.request_id,action:body.action,status:commandStatus,requires_reconciliation:commandStatus==='unknown'}
        requests=[receipt];return route.fulfill({json:receipt})
      }
      if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.blocked.push({path:url.pathname,method:req.method()});return route.abort()}
      if(url.pathname==='/api/v2/live/trading/events')return route.continue({url:`http://127.0.0.1:${port}/events${url.search}`})
      if(url.pathname==='/api/v2/live/trading')return route.fulfill({json:snapshot(url)})
      return route.continue()
    })
    await page.goto(href());await ready(page)
    if(await page.locator('.fx-app').getAttribute('data-theme')!==theme)await page.frameLocator('.advanced-chart-host iframe').getByTestId('theme-toggle').click()
    const chart=await page.locator('.advanced-chart-host iframe').elementHandle(),bar=page.locator('.legacy-trading-bar')
    assert.ok(await bar.evaluate(node=>{const box=node.getBoundingClientRect();return box.bottom<=innerHeight+1&&box.left>=0&&box.right<=innerWidth+1}))
    await page.screenshot({path:`${output}/dock-${width}-${theme}.png`})
    await page.getByRole('button',{name:'Mở danh sách lệnh',exact:true}).click()
    const panel=page.locator('#mt5-position-panel');await panel.getByText('Chưa có vị thế đang mở',{exact:true}).waitFor()
    await page.getByRole('tab',{name:'Vị thế đang mở',exact:true}).focus();await page.keyboard.press('ArrowRight')
    assert.equal(await page.getByRole('tab',{name:'Lệnh chờ',exact:true}).getAttribute('aria-selected'),'true')
    await page.keyboard.press('Home')
    const grip=page.locator('.legacy-positions-grip');await grip.focus();await page.keyboard.press('ArrowUp');await frames(page)
    const height=await page.locator('.legacy-resizable-positions').evaluate(node=>node.clientHeight)
    await grip.press('ArrowUp');await frames(page)
    assert.equal(await page.locator('.legacy-resizable-positions').evaluate(node=>node.clientHeight),height+30)
    const box=await grip.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-60);await page.mouse.up();await frames(page)
    assert.equal(await page.locator('.legacy-resizable-positions').evaluate(node=>node.clientHeight),height+90)
    await page.getByRole('button',{name:'Mở rộng danh sách lệnh',exact:true}).click();assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),1)
    await page.getByRole('button',{name:'Thu nhỏ danh sách lệnh',exact:true}).click();assert.ok(await chart.evaluate(node=>node.isConnected))
    populated=true;await panel.locator('.mt5-ticket-link').click()
    const detail=page.locator('.mt5-ticket-details');await detail.getByText('Fixture-Server').waitFor()
    await page.screenshot({path:`${output}/detail-${width}-${theme}.png`});await page.keyboard.press('Escape')
    await panel.getByRole('button',{name:'Sửa SL/TP',exact:true}).click()
    const protect=page.getByRole('dialog',{name:'Sửa SL/TP',exact:true});await protect.getByRole('spinbutton',{name:vi('Stop loss'),exact:true}).waitFor()
    phase='stale';await page.locator('.live-terminal-state').waitFor();assert.equal(await protect.getByRole('spinbutton',{name:vi('Stop loss'),exact:true}).isDisabled(),true)
    phase='ready';await page.locator('.live-terminal-state').waitFor({state:'hidden'});await page.keyboard.press('Escape')
    if(width===1920) {
      await panel.locator('.mt5-ticket-link').click();await detail.getByRole('button',{name:'Sửa SL/TP',exact:true}).click()
      await protect.waitFor();let release
      holdCommand=new Promise(resolve=>{release=resolve});commandStatus='done'
      await protect.getByRole('button',{name:'Xác nhận',exact:true}).click()
      try { assert.equal(await protect.getByRole('spinbutton',{name:vi('Stop loss'),exact:true}).isDisabled(),true) }
      finally { release();holdCommand=null }
      await protect.waitFor({state:'hidden'});await detail.waitFor({state:'hidden'})
      assert.equal(await page.getByRole('tab',{name:'Yêu cầu',exact:true}).getAttribute('aria-selected'),'true')
      assert.deepEqual(Object.keys(report.commands.at(-1)).sort(),['mode','connection_id','account_id','server','ticket','symbol','stop_loss','take_profit','action','request_id'].sort())
      commandStatus='unknown';await page.getByRole('tab',{name:'Vị thế đang mở',exact:true}).click()
    }
    await page.screenshot({path:`${output}/positions-${width}-${theme}.png`})
    await page.getByRole('button',{name:'Thu gọn danh sách lệnh',exact:true}).click()
    await page.getByRole('button',{name:'Scalper mode',exact:true}).click()
    const scalper=page.getByRole('dialog',{name:'Scalper mode',exact:true})
    await scalper.getByRole('switch',{name:vi('Stop loss'),exact:true}).check();await scalper.getByRole('switch',{name:vi('Take profit'),exact:true}).check()
    assert.equal(await scalper.getByRole('button',{name:'Pips',exact:true}).first().isDisabled(),true)
    await scalper.getByRole('spinbutton',{name:'Khoảng cách Stop loss',exact:true}).fill('20')
    await scalper.getByRole('spinbutton',{name:'Khoảng cách Take profit',exact:true}).fill('40')
    assert.equal(await scalper.getByRole('button',{name:'Ticks',exact:true}).first().getAttribute('aria-pressed'),'true')
    await page.screenshot({path:`${output}/scalper-${width}-${theme}.png`});await scalper.locator('.legacy-scalper-save').click()
    await page.getByRole('spinbutton',{name:vi('Khối lượng nhanh'),exact:true}).fill('0.02');await page.getByRole('button',{name:'Tăng khối lượng',exact:true}).click()
    assert.equal(await page.getByRole('spinbutton',{name:vi('Khối lượng nhanh'),exact:true}).inputValue(),'0.03')
    const commandsBefore=report.commands.length
    let modal=await order(page)
    assert.equal(await modal.getByRole('spinbutton',{name:'Khối lượng lệnh',exact:true}).inputValue(),'0.03')
    assert.equal(await modal.getByRole('spinbutton',{name:vi('Stop loss'),exact:true}).inputValue(),'1.1')
    assert.equal(await modal.getByRole('spinbutton',{name:vi('Take profit'),exact:true}).inputValue(),'1.1006')
    assert.equal(report.commands.length,commandsBefore)
    await modal.getByRole('button',{name:'Kiểm tra lệnh',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.legacy-order-save')?.disabled===false)
    assert.ok(await modal.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'order dialog has no horizontal overflow')
    assert.ok(await modal.locator('footer button').evaluateAll(nodes=>nodes.every(node=>node.scrollHeight<=node.clientHeight+1)),'footer labels fit their controls')
    await page.screenshot({path:`${output}/order-${width}-${theme}.png`})
    await modal.getByRole('spinbutton',{name:'Khối lượng lệnh',exact:true}).fill('0.04')
    assert.equal(await modal.getByRole('button',{name:'Xem và xác nhận lệnh',exact:true}).isDisabled(),true)
    await page.keyboard.press('Escape')
    modal=await order(page,'sell');assert.equal(await modal.getByRole('spinbutton',{name:vi('Stop loss'),exact:true}).inputValue(),'1.1002');await page.keyboard.press('Escape')
    await page.reload();await ready(page)
    assert.equal(await page.getByRole('button',{name:'Scalper mode',exact:true}).getAttribute('aria-pressed'),'true')
    if(width===1920) {
      await page.goto(href(second,'GBPUSDm'));await ready(page)
      assert.equal(await page.getByRole('button',{name:'Scalper mode',exact:true}).getAttribute('aria-pressed'),'false')
      await page.goto(href());await ready(page)
      assert.equal(await page.getByRole('button',{name:'Scalper mode',exact:true}).getAttribute('aria-pressed'),'true')
      mode='real';await page.locator('.legacy-trading-bar .live-badge').filter({hasText:'Real'}).waitFor()
      modal=await order(page);await modal.getByRole('button',{name:'Kiểm tra lệnh',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.legacy-order-save')?.disabled===false)
      await modal.getByRole('button',{name:'Xem và xác nhận lệnh',exact:true}).click()
      const confirm=page.getByRole('dialog',{name:'Xác nhận lệnh MT5',exact:true});await confirm.locator('strong').filter({hasText:'#fixture'}).waitFor()
      await page.waitForFunction(()=>document.querySelector('.live-terminal-confirm .is-primary')?.disabled===true,{},{timeout:7000})
      assert.equal(report.commands.length,commandsBefore)
      await confirm.getByRole('button',{name:'Kiểm tra lệnh',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.live-terminal-confirm .is-primary')?.disabled===false)
      await confirm.getByRole('button',{name:'Gửi lệnh MT5',exact:true}).click();await confirm.waitFor({state:'hidden'})
      assert.equal(report.commands.length,commandsBefore+1)
      assert.equal(report.commands.at(-1).mode,'real');assert.equal(report.commands.at(-1).connection_id,first)
      assert.equal(report.commands.at(-1).account_id,'fixture');assert.equal(report.commands.at(-1).server,'Fixture-Server')
      await page.waitForFunction(()=>document.querySelector('.legacy-trading-bar .buy')?.disabled===true)
      await page.reload();await page.locator('[data-chart-status=ready]').waitFor()
      assert.equal(await bar.locator('.buy').isDisabled(),true);assert.equal(report.commands.length,commandsBefore+1)
      requests=[];await page.evaluate(()=>sessionStorage.clear());mode='demo';await page.reload();await ready(page)
    }
    phase='readonly';await page.waitForFunction(()=>document.querySelector('.legacy-trading-bar .buy')?.disabled===true)
    assert.equal(await bar.locator('.sell').isDisabled(),true)
    phase='ready';await ready(page)
    report.cases.push({width,theme,sharedDock:true,resizeAndKeyboard:true,details:true,staleProtectionLocked:true,scalperTicksAndPersistence:true,quickDraftOnly:true,previewInvalidation:true,readOnlyLocked:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.result='PASS'
} catch(error) {report.result='FAIL';report.failure=error.stack;report.buttons=await current?.locator('#mt5-position-panel button').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,label:node.getAttribute('aria-label')}))).catch(()=>[]);await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});process.exitCode=1}
finally {await browser.close();for(const socket of sockets)socket.end();await new Promise(resolve=>server.close(resolve));await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
