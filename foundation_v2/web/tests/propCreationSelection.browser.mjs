import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/prop-creation-selection-20261018'
await mkdir(out, { recursive:true })
const browser = await chromium.launch()
const report = { scope:'Real local catalog reads; creator selection and validation only. All mutations blocked.', cases:[], errors:[], unexpectedWrites:[] }
try {
  const context = await browser.newContext({ viewport:{ width:1368, height:790 } })
  await context.addInitScript(() => { localStorage.setItem('tw-theme','dark'); localStorage.setItem('tw-language','vi') })
  await context.route('**/*', route => {
    const request = route.request()
    if (new URL(request.url()).origin !== origin) return route.abort()
    if (!['GET','HEAD','OPTIONS'].includes(request.method())) { report.unexpectedWrites.push(request.url()); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=prop`)
  const dialog = page.locator('.quick-session-dialog')
  const trigger = dialog.locator('.dataset-asset-select .fx-select-trigger')
  const options = dialog.locator('.dataset-asset-select [role=option]')
  const tags = dialog.locator('.fx-select-tag')
  await trigger.waitFor()
  await page.waitForFunction(() => !document.querySelector('.dataset-asset-select .fx-select-trigger')?.disabled)
  await trigger.click()
  assert.ok(await options.count() >= 2, 'catalog supplies at least two symbols for the selection regression')
  await options.first().click()
  assert.equal(await tags.count(), 1)
  await trigger.click()
  assert.ok(await options.locator('xpath=self::*[@aria-selected="false"][@disabled]').count() >= 1, 'other symbols disabled once Prop has an asset')
  assert.equal(await options.locator('xpath=self::*[@aria-selected="false"][not(@disabled)]').count(), 0)
  await page.keyboard.press('Escape')
  await tags.locator('button').click()
  assert.equal(await tags.count(), 0)
  await trigger.click()
  assert.equal(await options.locator('xpath=self::*[@disabled]').count(), 0, 'clearing enables every available symbol again')
  await page.keyboard.press('Escape')
  report.cases.push('Prop selects one asset; other symbols disabled; explicit removal reenables them')

  await dialog.locator('[role=tab][id$="-backtest"]').click()
  await trigger.click()
  await options.first().click()
  await trigger.click()
  await options.locator('xpath=self::*[@aria-selected="false"][not(@disabled)]').first().click()
  const selectedNames = await tags.locator('span').allTextContents()
  assert.equal(await tags.count(), 2, 'Backtest retains multiple assets')
  await dialog.locator('[role=tab][id$="-prop"]').click()
  assert.deepEqual(await tags.locator('span').allTextContents(), selectedNames, 'switching mode never silently drops a choice')
  await dialog.locator('input[maxlength="160"]').first().fill('Creator selection regression — not persisted')
  await dialog.locator('.quick-session-period-random').click()
  await dialog.locator('.quick-session-submit').click()
  const error = dialog.locator('.wm-field-error').filter({ hasText:'Phiên Prop Firm chỉ hỗ trợ 1 tài sản' })
  await error.waitFor()
  assert.equal(report.unexpectedWrites.length, 0, 'invalid Prop selection never reaches mutation transport')
  await dialog.screenshot({ path:`${out}/prop-multi-selection-desktop.png` })
  report.cases.push('two-asset Backtest switches to Prop without data loss; submit reports one-asset limit before any request')

  await page.setViewportSize({ width:390, height:844 })
  await dialog.screenshot({ path:`${out}/prop-multi-selection-mobile.png` })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page has no horizontal overflow')
  await tags.first().locator('button').click()
  await error.waitFor({ state:'hidden' })
  assert.equal(await tags.count(), 1)
  report.cases.push('mobile layout fits and removing the extra asset clears validation')
  assert.deepEqual(report.errors, [])
  await context.close()
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack
  throw error
} finally {
  await writeFile(`${out}/browser.json`, JSON.stringify(report,null,2))
  await browser.close()
  console.log(JSON.stringify({ result:report.result, cases:report.cases.length, errors:report.errors, unexpectedWrites:report.unexpectedWrites, evidence:out }))
}
