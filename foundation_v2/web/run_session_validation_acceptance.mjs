import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.TW_UI_BASE || 'http://127.0.0.1:5180'
const out = process.env.TW_VALIDATION_EVIDENCE || '../evidence/session-validation-20261014'
await mkdir(out, {recursive:true})
const browser = await chromium.launch({headless:true})
const results = [], errors = []
const dataset = {dataset_id:'validation-fixture',instrument_id:'EUR/USD',asset_class:'fx',timeframe:'60s',timeframe_seconds:60,row_count:100,first_timestamp:1704067200,last_timestamp:1735689600,instrument_spec:{account_ccy:'USD'},source:{provider:'Fixture'}}
try {
  for (const theme of ['dark','light']) for (const width of [1440,768,360]) {
    const page = await browser.newPage({viewport:{width,height:987}})
    page.setDefaultTimeout(7000)
    page.on('pageerror',error => errors.push(error.message))
    await page.addInitScript(theme => {localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
    const mutations = []
    await page.route('**/api/**',route => {
      if (route.request().method() === 'GET') return route.continue()
      mutations.push(route.request().url())
      return route.fulfill({status:422,json:{detail:'validation-fixture-rejection'}})
    })
    await page.route('**/api/v2/data/datasets',route => route.fulfill({json:{items:[dataset],catalog_items:[]}}))
    await page.route('**/api/v2/playbooks',route => route.request().method() === 'GET' ? route.fulfill({json:{items:[]}}) : route.fallback())
    await page.goto(`${base}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
    await page.locator('.fx-dashboard-quick-action').first().click()
    await page.getByRole('tab',{name:'Phiên prop firm',exact:true}).click()
    const dialog = page.locator('.quick-session-dialog'), submit = dialog.locator('.quick-session-submit')
    assert.equal(await submit.isEnabled(),true)
    assert.equal(await dialog.locator('[aria-invalid=true]').count(),0)
    await submit.click()
    const name = dialog.getByPlaceholder('Đặt tên phiên của bạn')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-invalid') === 'true')
    assert.equal(await name.evaluate(el => el === document.activeElement),true)
    assert.equal(await dialog.locator('.wm-validation-summary').count(),1)
    await name.fill('Validation fixture')
    assert.equal(await name.getAttribute('aria-invalid'),null)
    await dialog.locator('.dataset-asset-select .fx-select-trigger').click()
    await dialog.getByRole('option').first().click()
    await submit.click()
    const start = dialog.getByLabel('Ngày bắt đầu phiên (UTC)',{exact:true})
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ngày bắt đầu phiên (UTC)')
    assert.equal(await start.getAttribute('aria-invalid'),'true')
    await start.fill('01/02/2024 00:00')
    const rules = dialog.locator('.quick-session-rule-input')
    await rules.nth(0).locator('input').fill('0')
    await rules.nth(1).locator('input').fill('0')
    await rules.nth(2).locator('input').fill('-1')
    await submit.click()
    assert.equal(await rules.locator('[aria-invalid=true]').count(),3)
    assert.equal(await dialog.locator('.wm-validation-summary li').count(),3)
    for (let i=0;i<3;i++) {
      await rules.nth(i).locator('input').fill(['10','500','1000'][i])
      await name.focus()
      await page.mouse.move(0,0)
      const before = await rules.nth(i).evaluate(el => getComputedStyle(el).backgroundColor)
      await rules.nth(i).hover()
      await page.waitForFunction(({index,before}) => getComputedStyle(document.querySelectorAll('.quick-session-rule-input')[index]).backgroundColor !== before,{index:i,before})
    }
    assert.equal(await dialog.locator('.wm-validation-summary').count(),0)
    await dialog.getByRole('button',{name:'+ Tạo chiến lược mới',exact:true}).click()
    await dialog.getByRole('button',{name:'Tạo chiến lược',exact:true}).click()
    assert.equal(await dialog.getByLabel('Tên chiến lược',{exact:true}).getAttribute('aria-invalid'),'true')
    await dialog.getByLabel('Tên chiến lược',{exact:true}).fill('Draft strategy')
    await submit.click()
    assert.match(await dialog.locator('.wm-validation-summary').innerText(),/Hoàn tất hoặc hủy/)
    assert.equal(await submit.isEnabled(),true)
    assert.deepEqual(mutations,[])
    // The row reflows instead of crushing the strategy input on mobile.
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth),false)
    await page.screenshot({path:`${out}/${theme}-${width}.png`})
    await dialog.locator('.quick-session-strategy-create').getByRole('button',{name:'Hủy',exact:true}).click()
    await rules.nth(0).locator('input').fill('0')
    await dialog.getByRole('tab',{name:'Phiên backtest',exact:true}).click()
    assert.equal(await dialog.locator('.wm-validation-summary').count(),0)
    await submit.click()
    await dialog.locator('.quick-session-error').waitFor()
    assert.match(await dialog.locator('.quick-session-error').innerText(),/validation-fixture-rejection/)
    assert.equal(mutations.length,1)
    assert.match(mutations[0],/replay\/sessions$/)
    assert.equal(await name.inputValue(),'Validation fixture')
    results.push({theme,width,pass:true,scope:'labeled-fixture; all mutations intercepted'})
    await page.close()
  }
  assert.deepEqual(errors,[])
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`,JSON.stringify({results,errors},null,2))
}
console.log(JSON.stringify({results,errors}))
