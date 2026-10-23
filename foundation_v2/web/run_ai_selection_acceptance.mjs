import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5188'
const evidence = process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ai-selection-20261023/browser'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Production UI with isolated catalog/conversation/run fixtures; no real inference or configuration writes', checks: [], errors: [] }
try {
  for (const width of [360, 768, 1440]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), lang === 'en' ? 'light' : 'dark')
    const page = await context.newPage(), say = (vi, en) => lang === 'en' ? en : vi
    const initial = { provider: 'local-gateway', model: 'original', effort: null }
    const preferred = { provider: 'local-gateway', model: 'shared', effort: 'medium' }
    const model = (id, name, efforts = ['low', 'medium', 'high']) => ({ id, name, efforts })
    let models = [model('original', 'Original Model'), model('shared', 'Preferred Gemini')]
    let ready = true, fail = false, slowCatalog = null, readDelay = 0, catalogDelay = 0, catalogReads = 0
    const chatId = crypto.randomUUID(), sends = []
    let conversation = { id: chatId, agent_id: 'mentor', title: 'Saved conversation', selection: initial, messages: [], run: null, next: null }
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.split('/ai/assistant')[1], method = request.method()
      if (endpoint === '/account') return route.fulfill({ json: { provider: initial.provider, selection: initial, ready, models } })
      if (endpoint === '/catalog') {
        catalogReads++
        if (fail) return route.fulfill({ status: 503, json: { detail: 'ai_gateway_unavailable' } })
        const response = { routes: [{ provider: 'local-gateway', ready, models }, { provider: 'chatgpt-web', ready: true, models: [model('shared', 'Preferred Gemini', ['high'])] }] }
        const gate = slowCatalog; slowCatalog = null
        if (gate) await gate
        if (catalogDelay) await new Promise(resolve => setTimeout(resolve, catalogDelay))
        return route.fulfill({ json: response })
      }
      if (endpoint === '/profiles') return route.fulfill({ json: { items: [], chat_default: { selection: initial } } })
      if (endpoint === '/agents') return route.fulfill({ json: { items: [{ id: 'mentor', name: 'Mentor', builtin: true, revision: 0 }] } })
      if (endpoint === '/conversations') return route.fulfill({ json: { items: [{ id: conversation.id, title: 'Saved conversation', selection: initial }], next: null } })
      if (endpoint?.startsWith('/conversations/')) {
        if (endpoint !== `/conversations/${conversation.id}`) return route.fulfill({ status: 404, json: { detail: 'chatgpt_turn_not_found' } })
        if (readDelay) await new Promise(resolve => setTimeout(resolve, readDelay))
        return route.fulfill({ json: conversation })
      }
      if (endpoint === '/chat' && method === 'POST') {
        const body = request.postDataJSON(); sends.push(body)
        const run = { id: crypto.randomUUID(), request_key: body.idempotency_key, status: 'running', phase: 'thinking', sequence: 1, text: '', provider: body.expected_selection.provider, selection: { model: body.expected_selection.model, effort: body.expected_selection.effort } }
        conversation = { ...conversation, id: body.conversation_id, selection: body.expected_selection, run, messages: [{ role: 'user', id: run.id, content: body.messages.at(-1).content, status: 'running' }] }
        return route.fulfill({ status: 202, json: run })
      }
      if (endpoint?.startsWith('/chat/')) {
        if (endpoint.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(conversation.run)}\n\n` })
        return route.fulfill({ json: conversation.run })
      }
      assert.ok(['GET', 'HEAD'].includes(method), `Unexpected write ${method} ${url.pathname}`)
      return route.fulfill({ json: {} })
    })
    const url = workspace => `${origin}/?workspace=${workspace}&view=ai&area=ai&section=automation&lang=${lang}`
    const chat = page.getByTestId('ai-chat'), picker = chat.locator('.wm-ai-model-trigger')
    const input = chat.locator('#wm-ai-input')
    const reload = async () => { await page.reload(); await page.getByTestId('ai-toggle').click(); await input.waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.querySelector('.wm-ai-model-trigger')?.disabled) }
    const selection = () => page.evaluate(() => JSON.parse(localStorage.getItem('wm-ai-selection:tenant-a')))
    const chooseModel = async provider => {
      await picker.click()
      if (await chat.locator('.wm-ai-model-current').isVisible()) await chat.locator('.wm-ai-model-current').click()
      await chat.getByRole('option', { name: `Preferred Gemini · ${provider}`, exact: true }).click()
    }
    const refresh = async () => {
      const before = catalogReads
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('wm-ai-provider-change', { detail: { workspace: 'tenant-a' } })))
      await page.waitForFunction(() => !document.querySelector('.wm-ai-model-trigger')?.disabled)
      assert.ok(catalogReads > before)
    }
    await page.goto(url('tenant-a')); await page.getByTestId('ai-toggle').click()
    await input.fill('Draft without sending')
    await chooseModel('CLIProxyAPI'); await picker.click()
    const slider = chat.getByRole('slider', { name: say('Mức suy luận AI', 'AI reasoning effort') })
    await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight'); await slider.press('ArrowRight')
    await page.keyboard.press('Escape')
    assert.deepEqual(await selection(), preferred)
    assert.equal(await picker.locator('.wm-ai-effort-value').evaluate(el => getComputedStyle(el).borderInlineStartWidth), '0px')
    assert.doesNotMatch(await picker.innerText(), /\||CLIProxyAPI/)
    await page.screenshot({ path: path.join(evidence, `preferred-${lang}-${width}.png`) })
    // Restore an older conversation in both response orders. Unsent preference still wins.
    await page.evaluate(id => localStorage.setItem('wm-ai-chat:tenant-a', id), chatId)
    readDelay = 120; await reload(); assert.deepEqual(await selection(), preferred)
    readDelay = 0; catalogDelay = 120; await reload(); assert.deepEqual(await selection(), preferred); catalogDelay = 0
    await chat.getByRole('button', { name: say('Cuộc trò chuyện mới', 'New chat'), exact: true }).click()
    assert.deepEqual(await selection(), preferred)
    await chooseModel('ChatGPT Web')
    assert.deepEqual(await selection(), { provider: 'chatgpt-web', model: 'shared', effort: 'high' })
    await reload(); assert.match(await picker.getAttribute('data-tooltip'), /ChatGPT Web/)
    await chooseModel('CLIProxyAPI')
    assert.deepEqual(await selection(), { ...preferred, effort: 'high' })
    // Failure/empty offline route must not silently reroute to the healthy Web provider.
    fail = true; await refresh(); await chat.locator('.wm-ai-error').waitFor()
    assert.equal((await selection()).provider, 'local-gateway')
    fail = false; ready = false; models = []; await refresh()
    assert.equal(await input.isDisabled(), true)
    assert.deepEqual(await selection(), { ...preferred, effort: 'high' })
    await reload(); assert.equal(await input.isDisabled(), true)
    // A ready route confirms effort/model removal. Do not reintroduce a stale preference.
    ready = true; models = [model('shared', 'Preferred Gemini', ['low'])]; await refresh()
    assert.deepEqual(await selection(), { ...preferred, effort: null })
    let release
    slowCatalog = new Promise(resolve => { release = resolve })
    const reads = catalogReads
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('wm-ai-provider-change', { detail: { workspace: 'tenant-a' } })))
    while (catalogReads === reads) await page.waitForTimeout(10)
    models = [model('replacement', 'Replacement Model', [])]; await refresh()
    release(); await page.waitForTimeout(100)
    assert.deepEqual(await selection(), { provider: 'local-gateway', model: 'replacement', effort: null })
    // Capture an in-flight run, then remove its model: only the next-turn picker changes.
    await input.fill('Synthetic held run'); await input.press('Enter')
    await chat.getByText(say('Đang suy nghĩ…', 'Thinking…'), { exact: true }).waitFor()
    const admitted = structuredClone(conversation.run)
    models = [model('latest', 'Latest Model', [])]; await refresh()
    await reload()
    assert.deepEqual(conversation.run, admitted)
    assert.equal(sends.length, 1, 'refresh/reload never submits a second inference')
    assert.equal((await selection()).model, 'latest')
    assert.equal(sends[0].expected_selection.model, 'replacement')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(evidence, `selection-${lang}-${width}.png`) })
    // Malformed preferences, explicit history open, workspace isolation and blocked storage.
    conversation.run = null; conversation.messages = []
    models = [model('original', 'Original Model'), model('shared', 'Preferred Gemini')]
    await page.evaluate(() => localStorage.setItem('wm-ai-selection:tenant-a', '{broken'))
    await reload(); assert.equal((await selection()).model, 'original')
    await chooseModel('CLIProxyAPI')
    await chat.getByRole('button', { name: say('Chat gần đây', 'Recent chats'), exact: true }).click()
    conversation.selection = initial
    await chat.locator('.wm-ai-history-open').click()
    await chat.locator('.wm-ai-history').waitFor({ state: 'hidden' })
    assert.equal((await selection()).model, 'original', 'explicit history open restores its model')
    await chooseModel('CLIProxyAPI')
    await page.goto(url('tenant-b')); await page.getByTestId('ai-toggle').click(); await input.fill('Other workspace')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wm-ai-selection:tenant-b')).model), 'original')
    await page.goto(url('tenant-a')); await page.getByTestId('ai-toggle').click(); await input.fill('Return')
    assert.equal((await selection()).model, 'shared')
    await context.addInitScript(() => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem
      Storage.prototype.getItem = function(key) { if (key.startsWith('wm-ai-selection:')) throw new DOMException('Blocked', 'SecurityError'); return get.call(this, key) }
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('wm-ai-selection:')) throw new DOMException('Blocked', 'SecurityError'); return set.call(this, key, value) }
    })
    await reload(); await chooseModel('CLIProxyAPI')
    assert.match(await picker.innerText(), /Preferred Gemini/)
    assert.equal(sends.length, 1)
    report.checks.push({ lang, width, pass: true, fixture_submissions: sends.length })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
