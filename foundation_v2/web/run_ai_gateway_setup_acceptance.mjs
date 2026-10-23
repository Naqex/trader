import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { googleOAuthUrl } from './src/aiProvider.js'

const evidence = path.resolve('../evidence/ai-gateway-managed-20261023/ui')
await mkdir(evidence, { recursive: true })
const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5180'
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=synthetic&redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback'
assert.ok(googleOAuthUrl(authUrl))
for (const value of ['javascript:alert(1)', authUrl.replace('accounts.google.com', 'evil.example'), authUrl.replace('localhost', 'evil.example')]) assert.equal(googleOAuthUrl(value), null)
const browser = await chromium.launch({ headless: true })
const checks = []
try {
  for (const [width, lang, theme] of [[1440,'vi','dark'],[360,'en','light']]) {
    const en = lang === 'en', say = (vi, english) => en ? english : vi
    const context = await browser.newContext({ viewport:{width,height:960}, reducedMotion:'reduce' })
    const popups = []
    await context.addInitScript(value => localStorage.setItem('tw-theme', value),theme)
    // Google is a labeled local browser fixture; this test never contacts the provider.
    await context.route('https://accounts.google.com/**', route => route.fulfill({ contentType:'text/html', body:'<title>Synthetic OAuth fixture</title><p>Fixture only: no Google login</p>' }))
    const page = await context.newPage(), errors = [], actions = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('popup', popup => popups.push(popup))
    let reads = 0, mode = 'waiting', state = {
      provider:'local-gateway',status:'unavailable',error:'ai_gateway_unavailable',models:[],ready:false,selection:null,operation:null,
      runtime:{managed:true,running:false,accounts:0,error:null},
    }
    await page.route('**/api/v2/ai/assistant/**', async route => {
      const request = route.request(), suffix = new URL(request.url()).pathname.split('/account')[1]
      assert.ok(suffix !== undefined, 'setup never sends inference')
      const action = suffix.slice(1)
      if (action) actions.push(action); else reads++
      if (action === 'login') state = {...state,status:'waiting_for_browser',error:null,operation:{kind:'login',auth_url:authUrl},runtime:{...state.runtime,running:true}}
      if (action === 'cancel') state = {...state,status:'empty',operation:null}
      if (action === 'stop') state = {...state,status:'unavailable',error:'ai_gateway_unavailable',operation:null,runtime:{...state.runtime,running:false}}
      if (action === 'start') state = {...state,status:'catalog_ready',error:null,runtime:{...state.runtime,running:true}}
      if (action === 'selection') state = {...state,selection:request.postDataJSON(),ready:true}
      if (!action && state.operation && mode === 'offline') return route.fulfill({status:503,json:{detail:'ai_gateway_unavailable'}})
      if (!action && state.operation && mode === 'complete') state = {...state,status:'catalog_ready',operation:null,models:[{id:'gemini-fixture-pro',name:'Gemini fixture Pro',efforts:[]}],runtime:{...state.runtime,accounts:1}}
      await route.fulfill({json:state})
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=connections&lang=${lang}&theme=${theme}`)
    const settings = page.getByTestId('ai-provider-settings')
    await settings.getByText(say('Đã tắt','Stopped'),{exact:true}).waitFor()
    const idleReads = reads
    await page.waitForTimeout(1800)
    assert.equal(reads,idleReads); assert.deepEqual(actions,[])
    assert.equal(await settings.getByText('http://127.0.0.1:17852/v1',{exact:true}).count(),0,'managed setup hides implementation-only endpoint')
    await settings.getByRole('button',{name:say('Kết nối Google','Connect Google'),exact:true}).click()
    await settings.getByRole('button',{name:say('Hủy đăng nhập','Cancel sign-in'),exact:true}).waitFor()
    assert.equal(await settings.getByRole('button',{name:say('Nhà cung cấp AI','AI provider'),exact:true}).isDisabled(),true)
    assert.equal(popups.length,1)
    await popups[0].waitForURL('https://accounts.google.com/**')
    assert.equal(await popups[0].evaluate(()=>window.opener),null)
    await settings.getByRole('button',{name:say('Hủy đăng nhập','Cancel sign-in'),exact:true}).click()
    await settings.getByRole('button',{name:say('Kết nối Google','Connect Google'),exact:true}).waitFor()
    const afterCancel = reads
    await page.waitForTimeout(1800); assert.equal(reads,afterCancel,'cancel stops polling')
    await popups[0].close()
    // Popup blocked: preserve a real user-activated fallback link.
    await page.evaluate(()=>{window.open=()=>null})
    await settings.getByRole('button',{name:say('Kết nối Google','Connect Google'),exact:true}).click()
    const fallback = settings.getByRole('link',{name:say('Mở trang đăng nhập','Open sign-in page')+' ↗',exact:true})
    assert.equal(await fallback.getAttribute('href'),authUrl)
    mode='offline'
    await settings.getByRole('alert').waitFor()
    const paused = reads
    await page.waitForTimeout(1800); assert.equal(reads,paused,'polling pauses on transport failure')
    mode='complete'
    await settings.getByRole('button',{name:say('Thử lại','Retry'),exact:true}).click()
    await settings.getByText(say('Đã tải model','Models loaded'),{exact:true}).waitFor()
    await settings.getByRole('button',{name:'Model AI',exact:true}).click()
    await page.getByRole('option',{name:'Gemini fixture Pro',exact:true}).click()
    await page.screenshot({path:path.join(evidence,`connected-${lang}-${width}.png`)})
    await settings.getByRole('button',{name:say('Tắt kết nối','Stop connection'),exact:true}).click()
    await settings.getByRole('button',{name:say('Bật kết nối','Start connection'),exact:true}).waitFor()
    await page.reload()
    await settings.getByRole('button',{name:say('Bật kết nối','Start connection'),exact:true}).click()
    await settings.getByText(say('Đã tải model','Models loaded'),{exact:true}).waitFor()
    const doneReads = reads
    await page.waitForTimeout(1800); assert.equal(reads,doneReads,'completed OAuth stops polling')
    assert.ok(actions.every(action=>['login','cancel','selection','stop','start'].includes(action)))
    assert.deepEqual(errors,[])
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    checks.push(`${width}px ${lang}/${theme}: user-only login, sanitized popup/no opener, blocked-popup fallback, cancel, offline polling pause/retry, successful catalog/selection, stop/start/reload, no idle polling/inference/overflow/page errors`)
    await context.close()
  }
  await writeFile(path.join(evidence,'report.json'),JSON.stringify({scope:'Product UI with labeled HTTP and Google-page fixtures; no real OAuth or inference',checks},null,2))
  console.log(JSON.stringify({checks}))
} finally { await browser.close() }
