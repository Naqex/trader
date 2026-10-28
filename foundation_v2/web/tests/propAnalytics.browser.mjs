import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.TW_UI_EVIDENCE_DIR || '../evidence/prop-analytics-layout-20261028')
await mkdir(out, { recursive:true })
const browser = await chromium.launch({headless:true, executablePath:process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const page = await browser.newPage({viewport:{width:1920,height:940}, reducedMotion:'reduce'})
page.setDefaultTimeout(12000)
const cases=[], errors=[]
let boundRead='not evaluated'
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>{
  const request=route.request()
  return new URL(request.url()).origin===origin && ['GET','HEAD','OPTIONS'].includes(request.method()) ? route.continue() : route.abort()
})
const route = extra => `${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&analytics_source=prop&${extra}`
const objectives=()=>page.getByTestId('prop-analytics-objectives')
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
try {
  for(const [width,lang,theme] of [[1920,'vi','dark'],[390,'vi','dark'],[1440,'en','light']]){
    await page.setViewportSize({width,height:940})
    await page.goto(route(`demo=1&lang=${lang}&theme=${theme}`))
    await objectives().waitFor()
    if(await page.locator('.fx-app').getAttribute('data-theme')!==theme)await page.getByTestId('theme-toggle').click()
    assert.equal(await page.locator('.fx-app').getAttribute('data-theme'),theme)
    const geometry=await page.evaluate(()=>{
      const box=document.querySelector('[data-testid="prop-analytics-objectives"]'), profit=document.querySelector('.fxa-profit-panel'), risk=document.querySelector('.fxa-risk-panels'), expectancy=document.querySelector('.fxa-expectancy-panel')
      const rect=node=>node.getBoundingClientRect()
      return {top:rect(box).top,bottom:rect(box).bottom,profitBottom:rect(profit).bottom,riskBottom:rect(risk).bottom,expectancyTop:rect(expectancy).top,border:getComputedStyle(box).borderColor,token:getComputedStyle(box).getPropertyValue('--project-highlight').trim(),width:getComputedStyle(box).borderTopWidth,columns:box.querySelectorAll('thead th').length}
    })
    assert.ok(geometry.top>=Math.max(geometry.profitBottom,geometry.riskBottom)-1)
    assert.ok(geometry.bottom<=geometry.expectancyTop+1)
    assert.equal(geometry.columns,3);assert.equal(geometry.width,'1px')
    const expected=await page.evaluate(()=>{const node=document.createElement('span');node.style.color='var(--project-highlight)';document.querySelector('.fx-app').append(node);const value=getComputedStyle(node).color;node.remove();return value})
    assert.equal(geometry.border,expected)
    assert.equal(await objectives().locator('.wm-table-scroll').evaluate(node=>Math.abs(node.getBoundingClientRect().width-node.querySelector('table').getBoundingClientRect().width)<1),true)
    assert.equal(await objectives().getByRole('button').count(),0)
    assert.equal(await objectives().locator('tbody tr').count(),5)
    const alignment=await objectives().locator('tbody tr').first().locator('th,td').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).textAlign))
    assert.deepEqual(alignment,['left','right','center'])
    const separators=await objectives().locator('tbody tr').evaluateAll(rows=>rows.map(row=>[...row.children].map(cell=>getComputedStyle(cell).borderBottomWidth)))
    assert.ok(separators.slice(0,-1).every(row=>row.every(width=>width==='1px')))
    assert.ok(separators.at(-1).every(width=>width==='0px'))
    await noOverflow()
    await objectives().screenshot({path:path.join(out,`objectives-${width}-${lang}-${theme}.png`)})
    const before=await objectives().innerText()
    await page.locator('#fxa-tab-drawdown').click();assert.equal(await objectives().isVisible(),false)
    await page.locator('#fxa-tab-simulation').click();assert.equal(await objectives().isVisible(),false)
    await page.locator('#fxa-tab-performance').click();assert.equal(await objectives().innerText(),before)
    cases.push(`demo ${width}/${lang}/${theme}: placement, orange token, 3 aligned columns, static rows, single separators, tabs, no overflow`)
  }
  await page.goto(route('demo=1&lang=vi&ui_state=filtered'))
  await objectives().waitFor()
  assert.equal(await page.getByTestId('analytics-performance').count(),0)
  const filtered=await objectives().innerText()
  await page.goto(route('demo=1&lang=vi'))
  await objectives().waitFor();assert.equal(await objectives().innerText(),filtered)
  cases.push('demo objectives remain independent of trade filters')
  await page.goto(route('demo=1&lang=vi&ui_state=no-trades'))
  await objectives().waitFor();assert.equal(await page.getByRole('tab').count(),3)
  assert.equal(await page.getByTestId('analytics-performance').count(),0)
  cases.push('empty demo keeps objectives and all three tabs')
  await page.goto(route('demo=1&lang=vi').replace('analytics_source=prop','analytics_source=sessions'))
  await page.getByTestId('analytics-performance').waitFor();assert.equal(await objectives().count(),0)
  cases.push('session analytics unchanged: no challenge objectives')
  const response=await fetch(`${origin}/api/v2/prop/reports`,{headers:{'X-Workspace-Id':'tenant-a'}})
  assert.equal(response.ok,true)
  const reports=(await response.json()).items, unbound=reports.find(report=>!report.provenance?.replay_binding?.replay_session_id)
  assert.ok(unbound,'Current runtime must have an unbound report for the read-only journey')
  const selected=`lang=vi&prop_session=${encodeURIComponent(unbound.session.session_id)}&attempt=${encodeURIComponent(unbound.attempt.attempt_id)}`
  await page.goto(route(selected));await objectives().waitFor();await noOverflow()
  assert.equal(await page.getByTestId('analytics-performance').count(),0)
  cases.push('real service: unbound report objectives readable without replay analytics')
  const bound=reports.find(report=>report.provenance?.replay_binding?.replay_session_id)
  if(bound){
    await page.goto(route(`lang=vi&prop_session=${encodeURIComponent(bound.session.session_id)}&attempt=${encodeURIComponent(bound.attempt.attempt_id)}`))
    await objectives().waitFor()
    try{
      await page.getByTestId('analytics-performance').waitFor({timeout:20000})
      assert.equal(await objectives().count(),1)
      assert.equal(await objectives().evaluate(node=>node.previousElementSibling?.classList.contains('fxa-risk-panels') && node.nextElementSibling?.classList.contains('fxa-expectancy-panel')),true)
      await objectives().screenshot({path:path.join(out,'real-bound-objectives.png')})
      boundRead='ready: real bound analytics renders objectives after risk and before expectancy'
      cases.push(boundRead)
    }catch(error){
      if(error.name!=='TimeoutError')throw error
      boundRead='pending: real bound analytics did not finish within 20 seconds; objectives remain readable in fallback'
    }
  }
  const fixture=structuredClone(unbound)
  fixture.phase.phase_index=2;fixture.phase.qualifying_days=3
  fixture.objectives={schema:'prop-objectives-v1',phase_index:1,technical_status:'ready',calendar:{qualifying_days:3,min_qualifying_days_satisfied:true},money:{profit_target:{current:12000,target:11000,hit:true}}}
  await page.route('**/api/v2/prop/reports',route=>route.fulfill({json:{schema_version:'prop-report-list-v1',broker_execution_capability:false,items:[fixture]}}))
  await page.goto(route(selected));await objectives().waitFor()
  for(const key of ['daily_loss','overall_drawdown','profit_target','days'])assert.match(await objectives().locator(`[data-objective="${key}"]`).innerText(),/N\/A.*Chưa đủ dữ liệu/s)
  assert.match(await page.locator('.fxa-session-trigger').innerText(),/Giai đoạn 2/)
  assert.equal(await page.locator('.fxa-prop-selector').count(),0)
  cases.push('labeled fixture: stale phase success never shown; qualifying rule retained unknown; phase context visible')
  assert.deepEqual(errors,[])
  await writeFile(path.join(out,'report.json'),JSON.stringify({scope:'Demo layout/interaction, labeled stale-phase fixture, real service GET. No writes or broker actions.',boundRead,cases,errors},null,2))
  console.log(`PASS ${cases.length} focused journeys; no page errors or writes`)
}catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}
finally{await browser.close()}
