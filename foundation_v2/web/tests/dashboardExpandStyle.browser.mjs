import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin='http://127.0.0.1:5180', output='../evidence/session-options-reference-20261018/dashboard'
await mkdir(output,{recursive:true})
const browser=await chromium.launch(), report={scope:'Actual local dashboard reads; all writes blocked',cases:[],errors:[]}
try {
  for(const theme of ['dark','light']) {
    const context=await browser.newContext({viewport:{width:1368,height:790},reducedMotion:'reduce'})
    await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin && ['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort())
    const page=await context.newPage()
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
    const toggle=page.locator('.fx-dashboard-card-expand').first()
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-expanded'),'true')
    await page.mouse.move(0,0)
    const idle=await toggle.evaluate(el=>getComputedStyle(el).backgroundColor)
    assert.ok(['rgba(0, 0, 0, 0)','transparent'].includes(idle),'expanded arrow has no persistent background')
    await toggle.hover()
    const hover=await toggle.evaluate(el=>getComputedStyle(el).backgroundColor)
    assert.notEqual(hover,idle,'hover background is retained')
    await page.mouse.move(0,0)
    await page.screenshot({path:`${output}/${theme}-expanded.png`})
    report.cases.push({theme,idle,hover,result:'PASS'})
    await context.close()
  }
  assert.deepEqual(report.errors,[])
  report.result='PASS'
}catch(error){report.result='FAIL';report.failure=error.stack;throw error}
finally{await browser.close();await writeFile(`${output}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
