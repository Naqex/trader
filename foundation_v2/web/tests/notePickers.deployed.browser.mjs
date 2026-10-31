import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
const [origin,out]=process.argv.slice(2)
assert.equal(origin,'http://127.0.0.1:5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Deployed local UI/API; read-only, all HTTP writes blocked',cases:[],errors:[],writes:[]}
try{
  for(const [width,theme] of [[1920,'dark'],[1440,'light'],[390,'dark']]){
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
    await context.routeWebSocket('**/*',socket=>socket.close())
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url())
      if(url.origin!==origin)return route.abort()
      if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push({method:request.method(),path:url.pathname});return route.abort()}
      return route.continue()
    })
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.stack))
    await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=notes&lang=vi`)
    await page.locator('.live-note-create').click()
    const drawer=page.locator('.is-note-editor');await drawer.locator('.bn-editor').waitFor()
    await drawer.getByRole('button',{name:'Loại ghi chú',exact:true}).click()
    const menu=page.locator('.wm-note-type-menu');await menu.getByRole('option').first().waitFor()
    assert.equal(await menu.getByRole('alert').count(),0)
    assert.equal(await menu.getByRole('option').count(),4)
    assert(await menu.getByRole('option').first().isEnabled())
    await menu.getByRole('button',{name:'Sửa loại ghi chú Chung',exact:true}).click()
    const edit=page.locator('.wm-label-edit-popup');await edit.waitFor()
    assert.equal(await edit.getByRole('button',{name:'Xóa loại ghi chú',exact:true}).count(),0)
    await page.keyboard.press('Escape');await page.keyboard.press('Escape')
    await drawer.getByRole('button',{name:'Chọn khoảng ngày',exact:true}).click()
    const calendar=page.locator('.project-date-popover:popover-open');await calendar.waitFor()
    const box=await calendar.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=941)
    await page.screenshot({path:`${out}/notes-calendar-${width}-${theme}.png`})
    await page.keyboard.press('Escape');assert(await drawer.isVisible())
    await drawer.getByRole('button',{name:'Đóng',exact:true}).click();await drawer.waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    report.cases.push({width,theme,name:'real catalog, protected default menu, range overlay, no fresh-note autosave',box})
    for(const route of ['view=live&area=live&section=trades','view=trade&area=testing&section=trades&select=1&sessions=all']){
      await page.goto(`${origin}/?workspace=tenant-a&lang=vi&${route}`)
      await page.locator('.fxl-ledger-table,.live-trades-section,.fxa-trades').first().waitFor()
      assert.equal(await page.getByText('Không mở được trang này',{exact:true}).count(),0)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      report.cases.push({width,theme,route,name:'trade surface regression'})
    }
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;throw error}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()}
