import assert from 'node:assert/strict'
import { chromium, expect } from 'playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { journalRecords, fixtureAccount, fixtureStrategies, brokerSnapshot } from './liveJournal.fixture.mjs'

const [origin,out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname,'127.0.0.1')
assert.notEqual(new URL(origin).port,'5180')
await mkdir(out,{recursive:true})
const browser=await chromium.launch()
const report={cases:[],errors:[],writes:[],scope:'Isolated production UI with synthetic journal/MT5 fixtures; no broker requests'}
try {
  for (const [width,theme] of [[1920,'dark'],[1440,'light'],[390,'dark']]) {
    const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
    await context.routeWebSocket('**/*',socket=>socket.close())
    let records=journalRecords().filter(row=>row.kind==='account' || row.kind==='trade').slice(0,5)
    records[1].payload.tags=['planned','review, later']; records[2].payload.tags=['planned']
    records[3].payload.note=''; records[4].payload.note=''
    const broker=brokerSnapshot()
    await context.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url())
      if(url.origin!==origin)return route.abort()
      if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.writes.push(url.pathname);return route.abort()}
      if(!url.pathname.startsWith('/api/'))return route.continue()
      if(url.pathname==='/api/v2/live/status')return route.fulfill({json:broker})
      if(url.pathname==='/api/v2/live/connections')return route.fulfill({json:{items:broker.connections}})
      if(url.pathname==='/api/v2/live/records')return route.fulfill({json:{version:'live-records-v1',items:records}})
      if(url.pathname==='/api/v2/playbooks')return route.fulfill({json:{items:fixtureStrategies}})
      return route.fulfill({json:{items:[],available:false}})
    })
    const page=await context.newPage();page.setDefaultTimeout(7000)
    page.on('pageerror',error=>report.errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=trades&lang=en&live_account=${fixtureAccount}`)
    const toolbar=page.getByTestId('analytics-filters'), table=page.locator('.live-broker tbody')
    await expect(table.locator('tr')).toHaveCount(4)
    const drawer=page.locator('.fxl-filter-drawer')
    const open=async()=>{await toolbar.getByRole('button',{name:'Basic',exact:true}).click();await expect(drawer).toBeVisible()}
    const expand=async name=>{const group=drawer.locator('details').filter({has:page.locator('summary').filter({hasText:new RegExp(`^${name}$`)})});await group.locator('summary').click();return group}
    const apply=async()=>{await drawer.getByRole('button',{name:/^Apply filters$/i}).click();await expect(drawer).toHaveCount(0)}
    await open()
    const summaries=await drawer.locator('summary').allTextContents()
    assert.deepEqual(summaries,['Notes','Assets','Side','Outcome','Type','Date range','Year','Month','Hour of the day'])
    await expect(drawer.getByRole('radio',{name:'Chart',exact:true})).toBeChecked()
    const side=await expand('Side');await side.getByRole('checkbox',{name:'Buy',exact:true}).check()
    await expect(table.locator('tr')).toHaveCount(4)
    await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0)
    await expect(toolbar.getByRole('button',{name:'Basic',exact:true})).toBeFocused()
    await open();await expand('Side')
    await expect(drawer.getByRole('checkbox',{name:'Buy',exact:true})).not.toBeChecked()
    await drawer.getByRole('checkbox',{name:'Buy',exact:true}).check();await apply()
    await expect(table.locator('tr')).toHaveCount(2)
    await expect(toolbar.locator('.fxa-filter-chip')).toHaveCount(1)
    await toolbar.locator('.fxa-filter-chip').click();await expect(table.locator('tr')).toHaveCount(4)
    await open();const notes=await expand('Notes');await notes.getByRole('checkbox',{name:'With notes',exact:true}).check();await apply()
    await expect(table.locator('tr')).toHaveCount(2)
    await toolbar.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(table.locator('tr')).toHaveCount(4)
    await open();await drawer.getByRole('radio',{name:'Realtime',exact:true}).check()
    await expect(drawer.getByRole('button',{name:/^Apply filters$/i})).toBeEnabled()
    const year=await expand('Year');await year.getByRole('button',{name:'Year',exact:true}).click()
    await expect(drawer.getByRole('option',{name:'2026',exact:true})).toBeVisible()
    await drawer.getByRole('option',{name:'2026',exact:true}).click();await year.getByRole('button',{name:'Year',exact:true}).click()
    await apply();await expect(table.locator('tr')).toHaveCount(4)
    await open();await expect(drawer.getByRole('radio',{name:'Realtime',exact:true})).toBeChecked()
    await drawer.getByRole('button',{name:/^Clear all$/i}).click()
    await expect(drawer.getByRole('radio',{name:'Chart',exact:true})).toBeChecked();await apply()
    await toolbar.getByRole('button',{name:'Tags',exact:true}).click()
    await expect(drawer.getByRole('tab',{name:'Tags',exact:true})).toHaveAttribute('aria-selected','true')
    await expect(drawer.locator('.fxl-tag-heading')).toHaveCount(2)
    await drawer.getByRole('button',{name:'Include Tags',exact:true}).click()
    await drawer.getByRole('option',{name:'planned',exact:true}).click()
    await drawer.getByRole('option',{name:'review, later',exact:true}).click()
    await drawer.getByRole('button',{name:'Include Tags',exact:true}).click()
    await page.screenshot({path:`${out}/tags-${width}-${theme}.png`})
    await apply();await expect(table.locator('tr')).toHaveCount(1)
    await expect(toolbar.locator('.fxa-filter-chip')).toContainText('planned AND review, later')
    await page.screenshot({path:`${out}/applied-${width}-${theme}.png`})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    const bounds=await toolbar.evaluate(el=>{const p=el.parentElement.getBoundingClientRect(),r=el.getBoundingClientRect(),line=getComputedStyle(el,'::after');return {left:r.left-p.left,right:p.right-r.right,lineLeft:line.left,lineRight:line.right}})
    assert(Math.abs(bounds.left)<1&&Math.abs(bounds.right)<1)
    assert.equal(bounds.lineLeft,'0px');assert.equal(bounds.lineRight,'0px')
    await toolbar.getByRole('button',{name:'Clear filters',exact:true}).click()
    await open();await page.screenshot({path:`${out}/basic-${width}-${theme}.png`});await page.keyboard.press('Escape')
    if(width===1920){
      await open();await expand('Side');await drawer.getByRole('checkbox',{name:'Buy',exact:true}).check();await apply()
      await toolbar.locator('.fxa-session-trigger').click()
      await page.locator('.fxa-session-options > button').first().click()
      await expect(page.getByTestId('live-trade-grid')).toBeVisible()
      await expect(toolbar.locator('.fxa-filter-chip')).toHaveCount(0)
      await open();await expand('Notes');await drawer.getByRole('checkbox',{name:'Without notes',exact:true}).check();await apply()
      await expect(page.getByTestId('live-trade-grid').locator('tbody tr')).toHaveCount(0)
      await toolbar.getByRole('button',{name:'Clear filters',exact:true}).click()
      await expect(page.getByTestId('live-trade-grid').locator('tbody tr').first()).toBeVisible()
      report.cases.push({accountSwitchResets:true,brokerUnknownNotesEmpty:true,clearRestores:true})
    }
    // The reference Training page must expose the same sections and native controls.
    await page.goto(`${origin}/?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all&demo=1&lang=en`)
    await page.getByTestId('analytics-filters').getByRole('button',{name:'Basic',exact:true}).click()
    assert.deepEqual(await drawer.locator('summary').allTextContents(),summaries)
    report.cases.push({width,theme,draftCancelApply:true,multiTags:true,clockPreview:true,sharedTrainingPanel:true,noPageOverflow:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS'
} catch(error) { report.status='FAIL';report.failure=error.stack;throw error }
finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close()}
