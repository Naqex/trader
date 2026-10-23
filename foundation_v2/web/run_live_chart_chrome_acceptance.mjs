import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_LIVE_UI_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.TW_LIVE_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/live-chart-chrome-ui'
await mkdir(output, { recursive:true })
const browser = await chromium.launch()
const fixture = process.env.TW_LIVE_CHART_FIXTURE === '1'
const report = { origin, scope:fixture ? 'Labeled synthetic MT5 and notes fixtures; no broker preview/send or inference' : 'Read-only local MT5 chart; labeled notes fixtures; no broker preview/send or inference', cases:[], errors:[], mutations:[] }
const connection = '492ec8a5-3938-41a3-8a26-8c0f7f59ed43'
let currentPage
try {
  for (const [width,theme] of [[1920,'dark'],[1440,'light'],[768,'dark'],[390,'dark']]) {
    const context = await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
    await context.route('**/charting_library/**', async route => route.fulfill({response:await route.fetch({url:route.request().url().replace(origin,'http://127.0.0.1:5180')})}))
    await context.route('**/api/**', async route => {
      if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) { report.mutations.push(route.request().url()); return route.abort() }
      if (fixture && new URL(route.request().url()).pathname === '/api/v2/live/trading') {
        const start = Math.floor(Date.now()/60000)*60 - 60*119
        return route.fulfill({json:{status:'ready',reason:'demo_ready',mode:'demo',symbol:'EURUSDm',connection_id:connection,execution_enabled:true,
          account:{login:'fixture-demo',server:'Fixture-Demo',trade_mode:'demo',currency:'USD',balance:10000,equity:10000,margin_free:10000},
          instrument:{asset_class:'fx',quantity_min:0.01,quantity_max:10,quantity_step:0.01,tick_size:0.00001},policy:{source:'broker',max_quote_age_ms:5000},capabilities:{market:true},
          quote:{bid:1.1,ask:1.1002,time_msc:Date.now()},positions:[],orders:[],requests:[],
          bars:Array.from({length:120},(_,i)=>({timestamp:start+i*60,open:1.1+Math.sin(i/8)*0.001,close:1.1+Math.sin((i+1)/8)*0.001,high:1.102,low:1.098,volume:100}))}})
      }
      await route.continue()
    })
    const page = await context.newPage()
    currentPage = page
    page.on('pageerror', error => report.errors.push(error.message))
    const href = section => `${origin}/?workspace=tenant-a&view=live&area=live&section=${section}&lang=vi&theme=${theme}&mt5_connection=${connection}`
    await page.goto(`${href('terminal')}&surface=workspace&mt5_timeframe=M1&mt5_symbol=EURUSDm`)
    await page.locator('[data-chart-status="ready"]').waitFor({timeout:30000})
    const bar = page.locator('.mt5-trading-bar')
    await bar.getByRole('button',{name:'Thông tin tài khoản',exact:true}).filter({hasText:'10,000'}).waitFor({timeout:30000})
    const frame = page.frameLocator('.advanced-chart-host iframe')
    await frame.getByRole('button',{name:'AI Mentor',exact:true}).waitFor()
    if (await page.locator('.fx-app').getAttribute('data-theme') !== theme) {
      await frame.getByRole('button',{name:'Đổi giao diện',exact:true}).click()
      await page.locator(`.fx-app[data-theme="${theme}"]`).waitFor()
    }
    const quantity = bar.getByRole('spinbutton',{name:/Khối lượng/})
    await quantity.fill('0.01')
    await bar.getByRole('button',{name:'Tăng khối lượng',exact:true}).click()
    assert.equal(await quantity.inputValue(),'0.02')
    await bar.locator('button.buy').click()
    await page.getByRole('dialog',{name:'Lệnh mới',exact:true}).waitFor()
    assert.equal(await page.locator('.live-terminal-form').getByRole('spinbutton',{name:/Khối lượng/}).inputValue(),'0.02')
    await page.getByRole('dialog',{name:'Lệnh mới',exact:true}).getByRole('button',{name:'Đóng',exact:true}).click()
    await bar.getByRole('button',{name:'Thông tin tài khoản',exact:true}).click()
    await page.locator('.legacy-account-details').waitFor()
    await page.keyboard.press('Escape')
    await bar.getByRole('button',{name:'Mở danh sách lệnh',exact:true}).click()
    await page.locator('.live-terminal-ledger').waitFor()
    const separator = bar.getByRole('separator')
    await separator.focus(); await page.keyboard.press('End')
    const bounds = await page.locator('.mt5-trading-workspace').boundingBox()
    assert.ok(bounds.y + bounds.height <= 941,JSON.stringify(bounds))
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp')
    const dock = page.locator('.mt5-positions-dock'), before = await dock.boundingBox(), grip = await separator.boundingBox()
    await page.mouse.move(grip.x + grip.width/2,grip.y + grip.height/2)
    await page.mouse.down(); await page.mouse.move(grip.x + grip.width/2,grip.y + grip.height/2 - 80,{steps:8}); await page.mouse.up()
    assert.ok((await dock.boundingBox()).height > before.height)
    await bar.getByRole('button',{name:'Mở rộng danh sách lệnh',exact:true}).click()
    await page.screenshot({path:`${output}/chart-max-${width}-${theme}.png`,animations:'disabled'})
    await bar.getByRole('button',{name:'Thu nhỏ danh sách lệnh',exact:true}).click()
    await bar.getByRole('button',{name:'Thu gọn danh sách lệnh',exact:true}).click()
    await page.screenshot({path:`${output}/chart-${width}-${theme}.png`,animations:'disabled'})
    await frame.getByRole('button',{name:'AI Mentor',exact:true}).click()
    await page.locator('#wm-ai-chat:not([hidden])').waitFor()
    await page.locator('#wm-ai-chat').getByRole('button',{name:'Đóng chat AI',exact:true}).click()
    const journal = page.getByRole('link',{name:'Ghi chú',exact:true})
    const journalUrl = new URL(await journal.getAttribute('href'),origin)
    assert.equal(journalUrl.searchParams.get('live_account'),`broker:${connection}`)
    assert.equal(journalUrl.searchParams.has('surface'),false)
    let count = 0
    await page.route('**/api/v2/live/records*',route => route.fulfill({json:{version:'live-records-v1',items:Array.from({length:count},(_,index) => ({record_id:`fixture-note-${index}`,kind:'note',revision:1,updated_at_utc:'2026-10-23T00:00:00Z',payload:{title:`Fixture note ${index}`,note:'Labeled fixture '.repeat(30),tags:[]}}))}}))
    await journal.click()
    const pagination = page.getByRole('navigation',{name:'Trang ghi chú',exact:true})
    await pagination.waitFor()
    let box = await pagination.boundingBox()
    assert.ok(Math.abs(box.y + box.height - 940) < 2,JSON.stringify(box))
    count = 35
    await page.reload(); await page.locator('.live-note-row').first().waitFor()
    box = await pagination.boundingBox()
    assert.ok(Math.abs(box.y + box.height - 940) < 2,JSON.stringify(box))
    assert.ok(await page.locator('.live-note-list').evaluate(node => node.scrollHeight > node.clientHeight))
    await page.screenshot({path:`${output}/notes-${width}-${theme}.png`,animations:'disabled'})
    report.cases.push({width,theme,quantityShared:true,ticketOnly:true,resizeMaxWithinViewport:true,pointerResize:true,mentor:true,notesEmptyAndOverflow:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[])
  assert.deepEqual(report.mutations,[])
  report.passed = true
} catch (error) {
  report.failure=error.stack
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({path:`${output}/failure.png`,animations:'disabled'}).catch(()=>{})
    report.page = await currentPage.locator('body').innerText().catch(()=>null)
  }
  throw error
}
finally {await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)); await browser.close(); console.log(JSON.stringify(report))}
