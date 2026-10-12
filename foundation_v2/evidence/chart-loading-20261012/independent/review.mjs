import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
const out = new URL('.', import.meta.url).pathname.replace(/^\/(?:([A-Z]):)/, '$1:')
const browser = await chromium.launch({headless:true})
const results = [], errors = [], writes = []
await mkdir(out, {recursive:true})
async function create(width, theme, reducedMotion='no-preference') {
  const context = await browser.newContext({viewport:{width,height:987},reducedMotion})
  await context.addInitScript(theme => {localStorage.setItem('tw-theme',theme)}, theme)
  await context.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url())
    if (!['GET','HEAD','OPTIONS'].includes(request.method())) {writes.push(request.url());return route.abort()}
    if (!['127.0.0.1','localhost'].includes(url.hostname) && !['blob:','data:'].includes(url.protocol)) return route.abort()
    return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000)
  page.on('pageerror', e=>errors.push(String(e)))
  return {context,page}
}
try {
  for(const width of [1537,390]) for(const theme of ['dark','light']) {
    const {context,page}=await create(width,theme,theme==='light'?'reduce':'no-preference')
    let release;const gate=new Promise(r=>release=r)
    await page.route('**/api/v2/replay/sessions/qa-chart-loading*',async route=>{await gate;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Labeled independent GET failure'})})})
    await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=replay&surface=workspace&session=qa-chart-loading')
    await page.locator('.wm-chart-loading.is-viewport').waitFor()
    const metric=await page.locator('[data-testid="chart-loading"]').evaluate(node=>{
      const box=node.getBoundingClientRect(), inner=node.firstElementChild.getBoundingClientRect(), style=getComputedStyle(node), spin=getComputedStyle(node.querySelector('.wm-chart-loading-spinner'))
      return {box:{x:box.x,y:box.y,w:box.width,h:box.height},inner:{x:inner.x,y:inner.y,w:inner.width,h:inner.height},bg:style.backgroundColor,animation:spin.animationName,main:document.querySelectorAll('main,[role="main"]').length,theme:document.querySelector('.fx-app')?.dataset.theme}
    })
    assert.ok(Math.abs(metric.inner.x+metric.inner.w/2-(metric.box.x+metric.box.w/2))<1)
    assert.ok(Math.abs(metric.inner.y+metric.inner.h/2-(metric.box.y+metric.box.h/2))<1)
    assert.ok(metric.box.h>800);assert.equal(metric.main,1);assert.equal(metric.theme,theme)
    if(theme==='light')assert.equal(metric.animation,'none')
    await page.screenshot({path:out+`/initial-get-${width}-${theme}.png`})
    release()
    await page.locator('.wm-chart-loading').waitFor({state:'hidden'})
    await page.locator('[role="alert"]').first().waitFor()
    results.push({case:'Initial GET pending center/full viewport and GET failure exits spinner',width,theme,metric})
    await context.close()
  }
  const {context,page}=await create(390,'dark')
  let release;const gate=new Promise(r=>release=r)
  await page.route('**/src/SessionPicker.jsx',async route=>{await gate;await route.continue()})
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=replay&area=testing&section=sessions&select=1')
  await page.locator('.wm-page-skeleton').waitFor()
  assert.equal(await page.locator('.wm-chart-loading').count(),0)
  results.push({case:'Sessions lazy picker remains page skeleton'})
  release();await context.close()
} catch(error){errors.push(String(error))}
finally {await browser.close();await writeFile(out+'/independent-initial.json',JSON.stringify({scope:'GET-only initial chart loading and Sessions picker',results,errors,writes,result:errors.length||writes.length?'FAIL':'PASS'},null,2))}
console.log(JSON.stringify({cases:results.length,errors,writes}))
if(errors.length||writes.length)process.exitCode=1
