import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/session-dialog-review-20261015'
await mkdir(out, {recursive:true})
const browser = await chromium.launch()
const report = {scope:'Actual local GETs; dialog validation and catalog read only. Repair responses intercepted for notification UI tests.', cases:[], errors:[], unexpectedWrites:[]}
try {
  for (const width of [1710,390]) for (const theme of ['dark','light']) {
    const context = await browser.newContext({viewport:{width,height:987}})
    await context.addInitScript(theme => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language','vi') },theme)
    await context.route('**/*', async route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) { report.unexpectedWrites.push(request.url()); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror',error => report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=prop`)
    const dialog = page.locator('.quick-session-dialog')
    await dialog.waitFor()
    await dialog.locator('.dataset-asset-select .fx-select-trigger:not(:disabled)').waitFor()
    assert.equal(await dialog.getByRole('spinbutton',{name:'Max daily loss USD',exact:true}).inputValue(),'500')
    assert.equal(await dialog.getByRole('spinbutton',{name:'Max total loss USD',exact:true}).inputValue(),'1000')
    assert.equal(await dialog.locator('.quick-session-rule-target .quick-session-rule-input > :first-child').textContent(),'%')
    await dialog.locator('.quick-session-submit').click()
    const name = dialog.locator('input[maxlength="160"]').first()
    await name.focus()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-invalid') === 'true')
    const invalidStyle = await name.evaluate(input => {
      const style = getComputedStyle(input)
      return {outline:style.outlineStyle,shadow:style.boxShadow,border:style.borderTopWidth,focus:input === document.activeElement,error:document.getElementById(input.getAttribute('aria-describedby'))?.textContent}
    })
    assert.equal(invalidStyle.outline,'none')
    assert.equal(invalidStyle.shadow,'none')
    assert.equal(invalidStyle.border,'1px')
    assert.ok(invalidStyle.error?.includes('bắt buộc'))
    assert.equal(await dialog.locator('.wm-validation-summary').count(),0)
    const feedback = dialog.locator('footer .wm-form-feedback')
    assert.match(await feedback.textContent(),/được đánh dấu/)
    const layout = await feedback.evaluate(node => {
      const rect = node.getBoundingClientRect(), footer = node.closest('footer').getBoundingClientRect()
      const style = getComputedStyle(node)
      return {left:rect.left-footer.left,right:rect.right,bottom:rect.bottom,footerBottom:footer.bottom,color:style.color,negative:getComputedStyle(node.closest('.fx-app')).getPropertyValue('--wm-negative').trim()}
    })
    assert.ok(layout.left < 25 && layout.bottom <= layout.footerBottom)
    await dialog.screenshot({path:`${out}/validation-${theme}-${width}.png`})
    await name.fill('Review')
    await dialog.getByRole('button',{name:'Chọn tài sản',exact:true}).click()
    const options = dialog.locator('.dataset-asset-select [role=option]')
    await options.first().waitFor()
    const gold = options.filter({hasText:'XAU/USD'})
    assert.equal(await gold.count(),1,'updated gold has one current selectable row')
    await options.first().click()
    assert.equal(await dialog.locator('.dataset-asset-select .fx-select-menu').count(),0)
    await dialog.locator('.quick-session-period-random').click()
    assert.equal(await feedback.textContent(),'')
    const period = dialog.locator('.quick-session-period')
    const end = period.getByRole('textbox',{name:'Ngày kết thúc phiên (UTC)'})
    assert.equal(await end.inputValue(),'Tự động')
    assert.equal(await end.isDisabled(),true)
    await period.getByRole('button',{name:'Tùy chọn',exact:true}).click()
    assert.equal(await end.isEnabled(),true)
    await period.getByRole('button',{name:'Tự động',exact:true}).click()
    assert.equal(await end.inputValue(),'Tự động')
    assert.equal(await feedback.textContent(),'')
    const profit = dialog.getByRole('spinbutton',{name:'Mục tiêu lợi nhuận %'})
    await profit.fill('')
    await dialog.locator('.quick-session-submit').click()
    await profit.focus()
    assert.equal(await profit.evaluate(input => getComputedStyle(input).outlineStyle),'none')
    assert.equal(await profit.evaluate(input => getComputedStyle(input).borderTopWidth),'0px')
    await page.getByRole('button',{name:'Đóng tạo phiên'}).click()
    await page.goto(`${origin}/?workspace=tenant-a&view=market-data`)
    const goldRow = page.locator('tbody tr').filter({hasText:'XAU/USD'})
    await goldRow.first().waitFor()
    assert.equal(await goldRow.count(),1)
    await page.screenshot({path:`${out}/library-${theme}-${width}.png`})
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

    // Simulated responses exercise only UI feedback; no repair command reaches the real API.
    let repair = 'healthy'
    await context.route('**/api/v2/data/datasets/*/repair', route => route.fulfill({status:repair === 'error' ? 400 : 200,contentType:'application/json',body:JSON.stringify(repair === 'error' ? {detail:'dataset_source_unavailable'} : {status:repair})}))
    const checkData = async () => {
      await goldRow.getByRole('button',{name:'Thao tác dữ liệu XAU/USD',exact:true}).click()
      await page.getByRole('menuitem',{name:'Kiểm tra & khôi phục'}).click()
    }
    await checkData()
    const notice = page.locator('.wm-notification')
    await notice.waitFor()
    assert.equal(await page.getByText('Dữ liệu nguyên vẹn, không cần khôi phục.',{exact:true}).count(),0)
    assert.match(await notice.textContent(),/Đã kiểm tra/)
    await notice.getByRole('button').focus()
    await page.waitForTimeout(6200)
    assert.equal(await notice.count(),1,'focus pauses dismissal')
    await notice.getByRole('button').click()
    assert.equal(await notice.count(),0)
    repair = 'restored'
    await checkData()
    await notice.waitFor()
    await page.mouse.move(width-2,2)
    await notice.waitFor({state:'detached',timeout:8000})
    repair = 'error'
    await checkData()
    await notice.locator('[role=alert]').waitFor()
    await page.waitForTimeout(6200)
    assert.equal(await notice.count(),1,'action errors remain until dismissed')
    await notice.getByRole('button').click()
    report.cases.push({width,theme,invalidStyle,layout,result:'PASS'})
    await context.close()
  }
  assert.deepEqual(report.errors,[])
  assert.deepEqual(report.unexpectedWrites,[])
  report.result = 'PASS'
} finally {
  await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))
  await browser.close()
}
console.log(JSON.stringify({result:report.result,cases:report.cases.length}))
