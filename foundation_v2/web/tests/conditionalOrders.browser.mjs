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
    const chart = page.frameLocator('iframe[id^=tradingview_]')
    const noDraftMarkers = async () => {
      await chart.locator('.wm-order-marker').first().waitFor({state:'detached'})
      assert.equal(await chart.locator('.wm-order-marker').count(),0,'Unsubmitted form must not look like a placed order')
    }
    const open = page.locator('#chart-utility-actions > button').first()
    await open.click()
    const dialog = page.locator('.legacy-order-modal')
    await dialog.waitFor({state:'visible'})
    assert.equal(await dialog.locator('[data-protection] input[role=switch]:checked').count(),0,'New orders start with protection off')
    assert.equal(await dialog.locator('[data-protection] input[type=number]').count(),0)
    await noDraftMarkers()
    if (side==='BUY' && type==='limit') {
      await dialog.locator('[data-protection=stopLoss]').getByRole('switch').check()
      await dialog.locator('[data-protection=takeProfit]').getByRole('switch').check()
      await dialog.getByRole('button',{name:'Hủy',exact:true}).click()
      await dialog.waitFor({state:'hidden'})
      await noDraftMarkers()
      const unchanged=await request('GET',path)
      assert.equal(unchanged.revision,record.revision)
      assert.equal(unchanged.payload.execution.pending_market_order,null)
      assert.equal(unchanged.payload.execution.position,null)
      await open.click()
      await dialog.waitFor({state:'visible'})
      assert.equal(await dialog.locator('[data-protection] input[role=switch]:checked').count(),0,'Reopening discards unsaved protection')
      assert.equal(await dialog.locator('[data-protection] input[type=number]').count(),0)
      const legs = [dialog.locator('[data-protection=stopLoss]'),dialog.locator('[data-protection=takeProfit]')]
      for (const states of [[false,false],[true,false],[false,true],[true,true]]) {
        for (const [i,leg] of legs.entries()) await leg.getByRole('switch').setChecked(states[i])
        for (const [nextSide,nextType] of [['SELL','limit'],['BUY','stop'],['SELL','market'],['SELL','market'],['BUY','limit'],['BUY','market']]) {
          await dialog.getByRole('button',{name:'Hướng',exact:true}).click()
          await dialog.getByRole('option',{name:nextSide==='BUY'?'Mua':'Bán',exact:true}).click()
          await dialog.getByRole('button',{name:'Loại lệnh',exact:true}).click()
          await dialog.getByRole('option',{name:nextType[0].toUpperCase()+nextType.slice(1),exact:true}).click()
          for (const [i,leg] of legs.entries()) {
            assert.equal(await leg.getByRole('switch').isChecked(),states[i],'Side/type selection must preserve explicit SL/TP switches')
            if (states[i]) assert.equal(Number(await leg.getByRole('spinbutton').nth(1).inputValue()),i===0?20:40,'Enabled protection keeps its pip distance')
            else assert.equal(await leg.getByRole('spinbutton').count(),0)
          }
          await noDraftMarkers()
        }
      }
      for (const leg of legs) await leg.getByRole('switch').uncheck()
      assert.equal((await request('GET',path)).revision,record.revision,'Repeated selections must never submit an order')
      report.selectionProtectionStates=true
    }
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
    const stop = dialog.locator('[data-protection=stopLoss]')
    const target = dialog.locator('[data-protection=takeProfit]')
    for (const section of [stop,target]) assert.equal(await section.getByRole('switch').isChecked(),false,'Choosing side/type keeps default protection off')
    const rows = dialog.locator('.legacy-protection-row')
    const surfaces = await rows.evaluateAll(nodes => nodes.map(node => {
      const {x,width,height} = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {x,width,height,background:style.backgroundColor,expected:style.getPropertyValue('--project-control').trim()}
    }))
    assert.equal(surfaces.length,3)
    assert.ok(surfaces.every(row=>row.x===surfaces[0].x && row.width===surfaces[0].width && row.height===surfaces[0].height),'SL, TP and break-even bars must align')
    assert.notEqual(surfaces[0].background,'rgba(0, 0, 0, 0)')
    assert.equal(await stop.getByRole('spinbutton').count(),0)
    assert.equal(await target.getByRole('spinbutton').count(),0)
    await noDraftMarkers()
    await page.screenshot({path:`${out}/${side}-${type}-${width}-protection-off.png`})
    for (const section of [stop,target]) {
      await section.getByRole('switch').check()
      const price = section.getByRole('spinbutton').nth(0), pips = section.getByRole('spinbutton').nth(1)
      await pips.fill('30')
      const direction = (side==='BUY'?1:-1)*(section===stop?-1:1)
      const expected = Number((Number(level)+direction*.003).toFixed(5))
      assert.equal(Number(await price.inputValue()),expected)
      const geometry = await section.locator('.legacy-order-grid input').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))
      assert.equal(geometry[0].y,geometry[1].y)
      assert.equal(geometry[0].height,geometry[1].height)
      assert.ok(Math.abs(geometry[0].width-geometry[1].width)<1)
      await price.fill('')
      assert.equal(await section.getByRole('switch').isChecked(),true,'Clearing a field must not turn protection off')
      await price.fill(String(expected))
      assert.equal(Number(await pips.inputValue()),30)
    }
    assert.equal(await stop.locator('.legacy-risk-fields').isVisible(),true)
    assert.equal(await stop.locator('summary').count(),0)
    assert.equal(await target.locator('.legacy-risk-sizing').count(),0)
    await stop.scrollIntoViewIfNeeded()
    await page.screenshot({path:`${out}/${side}-${type}-${width}-protection-on.png`})
    {
      const risk=stop.locator('.legacy-risk-sizing')
      assert.equal(await risk.getByRole('radio',{name:lang==='vi'?'Số dư ban đầu':'Initial balance',exact:true}).isChecked(),true)
      assert.equal(await risk.getByRole('radio').count(),2)
      assert.equal(await risk.locator('.fx-select').count(),0,'Balance basis uses radio choices')
      assert.equal(await risk.locator('.legacy-risk-apply').count(),0,'Risk sizing applies directly without an extra button or size row')
      assert.deepEqual(await risk.locator('.legacy-risk-input > span').allTextContents(),['%','$'])
      const affixes = await risk.locator('.legacy-risk-input').evaluateAll(nodes => nodes.map(node => {
        const symbol=node.querySelector('span').getBoundingClientRect(), input=node.querySelector('input'), bounds=input.getBoundingClientRect()
        return {symbolRight:symbol.right,textStart:bounds.left+parseFloat(getComputedStyle(input).paddingLeft)}
      }))
      assert.ok(affixes.every(field=>field.textStart>field.symbolRight),'Prefix symbols must not overlap input values')
      const estimate = stop.locator('.legacy-protection-estimate')
      const estimateStyle = await estimate.evaluate(node => { const s=getComputedStyle(node); return {background:s.backgroundColor,height:node.getBoundingClientRect().height} })
      assert.notEqual(estimateStyle.background,'rgba(0, 0, 0, 0)')
      assert.ok(estimateStyle.height>=36)
      await risk.locator('button[aria-pressed]').filter({hasText:/^1%$/}).click()
      const quantity=dialog.getByRole('spinbutton').first()
      assert.equal(await quantity.inputValue(),'0.33','1% of 10000 / 30 pip stop rounds down to .33 lots')
      assert.ok((await estimate.innerText()).includes(lang==='vi'?'Lỗ ước tính':'Estimated Loss'))
      assert.ok((await estimate.locator('strong').innerText()).includes('$'))
      const amount=risk.locator('.legacy-order-grid input').nth(1)
      await amount.fill('1')
      assert.equal(await amount.getAttribute('aria-invalid'),'true','Budget below minimum must not silently use a stale size')
      assert.equal(await quantity.inputValue(),'0.33')
      await dialog.locator('.legacy-order-save').click()
      assert.equal(await dialog.isVisible(),true,'Invalid risk sizing must block order submission')
      assert.equal((await request('GET',path)).revision,record.revision)
      await amount.fill('100')
      assert.equal(await amount.getAttribute('aria-invalid'),null)
      await amount.press('Enter')
      assert.equal(await dialog.isVisible(),true,'Enter in the sizing calculator must not place an order')
      const percentage = risk.locator('.legacy-order-grid input').first()
      await percentage.fill('2')
      assert.equal(await quantity.inputValue(),'0.66','Editing risk percentage updates size automatically')
      assert.equal(await amount.inputValue(),'200')
      await amount.fill('50')
      assert.equal(await quantity.inputValue(),'0.16','Editing risk amount updates size automatically')
      assert.equal(await percentage.inputValue(),'0.5')
      await stop.getByRole('spinbutton').nth(1).fill('20')
      assert.equal(await quantity.inputValue(),'0.25','SL changes recalculate an open risk calculator')
      await stop.getByRole('spinbutton').nth(1).fill('30')
      await amount.fill('100')
      await risk.scrollIntoViewIfNeeded()
      await page.screenshot({path:`${out}/${side}-${type}-${width}-risk-sizing.png`})
      assert.equal((await request('GET',path)).revision,record.revision,'Editing/sizing must not write an order')
      await quantity.fill('0.01')
      await stop.getByRole('spinbutton').nth(1).fill('25')
      assert.equal(await quantity.inputValue(),'0.01','Manual size remains authoritative until risk is edited')
      assert.equal(Number(await amount.inputValue()),2.5,'Visible risk follows manually entered quantity')
    }
    for (const toggle of await dialog.getByRole('switch').all()) {
      if (await toggle.isEnabled() && await toggle.isChecked()) await toggle.uncheck()
    }
    await noDraftMarkers()
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
    await chart.locator('.wm-order-marker-quantity').first().click()
    await dialog.waitFor({state:'visible'})
    assert.equal(await dialog.locator('.legacy-risk-sizing').count(),0,'Sizing must not change an existing position')
    assert.equal(await dialog.locator('.legacy-edit-protection').count(),2)
    for (const section of [stop,target]) {
      await section.getByRole('switch').check()
      await section.getByRole('spinbutton').nth(1).fill('20')
    }
    const expectedStop = Number((Number(level)+(side==='BUY'?-1:1)*.002).toFixed(5))
    const expectedTarget = Number((Number(level)+(side==='BUY'?1:-1)*.002).toFixed(5))
    assert.equal(Number(await stop.getByRole('spinbutton').first().inputValue()),expectedStop)
    await page.screenshot({path:`${out}/${side}-${type}-${width}-edit-protection.png`})
    const protectionSaved=page.waitForResponse(r=>new URL(r.url()).pathname===`${path}/orders/protection` && r.request().method()==='POST')
    await dialog.locator('.legacy-order-save').click()
    const protectionResponse=await protectionSaved
    assert.equal(protectionResponse.status(),200,await protectionResponse.text())
    await dialog.waitFor({state:'hidden'})
    record=await request('GET',path)
    assert.equal(Number(record.payload.execution.position.stop_loss),expectedStop)
    assert.equal(Number(record.payload.execution.position.take_profit),expectedTarget)
    await page.reload()
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    await chart.locator('[data-order-kind=stop]').waitFor({state:'visible'})
    await chart.locator('.wm-order-marker-quantity').first().click()
    await dialog.waitFor({state:'visible'})
    assert.equal(await stop.getByRole('switch').isChecked(),true)
    assert.equal(await target.getByRole('switch').isChecked(),true)
    assert.equal(Number(await stop.getByRole('spinbutton').first().inputValue()),expectedStop)
    assert.equal(Number(await target.getByRole('spinbutton').first().inputValue()),expectedTarget)
    await dialog.getByRole('button',{name:lang==='vi'?'Hủy':'Cancel',exact:true}).click()
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
      await noDraftMarkers()
      await stop.getByRole('switch').check()
      const risk=stop.locator('.legacy-risk-sizing')
      const amount=risk.locator('.legacy-order-grid input').nth(1)
      assert.equal(Number(await amount.inputValue()),100)
      await risk.getByRole('radio',{name:'Số dư hiện tại',exact:true}).check()
      assert.notEqual(Number(record.payload.execution.balance),10000,'Fixture current balance must differ from starting balance')
      assert.equal(Number(await amount.inputValue()),Number((Number(record.payload.execution.balance)/100).toFixed(2)))
      await dialog.getByRole('spinbutton',{name:'Khối lượng lệnh',exact:true}).fill('0.01')
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
      report.noUnsubmittedMarkers=true
      report.protectionLayoutAndSizing=true
      report.automaticRiskSizing=true
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
