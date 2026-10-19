import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.env.ACCOUNT_PNL_OUTPUT || '../evidence/account-pnl-20261019'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const spec = fixture.datasets.items[0].instrument_spec
const position = { position_id:'fixture-open',side:'BUY',quantity:'0.01',entry_fill:'1.1',stop_loss:null,take_profit:null }
const execution = { cursor_index:60,instrument_spec:spec,cost_model:{ account_ccy:'USD' },spread_price:'0',starting_balance:'10000',position:null,pending_market_order:null,ledger:[] }
const report = { scope:'Synthetic account snapshots, real preview/native chart; API writes blocked',cases:[],errors:[],unexpected:[] }
const browser = await chromium.launch()
await mkdir(output,{ recursive:true })

const cases = [
  { name:'closed-profit',balance:'10013.62',floating:'0',equity:'10013.62',open:0,realized:'$13.62',tone:'is-gain' },
  { name:'open-profit',balance:'10013.62',floating:'40.01',equity:'10053.63',open:1,realized:'$13.62',tone:'is-gain',outside:'+$40.01' },
  { name:'open-loss',balance:'10013.62',floating:'-11.25',equity:'10002.37',open:1,realized:'$13.62',tone:'is-gain',outside:'-$11.25' },
  { name:'partial-close',balance:'10006.81',floating:'20',equity:'10026.81',open:1,realized:'$6.81',tone:'is-gain',outside:'+$20.00' },
  { name:'closed-loss',balance:'9676.04',floating:'0',equity:'9676.04',open:0,realized:'-$323.96',tone:'is-loss' },
  { name:'open-zero',balance:'10000',floating:'0',equity:'10000',open:1,realized:'$0.00',tone:'',outside:'+$0.00' },
  { name:'other-asset-open',balance:'10000',floating:'-5',equity:'9995',open:1,other:true,realized:'$0.00',tone:'',outside:'-$5.00' },
  { name:'pending-only',balance:'10000',floating:'0',equity:'10000',open:0,pending:true,realized:'$0.00',tone:'' },
  { name:'unknown',balance:null,floating:null,equity:null,open:1,realized:'—',tone:'',outside:'—' },
]
const money = value => value === null ? '—' : new Intl.NumberFormat('en-US',{ style:'currency',currency:'USD' }).format(Number(value))

try {
  for (const [width,lang,theme] of [[1368,'en','dark'],[390,'vi','light']]) {
    let snapshot
    const context = await browser.newContext({ viewport:{ width,height:790 },reducedMotion:'reduce' })
    await context.addInitScript(({lang,theme}) => { localStorage.setItem('tw-language',lang); localStorage.setItem('tw-theme',theme) }, {lang,theme})
    await context.route('**/*',route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === origin && request.method() === 'POST' && url.pathname.endsWith('/activity')) return route.abort()
      if (url.origin !== origin || !['GET','HEAD','OPTIONS'].includes(request.method())) { report.unexpected.push(`${request.method()} ${url.pathname}`); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType:'text/event-stream',body:': fixture\n\n' })
      return route.fulfill({ json:url.pathname === `/api/v2/replay/sessions/${fixture.session}` ? snapshot : url.pathname === '/api/v2/data/datasets' ? fixture.datasets : { items:[],available:false } })
    })
    const page = await context.newPage()
    page.on('pageerror',error => report.errors.push(error.message))
    for (const state of cases) {
      const current = { ...execution,balance:state.balance,equity:state.equity,floating_pl:state.floating,
        position:state.open && !state.other ? position : null,pending_market_order:state.pending ? { operation_id:'pending',order_type:'limit',side:'BUY',quantity:'0.01',entry_price:'1.08' } : null }
      snapshot = { ...fixture.latest,dataset_sha256:null,portfolio_account:{ starting_balance:'10000',balance:state.balance,equity:state.equity,floating_pl:state.floating,account_ccy:'USD',open_position_count:state.open },
        payload:{ ...fixture.latest.payload,starting_balance:'10000',starting_balance_ccy:'USD',execution:current,
          ...(state.other ? { asset_states:{ active:{ execution:current },other:{ execution:{ ...execution,position,floating_pl:'-5' } } } } : {}) } }
      await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
      await page.locator('[data-chart-status=ready]').waitFor({ timeout:30000 })
      const pill = page.locator('.legacy-balance-pill'), floating = pill.locator('.legacy-floating-pnl')
      assert.equal(await pill.locator('strong').innerText(),money(state.equity),'Headline is Equity, including floating PnL')
      assert.equal(await floating.count(),state.open ? 1 : 0,'Only an open position exposes floating PnL, including zero and other assets')
      if (state.open) {
        assert.equal((await floating.innerText()).replace('●','').trim(),state.outside)
        const classes = await floating.getAttribute('class')
        const tone = Number(state.floating) > 0 ? 'is-gain' : Number(state.floating) < 0 ? 'is-loss' : ''
        if (tone) assert.ok(classes.includes(tone)); else assert.ok(!/is-gain|is-loss/.test(classes))
      }
      await pill.hover()
      const details = page.locator('.legacy-account-details')
      await details.waitFor()
      const values = details.locator('dd')
      assert.deepEqual(await details.locator('dt').allTextContents(),lang === 'vi' ? ['Equity','PnL đã chốt','PnL chưa chốt'] : ['Equity','Realized PnL','Unrealized PnL'])
      assert.deepEqual(await values.allTextContents(),[money(state.equity),state.realized,money(state.floating)])
      assert.equal(await values.nth(1).getAttribute('class'),state.tone)
      for (const value of await details.locator('.is-gain,.is-loss').all()) {
        const matches = await value.evaluate(node => {
          const probe = document.createElement('span'); probe.style.color = node.classList.contains('is-gain') ? 'var(--project-positive)' : 'var(--project-negative)'
          node.append(probe); const same = getComputedStyle(node).color === getComputedStyle(probe).color; probe.remove(); return same
        })
        assert.equal(matches,true,'PnL uses semantic profit/loss colors in portaled details')
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
      assert.equal(await details.evaluate(node => node.getBoundingClientRect().right <= innerWidth),true)
      if (['closed-loss','open-profit','open-loss'].includes(state.name)) await page.screenshot({path:`${output}/${width}-${lang}-${state.name}.png`})
      report.cases.push({ width,lang,theme,state:state.name,result:'PASS' })
    }
    await context.close()
  }
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.unexpected,[])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`,JSON.stringify(report,null,2)); await browser.close() }
console.log(JSON.stringify({result:report.result,cases:report.cases.length,errors:report.errors}))
