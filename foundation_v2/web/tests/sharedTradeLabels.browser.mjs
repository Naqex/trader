// Stateful synthetic catalog: writes are intercepted; no broker or personal profile.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { brokerSnapshot, completedDealFills, fixtureConnection } from './liveJournal.fixture.mjs'
const [origin,out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1'); assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser = await chromium.launch(), report = {scope:'Stateful synthetic labels UI; no broker',checks:[],errors:[],blockedWrites:[]}
let page
try {
  for (const [width,theme] of [[1920,'dark'],[390,'light']]) {
    const context = await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await context.addInitScript(theme => {localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
    let catalog={schema_version:'trade-labels-v1',items:[],groups:[],assignments:[]}, conflict=false
    const broker=brokerSnapshot(); broker.deals=completedDealFills(broker.deals.slice(0,3))
    const second='00000000-0000-4000-8000-000000000003'
    broker.connections.push({...broker.connections[0],id:second,name:'SECOND FIXTURE'})
    await context.routeWebSocket('**/*',socket=>socket.close())
    await context.route('**/*', async route => {
      const request=route.request(),url=new URL(request.url()),json=(body,status=200)=>route.fulfill({json:body,status})
      if(url.origin!==origin)return route.abort()
      if(url.pathname==='/api/v2/trade-labels') {
        if(request.method()==='GET')return json(catalog)
        const body=request.postDataJSON()
        if(conflict) {conflict=false;return json({detail:'revision_conflict'},409)}
        const target=body.action.includes('group')?catalog.groups:catalog.items
        if(body.action.startsWith('create'))target.push({id:`id-${target.length}`,revision:1,name:body.name,color:body.color,group_id:body.group_id,archived:false})
        if(body.action==='update'||body.action==='update_group')Object.assign(target.find(item=>item.id===body.id),{...body,revision:body.expected_revision+1})
        if(body.action==='archive'||body.action==='archive_group') {target.find(item=>item.id===body.id).archived=true;if(body.action==='archive_group')catalog.items.filter(item=>item.group_id===body.id).forEach(item=>item.archived=true)}
        let assignment
        if(body.action==='assign') {assignment={session_id:body.session_id,trade_id:body.trade_id,revision:body.expected_revision+1,tags:body.tags};catalog.assignments=[...catalog.assignments.filter(item=>item.trade_id!==body.trade_id||item.session_id!==body.session_id),assignment]}
        return json({...catalog,...assignment?{assignment}:{}})
      }
      if(!['GET','HEAD','OPTIONS'].includes(request.method())) {report.blockedWrites.push(url.pathname);return route.abort()}
      if(!url.pathname.startsWith('/api/'))return route.continue()
      if(url.pathname==='/api/v2/live/status')return json(url.searchParams.get('connection_id')===second?{...broker,connection_id:second}:broker)
      if(url.pathname==='/api/v2/live/connections')return json({items:broker.connections})
      return json({items:[],available:false})
    })
    page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.message))
    const settings=`${origin}/?workspace=fixture&view=settings&settings_tab=labels&lang=vi`
    await page.goto(settings)
    const manager=page.getByRole('region',{name:'Quản lý nhãn'}), dialog=()=>page.getByRole('dialog')
    await manager.getByText('Chưa có nhãn',{exact:true}).waitFor()
    await manager.getByRole('button',{name:'Thêm nhóm',exact:true}).click()
    await dialog().getByLabel('Tên nhóm',{exact:true}).fill('Setup')
    await dialog().getByRole('button',{name:'Lưu thay đổi'}).click();await dialog().waitFor({state:'hidden'})
    await manager.getByRole('button',{name:'Thêm nhãn vào Setup'}).click()
    await dialog().getByLabel('Tên nhãn',{exact:true}).fill('Breakout')
    await dialog().locator('.wm-label-colors button').first().click()
    await dialog().getByRole('button',{name:'Lưu thay đổi'}).click();await dialog().waitFor({state:'hidden'})
    assert.equal(catalog.items[0].group_id,catalog.groups[0].id)
    await page.reload();await manager.locator('.wm-trade-label').getByText('Breakout',{exact:true}).waitFor()
    await manager.getByRole('searchbox').fill('missing');await manager.getByText('Không tìm thấy nhóm hoặc nhãn.').waitFor();await manager.getByRole('searchbox').fill('')
    await manager.getByRole('button',{name:'Sửa nhãn Breakout'}).click()
    await page.keyboard.press('Escape');await dialog().waitFor({state:'hidden'})
    assert.equal(await manager.getByRole('button',{name:'Sửa nhãn Breakout'}).evaluate(el=>el===document.activeElement),true)
    await page.screenshot({path:`${out}/settings-${width}-${theme}.png`,fullPage:true})
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=trades&lang=vi&mt5_connection=${fixtureConnection}`)
    const grid=page.getByTestId('live-trade-grid');await grid.waitFor()
    const labels=grid.getByRole('button',{name:/Nhãn giao dịch position:/})
    await labels.first().click();await dialog().getByRole('checkbox',{name:'Breakout',exact:true}).click()
    await page.keyboard.press('Escape');await labels.first().getByText('Breakout',{exact:true}).waitFor()
    await page.reload();await labels.first().getByText('Breakout',{exact:true}).waitFor()
    const headers=await grid.locator('thead th').allTextContents(),gross=headers.findIndex(value=>value.includes('PnL trước phí')),net=headers.findIndex(value=>value.includes('Lợi nhuận'))
    const row=grid.locator('tbody tr').first()
    assert(gross>=0);assert(net>=0)
    assert.equal(await row.locator('td').nth(gross).locator('.wm-return-badge').count(),1)
    assert.equal(await row.locator('td').nth(net).locator('.wm-return-badge').count(),1)
    const win=page.locator('.live-win-rate-row');await win.scrollIntoViewIfNeeded()
    assert.equal(await win.locator('.live-win-rate-copy .live-win-rate-counts').count(),1)
    const geometry=await win.evaluate(el=>{const copy=el.querySelector('.live-win-rate-copy').getBoundingClientRect(),chart=el.querySelector('.fxa-ring').getBoundingClientRect();return {copyRight:copy.right,chartLeft:chart.left}})
    assert(geometry.copyRight<=geometry.chartLeft)
    await page.screenshot({path:`${out}/trades-${width}-${theme}.png`,fullPage:true})
    await win.screenshot({path:`${out}/win-rate-${width}-${theme}.png`})
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=calendar&live_accounts=all&lang=vi&mt5_connection=${fixtureConnection}`)
    await page.locator('.live-balance-summary > div').last().getByText('6',{exact:true}).waitFor()
    await page.locator('.live-filters').getByRole('button',{name:'Nhãn',exact:true}).click()
    await dialog().getByRole('button',{name:'Nhãn',exact:true}).click()
    await page.getByRole('option',{name:'Breakout',exact:true}).click();await page.keyboard.press('Escape')
    await dialog().getByRole('button',{name:'Áp dụng bộ lọc',exact:true}).click()
    await page.locator('.live-balance-summary > div').last().getByText('1',{exact:true}).waitFor()
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=trades&lang=vi&mt5_connection=${fixtureConnection}`)
    await labels.first().click();await dialog().getByRole('button',{name:'Sửa nhãn Breakout'}).click()
    await page.locator('.wm-label-edit-popup').getByLabel('Tên nhãn',{exact:true}).fill('London breakout')
    await page.locator('.wm-label-edit-popup').getByLabel('Tên nhãn',{exact:true}).press('Enter');await page.keyboard.press('Escape')
    // Fixture rename projection mirrors the backend; backend tests verify historical reconciliation.
    catalog.assignments.forEach(item=>item.tags=item.tags.map(tag=>tag==='Breakout'?'London breakout':tag))
    await page.goto(settings);await manager.getByRole('button',{name:'Sửa nhãn London breakout'}).click()
    conflict=true;await dialog().getByRole('button',{name:'Lưu thay đổi'}).click();await dialog().waitFor({state:'hidden'})
    await manager.getByRole('alert').waitFor()
    await manager.getByRole('button',{name:'Sửa Setup'}).click();await dialog().getByRole('button',{name:'Lưu trữ',exact:true}).click()
    await dialog().locator('.trade-label-settings-archive').waitFor();await dialog().getByRole('button',{name:'Lưu trữ',exact:true}).click();await dialog().waitFor({state:'hidden'})
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=trades&lang=vi&mt5_connection=${fixtureConnection}`)
    await labels.first().getByText('London breakout',{exact:true}).waitFor()
    await labels.first().click();assert.equal(await dialog().getByRole('checkbox',{name:'London breakout',exact:true}).count(),0)
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    report.checks.push({width,theme,settingsCRUD:true,liveAssignmentReload:true,multiAccountTags:true,archiveHistory:true,conflictRecovery:true,badges:true,geometry})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedWrites,[]);report.status='PASS'
} catch(error) {report.status='FAIL';report.error=error.stack;report.buttons=await page?.locator('.trade-label-settings button').evaluateAll(nodes=>nodes.map(el=>({text:el.textContent,label:el.getAttribute('aria-label'),disabled:el.disabled})));process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{})}
finally {await browser.close();await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
