import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'
import { journalRecords, fixtureAccount } from './liveJournal.fixture.mjs'

const web = fileURLToPath(new URL('..', import.meta.url))
const out = path.join(web, '.artifacts', 'live-analytics-controls')
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const preview = spawn(process.execPath, [path.join(web,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',String(port),'--strictPort'], {cwd:web,stdio:'pipe',windowsHide:true})
const origin = `http://127.0.0.1:${port}`
let browser, output = ''
preview.stdout.on('data', data => { output += data })
preview.stderr.on('data', data => { output += data })
const report = {scope:'Synthetic manual journal; external requests and every API write blocked',cases:[],errors:[],mutations:[]}
try {
  for (let i=0;;i++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    if (i>=60 || preview.exitCode !== null) throw new Error(`Preview failed: ${output}`)
    await new Promise(resolve => setTimeout(resolve,200))
  }
  await mkdir(out,{recursive:true})
  browser = await chromium.launch({headless:true})
  for (const [width,theme,lang] of [[1920,'dark','vi'],[1920,'light','en'],[390,'dark','vi'],[390,'light','en']]) {
    const context = await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    const page = await context.newPage()
    let missingCapital=false, empty=false
    const records = journalRecords().filter(record => record.kind==='account' || record.kind==='trade').slice(0,4)
    records[1].payload.tags=['London']; records[2].payload.tags=['London','New York']; records[3].payload.tags=[]
    // Net -6 + 9 - 6 = -3. Both labels contain the winning trade; London count is two.
    page.on('pageerror',error => report.errors.push(error.message))
    await page.addInitScript(({theme,lang}) => {localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang)}, {theme,lang})
    await page.route('**/*',async route => {
      const request=route.request(),url=new URL(request.url())
      if(url.origin!==origin && !['blob:','data:'].includes(url.protocol)) return route.abort()
      if(!url.pathname.startsWith('/api/'))return route.continue()
      if(request.method()!=='GET'){report.mutations.push(url.pathname);return route.abort()}
      if(url.pathname==='/api/v2/live/status')return route.fulfill({json:{status:'unavailable',connections:[]}})
      if(url.pathname==='/api/v2/live/records') {
        const items=structuredClone(empty ? records.slice(0,1) : records)
        if(missingCapital) { items[0].payload.opening_balance=null;items[0].payload.currency='' }
        return route.fulfill({json:{version:'live-records-v1',items}})
      }
      if(url.pathname==='/api/v2/trade-labels')return route.fulfill({json:{schema_version:'trade-labels-v1',items:[{id:'london',name:'London',color:'purple'},{id:'ny',name:'New York',color:'blue'}]}})
      return route.fulfill({json:{items:[],sessions:[],datasets:[],accounts:[],connections:[],total:0}})
    })
    const href=section=>`${origin}/?workspace=fixture&view=live&area=live&section=${section}&lang=${lang}&live_account=${fixtureAccount}`
    await page.goto(href('trades'),{waitUntil:'networkidle'})
    const panel=page.locator('.live-analytics-side'), balance=panel.locator('.live-balance-summary > div:first-child strong')
    await balance.filter({hasText:'9'}).waitFor()
    assert.match(await balance.textContent(),/9[.,]997|9\s997/)
    const overview=panel.locator('.live-tag-overview')
    assert.equal(await overview.locator('li').count(),2)
    const london=overview.locator('li').filter({hasText:'London'})
    assert.equal(await london.locator('.live-tag-count').textContent(),'2')
    assert.equal(await london.locator('[data-color=purple]').textContent(),'London')
    assert.match(await london.locator('strong').textContent(),/3/)
    assert.match(await london.locator('.live-tag-results > span').textContent(),/50/)
    if(width===1920 && theme==='dark')await page.screenshot({path:path.join(out,'readme-trades.png')})
    const gear=overview.getByRole('button')
    assert.equal(await gear.getAttribute('aria-disabled'),'true')
    await gear.press('Enter')
    assert.equal(await page.getByRole('dialog').count(),0)
    const controls=panel.locator('.live-analytics-controls'), select=controls.locator('.fx-select-trigger')
    await select.click()
    await page.getByRole('option',{name:lang==='vi'?'Phần trăm':'Percentage',exact:true}).click()
    assert.match(await balance.textContent(),/-0[.,]03%/)
    assert.match(await panel.locator('.live-analytics-expectancy-heading > strong').textContent(),/\$/)
    const eye=controls.locator('button[aria-pressed]')
    await eye.press('Enter')
    assert.equal(await balance.textContent(),'******')
    assert.equal(await eye.getAttribute('aria-pressed'),'true')
    await eye.press('Space')
    assert.match(await balance.textContent(),/-0[.,]03%/)
    await select.click()
    await page.keyboard.press('Escape')
    assert.equal(await select.getAttribute('aria-expanded'),'false')
    const style=await london.evaluate(element=>({radius:getComputedStyle(element).borderRadius,bottom:getComputedStyle(element).borderBottomWidth,left:getComputedStyle(element).borderLeftWidth}))
    assert.deepEqual(style,{radius:'0px',bottom:'1px',left:'0px'})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No document overflow')
    await page.screenshot({path:path.join(out,`${theme}-${width}-${lang}.png`),fullPage:true})
    await page.goto(href('calendar'),{waitUntil:'networkidle'})
    await page.locator('.live-analytics-controls').waitFor()
    assert.equal(await page.locator('.live-tag-overview').count(),0)
    missingCapital=true
    await page.goto(href('trades'),{waitUntil:'networkidle'})
    await page.locator('.live-tag-overview li').first().waitFor()
    assert.doesNotMatch(await page.locator('.live-analytics-controls .fx-select-trigger').textContent(),/\$/)
    await page.locator('.live-analytics-controls .fx-select-trigger').click()
    await page.getByRole('option',{name:lang==='vi'?'Phần trăm':'Percentage',exact:true}).click()
    assert.equal(await balance.textContent(),'N/A')
    empty=true;missingCapital=false
    await page.reload({waitUntil:'networkidle'})
    await page.locator('.live-tag-overview p').waitFor()
    assert.equal(await page.locator('.live-tag-overview li').count(),0)
    report.cases.push({width,theme,lang,units:true,privacy:true,sharedCatalog:true,flatSeams:true,calendarExclusion:true,unknown:true,empty:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.mutations,[])
  report.passed=true
} catch(error) { report.failure=error.stack;throw error }
finally { await browser?.close();preview.kill();await mkdir(out,{recursive:true});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report)) }
