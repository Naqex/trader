import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile,writeFile } from 'node:fs/promises'
const fixture=JSON.parse(await readFile(new URL('../../../web/tests/visual/chart-fixture.json',import.meta.url)))
const out=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:')
const browser=await chromium.launch({headless:true}),report={scope:'Isolated labeled synthetic replay; final Scalper DS adapter only; no backend dispatch',cases:[],errors:[],blocked:[]}
try {
 for(const width of [1440,390]) for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:987},hasTouch:width===390,reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'||u.origin!=='http://127.0.0.1:5180'){report.blocked.push(r.method()+' '+u.pathname);return route.abort()}if(!u.pathname.startsWith('/api/'))return route.continue();return route.fulfill({json:u.pathname.includes('/replay/sessions/')?{...fixture.latest,dataset_sha256:null}:u.pathname.endsWith('/data/datasets')?fixture.datasets:{items:[],available:false}})})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(`http://127.0.0.1:5180/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
  await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  await page.locator('.legacy-quantity-control input').click()
  await page.waitForFunction(()=>{const n=document.querySelector('.legacy-quantity-control'),p=document.createElement('span');p.style.color='var(--project-primary)';n.append(p);const match=getComputedStyle(n).borderTopColor===getComputedStyle(p).color;p.remove();return match})
  await page.locator('.legacy-scalper-button').click()
  const form=page.locator('.legacy-scalper-settings');await form.waitFor()
  assert.equal(await form.locator('select').count(),0)
  const field=form.getByRole('button',{name:'Chiến lược',exact:true});assert.equal(await field.isDisabled(),true)
  const style=await field.evaluate(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return{font:s.fontSize,border:s.borderTopWidth,radius:s.borderRadius,width:r.width,height:r.height,parent:n.closest('.fx-select').getBoundingClientRect().width,bg:s.backgroundColor}})
  report.styles ??= [];report.styles.push({width,theme,...style});assert.equal(style.font,'13px');assert.equal(style.border,'1px');assert.equal(style.radius,'8px');assert.ok(style.height>=(width===390?44:36));assert.ok(Math.abs(style.width-style.parent)<1)
  await field.hover();await page.mouse.move(0,0);assert.equal(await field.evaluate(n=>getComputedStyle(n).backgroundColor),style.bg)
  await page.screenshot({path:out+`/scalper-final-${width}-${theme}.png`})
  await page.keyboard.press('Escape');await form.waitFor({state:'hidden'})
  report.cases.push({width,theme,case:'Final Scalper disabled strategy uses full-width DS FxSelect,8px/13px/36desktop44touch, no native arrow/menu or overflow; touch quantity focus and actual Scalper click pass'})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error.stack);console.error(error)}finally{await browser.close();await writeFile(out+'/scalper-final.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.result==='FAIL')process.exitCode=1}
