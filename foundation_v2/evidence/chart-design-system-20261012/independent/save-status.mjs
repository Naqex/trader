import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile,writeFile } from 'node:fs/promises'
const fixture=JSON.parse(await readFile(new URL('../../../web/tests/visual/chart-fixture.json',import.meta.url)))
const out=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:')
const browser=await chromium.launch({headless:true}),report={scope:'Isolated browser storage failure only; labeled synthetic replay; no backend dispatch',cases:[],errors:[],blocked:[]}
try {
 for(const width of [1440,390]) for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:987},hasTouch:width===390,reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('tw:advanced-chart:'))throw new DOMException('Independent isolated quota fixture','QuotaExceededError');return original.call(this,key,value)}},theme)
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'||u.origin!=='http://127.0.0.1:5180'){report.blocked.push(r.method()+' '+u.pathname);return route.abort()}if(!u.pathname.startsWith('/api/'))return route.continue();return route.fulfill({json:u.pathname.includes('/replay/sessions/')?{...fixture.latest,dataset_sha256:null}:u.pathname.endsWith('/data/datasets')?fixture.datasets:{items:[],available:false}})})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(`http://127.0.0.1:5180/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
  await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  const status=page.locator('.advanced-chart-save-status .wm-resource-status')
  await page.locator('.advanced-chart-save-status .wm-resource-status.is-stale').waitFor({timeout:15000})
  const button=status.locator('summary');assert.match(await button.getAttribute('aria-label'),/Không lưu được chart/)
  await button.click();const detail=status.locator('.wm-resource-status-detail');await detail.waitFor()
  await page.waitForFunction(()=>{const n=document.querySelector('.advanced-chart-save-status .wm-resource-status-detail'),r=n?.getBoundingClientRect();return r && r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight},{},{timeout:5000}).catch(async e=>{await page.screenshot({path:out+`/save-error-failure-${width}-${theme}.png`});report.bounds=await detail.evaluate(n=>({box:n.getBoundingClientRect().toJSON(),style:n.getAttribute('style'),ancestor:n.closest('.chart-canvas')?.getBoundingClientRect().toJSON()}));throw e})
  assert.match(await detail.innerText(),/Không lưu được chart/)
  assert.equal(await page.locator('.advanced-chart-save-status [role=alert]').count(),1)
  await page.screenshot({path:out+`/save-error-${width}-${theme}.png`})
  await button.press('Escape');assert.equal(await status.getAttribute('open'),null)
  await button.click();await page.getByRole('button',{name:'Mua',exact:true}).click();assert.equal(await status.getAttribute('open'),null)
  await page.locator('.legacy-order-modal').getByRole('button',{name:'Hướng',exact:true}).click()
  await page.waitForFunction(()=>{const n=document.querySelector('.legacy-order-modal .fx-select-trigger[aria-expanded=true]'),p=document.createElement('span');p.style.color='var(--project-primary)';n.append(p);const match=getComputedStyle(n).borderTopColor===getComputedStyle(p).color;p.remove();return match})
  report.cases.push({width,theme,case:'Storage error status remains clickable, precise save failure copy, live alert, clamped popup, Escape/outside dismiss and settled open border blue'})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error.stack);console.error(error)}finally{await browser.close();await writeFile(out+'/save-status.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.result==='FAIL')process.exitCode=1}
