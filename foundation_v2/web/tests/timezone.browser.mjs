import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.BASE_URL || 'http://127.0.0.1:5194'
const out = process.env.EVIDENCE_DIR || 'E:/BACKUP-TRADINGWORKSPACE/dashboard-refine-20261024'
await mkdir(out, {recursive:true})
const browser = await chromium.launch(), page = await browser.newPage({viewport:{width:1920,height:940}})
const evidence = {errors:[], writes:[], checks:[]}
page.on('pageerror', e=>evidence.errors.push(e.message))
await page.route('**/api/**', route=>{
  if(!['GET','HEAD','OPTIONS'].includes(route.request().method())) { evidence.writes.push(route.request().url()); return route.abort() }
  return route.continue()
})
try {
  await page.goto(`${base}/?workspace=tenant-a&view=settings&lang=vi`)
  const settings=page.locator('.settings-timezone')
  await settings.getByRole('button',{name:'Múi giờ',exact:true}).click()
  const search=settings.getByRole('searchbox')
  await search.fill('ho chi')
  await page.getByRole('option',{name:/Ho Chi Minh/}).click()
  await settings.getByRole('button',{name:'Lưu thay đổi',exact:true}).click()
  await page.waitForFunction(()=>localStorage.getItem('tw-timezone')==='Asia/Ho_Chi_Minh')
  await page.reload()
  await settings.getByRole('button',{name:'Múi giờ',exact:true}).waitFor()
  assert.match(await settings.innerText(),/Ho Chi Minh/)
  evidence.checks.push('Settings saves and reloads IANA preference')
  const tradesRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v2/replay/trades' && response.status() === 200)
  await page.goto(`${base}/?workspace=tenant-a&view=trade&lang=vi&area=testing&section=trades&select=1&sessions=all`)
  const payload = await (await tradesRead).json()
  assert.ok(payload.ledger.length, 'Timezone integration needs an existing trade; this test never creates one')
  const instant = payload.ledger[0].open_time_utc
  const date = new Date(typeof instant === 'number' ? instant * 1000 : instant)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Ho_Chi_Minh', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(date).map(part => [part.type,part.value]))
  const expected = `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
  await page.waitForFunction(value=>document.querySelector('tbody')?.textContent.includes(value), expected)
  const rows=await page.locator('tbody').innerText()
  assert.ok(rows.includes(expected))
  assert.doesNotMatch(await page.locator('thead').innerText(),/\bUTC\b/)
  evidence.checks.push('Actual trade instant matches independent IANA formatter; headings follow Settings')
  await page.screenshot({path:`${out}/timezone-trades.png`})
  await page.goto(`${base}/?workspace=tenant-a&view=overview&lang=vi&area=testing&section=dashboard`)
  const field=page.getByRole('searchbox',{name:'Tìm phiên gần đây'})
  await field.waitFor()
  await field.fill('test')
  await field.press('Escape')
  await page.waitForFunction(()=>document.querySelector('.fx-dashboard-search input')?.value==='')
  await page.waitForTimeout(500)
  assert.equal(await field.inputValue(),'')
  const card=page.locator('.fx-dashboard-session-card').first()
  await card.waitFor()
  await card.evaluate(node=>{ window.cardIdentity=node })
  await page.getByRole('button',{name:'Hiện bộ lọc phiên',exact:true}).click()
  await page.getByRole('button',{name:'Ẩn bộ lọc phiên',exact:true}).click()
  assert.equal(await card.evaluate(node=>window.cardIdentity===node),true)
  evidence.checks.push('Search Escape clears controlled state; filter toggle preserves card identity')
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.writes,[])
} finally {
  await writeFile(`${out}/timezone-browser.json`,JSON.stringify(evidence,null,2))
  await browser.close()
}
console.log(JSON.stringify(evidence))
