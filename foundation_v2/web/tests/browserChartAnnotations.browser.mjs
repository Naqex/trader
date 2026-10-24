import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { installBrowserAnnotationFixture, checkBrowserChartAnnotations } from './browserChartAnnotationChecks.mjs'

const origin=process.env.CHART_DS_ORIGIN||'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname,'127.0.0.1')
const output=process.env.CHART_DS_OUTPUT||'E:/BACKUP-TRADINGWORKSPACE/chart-browser-annotations'
const fixture=JSON.parse(await readFile(new URL('./visual/chart-fixture.json',import.meta.url)))
const replay={...fixture.latest,dataset_sha256:null,has_future_rows:true}
const report={scope:'Synthetic replay data and browser annotation API; native chart library; all API writes blocked',cases:[],errors:[],writes:[],blockedActivity:[]}
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try {
  for(const [width,theme,mode] of [[1440,'dark','toggle'],[390,'light','toggle'],[1440,'dark','active'],[1440,'dark','absent']]) {
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    if(mode!=='absent')await installBrowserAnnotationFixture(context)
    await context.addInitScript(({theme,mode})=>{
      localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')
      if(mode==='active')window.__annotationActive=true
    },{theme,mode})
    await context.route('**/api/**',route=>{
      const req=route.request(),url=new URL(req.url())
      if(req.method()==='POST'&&url.pathname===`/api/v2/replay/sessions/${fixture.session}/activity`){report.blockedActivity.push(url.pathname);return route.abort()}
      if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.writes.push(req.url());return route.abort()}
      if(url.pathname.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
      return route.fulfill({json:url.pathname===`/api/v2/replay/sessions/${fixture.session}`?replay:url.pathname==='/api/v2/data/datasets'?fixture.datasets:{items:[],available:false}})
    })
    const page=await context.newPage()
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&area=testing&session=${fixture.session}`)
    await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    if(mode==='toggle')await checkBrowserChartAnnotations(page)
    else assert.equal(await page.locator('.advanced-chart-host iframe').evaluate(node=>getComputedStyle(node).pointerEvents),mode==='active'?'none':'auto')
    if(mode==='active') {
      await page.reload()
      await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
      assert.equal(await page.locator('.advanced-chart-host iframe').evaluate(node=>getComputedStyle(node).pointerEvents),'none')
    }
    await page.screenshot({path:`${output}/replay-${width}-${mode}.png`})
    await page.evaluate(()=>{
      window.__detachedChartHost=document.querySelector('.advanced-chart-host')
      const url=new URL(location.href);url.searchParams.set('view','ai');url.searchParams.set('area','ai');url.searchParams.set('section','connections');url.searchParams.delete('surface')
      history.pushState(null,'',url);dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.locator('.advanced-chart-host').waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>window.__detachedChartHost.hasAttribute('data-browser-annotating')),false,'Unmount removes annotation state')
    report.cases.push({width,theme,mode,passed:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[])
  report.result='PASS'
}catch(error){report.result='FAIL';report.failure=error.stack;throw error}
finally{await browser.close();await writeFile(`${output}/browser.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
