import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [origin,out] = process.argv.slice(2)
assert.ok(origin && out)
assert.equal(new URL(origin).hostname,'127.0.0.1')
assert.notEqual(new URL(origin).port,'5180','Run only against the disposable fixture')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport:{width:1368,height:790},reducedMotion:'reduce' })
const report = { scope:'Disposable PostgreSQL/native API and real chart UI; synthetic CSV; no owner mutations',cases:[],errors:[] }
page.on('pageerror',e => report.errors.push(e.message))
await page.addInitScript(() => { if (!localStorage.getItem('tw-language')) localStorage.setItem('tw-language','vi'); if (!localStorage.getItem('tw-theme')) localStorage.setItem('tw-theme','dark') })
async function request(method,route,body,status=200) {
  const result = await page.evaluate(async ({method,route,body}) => {
    const {scopedMutation} = await import('/src/scopedMutation.js')
    const r = method === 'GET' ? await fetch(route,{headers:{'X-Workspace-Id':'tenant-a'}})
      : await scopedMutation(route,'tenant-a',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    return {status:r.status,body:await r.json()}
  },{method,route,body})
  assert.equal(result.status,status,JSON.stringify(result.body))
  return result.body
}
const spec = {instrument_id:'EURUSD',asset_class:'fx',base_ccy:'EUR',quote_ccy:'USD',account_ccy:'USD',contract_size:'100000',tick_size:'0.00001',pip_size:'0.0001',quantity_min:'0.01',quantity_step:'0.01',effective_from_utc:'2020-01-01T00:00:00Z',effective_to_utc:''}
try {
  await page.goto(origin)
  const csv = 'time,open,high,low,close,volume\n'+Array.from({length:40},(_,i)=>`${1577923200+i*60},1.10000,${i===2?'1.10200':'1.10020'},${i===2?'1.09800':'1.09980'},1.10000,10`).join('\n')
  const imported = await request('POST','/api/v2/data/csv/import',{
    csv_text:csv,source:{source_id:'pending-entry-fixture',provider:'fixture',instrument_mapping:{EURUSD:'EURUSD'},license_use:'qa-only',retrieved_at_utc:'2026-10-19T00:00:00Z',export_settings:'synthetic touch sequence'},instrument:spec,timeframe_seconds:60,holdout_policy:{mode:'none'}
  },201)
  const dataset = imported.dataset.dataset_id
  for (const [side,type,level,width,lang] of [['BUY','limit','1.09900',1368,'vi'],['SELL','limit','1.10100',768,'en'],['BUY','stop','1.10100',1368,'en'],['SELL','stop','1.09900',390,'vi']]) {
    await page.setViewportSize({width,height:790})
    await page.evaluate(({lang,width}) => { localStorage.setItem('tw-language',lang);localStorage.setItem('tw-theme',width===768?'light':'dark') },{lang,width})
    let record = await request('POST','/api/v2/replay/sessions',{dataset_id:dataset,name:`${side}-${type}`},201)
    const path = `/api/v2/replay/sessions/${record.record_id}`
    record = await request('POST',`${path}/execution`,{expected_revision:record.revision,instrument_spec:spec,cost_model:{version:'fixture-cost-v1',spread_basis:'bid_ask_embedded',commission_per_side_account:'0',minimum_fee_account:'0',slippage_price_per_side:'0',financing_account:'0',quote_to_account_rate:'1',account_ccy:'USD',rounding_decimals:2},spread_price:'0',timeframe_seconds:60,starting_balance:'10000'})
    assert.equal(record.execution_capabilities.conditional_orders,true)
    await page.goto(`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${record.record_id}&dataset=${dataset}`)
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    const open = page.locator('#chart-utility-actions > button').first()
    await open.click()
    const dialog = page.locator('.legacy-order-modal')
    await dialog.getByRole('button',{name:lang==='vi'?'Loại lệnh':'Type',exact:true}).click()
    assert.deepEqual((await dialog.getByRole('option').allTextContents()).map(text=>text.replace('✓','').trim()),['Market','Limit','Stop'])
    await page.screenshot({path:`${out}/${side}-${type}-${width}-menu.png`})
    await dialog.getByRole('option',{name:type==='limit'?'Limit':'Stop',exact:true}).click()
    if (side==='SELL') {
      await dialog.getByRole('button',{name:lang==='vi'?'Hướng':'Side',exact:true}).click()
      await dialog.getByRole('option',{name:lang==='vi'?'Bán':'Sell',exact:true}).click()
    }
    const entry = dialog.getByRole('spinbutton',{name:lang==='vi'?'Giá vào lệnh':'Entry Price',exact:true})
    await entry.fill(level)
    for (const toggle of await dialog.getByRole('switch').all()) {
      if (await toggle.isEnabled() && await toggle.isChecked()) await toggle.uncheck()
    }
    await page.screenshot({path:`${out}/${side}-${type}-${width}-form.png`})
    await request('POST',`${path}/orders/market`,{expected_revision:record.revision,operation_id:`invalid-${side}-${type}`,execution_timing:'pending',order_type:type,side,quantity:'0.01',entry_price:'1.10000'},422)
    const save = dialog.locator('.legacy-order-save')
    const submitted = page.waitForResponse(r=>new URL(r.url()).pathname===`${path}/orders/market` && r.request().method()==='POST')
    await save.click()
    const response = await submitted
    assert.equal(response.status(),200,await response.text())
    const sent = response.request().postDataJSON()
    assert.equal(sent.order_type,type);assert.equal(sent.execution_timing,'pending');assert.equal(sent.entry_price,level)
    await dialog.waitFor({state:'hidden'})
    record = await request('GET',path)
    assert.equal(record.payload.execution.position,null)
    assert.equal(record.payload.execution.pending_market_order.order_type,type)
    await page.reload()
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    const chart = page.frameLocator('iframe[id^=tradingview_]')
    await chart.locator('.wm-order-marker-text').filter({hasText:`${side} ${type.toUpperCase()}`}).waitFor()
    await page.screenshot({path:`${out}/${side}-${type}-${width}-pending.png`})
    record = await request('POST',`${path}/step`,{expected_revision:record.revision,steps:1})
    assert.equal(record.payload.execution.position,null,'No early fill on the untouched bar')
    assert.equal(record.payload.execution.pending_market_order.order_type,type)
    record = await request('POST',`${path}/step`,{expected_revision:record.revision,steps:1})
    assert.equal(record.payload.execution.pending_market_order,null)
    assert.equal(record.payload.execution.position.side,side)
    assert.equal(Number(record.payload.execution.position.entry_fill),Number(level))
    const ledger = record.payload.execution.ledger
    assert.equal(ledger.filter(e=>e.kind==='market_fill').length,1)
    assert.equal(ledger.filter(e=>e.kind==='order_placed').length,1)
    await page.goto(`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${record.record_id}&dataset=${dataset}&cursor=${record.payload.cursor_index}`)
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    await chart.locator('.wm-order-marker-text').filter({hasText:side}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    report.cases.push({side,type,width,lang,passed:true})
    if (side==='BUY' && type==='limit') {
      record = await request('POST',`${path}/orders/close`,{expected_revision:record.revision,operation_id:'close-fixture',target_id:record.payload.execution.position.position_id})
      record = await request('POST',`${path}/orders/market`,{expected_revision:record.revision,operation_id:'cancel-fixture',execution_timing:'pending',order_type:'limit',side:'BUY',quantity:'0.01',entry_price:'1.09900'})
      const pending = record.payload.execution.pending_market_order
      record = await request('POST',`${path}/orders/close`,{expected_revision:record.revision,operation_id:'cancel-command',target_id:pending.operation_id})
      assert.equal(record.payload.execution.pending_market_order,null)
      assert.equal(record.payload.execution.position,null)
      await page.goto(`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${record.record_id}&dataset=${dataset}&cursor=${record.payload.cursor_index}`)
      await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
      await open.click()
      assert.equal(await dialog.getByRole('button',{name:'Loại lệnh',exact:true}).innerText(),'Market')
      for (const toggle of await dialog.getByRole('switch').all()) if (await toggle.isEnabled() && await toggle.isChecked()) await toggle.uncheck()
      const marketSaved=page.waitForResponse(r=>new URL(r.url()).pathname===`${path}/orders/market` && r.request().method()==='POST')
      await dialog.locator('.legacy-order-save').click()
      const immediate=await marketSaved
      assert.equal(immediate.status(),200,await immediate.text())
      assert.equal(immediate.request().postDataJSON().execution_timing,'current_quote')
      record=await request('GET',path)
      assert.equal(record.payload.execution.pending_market_order,null)
      assert.equal(record.payload.execution.position.side,'BUY')
      report.marketAndCancel=true
    }
  }
  assert.deepEqual(report.errors,[])
  report.passed = true
} catch (error) {
  report.failure={message:error.message,url:page.url(),dialogs:await page.locator('.legacy-modal').allTextContents()}
  await page.screenshot({path:`${out}/failure.png`})
  throw error
} finally {
  await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))
  await browser.close()
}
console.log(JSON.stringify(report))
