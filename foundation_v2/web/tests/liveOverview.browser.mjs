// Production-build UI fixture: synthetic account/bars, no terminal or broker.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const [origin,output]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
assert.notEqual(new URL(origin).port,'5180','Use isolated preview')
await mkdir(output,{recursive:true})
const account={login:999111,server:'SYNTHETIC - NO BROKER',account_ref:'…111',currency:'USD',balance:10000,equity:10024,profit:24,margin:100,margin_free:9924,leverage:100,trade_mode:'demo'}
const bars=Array.from({length:150},(_,i)=>({timestamp:1792742400+i*60,open:1.1+i*.00001,high:1.1005+i*.00001,low:1.0995+i*.00001,close:1.1001+i*.00001,volume:100}))
const snapshot={status:'ready',mode:'demo',account,symbol:'EURUSD',timeframe:'M1',bars,positions:[],orders:[],requests:[],quote:{bid:1.1,ask:1.1002,time_msc:Date.now()},instrument:{tick_size:.00001,quantity_min:.01,quantity_max:10,quantity_step:.01,asset_class:'fx'},policy:{source:'broker',max_quote_age_ms:5000},capabilities:{}}
const history={status:'ready',connection_id:'fixture',account,history_from_utc:'2026-10-23T00:00:00Z',captured_at_utc:'2026-10-24T00:00:00Z',deals:[{type:2,profit:10000},{type:0,profit:30,commission:-2,swap:-1,fee:-1}]}
let scenario='ready', releaseMarket, marketRequested, streamCount=0
const streams=new Set(), report={scope:'Synthetic GET-only fixture and real chart engine',cases:[],errors:[],mutations:[]}
const server=createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*')
 if(req.method==='OPTIONS'){res.end();return}
 if(req.method!=='GET'){report.mutations.push(req.url);res.statusCode=405;res.end();return}
 const url=new URL(req.url,'http://fixture'),json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))}
 if(url.pathname==='/api/v2/live/status')return json(scenario==='denied'?{status:'locked'}:history)
 if(url.pathname==='/api/v2/live/connections')return json({items:[{id:'fixture',status:'connected',requested_mode:'trading'}]})
 if(url.pathname==='/api/v2/live/trading')return json(scenario==='denied'?{status:'locked',mode:'demo',reason:'mt5_trading_access_required'}:{...snapshot,summary:true,bars:[]})
 if(url.pathname==='/api/v2/live/trading/events'){
  streamCount++
  if(scenario==='network-error'){res.statusCode=503;return json({detail:'fixture_disconnected'})}
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.flushHeaders();streams.add(res)
  const send=()=>res.write(`event: snapshot\ndata: ${JSON.stringify({...snapshot,timeframe:url.searchParams.get('timeframe')||'M1',symbol:url.searchParams.get('symbol')||'EURUSD',...(scenario==='empty'?{bars:[]}:{} )})}\n\n`)
  if(scenario==='slow'){releaseMarket=send;marketRequested?.resolve()}else send()
  const timer=setInterval(()=>res.write(': heartbeat\n\n'),1000)
  res.on('close',()=>{clearInterval(timer);streams.delete(res)})
  return
 }
 return json({items:[],available:false})
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const backend=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch()
const url=(extra='')=>`${origin}/?workspace=fixture&view=live&area=live&section=terminal&lang=vi&mt5_connection=fixture&mt5_timeframe=M1${extra}`
async function setup(width=1440,theme='dark'){
 const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 await context.route('**/api/**',route=>route.continue({url:backend+new URL(route.request().url()).pathname+new URL(route.request().url()).search}))
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
 return {context,page}
}
try{
 for(const width of (process.env.TW_QA_CASE?[]:[1440,390]))for(const theme of ['dark','light']){
  scenario='ready';const {context,page}=await setup(width,theme)
  await page.goto(url())
  await page.getByText('10.000 USD',{exact:true}).waitFor()
  await page.getByText('26 USD',{exact:true}).waitFor()
  assert.equal(await page.getByText('10000',{exact:true}).count(),0)
  assert.equal(await page.locator('.mt5-account-metrics .fx-dashboard-metric').count(),5)
  assert.ok(await page.locator('.mt5-quick-actions button').evaluate(node=>node.clientWidth<300||innerWidth<480))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`${output}/overview-${width}-${theme}.png`,fullPage:true})
  await page.getByRole('button',{name:/Mở biểu đồ/}).click()
  await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  await page.getByTestId('chart-loading').waitFor({state:'hidden'})
  const color=await page.frameLocator('.advanced-chart-host iframe').locator('.legacy-mentor').evaluate(node=>getComputedStyle(node).color)
  assert.equal(color,theme==='dark'?'rgb(255, 173, 124)':'rgb(164, 71, 21)')
  assert.equal(await page.locator('.wm-notification').count(),0)
  await page.screenshot({path:`${output}/chart-${width}-${theme}.png`})
  await page.frameLocator('.advanced-chart-host iframe').getByRole('link',{name:'Trở về tổng quan MT5'}).click()
  await page.getByRole('region',{name:'Biểu đồ gần đây'}).waitFor()
  assert.equal(await page.locator('.mt5-recent-list button').count(),1)
  await page.reload();await page.getByRole('region',{name:'Biểu đồ gần đây'}).waitFor()
  report.cases.push({width,theme,loadedOverview:true,orangeAI:true,recentAfterBackAndReload:true})
  await context.close()
 }
 if(!process.env.TW_QA_CASE){
  scenario='slow';marketRequested=Promise.withResolvers();const {context,page}=await setup()
  await page.goto(url('&surface=workspace'))
  await page.getByTestId('chart-loading').waitFor()
  assert.equal(await page.getByTestId('chart-loading').count(),1)
  assert.equal(await page.getByText('Chưa có biểu đồ MT5').count(),0)
  await page.waitForFunction(()=>document.querySelector('[data-testid="chart-loading"]')?.getBoundingClientRect().width===innerWidth)
  await marketRequested.promise;assert.ok(releaseMarket);releaseMarket()
  await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  await page.getByTestId('chart-loading').waitFor({state:'hidden'})
  await page.evaluate(()=>{window.retainedChart=document.querySelector('.advanced-chart-host')})
  const count=streamCount;for(const stream of streams)stream.end()
  await page.waitForFunction(()=>!!document.querySelector('[data-chart-status=ready]'))
  await page.waitForResponse(r=>r.url().includes('/trading/events'))
  assert.ok(streamCount>count)
  assert.equal(await page.evaluate(()=>window.retainedChart===document.querySelector('.advanced-chart-host')),true)
  assert.equal(await page.getByTestId('chart-loading').count(),0)
  scenario='ready'
  for(const engine of ['lightweight','advanced','lightweight']){
    await page.evaluate(engine=>{const url=new URL(location.href);url.searchParams.set('chart_engine',engine);history.pushState(null,'',url);dispatchEvent(new PopStateEvent('popstate'))},engine)
    if(engine==='advanced')await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    else await page.locator('.tv-lightweight-charts').waitFor()
    await page.getByTestId('chart-loading').waitFor({state:'hidden',timeout:10000})
  }
  report.cases.push({slowDataOneLoader:true,reconnectRetainsChart:true})
  report.cases.push({cachedRendererRoundtrip:true})
  await context.close()
 }
 for(const kind of ['network-error','empty','denied','library-error','lightweight']){
  if(process.env.TW_QA_CASE && process.env.TW_QA_CASE!==kind)continue
  scenario=kind==='library-error'||kind==='lightweight'?'ready':kind
  const {context,page}=await setup(390,'light')
  if(kind==='library-error')await page.route('**/charting_library/charting_library.standalone.js*',r=>r.abort())
  await page.goto(url(kind==='denied'?'':`&surface=workspace${kind==='lightweight'?'&chart_engine=lightweight':''}`))
  if(kind==='denied')await page.getByText('Chưa có lịch sử giao dịch đã đồng bộ.').waitFor()
  else if(kind==='library-error')await page.locator('.advanced-chart-message a[href*="chart_engine=lightweight"]').waitFor()
  else if(kind==='lightweight')await page.locator('.tv-lightweight-charts').waitFor()
  else await page.getByText('Chưa có biểu đồ MT5').waitFor()
  await page.getByTestId('chart-loading').waitFor({state:'hidden'})
  await page.screenshot({path:`${output}/${kind}.png`})
  report.cases.push({kind,exitsLoading:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[]);report.passed=true
}catch(error){report.failure=error.stack;for(const [i,page] of browser.contexts().flatMap(context=>context.pages()).entries())await page.screenshot({path:`${output}/failure-${i}.png`}).catch(()=>{});process.exitCode=1}
finally{await browser.close();for(const stream of streams)stream.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
