import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { assetTradingDefaults, buildTradingOptions, sessionExecutionConfig } from '../src/sessionTradingOptions.js'

const origin = 'http://127.0.0.1:5180'
const output = '../evidence/session-trading-options-20261018/quick'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const dataset = fixture.datasets.items[0]
const report = { scope:'Synthetic API responses; production chart and real quick BUY/SELL clicks. All API requests intercepted. No owner writes.', cases:[], errors:[] }
await mkdir(output,{recursive:true})
const browser = await chromium.launch()
try {
  for (const scenario of [{side:'BUY',costs:false},{side:'SELL',costs:false},{side:'SELL',costs:true}]) {
    const options = buildTradingOptions({costs_enabled:scenario.costs,assets:{[dataset.dataset_id]:{...assetTradingDefaults(),spread_price:'0.0002',commission_per_lot:'7',commission_charge:'per_side'}}},[dataset])
    let replay = structuredClone(fixture.latest)
    replay.dataset_sha256 = null
    replay.payload = {...replay.payload,dataset_id:dataset.dataset_id,execution:null,starting_balance:'10000',starting_balance_ccy:'USD',trading_options:options}
    replay.has_future_rows = true
    const calls = []
    const context = await browser.newContext({viewport:{width:1440,height:987}})
    await context.addInitScript(()=>localStorage.setItem('tw-language','vi'))
    await context.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url())
      if(url.origin!==origin) return route.abort()
      if(!url.pathname.startsWith('/api/')) return route.continue()
      if(url.pathname.endsWith('/activity')) return route.abort()
      calls.push({method:req.method(),path:url.pathname})
      if(req.method()==='GET') {
        if(url.pathname==='/api/v2/workspace/events') return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
        return route.fulfill({json:url.pathname===`/api/v2/replay/sessions/${fixture.session}`?replay:url.pathname==='/api/v2/data/datasets'?fixture.datasets:{items:[],available:false}})
      }
      assert.equal(url.pathname,`/api/v2/replay/sessions/${fixture.session}/orders/quick`)
      const body=req.postDataJSON(), config=sessionExecutionConfig(replay,dataset.instrument_spec)
      assert.equal(body.side,scenario.side)
      assert.equal(body.execution_timing,'current_quote')
      assert.equal(body.spread_price,config.spread)
      assert.deepEqual(body.cost_model,config.costModel)
      assert.equal(body.tick_snapshot_id,undefined,'no historical ticks mixed into configured bar session')
      assert.equal(body.expected_revision,replay.revision)
      const close=Number(replay.visible_rows.at(-1).close)
      const fill=close+(scenario.costs?(scenario.side==='BUY'?0.0001:-0.0001):0)
      replay={...replay,revision:replay.revision+2,payload:{...replay.payload,execution:{...body,cursor_index:replay.payload.cursor_index,balance:'10000',equity:'10000',floating_pl:'0',pending_market_order:null,ledger:[],position:{position_id:'qa-position',side:body.side,quantity:body.quantity,entry_fill:String(fill),opened_time_utc:replay.cutoff_timestamp,stop_loss:null,take_profit:null}}}}
      return route.fulfill({json:replay})
    })
    const page=await context.newPage()
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    await page.locator(`.legacy-trading-bar button.${scenario.side==='BUY'?'buy':'sell'}`).click()
    const frame=await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
    await frame.locator('[data-order-kind=entry]').waitFor({state:'visible'})
    assert.match(await frame.locator('[data-order-kind=entry]').textContent(),new RegExp(scenario.side))
    assert.equal(calls.filter(call=>call.method==='POST').length,1,'initialize and current-quote fill share one command')
    assert.equal(calls.filter(call=>call.path.endsWith('/tick-data')).length,0,'no unnecessary tick availability request')
    await page.screenshot({path:`${output}/${scenario.side.toLowerCase()}-${scenario.costs?'custom':'zero'}.png`})
    report.cases.push({...scenario,result:'PASS',requestCount:1})
    await context.close()
  }
  assert.deepEqual(report.errors,[])
  report.result='PASS'
} catch(error) {report.result='FAIL';report.failure=error.stack;throw error}
finally {await browser.close();await writeFile(`${output}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
