import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'

const [origin,out,api]=process.argv.slice(2)
for(const value of [origin,api]){assert.equal(new URL(value).hostname,'127.0.0.1');assert(!['5180','8010'].includes(new URL(value).port))}
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Synthetic trade, real isolated Rust Router/PostgreSQL; no owner writes',cases:[],errors:[]}
let page
try{
 for(const [width,theme,language] of [[1920,'dark','vi'],[1440,'light','en'],[390,'dark','vi']]){
  const context=await browser.newContext({viewport:{width,height:940},deviceScaleFactor:width===1440?1.25:1})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  let failMedia=false
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==origin)return route.abort()
   if(url.pathname==='/api/v2/events')return route.fulfill({status:204,body:''})
   if(url.pathname.startsWith('/api/')){
    if(failMedia && url.pathname==='/api/v2/trade-media' && request.method()==='GET')return route.fulfill({status:503,json:{detail:'fixture_failure'}})
    const response=await route.fetch({url:api+url.pathname+url.search})
    return route.fulfill({response})
   }
   return route.continue()
  })
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.stack))
  const vi=language==='vi',label=(a,b)=>vi?a:b
  const root=`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all&lang=${language}`
  await page.goto(root)
  const row=page.getByTestId('analytics-ledger').locator('tbody tr').first()
  await row.locator('[data-column=symbol]').click()
  const drawer=page.locator('dialog.fxa-trade-inspector'),editor=drawer.locator('.bn-editor')
  await editor.waitFor()
  if(width===1920){
   const separator=drawer.getByRole('separator',{name:'Độ rộng chi tiết giao dịch'}),before=await drawer.locator('.fx-trade-detail-sidebar').boundingBox()
   const b=await separator.boundingBox()
   await page.mouse.move(b.x+b.width/2,b.y+150);await page.mouse.down();await page.mouse.move(b.x+70,b.y+150,{steps:6});await page.mouse.up()
   assert((await drawer.locator('.fx-trade-detail-sidebar').boundingBox()).width>before.width+50)
   await separator.press('ArrowLeft');assert.equal(await separator.getAttribute('aria-valuenow')!==null,true)
   report.cases.push('pointer and keyboard resize')
  }
  await drawer.getByRole('button',{name:label('Mẫu ghi chú','Templates'),exact:true}).click()
  const dialog=page.locator('dialog.wm-note-templates')
  await dialog.getByRole('button',{name:label('Mẫu mới','New template'),exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('.wm-note-new-template').disabled)
  const geometry=await dialog.evaluate(node=>{
   const search=node.querySelector('.wm-note-template-search'),meta=node.querySelector('.wm-note-template-meta')
   return {search:search.getBoundingClientRect().bottom,meta:meta.getBoundingClientRect().bottom,borders:[search,meta].map(n=>getComputedStyle(n).borderBottomWidth),overflow:node.scrollWidth>node.clientWidth+1}
  })
  assert(Math.abs(geometry.search-geometry.meta)<.1,JSON.stringify(geometry));assert.deepEqual(geometry.borders,['1px','1px']);assert(!geometry.overflow)
  assert(!(await dialog.locator('.wm-note-template-preview').innerText()).includes(vi?'What is your goal':'Mục tiêu'))
  await page.screenshot({path:`${out}/templates-${width}-${theme}.png`})
  await dialog.getByRole('button',{name:label('Nhân bản mẫu','Duplicate template'),exact:true}).click()
  const title=dialog.getByRole('textbox',{name:label('Tên mẫu','Template name'),exact:true})
  await title.waitFor();await title.fill(`QA ${width}`)
  const content=dialog.getByRole('textbox',{name:label('Nội dung mẫu','Template content'),exact:true})
  await content.fill(`Persisted template ${width}`)
  await dialog.locator('[data-state=saved]').waitFor()
  await dialog.getByRole('button',{name:label('Yêu thích mẫu','Favorite template'),exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.wm-note-template-actions button').getAttribute('aria-pressed')==='true')
  await dialog.getByRole('button',{name:label('Đặt mặc định','Set as default'),exact:true}).click()
  const defaults=dialog.getByRole('menuitemcheckbox')
  assert.equal(await defaults.count(),3)
  for(let i=0;i<3;i++){
   await defaults.nth(i).click();await page.waitForFunction(index=>document.querySelectorAll('[role=menuitemcheckbox]')[index]?.getAttribute('aria-checked')==='true',i)
   await page.waitForFunction(()=>!document.querySelector('.wm-note-new-template').disabled)
  }
  await page.screenshot({path:`${out}/defaults-${width}-${theme}.png`})
  await page.keyboard.press('Escape')
  await dialog.getByRole('button',{name:label('Áp dụng vào','Apply to'),exact:true}).click()
  await dialog.getByRole('menuitem',{name:label('Chèn vào ghi chú','Insert into this note'),exact:true}).click()
  await dialog.waitFor({state:'detached'})
  assert((await editor.innerText()).includes(`Persisted template ${width}`))
  await drawer.locator('[data-state=saved]').waitFor()
  await drawer.getByRole('button',{name:label('Mẫu ghi chú','Templates'),exact:true}).click()
  await dialog.locator('.wm-note-template-list > button').filter({hasText:`QA ${width}`}).first().click()
  await title.waitFor();assert.equal(await title.inputValue(),`QA ${width}`)
  await dialog.getByRole('button',{name:label('Xóa mẫu','Delete template'),exact:true}).waitFor()
  page.once('dialog',dialog=>dialog.accept())
  await dialog.getByRole('button',{name:label('Xóa mẫu','Delete template'),exact:true}).click()
  await title.waitFor({state:'detached'})
  if(width===1920){
   await dialog.getByRole('button',{name:'Mẫu mới',exact:true}).click()
   await title.waitFor();await title.fill('Unsaved new template');await content.fill('Latest content before duplicate')
   await dialog.getByRole('button',{name:'Nhân bản mẫu',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('.wm-note-template-title')?.value==='Unsaved new template (bản sao)')
   assert((await content.innerText()).includes('Latest content before duplicate'))
   page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'Xóa mẫu',exact:true}).click();await title.waitFor({state:'detached'})
   await dialog.locator('.wm-note-template-list > button').filter({hasText:'Unsaved new template'}).first().click()
   await title.waitFor();page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'Xóa mẫu',exact:true}).click();await title.waitFor({state:'detached'})
   report.cases.push('new template and duplicate while autosave dirty retains latest content')
  }
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
  await drawer.getByRole('tab',{name:label('Nhóm nhãn','Tag groups'),exact:true}).click()
  const groups=drawer.locator('.wm-trade-tag-groups')
  await groups.getByRole('button',{name:label('Nhóm nhãn','Tag groups'),exact:true}).click()
  const pop=page.locator('.wm-trade-group-create')
  await pop.getByRole('textbox').fill(`Setup ${width}`);await pop.getByRole('button',{name:label('Thêm nhóm','Add group'),exact:true}).click();await pop.waitFor({state:'detached'})
  await groups.getByRole('button',{name:label(`Thêm nhãn vào Setup ${width}`,`Add tag to Setup ${width}`)}).click()
  const labels=page.locator('.wm-label-popup');await labels.getByRole('searchbox').fill(`Breakout ${width}`)
  await labels.getByRole('button').filter({hasText:label('Tạo nhãn','Create label')}).click()
  await labels.getByRole('checkbox',{checked:true}).filter({hasText:`Breakout ${width}`}).waitFor()
  await page.keyboard.press('Escape')
  assert((await groups.innerText()).includes(`Breakout ${width}`))
  await drawer.getByRole('tab',{name:label('Tệp đính kèm','Media'),exact:true}).click()
  const media=drawer.locator('.wm-trade-media'),file=media.locator('input[type=file]')
  await media.getByRole('button',{name:label('Tải ảnh lên','Upload'),exact:true}).waitFor()
  await file.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')})
  await media.getByRole('alert').waitFor();assert((await media.innerText()).includes('5 MB'))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  await file.setInputFiles({name:`QA-${width}.png`,mimeType:'image/png',buffer:png})
  await media.locator('img').waitFor()
  assert(await media.locator('img').evaluate(img=>img.complete && img.naturalWidth===1))
  await media.getByRole('button',{name:label(`Xem ảnh QA-${width}.png`,`View image QA-${width}.png`)}).click()
  await page.locator('.wm-trade-media-preview img').waitFor();await page.keyboard.press('Escape')
  await page.screenshot({path:`${out}/media-${width}-${theme}.png`})
  page.once('dialog',dialog=>dialog.accept());await media.getByRole('button',{name:label(`Xóa ảnh QA-${width}.png`,`Delete image QA-${width}.png`)}).click()
  await media.locator('img').waitFor({state:'detached'})
  failMedia=true
  await drawer.getByRole('tab',{name:label('Chi tiết','Details'),exact:true}).click();await drawer.getByRole('tab',{name:label('Tệp đính kèm','Media'),exact:true}).click()
  await media.getByRole('alert').waitFor();failMedia=false
  await media.getByRole('button',{name:label('Đọc lại dữ liệu','Reload data'),exact:true}).click()
  await media.getByRole('button',{name:label('Tải ảnh lên','Upload'),exact:true}).waitFor()
  report.cases.push({width,theme,language,alignedSeam:true,templateCRUD:true,favorite:true,independentDefaults:true,apply:true,tagGroupCreateAndAssign:true,mediaBytes:true,invalidImage:true,mediaErrorRecovery:true})
  await context.unrouteAll({behavior:'wait'});await context.close()
 }
 assert.deepEqual(report.errors,[]);report.status='PASS'
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{})}
finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'wait'});await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
