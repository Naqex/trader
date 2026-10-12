import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
const copy=JSON.parse(await readFile(new URL('../../../web/src/testing-copy.json',import.meta.url))),t=k=>copy[k]?.vi||k
const out=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:')
const browser=await chromium.launch({headless:true}),report={cases:[],errors:[],blocked:[],scope:'Local demo only; external and every non-GET request aborted before dispatch'}
try{
 for(const width of[1440,390])for(const theme of['dark','light']){
  const context=await browser.newContext({viewport:{width,height:987},hasTouch:width===390,reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'||u.origin!=='http://127.0.0.1:5180'){report.blocked.push(r.method()+' '+r.url());return route.abort()}if(u.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],available:false}});return route.continue()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.setDefaultTimeout(10000)
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=trade&demo=1&area=testing&section=trades&select=1&demo_session=demo-gold')
  await page.getByTestId('fx-trade-ledger').waitFor();assert.equal(await page.locator('tbody tr').count(),10)
  assert.equal(await page.locator('.fxa-filter-actions .wm-resource-status-slot').count(),0)
  assert.ok((await page.locator('tbody').innerText()).includes('Gold Swing'))
  assert.ok(!(await page.locator('tbody').innerText()).includes('London Breakout'))
  await page.getByRole('button',{name:t('Basic'),exact:true}).click();const drawer=page.locator('.fxl-filter-drawer');await drawer.waitFor()
  const summary=name=>drawer.locator('summary').filter({hasText:new RegExp('^'+t(name)+'$')})
  assert.equal(await summary('Days').count(),0)
  await summary('Notes').click();const notes=drawer.getByRole('group',{name:t('Notes'),exact:true})
  assert.equal(await notes.getByRole('checkbox').count(),2);assert.equal(await drawer.getByRole('searchbox',{name:t('Notes filter'),exact:true}).count(),0)
  await summary('Assets').click();assert.deepEqual(await drawer.getByRole('group',{name:t('Assets'),exact:true}).locator('label').allTextContents(),['XAUUSD'])
  await summary('Type').click();const types=drawer.getByRole('group',{name:t('Type'),exact:true})
  assert.equal(await types.getByRole('checkbox').count(),4);assert.equal(await types.getByRole('checkbox',{name:t('Closed'),exact:true}).isDisabled(),false)
  for(const name of['Lệnh chờ','Đã hủy','Đang mở'])assert.equal(await types.getByRole('checkbox',{name:t(name),exact:true}).isDisabled(),true)
  await summary('Month').click();const month=drawer.getByRole('button',{name:t('Month'),exact:true});await month.click()
  const menu=drawer.locator('.fx-select-menu');await menu.getByRole('option',{name:t('Tháng {month}').replace('{month}','7'),exact:true}).click();await menu.getByRole('option',{name:t('Tháng {month}').replace('{month}','8'),exact:true}).click()
  assert.equal(await menu.getByRole('option',{selected:true}).count(),2);await page.keyboard.press('Escape')
  assert.equal(await drawer.isVisible(),true)
  await summary('Hour of the day').click();await drawer.getByRole('button',{name:t('Hour of the day'),exact:true}).click();const hours=drawer.locator('.fx-select-menu');await hours.getByRole('option',{name:'07:00',exact:true}).click();await hours.getByRole('option',{name:'08:00',exact:true}).click();assert.equal(await hours.getByRole('option',{selected:true}).count(),2);await page.keyboard.press('Escape')
  await summary('Date range').click();const from=drawer.getByRole('textbox',{name:t('Analytics from date'),exact:true});await from.fill('06/07/2026');await drawer.getByRole('button',{name:new RegExp('^'+t('Xóa ngày')+' · '+t('Analytics from date')+'$')}).click();assert.equal(await from.inputValue(),'')
  await page.screenshot({path:out+`/drawer-${width}-${theme}.png`});await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'})
  await page.getByRole('button',{name:t('Cột hiển thị'),exact:true}).click();assert.equal(await page.getByRole('option',{name:t('Tags'),exact:true}).count(),0);await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=replay&demo=1&area=testing&section=sessions&select=1&demo_session=demo-gold')
  const action=page.locator('.fxs-recent .fxs-section-heading').getByRole('link',{name:t('Trades'),exact:true});await action.waitFor();const href=new URL(await action.getAttribute('href'),'http://127.0.0.1:5180');assert.equal(href.searchParams.get('view'),'trade');assert.equal(href.searchParams.get('demo_session'),'demo-gold');await action.click();await page.getByTestId('fx-trade-ledger').waitFor();assert.ok(!(await page.locator('tbody').innerText()).includes('London Breakout'))
  report.cases.push({width,theme,case:'Scoped demo route, notes checkboxes, real scoped assets, lifecycle3disabled, month/hour2select, date clear, no weekday/status/tags option, keyboard/menu/no overflow'})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);report.result='PASS'
}catch(e){report.result='FAIL';report.failure=String(e.stack);console.error(e)}finally{await browser.close();await writeFile(out+'/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.result==='FAIL')process.exitCode=1}
