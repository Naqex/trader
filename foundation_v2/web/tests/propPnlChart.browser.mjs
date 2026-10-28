import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin=process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180', out=path.resolve(process.env.TW_UI_EVIDENCE_DIR || '../evidence/prop-pnl-chart-20261028')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const cases=[],errors=[]
const base=`${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&analytics_source=prop&lang=vi`
const context=await browser.newContext({viewport:{width:1920,height:940},reducedMotion:'reduce'})
await context.route('**/*',route=>new URL(route.request().url()).origin===origin && ['GET','HEAD','OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort())
const page=await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror',error=>errors.push(error.message))
const chart=()=>page.locator('.fxa-profit-panel .fxa-line-viz')
const referenceValues=async()=>chart().locator('[data-reference]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.reference,Number(node.dataset.value)])))
const verifyGeometry=async()=>{
  const geometry=await chart().evaluate(node=>{
    const svg=node.querySelector(':scope>svg'), bounds=svg.getBoundingClientRect()
    const labels=[...node.querySelectorAll('.fxa-chart-reference text')].map(text=>text.getBoundingClientRect())
    const lines=[...node.querySelectorAll('.fxa-chart-reference>line:not(.fxa-chart-reference-connector)')].map(line=>({y:Number(line.getAttribute('y1')),x1:Number(line.getAttribute('x1')),x2:Number(line.getAttribute('x2'))}))
    const connected=[...node.querySelectorAll('.fxa-chart-reference')].every(group=>{
      const line=group.querySelector(':scope>line'),label=group.querySelector('.fxa-chart-reference-label').getBBox(),y=Number(line.getAttribute('y1')),connector=group.querySelector('.fxa-chart-reference-connector')
      return Math.abs(label.y+label.height-y)<.01 || connector && Number(connector.getAttribute('y2'))===y && [label.y,label.y+label.height].some(edge=>Math.abs(edge-Number(connector.getAttribute('y1')))<.01)
    })
    return {connected,fit:labels.every(box=>box.left>=bounds.left && box.right<=bounds.right+1 && box.top>=bounds.top && box.bottom<=bounds.bottom),overlap:labels.length===2 && labels[0].top<labels[1].bottom && labels[1].top<labels[0].bottom,lines,height:svg.viewBox.baseVal.height}
  })
  assert.equal(geometry.fit,true);assert.equal(geometry.overlap,false);assert.equal(geometry.connected,true)
  for(const line of geometry.lines){assert.ok(line.y>=0 && line.y<geometry.height);assert.ok(line.x2>line.x1)}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
}
try{
  for(const [width,theme] of [[1920,'dark'],[390,'dark'],[1440,'light']]){
    await page.setViewportSize({width,height:940})
    await page.goto(`${base}&demo=1`)
    await chart().waitFor()
    if(await page.locator('.fx-app').getAttribute('data-theme')!==theme)await page.getByTestId('theme-toggle').click()
    assert.deepEqual(await referenceValues(),{overall_drawdown:-1000,profit_target:1000})
    await verifyGeometry()
    const contrast=await chart().locator('.fxa-chart-reference').evaluateAll(nodes=>{
      const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(channel=>Number(channel)*(value.startsWith('color(srgb ') ? 255 : 1))
      const luminance=value=>rgb(value).map(channel=>channel/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0)
      return nodes.map(node=>{const label=getComputedStyle(node.querySelector('.fxa-chart-reference-label')),fill=label.fill,text=getComputedStyle(node.querySelector('text')).fill,a=luminance(fill),b=luminance(text);return {solid:fill===label.stroke,black:text==='rgb(8, 8, 8)',ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}})
    })
    assert.ok(contrast.every(label=>label.solid && label.black && label.ratio>=4.5),JSON.stringify(contrast))

    await page.mouse.move(0,0);await chart().locator(':scope>svg').focus();await page.keyboard.press('Tab')
    assert.equal(await chart().locator('.fxa-chart-tools').evaluate(node=>getComputedStyle(node).opacity),'1')
    await page.locator('#fxa-tab-performance').focus();await page.mouse.move(0,0)
    assert.equal(await chart().locator('.fxa-chart-tools').evaluate(node=>getComputedStyle(node).opacity),'0')
    await chart().hover()
    assert.equal(await chart().locator('.fxa-chart-tools').evaluate(node=>getComputedStyle(node).opacity),'1')
    await chart().getByRole('button',{name:'Phóng to biểu đồ',exact:true}).click()
    assert.notEqual(await chart().getAttribute('data-chart-range'),'0:1')
    assert.deepEqual(await referenceValues(),{overall_drawdown:-1000,profit_target:1000})
    await chart().getByRole('button',{name:'Đặt lại biểu đồ',exact:true}).click()
    assert.equal(await chart().getAttribute('data-chart-range'),'0:1')
    await page.mouse.move(0,0);await page.locator('#fxa-tab-performance').focus();await chart().screenshot({path:path.join(out,`prop-${width}-${theme}.png`)})
    cases.push(`demo ${width}/${theme}: threshold values, solid label contrast, geometry, hover/focus, zoom/reset`)
  }
  await page.goto(base.replace('analytics_source=prop','analytics_source=sessions')+'&demo=1')
  await chart().waitFor();assert.equal(await chart().locator('[data-reference]').count(),0)
  await chart().hover();assert.equal(await chart().locator('.fxa-chart-tools').getByRole('button').count(),5)
  cases.push('sessions retains shared five-button toolbar and has no challenge lines')
  const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  await touch.route('**/*',route=>new URL(route.request().url()).origin===origin && ['GET','HEAD','OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort())
  const touchPage=await touch.newPage()
  await touchPage.goto(base+'&demo=1')
  const touchTools=touchPage.locator('.fxa-profit-panel .fxa-chart-tools')
  await touchTools.waitFor();assert.equal(await touchTools.evaluate(node=>getComputedStyle(node).opacity),'1')
  await touchPage.locator('.fxa-profit-panel .fxa-line-viz').screenshot({path:path.join(out,'prop-touch.png')})
  await touchTools.getByRole('button',{name:'Phóng to biểu đồ',exact:true}).tap()
  assert.notEqual(await touchPage.locator('.fxa-profit-panel .fxa-line-viz').getAttribute('data-chart-range'),'0:1')
  await touch.close();cases.push('touch: toolbar always visible and zoom tappable')
  const response=await fetch(`${origin}/api/v2/prop/reports`,{headers:{'X-Workspace-Id':'tenant-a'}})
  assert.equal(response.ok,true)
  const bound=(await response.json()).items.find(report=>report.provenance?.replay_binding?.replay_session_id)
  assert.ok(bound)
  const url=`${base}&prop_session=${encodeURIComponent(bound.session.session_id)}&attempt=${encodeURIComponent(bound.attempt.attempt_id)}`
  await page.goto(url);await chart().waitFor()
  const initial=Number(bound.phase.initial_balance)
  assert.deepEqual(await referenceValues(),{overall_drawdown:Number(bound.objectives.money.overall_drawdown.floor)-initial,profit_target:Number(bound.objectives.money.profit_target.target)-initial})
  await verifyGeometry();await chart().screenshot({path:path.join(out,'real-bound.png')})
  cases.push('real service: target/floor projected from current evaluator snapshot onto phase PnL baseline')
  const fixture=structuredClone(bound)
  fixture.objectives.money.overall_drawdown={kind:'trailing',reference:initial+5000,current:initial,floor:initial+1000,breached:true}
  fixture.objectives.money.profit_target={target:initial+1000,current:initial,hit:false}
  await context.route('**/api/v2/prop/reports',route=>route.fulfill({json:{schema_version:'prop-report-list-v1',broker_execution_capability:false,items:[fixture]}}))
  await page.goto(url);await chart().waitFor()
  assert.deepEqual(await referenceValues(),{overall_drawdown:1000,profit_target:1000})
  assert.equal(await chart().locator('[data-reference="overall_drawdown"]>line').getAttribute('stroke-dasharray'),'5 4')
  assert.match(await chart().locator('[data-reference="overall_drawdown"]').textContent(),/hiện tại/)
  await verifyGeometry();await chart().screenshot({path:path.join(out,'fixture-trailing-coincident.png')})
  cases.push('labeled fixture: positive trailing floor, current snapshot label, coincident thresholds have distinct labels')
  fixture.objectives.phase_index=fixture.phase.phase_index+1
  await page.goto(url);await chart().waitFor();assert.deepEqual(await referenceValues(),{})
  cases.push('labeled fixture: stale phase evaluator never creates threshold lines')
  assert.deepEqual(errors,[])
  await writeFile(path.join(out,'report.json'),JSON.stringify({scope:'Read-only real runtime, demo, labeled trailing/stale fixtures. No broker actions.',cases,errors},null,2))
  console.log(`PASS ${cases.length} PnL chart journeys`)
}catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}
finally{await browser.close()}
