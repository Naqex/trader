// Synthetic stateful API only. No owner ledger or broker mutations.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {journalRecords,brokerSnapshot} from './liveJournal.fixture.mjs'
const [origin,out]=process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
await mkdir(out,{recursive:true})
const browser=await chromium.launch(), report={cases:[],errors:[],unexpectedWrites:[],scope:'Synthetic API; folder wizard, grouping, reload, errors; no owner data writes'}
try {
  for (const [width,theme,language] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]) {
    const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await ctx.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
    let records=[],folders=[], failFolders=false, invalidSave=false
    const payload=()=>({version:'live-note-folders-v1',items:folders})
    await ctx.routeWebSocket('**/*',socket=>socket.close())
    await ctx.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method()
      if(url.origin!==origin)return route.abort()
      if(!url.pathname.startsWith('/api/'))return route.continue()
      if(url.pathname==='/api/v2/live/note-folders') {
        if(method==='GET')return route.fulfill(failFolders?{status:503,json:{detail:'fixture_unavailable'}}:{json:payload()})
        if(method==='POST') {
          const body=req.postDataJSON()
          if(invalidSave)return route.fulfill({json:{unexpected:true}})
          assert(req.headers()['idempotency-key'])
          const folder={id:`folder-${folders.length}`,name:body.name,note_ids:body.note_ids}
          folders.push(folder)
          return route.fulfill({status:201,json:{...payload(),created_id:folder.id}})
        }
      }
      if(method==='POST' && url.pathname==='/api/v2/live/records') {
        const body=req.postDataJSON()
        const note={record_id:`saved-${records.length}`,revision:1,kind:body.kind,payload:body.payload,updated_at_utc:'2026-10-29T08:00:00Z'}
        records.push(note)
        if(body.folder_id)folders.find(folder=>folder.id===body.folder_id).note_ids.push(note.record_id)
        return route.fulfill({status:201,json:note})
      }
      if(!['GET','HEAD','OPTIONS'].includes(method)){report.unexpectedWrites.push(url.pathname);return route.abort()}
      if(url.pathname==='/api/v2/live/records')return route.fulfill({json:{version:'live-records-v1',items:records}})
      if(url.pathname==='/api/v2/live/status')return route.fulfill({json:brokerSnapshot()})
      if(url.pathname==='/api/v2/live/connections')return route.fulfill({json:{items:[]}})
      return route.fulfill({json:{items:[],available:false}})
    })
    const page=await ctx.newPage();page.setDefaultTimeout(12000)
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=fixture&view=live&area=live&section=notes&lang=${language}`)
    const notes=page.locator('.live-notes'), plus=notes.locator('.live-notes-groups .fxa-icon-button'), dialog=page.locator('.live-folder-dialog')
    await plus.waitFor();await page.waitForFunction(()=>!document.querySelector('.live-notes-groups .fxa-icon-button')?.disabled)
    await plus.click()
    assert(await dialog.getByRole('button',{name:language==='vi'?'Tiếp':'Next',exact:true}).isEnabled())
    await page.screenshot({path:`${out}/select-empty-${width}-${theme}.png`})
    await dialog.locator('button[type=submit]').click()
    assert(await dialog.locator('button[type=submit]').isDisabled())
    await dialog.locator('.live-folder-name input').fill('   ')
    assert(await dialog.locator('button[type=submit]').isDisabled())
    await dialog.locator('.live-folder-name input').fill('Trading diary')
    await page.screenshot({path:`${out}/name-${width}-${theme}.png`})
    const bounds=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})
    assert(bounds.left>=0 && bounds.right<=bounds.w && bounds.top>=0 && bounds.bottom<=bounds.h)
    assert(Math.abs((bounds.left+bounds.right)/2-bounds.w/2)<=1)
    await dialog.locator('button[type=submit]').click();await dialog.waitFor({state:'detached'})
    await notes.locator('.live-note-folder-summary').waitFor()
    assert.match(await notes.locator('.live-note-folder-summary').innerText(),/Trading diary\s+0/)
    assert.equal(await notes.locator('.wm-pagination').count(),0)
    await page.screenshot({path:`${out}/created-${width}-${theme}.png`})
    await page.reload();await notes.getByRole('button',{name:'Trading diary',exact:true}).click()
    assert.match(await notes.locator('.live-note-folder-summary').innerText(),/0/)
    if(width===1920){
      await notes.locator('.live-note-create').click()
      const record=page.locator('.live-record-dialog')
      await record.getByLabel('Tiêu đề',{exact:true}).fill('London review')
      await record.locator('textarea').fill('Synthetic reflection')
      await record.locator('footer .is-primary').click()
      await record.waitFor({state:'detached'})
      await notes.locator('.live-note-row').waitFor()
      assert.match(await notes.locator('.live-note-folder-summary').innerText(),/1/)
      assert.equal(folders[0].note_ids.length,1)
      records=journalRecords().filter(row=>row.kind==='note').concat(records)
      await page.reload();await notes.getByRole('button',{name:'Trading diary',exact:true}).click()
      assert.equal(await notes.locator('.live-note-row').count(),1)
      await plus.click();await dialog.locator('button[type=submit]').click()
      await dialog.locator('.live-folder-name input').fill('trading diary')
      assert(await dialog.locator('button[type=submit]').isDisabled())
      await page.keyboard.press('Escape')
      await plus.click()
      await dialog.getByRole('searchbox').fill('Synthetic note 30')
      assert.equal(await dialog.locator('.live-folder-note').count(),1)
      await dialog.locator('input[type=checkbox]').check()
      await dialog.locator('button[type=submit]').click()
      await dialog.locator('.live-folder-name input').fill('Review')
      await dialog.locator('button[type=submit]').click();await dialog.waitFor({state:'detached'})
      assert.equal(await notes.locator('.live-note-row').count(),1)
      assert.match(await notes.locator('.live-note-row').innerText(),/Synthetic note 30/)
      await plus.click();failFolders=true;await page.keyboard.press('Escape')
      await notes.locator('.live-status-error').waitFor()
      assert.equal(await notes.locator('.live-note-row').count(),1,'Folder read error never renders All')
      failFolders=false;await notes.locator('.live-status-error button').click()
      await notes.getByRole('button',{name:'Tất cả',exact:true}).click()
      assert.equal(await notes.locator('.live-note-row').count(),32)
      const group=notes.locator('.live-note-group')
      await group.locator('button').first().hover()
      assert.equal(await group.locator('button').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
      for(const label of ['Loại ghi chú','Ngày','Tuần','Tháng','Năm','Không']){
        await group.locator('button').first().click()
        assert.equal(await group.locator('button').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
        await group.getByRole('option',{name:label,exact:true}).click()
        assert.equal(await notes.locator('.live-note-row').count(),32)
        assert.equal(await notes.locator('.live-note-section > h3').count(),label==='Không'?0:label==='Loại ghi chú'||label==='Tháng'||label==='Năm'?1:2)
      }
      await plus.click();await dialog.locator('button[type=submit]').click()
      await dialog.locator('.live-folder-name input').fill('Uncertain')
      invalidSave=true;await dialog.locator('button[type=submit]').click()
      await dialog.getByRole('alert').waitFor()
      assert(await dialog.locator('.live-folder-name input').isDisabled())
      assert(await dialog.locator('button[type=submit]').isDisabled())
      await page.keyboard.press('Escape');invalidSave=false
    }
    report.cases.push({width,theme,language,bounds,folderCount:folders.length})
    await ctx.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedWrites,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1}
finally{await browser.close();await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
