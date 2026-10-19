import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [origin,out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
assert.notEqual(new URL(origin).port,'5180','Only disposable fixture writes are authorized')
const browser = await chromium.launch()
const page = await browser.newPage({viewport:{width:1368,height:790},reducedMotion:'reduce'})
const report = {scope:'Real native API, compact storage, disposable PostgreSQL and synthetic CSV only',cases:[],errors:[]}
page.on('pageerror',error => report.errors.push(error.message))
async function request(method,route,body,status=200) {
  const result = await page.evaluate(async ({method,route,body}) => {
    const {scopedMutation} = await import('/src/scopedMutation.js')
    const response = method === 'GET' ? await fetch(route,{headers:{'X-Workspace-Id':'tenant-a'}}) : await scopedMutation(route,'tenant-a',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    return {status:response.status,body:await response.json()}
  },{method,route,body})
  assert.equal(result.status,status,JSON.stringify(result.body))
  return result.body
}
const spec={instrument_id:'EURUSD',asset_class:'fx',base_ccy:'EUR',quote_ccy:'USD',account_ccy:'USD',contract_size:'100000',tick_size:'0.00001',pip_size:'0.0001',quantity_min:'0.01',quantity_step:'0.01',effective_from_utc:'2020-01-01T00:00:00Z',effective_to_utc:''}
try {
  await page.goto(origin)
  const csv='time,open,high,low,close,volume\n'+Array.from({length:40},(_,i)=>`${1577923200+i*60},1.10000,${i===1?'1.10150':i===2?'1.10250':'1.10020'},${i===1?'1.09850':i===2?'1.09750':'1.09980'},1.10000,10`).join('\n')
  const imported=await request('POST','/api/v2/data/csv/import',{csv_text:csv,source:{source_id:'partial-tp-fixture',provider:'fixture',instrument_mapping:{EURUSD:'EURUSD'},license_use:'qa-only',retrieved_at_utc:'2026-10-19T00:00:00Z',export_settings:'synthetic partial target touches'},instrument:spec,timeframe_seconds:60,holdout_policy:{mode:'none'}},201)
  const dataset=imported.dataset.dataset_id
  for (const [side,width,lang,theme] of [['BUY',1368,'vi','dark'],['SELL',768,'en','light'],['BUY',390,'vi','dark']]) {
    await page.setViewportSize({width,height:790})
    await page.evaluate(({lang,theme})=>{localStorage.setItem('tw-language',lang);localStorage.setItem('tw-theme',theme)},{lang,theme})
    let record=await request('POST','/api/v2/replay/sessions',{dataset_id:dataset,name:`Partial-${side}-${width}`},201)
    const path=`/api/v2/replay/sessions/${record.record_id}`
    record=await request('POST',`${path}/execution`,{expected_revision:record.revision,instrument_spec:spec,cost_model:{version:'fixture-cost-v1',spread_basis:'bid_ask_embedded',commission_per_side_account:'1',minimum_fee_account:'0',slippage_price_per_side:'0',financing_account:'0',quote_to_account_rate:'1',account_ccy:'USD',rounding_decimals:2},spread_price:'0',timeframe_seconds:60,starting_balance:'10000'})
    assert.equal(record.execution_capabilities.partial_take_profit,true)
    const url=`${origin}/?workspace=tenant-a&view=replay&surface=workspace&session=${record.record_id}&dataset=${dataset}`
    await page.goto(url)
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    await page.locator('#chart-utility-actions > button').first().click()
    const dialog=page.locator('.legacy-order-modal'),stop=dialog.locator('[data-protection=stopLoss]'),tp=dialog.locator('[data-protection=takeProfit]')
    await dialog.waitFor({state:'visible'})
    assert.equal(await dialog.locator('input[role=switch]:checked').count(),0)
    if (side==='SELL') {
      await dialog.getByRole('button',{name:'Side',exact:true}).click()
      await dialog.getByRole('option',{name:'Sell',exact:true}).click()
    }
    const size=dialog.getByRole('spinbutton',{name:lang==='vi'?'Khối lượng lệnh':'Order size',exact:true})
    await size.fill('0.04')
    await stop.getByRole('switch').check()
    await tp.getByRole('switch').check()
    await stop.getByRole('spinbutton').first().fill(side==='BUY'?'1.09':'1.11')
    await tp.getByRole('spinbutton').first().fill(side==='BUY'?'1.101':'1.099')
    await tp.getByRole('button',{name:lang==='vi'?'+ Chốt từng phần':'+ Partial TP',exact:true}).click()
    const share=tp.getByRole('spinbutton',{name:lang==='vi'?'Tỷ lệ chốt TP1':'Close share TP1',exact:true})
    const quick=tp.locator('.legacy-partial-target').first().locator('.legacy-partial-presets')
    for (const percent of [10,25,50]) {
      await quick.getByRole('button',{name:`${percent}%`,exact:true}).click()
      assert.equal(Number(await share.inputValue()),percent)
      assert.equal(await tp.locator('.legacy-partial-total').innerText(),`${percent+50} / 100%`)
      assert.equal(await tp.locator('.legacy-partial-total').evaluate(node=>node.classList.contains('is-invalid')),percent!==50)
    }
    await tp.getByRole('button',{name:lang==='vi'?'Một mức chốt lời':'Single profit',exact:true}).click()
    assert.equal(await tp.locator('.legacy-partial-target').count(),0)
    assert.equal(await tp.getByRole('switch').isChecked(),true)
    assert.equal(await tp.getByRole('spinbutton').first().inputValue(),side==='BUY'?'1.101':'1.099','Return to single retains the first target price')
    const add=tp.locator('.legacy-partial-add')
    const alignment=await add.evaluate(node=>{
      const box=node.getBoundingClientRect(),parent=node.parentElement.getBoundingClientRect()
      return {offset:Math.abs(box.x+box.width/2-parent.x-parent.width/2),background:getComputedStyle(node).backgroundColor}
    })
    assert.ok(alignment.offset<1,'Add partial target is centered')
    assert.notEqual(alignment.background,'rgba(0, 0, 0, 0)')
    await add.click()
    if (width > 600) {
      const tops=await tp.locator('.legacy-partial-target').first().locator('input').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top))
      assert.ok(Math.max(...tops)-Math.min(...tops)<1,'Price, pips and close-share inputs align across the row')
    }
    await tp.getByRole('spinbutton',{name:lang==='vi'?'Giá TP2':'Price TP2',exact:true}).fill(side==='BUY'?'1.102':'1.098')
    assert.equal(await tp.locator('.legacy-partial-quantity').first().innerText(),'0.02 lot')
    assert.ok((await tp.locator('.legacy-protection-estimate strong').innerText()).startsWith('$'))
    assert.ok((await stop.locator('.legacy-protection-estimate strong').innerText()).startsWith('$'))
    for (const [section,token] of [[stop,'--project-negative'],[tp,'--project-positive']]) {
      const colors=await section.locator('.legacy-protection-estimate strong').evaluate((node,token)=>{
        const probe=document.createElement('span');probe.style.color=`var(${token})`;node.append(probe)
        const expected=getComputedStyle(probe).color;probe.remove();return {actual:getComputedStyle(node).color,expected}
      },token)
      assert.equal(colors.actual,colors.expected)
    }
    const presetHeight=await stop.locator('.legacy-risk-presets button').first().evaluate(node=>node.getBoundingClientRect().height)
    assert.equal(presetHeight,24)
    await page.screenshot({path:`${out}/${side}-${width}-risk.png`})
    await size.fill('0.01')
    await tp.locator('[role=alert]').waitFor({state:'visible'})
    await dialog.locator('button[type=submit]').click()
    assert.equal((await request('GET',path)).revision,record.revision,'Invalid split must not place an order')
    await size.fill('0.04')
    await tp.getByRole('spinbutton',{name:lang==='vi'?'Tỷ lệ chốt TP1':'Close share TP1',exact:true}).fill('40')
    await dialog.locator('button[type=submit]').click()
    assert.equal((await request('GET',path)).revision,record.revision,'Percent sum must equal 100')
    await tp.getByRole('spinbutton',{name:lang==='vi'?'Tỷ lệ chốt TP1':'Close share TP1',exact:true}).fill('50')
    await page.screenshot({path:`${out}/${side}-${width}-partial-form.png`})
    const chart=page.frameLocator('iframe[id^=tradingview_]')
    assert.equal(await chart.locator('.wm-order-marker').count(),0,'No unsubmitted draft markers')
    await dialog.locator('button[type=submit]').click()
    await dialog.waitFor({state:'hidden'})
    record=await request('GET',path)
    assert.equal(record.payload.execution.pending_market_order,null)
    assert.equal(record.payload.execution.position.quantity,'0.04')
    assert.deepEqual(record.payload.execution.position.take_profits.map(t=>t.quantity),['0.02','0.02'])
    await page.reload()
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    await chart.locator('.wm-order-marker[data-order-kind^="target:"]').first().waitFor({state:'visible'})
    assert.equal(await chart.locator('.wm-order-marker[data-order-kind^="target:"]').count(),2)
    await page.screenshot({path:`${out}/${side}-${width}-accepted-chart.png`})
    const secondId=record.payload.execution.position.take_profits[1].target_id
    const handle=chart.locator(`[data-order-kind="target:${secondId}"] .wm-order-marker-body`)
    const amendment=page.waitForResponse(response=>new URL(response.url()).pathname === `${path}/orders/protection` && response.request().method()==='POST')
    await handle.press('ArrowUp')
    assert.equal((await amendment).status(),200)
    record=await request('GET',path)
    assert.equal(Number(record.payload.execution.position.take_profits[1].price),side==='BUY'?1.10201:1.09801)
    assert.equal(Number(record.payload.execution.position.take_profits[0].price),side==='BUY'?1.101:1.099)
    const restore=page.waitForResponse(response=>new URL(response.url()).pathname === `${path}/orders/protection` && response.request().method()==='POST')
    await handle.press('ArrowDown')
    assert.equal((await restore).status(),200)
    record=await request('GET',path)
    assert.equal(Number(record.payload.execution.position.take_profits[1].price),side==='BUY'?1.102:1.098)

    record=await request('POST',`${path}/step`,{expected_revision:record.revision,steps:1})
    assert.equal(record.payload.execution.position.quantity,'0.02')
    assert.equal(record.payload.execution.position.take_profits.length,1)
    let fills=record.payload.execution.ledger.filter(e=>e.kind==='protective_fill')
    assert.equal(fills.length,1)
    assert.equal(fills[0].details.quantity,'0.02')
    assert.equal(Number(fills[0].details.net_pnl),1)
    const fork=await request('POST',`${path}/branch`,{expected_revision:record.revision,cursor_index:record.payload.cursor_index},201)
    assert.deepEqual(fork.payload.execution.position.take_profits,record.payload.execution.position.take_profits)
    await page.goto(`${url}&cursor=${record.payload.cursor_index}`)
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    await chart.locator('.wm-order-marker[data-order-kind^="target:"]').first().waitFor({state:'visible'})
    assert.equal(await chart.locator('.wm-order-marker[data-order-kind^="target:"]').count(),1)
    await page.locator('#chart-utility-actions > button').first().click()
    await dialog.waitFor({state:'visible'})
    assert.equal(await tp.locator('.legacy-partial-target').count(),1)
    assert.equal(Number(await tp.getByRole('spinbutton',{name:lang==='vi'?'Tỷ lệ chốt TP1':'Close share TP1',exact:true}).inputValue()),100)
    await tp.getByRole('button',{name:lang==='vi'?'Bỏ TP1':'Remove TP1',exact:true}).click()
    assert.equal(await tp.getByRole('switch').isChecked(),false,'Removing the last target must turn TP off')
    await dialog.getByRole('button',{name:lang==='vi'?'Hủy':'Cancel',exact:true}).click()
    await page.locator('#chart-utility-actions > button').first().click()
    assert.equal(await tp.locator('.legacy-partial-target').count(),1,'Cancelled edits cannot remove an accepted target')
    await tp.getByRole('spinbutton').first().fill(side==='BUY'?'1.1021':'1.0979')
    await dialog.locator('button[type=submit]').click()
    await dialog.waitFor({state:'hidden'})
    record=await request('GET',path)
    assert.equal(Number(record.payload.execution.position.take_profits[0].price),side==='BUY'?1.1021:1.0979)
    record=await request('POST',`${path}/step`,{expected_revision:record.revision,steps:1})
    assert.equal(record.payload.execution.position,null)
    fills=record.payload.execution.ledger.filter(e=>e.kind==='protective_fill')
    assert.equal(fills.length,2)
    assert.equal(Number(record.payload.execution.balance),10004.2)
    assert.equal(fills[1].details.cost_breakdown.commission_account,1)
    const analytics=await request('GET',`${path}/analytics`)
    assert.equal(analytics.ledger.length,2)
    assert.deepEqual(analytics.ledger.map(trade=>trade.quantity),[0.02,0.02])
    assert.equal(new Set(analytics.ledger.map(trade=>trade.trade_id)).size,2)
    assert.equal(new Set(analytics.ledger.map(trade=>trade.source_position_id)).size,1)
    assert.equal(analytics.ledger.reduce((sum,trade)=>sum+trade.net_pnl,0),4.2)
    report.cases.push({side,width,lang,theme,balance:record.payload.execution.balance,targetFills:fills.map(e=>({quantity:e.details.quantity,net:e.details.net_pnl})),fork:fork.record_id})
  }
  assert.deepEqual(report.errors,[])
  report.pass=true
} finally {
  await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))
  await browser.close()
}
console.log(JSON.stringify(report))
