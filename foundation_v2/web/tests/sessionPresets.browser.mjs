import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const origin=process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out=process.env.TW_UI_EVIDENCE_DIR || '../evidence/preset-design-system-20261019/ui'
await mkdir(out,{recursive:true})
const browser=await chromium.launch()
const report={scope:'Production UI with an in-memory preset HTTP fixture and isolated browser storage. Real catalog GETs, all owner writes blocked; one intercepted session-creation 503 test. Database acceptance is separate.',cases:[],errors:[],writes:[],presetRequests:0}
try {
 for(const mode of ['backtest','prop']) for(const language of ['vi','en']) {
  const en=language==='en',context=await browser.newContext({viewport:{width:1368,height:790}})
  await context.addInitScript(language=>{localStorage.setItem('tw-language',language);localStorage.setItem('tw-theme','dark')},language)
  let failCreate=false,failDelete=false
  const savedPresets=new Map()
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==origin) return route.abort()
   if(url.pathname.startsWith('/api/v2/session-presets')) {
    report.presetRequests++
    if(request.method()==='GET') return route.fulfill({json:{version:'session-presets-v1',items:[...savedPresets.values()].filter(item=>item.mode===url.searchParams.get('mode'))}})
    const body=request.postDataJSON(),id=url.pathname.split('/')[4]
    if(url.pathname.endsWith('/delete')) {
     if(failDelete) return route.fulfill({status:409,json:{detail:'session_preset_revision_conflict'}})
     const current=savedPresets.get(id);assert.equal(body.expected_revision,current.revision)
     savedPresets.delete(id);return route.fulfill({json:{id,mode:body.mode,revision:current.revision+1,deleted:true}})
    }
    const current=id?savedPresets.get(id):null
    if(current) assert.equal(body.expected_revision,current.revision)
    const next={...body,id:id||crypto.randomUUID(),revision:(current?.revision||0)+1}
    savedPresets.set(next.id,next)
    return route.fulfill({status:current?200:201,json:next})
   }
   if(!['GET','HEAD','OPTIONS'].includes(request.method())) {
    if(failCreate && url.pathname==='/api/v2/replay/sessions') {
     const body=request.postDataJSON()
     assert.equal(body.starting_balance,'50000')
     assert.equal(Object.values(body.trading_options.assets)[0].spread_price,'0.0002')
     return route.fulfill({status:503,json:{detail:'QA uncertain create'}})
    }
    report.writes.push(url.pathname);return route.abort()
   }
   return route.continue()
  })
  const page=await context.newPage();page.setDefaultTimeout(12000)
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&create=${mode}`)
  const dialog=page.locator('.quick-session-dialog'),trigger=dialog.locator('.session-preset-trigger'),menu=dialog.locator('.session-preset-menu')
  await dialog.waitFor();await trigger.waitFor({state:'visible'})
  assert.equal(await dialog.locator('.quick-session-sections strong').nth(1).textContent(),en?'Options':'Tùy chọn')
  if(mode==='backtest') {
   for(const width of [1368,360]) for(const theme of ['dark','light']) {
    await page.setViewportSize({width,height:790})
    await page.evaluate(theme=>{document.querySelector('.fx-app').dataset.theme=theme},theme)
    const smooth=dialog.locator('.session-smooth-candles')
    await smooth.scrollIntoViewIfNeeded()
    const geometry=await dialog.locator('.session-chart-options').evaluate(root=>{
     const select=root.querySelector('.fx-select-trigger'),smooth=root.querySelector('.session-smooth-candles'),toggle=smooth.querySelector('button'),style=getComputedStyle(smooth),toggleStyle=getComputedStyle(toggle)
     return {selectHeight:select.getBoundingClientRect().height,smoothHeight:smooth.getBoundingClientRect().height,selectFont:getComputedStyle(select).fontSize,smoothFont:style.fontSize,line:style.lineHeight,controlLine:style.getPropertyValue('--ds-line-control').trim(),width:toggle.getBoundingClientRect().width,height:toggle.getBoundingClientRect().height,switchWidth:parseFloat(style.getPropertyValue('--ds-switch-width')),switchHeight:parseFloat(style.getPropertyValue('--ds-switch-height')),opacity:style.opacity,disabledOpacity:style.getPropertyValue('--ds-disabled-opacity').trim(),childOpacity:toggleStyle.opacity}
    })
    assert.equal(geometry.smoothHeight,geometry.selectHeight,'adjacent chart controls align')
    assert.equal(geometry.smoothFont,geometry.selectFont,'chart control labels use the same typography')
    assert.equal(geometry.line,geometry.controlLine)
    assert.equal(geometry.width,geometry.switchWidth);assert.equal(geometry.height,geometry.switchHeight)
    assert.equal(Number(geometry.opacity),Number(geometry.disabledOpacity));assert.equal(geometry.childOpacity,'1','disabled opacity applies once')
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no horizontal overflow')
    if(!en) await dialog.screenshot({animations:'disabled',path:`${out}/chart-options-${theme}-${width}.png`})
   }
   await page.setViewportSize({width:1368,height:790});await page.evaluate(()=>{document.querySelector('.fx-app').dataset.theme='dark'})
  }
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).borderTopColor),'rgba(0, 0, 0, 0)','unselected preset has no colored border')
  await page.addStyleTag({content:'*,*::before,*::after{animation:none !important;transition:none !important}'})
  assert.notEqual(await trigger.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','unselected preset has a neutral surface')
  await dialog.locator('input[maxlength="160"]').first().fill('OWNER DRAFT')
  const menuStyle=locator=>locator.evaluate(el=>{const c=getComputedStyle(el);return Object.fromEntries(['borderRadius','fontSize','lineHeight'].map(key=>[key,c[key]]))})
  const tokens=await trigger.evaluate(el=>{
   const probe=document.createElement('span');el.append(probe)
   const colors={};for(const name of ['--wm-hover','--wm-control-open','--wm-control-hover-border','--wm-focus']) {probe.style.color=`var(${name})`;colors[name]=getComputedStyle(probe).color}
   probe.remove();return colors
  })
  const assets=dialog.locator('.dataset-asset-select .fx-select-trigger:not(:disabled)')
  let optionStyle
  for(let i=0;i<2;i++) {await assets.click();const option=dialog.locator('.dataset-asset-select [role=option][aria-selected=false]:not([disabled])').first();optionStyle=await menuStyle(option);await option.click()}
  await dialog.getByRole('radio',{name:'$50K',exact:true}).click()
  await trigger.hover()
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).backgroundColor),tokens['--wm-hover'],'preset uses shared select hover')
  assert.equal(await trigger.evaluate(el=>el.matches(':focus-visible')),false,'pointer hover does not show keyboard focus')
  await trigger.click()
  await dialog.locator('.quick-session-header h2').hover()
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).backgroundColor),tokens['--wm-control-open'],'open preset uses shared select surface')
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).borderTopColor),tokens['--wm-control-hover-border'],'open preset uses shared select border')
  assert.equal(await menu.locator('small').count(),0,'no browser-only storage caption')
  assert.equal(await menu.locator('.session-preset-create').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px','empty menu has no stray separator')
  await menu.locator('.session-preset-create').hover()
  assert.equal(await menu.locator('.session-preset-create').evaluate(el=>getComputedStyle(el).backgroundColor),tokens['--wm-hover'],'create preset uses shared menu hover')
  assert.deepEqual(await menuStyle(menu.locator('.session-preset-create')),optionStyle,'create preset shares menu radius and typography')
  assert.ok(await menu.locator('.session-preset-create').evaluate(el=>parseFloat(getComputedStyle(el).minHeight)===parseFloat(getComputedStyle(el).getPropertyValue('--wm-control-height'))),'single-line menu action uses shared control height; asset catalog has its own taller rows')
  if(mode==='backtest' && !en) await dialog.screenshot({animations:'disabled',path:`${out}/empty-menu.png`})
  await page.keyboard.press('Escape');await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
  assert.equal(await trigger.evaluate(el=>el.matches(':focus-visible')),true)
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).borderTopColor),tokens['--wm-focus'],'preset uses shared keyboard focus')
  await page.keyboard.press('Enter');await menu.waitFor()
  assert.equal(await menu.locator('.session-preset-create').evaluate(el=>el.matches(':focus-visible')),true)
  assert.equal(await menu.locator('.session-preset-create').evaluate(el=>getComputedStyle(el).outlineColor),tokens['--wm-focus'],'menu keyboard focus uses the shared focus color')
  await menu.locator('.session-preset-create').click()
  assert.equal(await dialog.locator('.quick-session-sections').count(),0)
  const back=dialog.locator('.session-preset-back'),closeButton=dialog.locator('.quick-session-close')
  const quietStyle=locator=>locator.evaluate(el=>{const c=getComputedStyle(el);return Object.fromEntries(['backgroundColor','borderTopWidth','color','width','height'].map(key=>[key,c[key]]))})
  const quietBase=await quietStyle(closeButton)
  assert.deepEqual(await quietStyle(back),quietBase,'back uses the same quiet icon action as close')
  await back.hover()
  assert.equal((await quietStyle(back)).backgroundColor,'rgba(0, 0, 0, 0)')
  assert.equal((await quietStyle(back)).borderTopWidth,'0px')
  assert.notEqual((await quietStyle(back)).color,quietBase.color,'hover brightens only the icon')
  await closeButton.hover()
  assert.deepEqual(await quietStyle(back),quietBase,'back restores its quiet state after hover')
  await dialog.locator('.quick-session-header h2').hover()
  assert.equal(await dialog.locator('.quick-session-period-random').count(),0,'presets have no frozen backtest dates')
  await dialog.locator('.quick-session-submit').click()
  assert.ok(await dialog.locator('.wm-field-error').count(),'empty preset name blocks saving')
  await dialog.locator('input[maxlength="160"]').first().fill('TEST')
  await dialog.locator('[data-option=costs] [role=switch]').click()
  assert.ok(await dialog.locator('[data-option=costs] [role=switch]').evaluate(el=>{
   const c=getComputedStyle(el),r=el.getBoundingClientRect(),probe=document.createElement('span');probe.style.color='var(--project-primary)';el.append(probe);const primary=getComputedStyle(probe).color;probe.remove();return r.width===parseFloat(c.getPropertyValue('--ds-switch-width')) && r.height===parseFloat(c.getPropertyValue('--ds-switch-height')) && c.backgroundColor===primary
  }),'cost switch uses shared geometry and its selected color')
  const costs=dialog.locator('.session-cost-grid')
  await costs.first().locator('input').first().fill('0.0002')
  await costs.first().locator('input').nth(1).fill('5')
  await costs.last().locator('input').first().fill('0.2')
  if(mode==='backtest' && !en) {
   await dialog.locator('input[maxlength="160"]').first().scrollIntoViewIfNeeded()
   await dialog.screenshot({animations:'disabled',path:`${out}/new-preset.png`})
   await dialog.locator('[data-option=costs]').screenshot({animations:'disabled',path:`${out}/preset-costs.png`})
  }
  await dialog.locator('.quick-session-submit').click()
  await dialog.locator('.quick-session-sections').waitFor()
  assert.ok((await trigger.textContent()).includes('TEST'))
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(255, 173, 124)','selected preset uses orange action token')
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(255, 173, 124)','selected balance uses orange action token')
  assert.equal(await dialog.locator('input[maxlength="160"]').first().inputValue(),'OWNER DRAFT')
  await dialog.getByRole('radio',{name:'$10K',exact:true}).click()
  assert.ok(!(await trigger.textContent()).includes('TEST'),'manual config change detaches selected preset')
  await trigger.click();await menu.locator('.session-preset-apply').click()
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true')
  assert.equal(await dialog.locator('input[maxlength="160"]').first().inputValue(),'OWNER DRAFT','applying a preset preserves the session name')
  await trigger.click();await menu.getByRole('button',{name:en?'Edit preset TEST':'Sửa preset TEST',exact:true}).click()
  await dialog.locator('input[maxlength="160"]').first().fill('CANCELLED')
  await dialog.getByRole('radio',{name:'$10K',exact:true}).click()
  await dialog.locator('.session-preset-back').click()
  assert.ok((await trigger.textContent()).includes('TEST'),'cancel restores preset selection and draft')
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true')
  await trigger.click();await menu.getByRole('button',{name:en?'Edit preset TEST':'Sửa preset TEST',exact:true}).click()
  await dialog.locator('input[maxlength="160"]').first().fill('RENAMED')
  await dialog.locator('.quick-session-submit').click()
  await trigger.waitFor();assert.ok((await trigger.textContent()).includes('RENAMED'))
  await page.evaluate(language=>{localStorage.clear();localStorage.setItem('tw-language',language);localStorage.setItem('tw-theme','dark')},language)
  await page.reload();await trigger.waitFor()
  await trigger.click();await menu.locator('.session-preset-apply').click()
  assert.equal(await dialog.getByRole('radio',{name:'$50K',exact:true}).getAttribute('aria-checked'),'true','saved configuration survives reload')
  await dialog.locator('.quick-session-sections button').nth(1).click()
  assert.equal(await costs.first().locator('input').first().inputValue(),'0.0002')
  assert.equal(await costs.last().locator('input').first().inputValue(),'0.2')
  await trigger.click()
  if(mode==='backtest' && !en) await dialog.screenshot({animations:'disabled',path:`${out}/selected-menu.png`})
  await menu.getByRole('button',{name:en?'Delete preset RENAMED':'Xóa preset RENAMED',exact:true}).click()
  const confirmation=page.locator('.session-preset-confirm')
  await confirmation.waitFor()
  if(mode==='backtest' && !en) await page.screenshot({animations:'disabled',path:`${out}/delete-confirm.png`})
  failDelete=true
  await confirmation.getByRole('button',{name:en?'Delete preset':'Xóa preset',exact:true}).click()
  await confirmation.getByRole('alert').waitFor()
  assert.equal(savedPresets.size,1,'failed server deletion cannot remove a preset')
  failDelete=false
  await confirmation.getByRole('button',{name:en?"Don't delete":'Không xóa',exact:true}).click()
  assert.equal(await menu.locator('.session-preset-row').count(),1)
  await menu.getByRole('button',{name:en?'Delete preset RENAMED':'Xóa preset RENAMED',exact:true}).click()
  await confirmation.getByRole('button',{name:en?'Delete preset':'Xóa preset',exact:true}).click()
  await confirmation.waitFor({state:'detached'})
  assert.equal(await menu.locator('.session-preset-row').count(),0)
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),1,'menu Escape does not close session setup')
  await dialog.locator('.quick-session-sections button').nth(0).click()
  assert.equal(await dialog.locator('.session-smooth-candles [role=switch]').count(),mode==='backtest'?1:0)
  if(mode==='backtest') {
   assert.equal(await dialog.locator('.session-smooth-candles [role=switch]').isDisabled(),true)
   await dialog.locator('input[maxlength="160"]').first().fill('FAILURE TEST')
   await dialog.locator('.quick-session-period-random').click()
   failCreate=true;await dialog.locator('.quick-session-submit').click()
   await dialog.locator('.quick-session-error').waitFor()
   assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),true)
   assert.equal(await trigger.isDisabled(),true,'presets cannot bypass uncertain-create guard')
  }
  if(mode==='prop') {
   await dialog.getByRole('tab',{name:'Backtesting',exact:true}).click()
   await trigger.click();assert.equal(await menu.locator('.session-preset-row').count(),0,'mode-specific list')
   await page.keyboard.press('Escape')
  }
  if(!en && mode==='prop') {
   await page.setViewportSize({width:360,height:790})
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
   await trigger.click();await dialog.screenshot({animations:'disabled',path:`${out}/mobile-menu.png`})
  }
  report.cases.push(`${mode}/${language}: server CRUD fixture, apply/edit/cancel/reload after clearing localStorage, delete failure, independent asset costs, orange states and mode scoping`)
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.result='PASS'
} catch(error) {report.result='FAIL';report.failure=error.stack;throw error}
finally {await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors,failure:report.failure}))}
