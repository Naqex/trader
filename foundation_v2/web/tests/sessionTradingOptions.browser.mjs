import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-options-polish-20261018/ui'
await mkdir(out, { recursive:true })
const browser = await chromium.launch()
const report = { scope:'Real local catalog reads and production UI. Creation writes intercepted, no owner sessions modified.', cases:[], errors:[], unexpectedWrites:[] }
try {
  for (const mode of ['backtest','prop']) for (const language of ['vi','en']) {
    const labels = language === 'vi'
      ? {more:'Tùy chọn',basic:'Cơ bản',costs:'Spread và hoa hồng',empty:'Chọn tài sản trước',light:'Nhẹ',medium:'Vừa',fixed:'Cố định',off:'Tắt',charge:['Mỗi chiều','Cả lượt mở + đóng']}
      : {more:'Options',basic:'Basic',costs:'Spreads & commission',empty:'Pick your assets first',light:'Light',medium:'Medium',fixed:'Fixed',off:'Off',charge:['Per side','Round trip']}
    let submitted, bundle, catalog
    const context = await browser.newContext({ viewport:{width:1440,height:900} })
    await context.addInitScript(language => { localStorage.setItem('tw-theme','dark'); localStorage.setItem('tw-language',language) },language)
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
    const more = dialog.getByRole('button',{name:labels.more,exact:false})
    const basics = dialog.getByRole('button',{name:labels.basic,exact:false})
    await dialog.waitFor()
    await more.click()
    assert.deepEqual(await dialog.getByRole('tab').allTextContents(),['Backtesting','Prop Firm'])
    const costs = dialog.getByRole('switch',{name:labels.costs,exact:true})
    assert.equal(await costs.getAttribute('aria-checked'),'false')
    assert.ok((await dialog.locator('.session-options-empty').textContent()).includes(labels.empty))
    assert.equal(await dialog.locator('.session-cost-surface .session-options-empty').count(),0,'asset prompt sits outside the cost card')
    assert.equal(await dialog.locator('.session-cost-empty').count(),0,'off state has no redundant asset reminder')
    await dialog.screenshot({path:`${out}/empty-${language}-off.png`})
    await costs.click()
    assert.equal(await dialog.locator('.session-cost-empty').count(),1,'costs-on prompts where to select an asset')
    await dialog.screenshot({path:`${out}/empty-${language}-on.png`})
    await costs.click()
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
    await costs.click()
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
    for (const label of labels.charge) {
      await lastCharge.locator('.fx-select-trigger').click()
      const option = lastCharge.getByRole('option',{name:label,exact:true})
      assert.ok(await option.evaluate(el => {
        const rect = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), 'last asset charge option is visible and not clipped by its surface')
      await option.click()
    }
    const slippage = dialog.locator('[data-option=slippage] .session-slippage-asset').first()
    assert.equal(await slippage.getByRole('button').count(),4)
    for (const label of [labels.light,labels.medium,labels.off,labels.fixed]) {
      await slippage.getByRole('button',{name:label,exact:true}).click()
      assert.equal(await slippage.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true')
      if(mode==='backtest' && [labels.light,labels.medium].includes(label)) {
        assert.match(await slippage.locator('p').textContent(),label===labels.light?/1 .*2/:/3 .*8/)
        await slippage.screenshot({path:`${out}/slippage-${language}-${label===labels.light?'light':'medium'}.png`})
      }
    }
    await slippage.locator('input').fill('21')
    await dialog.locator('.quick-session-submit').click()
    await dialog.locator('.session-trading-options .wm-field-error').waitFor()
    assert.equal(submitted,undefined,'fixed amount above 20 cannot persist')
    await slippage.locator('input').fill('2')
    const secondMedium=dialog.locator('[data-option=slippage] .session-slippage-asset').last().getByRole('button',{name:labels.medium,exact:true})
    const secondHasSpec=await secondMedium.isEnabled()
    if(secondHasSpec) await secondMedium.click()
    else assert.ok(await secondMedium.getAttribute('data-tooltip'),'unknown units keep slippage disabled with an explanation')
    await basics.click(); await more.click()
    assert.equal(await dialog.locator('.quick-session-body').evaluate(el=>el.scrollTop),0,'switching sections starts at the section heading')
    assert.equal(await fields.first().locator('input').first().inputValue(),'0.00010','switching panels preserves cost inputs')
    assert.equal(await dialog.locator('.session-options-empty').count(),0)
    assert.equal(await dialog.locator('.session-trading-options > .session-options-hint').count(),0,'no redundant frozen-configuration footnote')
    assert.equal(await dialog.locator('.session-cost-table > .session-options-hint').count(),0,'no verbose pip example')
    if(mode==='backtest') {
      for(const width of [1440,768,360]) for(const theme of ['dark','light']) {
        await page.setViewportSize({width,height:900})
        await page.evaluate(theme=>{ localStorage.setItem('tw-theme',theme); document.querySelector('.fx-app').dataset.theme=theme },theme)
        assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog has no horizontal overflow')
        assert.ok(await dialog.locator('.quick-session-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'panel has no horizontal overflow')
        await dialog.screenshot({path:`${out}/more-${language}-${theme}-${width}.png`})
        if(width !== 768) {
          await dialog.locator('.quick-session-body').evaluate(el=>{el.scrollTop=el.scrollHeight})
          await dialog.screenshot({path:`${out}/more-${language}-${theme}-${width}-lower.png`})
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
    assert.equal(submitted.trading_options.version,'session-trading-options-v2')
    assert.deepEqual(values[0].slippage,{mode:'fixed',fixed_steps:2})
    assert.deepEqual(values[1].slippage,{mode:secondHasSpec?'medium':'off'})
    if(mode==='prop') {
      assert.equal(bundle.attempt.cost_version,'session-cost-v2')
      assert.deepEqual(bundle.resume_state.setup_metadata.trading_options,submitted.trading_options)
    }
    assert.ok(catalog)
    report.cases.push(`${mode}/${language}: short tabs, off/on empty states, four modes, invalid fixed blocked, two independent assets, draft preserved, options in request`)
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
