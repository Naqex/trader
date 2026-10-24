import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const origin=process.env.TW_MT5_TOOLS_UI_ORIGIN||'http://127.0.0.1:5193'
const output=process.env.TW_MT5_TOOLS_EVIDENCE||'E:/BACKUP-TRADINGWORKSPACE/mt5-tools-20261024/browser'
const id='492ec8a5-3938-41a3-8a26-8c0f7f59ed43'
await mkdir(output,{recursive:true})
const catalog=[{symbol:'EURUSDm',category:'Majors'},{symbol:'OPAQUE',category:'Crypto',description:'Bitcoin vs US Dollar'},
  {symbol:'AAPLm',path:'Shares\\US',description:'Apple Inc.'},{symbol:'US30m',path:'CFD\\Indices'},
  {symbol:'MYSTERY',category:'Broker Special'}].map(s=>({...s,source:'mt5_sdk'}))
const snapshot=url=>{const symbol=url.searchParams.get('symbol')||'EURUSDm',start=Math.floor(Date.now()/60000)*60-119*60
  return {status:'ready',reason:'demo_ready',mode:'demo',connection_id:id,requested_mode:'read_only',execution_enabled:false,
    account:{login:'fixture',server:'Fixture',trade_mode:'demo',currency:'USD',balance:10000,equity:10000,margin_free:10000},
    symbols:catalog.map(s=>s.symbol),symbol,timeframe:'M1',instrument:{asset_class:'fx',quantity_min:.01,quantity_max:10,quantity_step:.01,tick_size:.00001},
    quote:{bid:1.1,ask:1.1002,time_msc:Date.now()},policy:{source:'application',max_quote_age_ms:5000},positions:[],orders:[],requests:[],
    bars:Array.from({length:120},(_,i)=>({timestamp:start+i*60,open:1.1,high:1.102,low:1.098,close:1.1+i*.00001,volume:100}))}}
const streams=new Set(),sse=createServer((req,res)=>{streams.add(res);res.writeHead(200,{'content-type':'text/event-stream','access-control-allow-origin':'*'});const url=new URL(req.url,'http://localhost');const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(url))}\n\n`);send();const timer=setInterval(send,500);req.on('close',()=>{clearInterval(timer);streams.delete(res)})})
await new Promise(resolve=>sse.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch(), report={fixture:true,brokerCalls:0,mutations:[],errors:[],cases:[]}
try {
  for(const width of [1440,768,390]) {
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'}),page=await context.newPage()
    let metadataReads=0,unavailable=false
    page.on('pageerror',error=>report.errors.push(error.message))
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url())
      if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.mutations.push(req.url());return route.abort()}
      if(url.pathname===`/api/v2/ai/assistant/mt5/${id}/symbols`){metadataReads++;return unavailable?route.fulfill({status:503,json:{detail:'mt5_connection_not_ready'}}):route.fulfill({json:{provenance:{read_only:true},data:{items:catalog}}})}
      if(url.pathname==='/api/v2/live/trading/events')return route.continue({url:`http://127.0.0.1:${sse.address().port}/events${url.search}`})
      if(url.pathname==='/api/v2/live/trading')return route.fulfill({json:snapshot(url)})
      if(url.pathname==='/api/v2/live/status')return route.fulfill({json:{status:'ready',connection_id:id,account:{currency:'USD'},captured_at_utc:new Date().toISOString(),deals:[]}})
      if(url.pathname==='/api/v2/live/connections')return route.fulfill({json:{items:[{id,name:'Read-only fixture',requested_mode:'read_only',status:'connected'}]}})
      if(url.pathname==='/api/v2/ai/assistant/sources')return route.fulfill({json:{items:[{kind:'mt5_symbols',id,name:'Read-only fixture'},{kind:'mt5_indicators',id,name:'Read-only fixture'}]}})
      if(url.pathname==='/api/v2/ai/assistant/workflows')return route.fulfill({json:{items:[],next:null}})
      // All other API reads are isolated too; fixture journeys never reach a broker.
      return route.fulfill({json:{items:[],status:'unavailable'}})
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=terminal&lang=vi&mt5_connection=${id}&surface=workspace&mt5_timeframe=M1`)
    await page.locator('[data-chart-status="ready"]').waitFor({timeout:30000})
    const frame=page.frameLocator('.advanced-chart-host iframe')
    await frame.locator('.legacy-symbol').click()
    const dialog=page.getByRole('dialog',{name:'Chọn mã giao dịch MT5',exact:true}),search=dialog.getByRole('searchbox')
    await dialog.getByText('Phân nhóm từ thông tin broker.',{exact:true}).waitFor()
    await dialog.getByRole('button',{name:'Cổ phiếu',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),1)
    await dialog.getByRole('button',{name:'Tất cả',exact:true}).click();await search.fill('bitcoin');assert.match(await dialog.getByRole('option').innerText(),/OPAQUE/)
    await search.fill('Apple');assert.match(await dialog.getByRole('option').innerText(),/AAPLm/)
    await search.fill('');await dialog.getByRole('button',{name:'Chưa phân loại',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),1)
    assert.match(await dialog.getByRole('option').innerText(),/MYSTERY/)
    await dialog.getByRole('button',{name:'Tất cả',exact:true}).click()
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=941)
    await page.screenshot({path:`${output}/catalog-${width}.png`})
    assert.equal(metadataReads,1)
    await search.press('Escape');await dialog.waitFor({state:'hidden'})
    unavailable=true;await frame.locator('.legacy-symbol').click();await dialog.getByText('Phân nhóm theo mã tài sản.',{exact:true}).waitFor()
    await search.fill('EURUSD');assert.equal(await dialog.getByRole('option').count(),1)
    await search.press('Escape');await dialog.waitFor({state:'hidden'})
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=workflows&lang=vi`)
    const source=page.getByRole('button',{name:'Nguồn dữ liệu chỉ đọc',exact:true});await source.click()
    await page.getByRole('option').filter({hasText:'Danh mục MT5'}).click()
    await page.getByText('Chỉ đọc · dữ liệu có thể lưu đệm tối đa 60 giây',{exact:true}).waitFor()
    report.cases.push({width,metadataReads,brokerGrouping:true,descriptionSearch:true,unknown:true,fallback:true,aiSource:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[])
} finally {await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();for(const stream of streams)stream.destroy();await new Promise(resolve=>sse.close(resolve))}
console.log(JSON.stringify(report))
