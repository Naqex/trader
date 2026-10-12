import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
const fixture=JSON.parse(await readFile(new URL('../../../web/tests/visual/chart-fixture.json',import.meta.url)))
const out=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:')
const browser=await chromium.launch({headless:true}), report={cases:[],errors:[],blocked:[],unexpected:[],scope:'Read-only labeled synthetic prefix, real local chart, app-owned UI and actual coarse-pointer mobile'}
try {
 for(const width of [1440,390]) for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:987},hasTouch:width===390,reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(r.method()!=='GET'||u.origin!=='http://127.0.0.1:5180'){report.blocked.push(r.method()+' '+u.pathname);return route.abort()}
   if(!u.pathname.startsWith('/api/'))return route.continue()
   const body=u.pathname.includes('/replay/sessions/')?{...fixture.latest,dataset_sha256:null}:u.pathname.endsWith('/data/datasets')?fixture.datasets:{items:[],available:false}
   return route.fulfill({json:body})
  })
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(`http://127.0.0.1:5180/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
  await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  await page.getByRole('button',{name:'Mở danh sách lệnh',exact:true}).click()
  await page.locator('.legacy-positions [data-empty-kind=chart-unknown]').waitFor()
  assert.equal(await page.locator('.legacy-positions table,.legacy-positions .wm-pagination').count(),0)
  await page.getByRole('tab',{name:'Vị thế đang mở',exact:true}).press('ArrowRight')
  assert.equal(await page.getByRole('tab',{name:'Lệnh chờ',exact:true}).getAttribute('aria-selected'),'true')
  await page.screenshot({path:out+`/positions-unknown-${width}-${theme}.png`})
  report.cases.push({width,theme,case:'Unknown cutoff uses local empty without table/pager, tabs keyboard navigate'})
  await page.getByRole('button',{name:'Thu gọn danh sách lệnh',exact:true}).click()
  if(width===390) {
   const toggle=page.locator('.chart-utility-toggle');
   const hit=await toggle.evaluate(n=>{const b=n.getBoundingClientRect(),rail=n.closest('nav'),s=getComputedStyle(rail);return {button:b.toJSON(),rail:rail.getBoundingClientRect().toJSON(),style:{width:s.width,top:s.top,right:s.right,bottom:s.bottom,zIndex:s.zIndex,overflow:s.overflow},hit:document.elementsFromPoint(b.x+b.width/2,b.y+b.height/2).slice(0,5).map(n=>({tag:n.tagName,cls:n.className}))}})
   await writeFile(out+`/mobile-pointer-${theme}.json`,JSON.stringify(hit,null,2));await page.screenshot({path:out+`/mobile-pointer-${theme}.png`})
   await toggle.click()
   await page.locator('.chart-utility-rail.is-open').waitFor()
   await page.keyboard.press('Escape');await page.locator('.chart-utility-rail.is-open').waitFor({state:'hidden'})
   assert.equal(await toggle.evaluate(n=>n===n.ownerDocument.activeElement),true)
   await toggle.click();await page.getByRole('button',{name:'Mua',exact:true}).click()
   await page.locator('.chart-utility-rail.is-open').waitFor({state:'hidden'})
   report.cases.push({width,theme,case:'Mobile utility menu Escape and outside dismissal'})
  } else await page.getByRole('button',{name:'Mua',exact:true}).click()
  const modal=page.locator('.legacy-order-modal');await modal.waitFor()
  const direction=modal.getByRole('button',{name:'Hướng',exact:true});
  const fieldStyle=await direction.evaluate(n=>({border:getComputedStyle(n).borderTopWidth,width:n.getBoundingClientRect().width,parent:n.closest('.fx-select').getBoundingClientRect().width}))
  assert.equal(fieldStyle.border,'1px');assert.ok(Math.abs(fieldStyle.width-fieldStyle.parent)<1)
  const modalBefore=await modal.boundingBox();await direction.click();await modal.locator('.fx-select-menu').waitFor()
  const menuStyle=await modal.locator('.fx-select-menu').evaluate(n=>({bg:getComputedStyle(n).backgroundColor,position:getComputedStyle(n).position,radius:getComputedStyle(n).borderRadius}));assert.notEqual(menuStyle.bg,'rgba(0, 0, 0, 0)');assert.equal(menuStyle.position,'absolute');assert.equal(menuStyle.radius,'12px')
  assert.deepEqual(await modal.boundingBox(),modalBefore)
  await page.screenshot({path:out+`/order-menu-${width}-${theme}.png`})
  await page.keyboard.press('Escape');await modal.locator('.fx-select-menu').waitFor({state:'hidden'})
  assert.equal(await modal.count(),1);assert.equal(await direction.evaluate(n=>n.ownerDocument.activeElement===n),true)
  const size=await direction.boundingBox();assert.ok(size.height>=(width===390?44:36))
  const readonly=modal.locator('input[readonly]:not([type=checkbox])');
  const before=await readonly.evaluate(n=>({bg:getComputedStyle(n).backgroundColor,line:getComputedStyle(n).borderColor}));await readonly.hover()
  const after=await readonly.evaluate(n=>({bg:getComputedStyle(n).backgroundColor,line:getComputedStyle(n).borderColor}));assert.deepEqual(after,before)
  await page.screenshot({path:out+`/order-${width}-${theme}.png`})
  await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'})
  assert.equal(await page.getByRole('button',{name:'Mua',exact:true}).evaluate(n=>n===n.ownerDocument.activeElement),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  report.cases.push({width,theme,case:'Owned dropdown Escape hierarchy and focus, readonly hover, desktop36/touch44 sizing, no overflow'})
  await context.close()
 }
 assert.deepEqual(report.errors,[])
 report.result='PASS'
} catch(error){report.result='FAIL';report.failure=String(error.stack);console.error(error)}
finally {await browser.close();await writeFile(out+'/focused.json',JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors,blocked:report.blocked}));if(report.result==='FAIL')process.exitCode=1}
