import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-trading-options-20261018/ui'
await mkdir(out, { recursive:true })
const browser = await chromium.launch()
const report = { scope:'Real local catalog reads and production UI. Creation writes intercepted, no owner sessions modified.', cases:[], errors:[], unexpectedWrites:[] }
try {
  for (const mode of ['backtest','prop']) {
    let submitted, bundle, catalog
    const context = await browser.newContext({ viewport:{width:1440,height:900} })
    await context.addInitScript(() => { localStorage.setItem('tw-theme','dark'); localStorage.setItem('tw-language','vi') })
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (req.method()==='GET' && url.pathname==='/api/v2/data/datasets') {
        const response = await route.fetch(); catalog = await response.json()
        return route.fulfill({ response })
      }
      if (req.method()==='POST' && url.pathname==='/api/v2/prop/session-bundles') {
        bundle = req.postDataJSON(); return route.fulfill({json:bundle})
      }
      if (req.method()==='POST' && url.pathname==='/api/v2/replay/sessions') {
        submitted = req.postDataJSON()
        return route.fulfill({json:{record_id:'qa-options-not-persisted',revision:1,payload:submitted,session_period:{requested_start_timestamp:submitted.start_timestamp,requested_end_timestamp:submitted.end_timestamp}}})
      }
      if (!['GET','HEAD','OPTIONS'].includes(req.method())) { report.unexpectedWrites.push(url.pathname); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage(); page.setDefaultTimeout(20000)
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${mode}`)
    const dialog = page.locator('.quick-session-dialog')
    const more = dialog.getByRole('button',{name:'Tùy chọn thêm',exact:false})
    const basics = dialog.getByRole('button',{name:'Cơ bản',exact:false})
    await dialog.waitFor()
    await more.click()
    assert.equal(await dialog.getByRole('switch',{name:'Spread và commission',exact:true}).getAttribute('aria-checked'),'false')
    assert.match(await dialog.locator('.session-options-empty').textContent(),/Chọn tài sản trước/)
    assert.equal(await dialog.locator('input[maxlength="160"]').count(),0,'More options is its own panel')
    await basics.click()
    await dialog.locator('input[maxlength="160"]').first().fill(`QA options ${mode}`)
    const trigger=dialog.locator('.dataset-asset-select .fx-select-trigger:not(:disabled)')
    await trigger.click()
    await dialog.locator('.dataset-asset-select [role=option]:not([disabled])').first().click()
    await trigger.click()
    await dialog.locator('.dataset-asset-select [role=option][aria-selected=false]:not([disabled])').first().click()
    await dialog.locator('.quick-session-period-random').click()
    await more.click()
    await dialog.getByRole('switch',{name:'Spread và commission',exact:true}).click()
    const fields=dialog.locator('.session-cost-grid')
    assert.equal(await fields.count(),2)
    await fields.first().locator('input').nth(0).fill('-1')
    await dialog.locator('.quick-session-submit').click()
    await dialog.locator('.session-trading-options .wm-field-error').waitFor()
    assert.equal(submitted,undefined,'invalid costs cannot persist a session')
    await fields.first().locator('input').nth(0).fill('0.00010')
    await fields.first().locator('input').nth(1).fill('7')
    await fields.nth(1).locator('input').nth(0).fill('0.20')
    await fields.nth(1).locator('input').nth(1).fill('3')
    const lastCharge = fields.last().locator('.session-option-charge')
    for (const label of ['Mỗi chiều','Cả lượt mở + đóng']) {
      await lastCharge.locator('.fx-select-trigger').click()
      const option = lastCharge.getByRole('option',{name:label,exact:true})
      assert.ok(await option.evaluate(el => {
        const rect = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), 'last asset charge option is visible and not clipped by its surface')
      await option.click()
    }
    const slippage = dialog.locator('[data-option=slippage] .session-slippage-asset').first()
    await slippage.getByRole('button',{name:'Cố định',exact:true}).click()
    await slippage.locator('input').fill('0.00001')
    await basics.click(); await more.click()
    assert.equal(await dialog.locator('.quick-session-body').evaluate(el=>el.scrollTop),0,'switching sections starts at the section heading')
    assert.equal(await fields.first().locator('input').first().inputValue(),'0.00010','switching panels preserves cost inputs')
    assert.equal(await dialog.locator('.session-options-empty').count(),0)
    if(mode==='backtest') {
      for(const width of [1440,768,360]) for(const theme of ['dark','light']) {
        await page.setViewportSize({width,height:900})
        await page.evaluate(theme=>{ localStorage.setItem('tw-theme',theme); document.querySelector('.fx-app').dataset.theme=theme },theme)
        assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog has no horizontal overflow')
        assert.ok(await dialog.locator('.quick-session-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'panel has no horizontal overflow')
        await dialog.screenshot({path:`${out}/more-${theme}-${width}.png`})
        if(width !== 768) {
          await dialog.locator('.quick-session-body').evaluate(el=>{el.scrollTop=el.scrollHeight})
          await dialog.screenshot({path:`${out}/more-${theme}-${width}-lower.png`})
          await dialog.locator('.quick-session-body').evaluate(el=>{el.scrollTop=0})
        }
      }
      await page.setViewportSize({width:1440,height:900})
    }
    await dialog.locator('.quick-session-submit').click()
    await page.waitForFunction(()=>location.search.includes('qa-options-not-persisted'))
    assert.equal(submitted.trading_options.costs_enabled,true)
    const values=Object.values(submitted.trading_options.assets)
    assert.equal(values.length,2); assert.equal(values[0].commission_per_lot,'7'); assert.equal(values[1].spread_price,'0.20')
    if(mode==='prop') {
      assert.equal(bundle.attempt.cost_version,'session-cost-v1')
      assert.deepEqual(bundle.resume_state.setup_metadata.trading_options,submitted.trading_options)
    }
    assert.ok(catalog)
    report.cases.push(`${mode}: separate panel, default off, two independent assets, invalid blocked, draft preserved, options in creation request`)
    await context.close()
  }
  assert.deepEqual(report.unexpectedWrites,[])
  assert.deepEqual(report.errors,[])
  report.result='PASS'
} catch(error) { report.result='FAIL'; report.failure=error.stack; throw error }
finally {
  await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))
  await browser.close()
  console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors,evidence:out}))
}
