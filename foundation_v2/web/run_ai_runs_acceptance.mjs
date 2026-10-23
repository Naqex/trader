import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5187'
const evidence = path.resolve(process.env.TW_AI_UI_EVIDENCE || '../.runtime/ai-runs-ui')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
try {
  for (const width of [360, 768, 1440]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), errors = [], sends = [], cancellations = [], conversations = new Map(), runs = new Map()
    let requests = 0, hold = false, defaultWrites = 0
    const profiles = new Map(), profileWrites = []
    page.on('pageerror', e => errors.push(e.message))
    const selection = { provider: 'local-gateway', model: 'pro', effort: null }
    const models = [{ id: 'pro', name: 'Fixture Pro', efforts: [] }, { id: 'fast', name: 'Fixture Fast', efforts: [] }]
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.split('/ai/assistant')[1], method = request.method()
      if (endpoint === undefined) return route.fulfill({ json: {} })
      requests++
      if (endpoint === '/account') return route.fulfill({ json: { provider: 'local-gateway', ready: true, status: 'catalog_ready', models, selection } })
      if (endpoint.startsWith('/account/')) { defaultWrites++; return route.fulfill({ status: 400, json: { detail: 'unexpected_default_mutation' } }) }
      if (endpoint === '/catalog') return route.fulfill({ json: { routes: [{ provider: 'local-gateway', models, ready: true }, { provider: 'chatgpt-web', models: [{ id: 'pro', name: 'Fixture Web', efforts: ['low', 'high'] }], ready: true }] } })
      if (endpoint === '/profiles') return route.fulfill({ json: { items: [...profiles.values()], chat_default: profiles.get('system/default') || { selection } } })
      if (endpoint.startsWith('/profiles/') && method === 'PUT') {
        const body = request.postDataJSON(), id = endpoint.slice('/profiles/'.length), [feature, role] = id.split('/')
        assert.equal(body.revision, profiles.get(id)?.revision || 0)
        profileWrites.push({ id, ...body })
        if (body.selection) profiles.set(id, { feature, role, selection: body.selection, revision: body.revision + 1 })
        else profiles.delete(id)
        return route.fulfill({ json: { revision: body.revision + 1 } })
      }
      if (endpoint === '/conversations') return route.fulfill({ json: { items: [...conversations.values()].map(({ messages, run, ...item }) => item), next: null } })
      if (endpoint.startsWith('/conversations/')) {
        const id = endpoint.split('/')[2], value = conversations.get(id)
        if (!value) return route.fulfill({ status: 404, json: { detail: 'chatgpt_turn_not_found' } })
        if (method === 'PATCH') { value.title = request.postDataJSON().title; value.revision++ }
        if (method === 'DELETE') { conversations.delete(id); return route.fulfill({ json: { deleted: true } }) }
        return route.fulfill({ json: value })
      }
      if (endpoint === '/chat') {
        const body = request.postDataJSON(); sends.push(body)
        const run = { id: crypto.randomUUID(), conversation_id: body.conversation_id, request_key: body.idempotency_key, status: 'running', sequence: 2, provider: body.expected_selection.provider, selection: { model: body.expected_selection.model, effort: body.expected_selection.effort } }
        runs.set(run.id, run)
        const conversation = conversations.get(body.conversation_id) || { id: body.conversation_id, title: body.messages[0].content, revision: 1 }
        Object.assign(conversation, { selection: body.expected_selection, run, next: null, messages: body.messages.map((m, i) => ({ ...m, status: i === body.messages.length - 1 ? 'running' : 'completed', id: run.id })) })
        conversations.set(conversation.id, conversation)
        return route.fulfill({ status: 202, json: run })
      }
      if (endpoint.startsWith('/chat/')) {
        const run = runs.get(endpoint.split('/')[2]); assert.ok(run)
        if (method === 'DELETE') { cancellations.push(run.id); run.status = 'cancelled'; run.sequence++ }
        else if (!hold && run.status === 'running') {
          run.status = 'completed'; run.text = `${run.selection.model} fixture answer`; run.sequence++
          const conversation = conversations.get(run.conversation_id)
          conversation.messages.at(-1).status = 'completed'; conversation.messages.push({ role: 'assistant', content: run.text, status: 'completed' })
        }
        if (endpoint.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: `event: run\nid: ${run.sequence}\ndata: ${JSON.stringify(run)}\n\n` })
        return route.fulfill({ json: run })
      }
      throw new Error(`unhandled endpoint ${endpoint}`)
    })
    const say = (vi, en) => lang === 'en' ? en : vi
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=automation&lang=${lang}`)
    assert.equal(requests, 0, 'closed chat remains lazy')
    await page.getByTestId('ai-toggle').click()
    const chat = page.getByTestId('ai-chat'), input = chat.locator('#wm-ai-input')
    await input.waitFor(); await input.fill('First conversation')
    const picker = chat.locator('.wm-ai-model-trigger')
    await picker.click()
    await chat.getByRole('option', { name: /Fixture Fast/ }).click()
    await input.press('Enter')
    await chat.getByText('fast fixture answer', { exact: true }).waitFor()
    assert.equal(sends[0].expected_selection.model, 'fast'); assert.match(sends[0].conversation_id, /^[\da-f-]{36}$/)
    assert.match(sends[0].idempotency_key, /^[\da-f-]{36}$/); assert.equal(defaultWrites, 0)
    await chat.getByRole('button', { name: say('Cuộc trò chuyện mới', 'New chat'), exact: true }).click()
    await input.fill('Second conversation'); hold = true; await input.press('Enter')
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).waitFor()
    assert.equal(sends[1].expected_selection.model, 'pro', 'new chat resolves system default')
    assert.notEqual(sends[0].conversation_id, sends[1].conversation_id)
    await picker.click(); await chat.getByRole('option', { name: /Fixture Web/ }).click()
    assert.equal(sends[1].expected_selection.provider, 'local-gateway', 'running snapshot is immutable')
    await chat.getByRole('button', { name: say('Đóng chat AI', 'Close AI chat'), exact: true }).click()
    assert.equal(cancellations.length, 0, 'closing reader does not cancel inference')
    await page.reload(); await page.getByTestId('ai-toggle').click()
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).waitFor()
    assert.equal(sends.length, 2, 'reload resumes the existing run')
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).click()
    await chat.getByText(say('Đã dừng chờ phản hồi.', 'Response stopped.'), { exact: true }).waitFor()
    assert.equal(cancellations.length, 1)
    await chat.getByRole('button', { name: say('Chat gần đây', 'Recent chats'), exact: true }).click()
    await chat.getByRole('button', { name: 'First conversation', exact: true }).click()
    await chat.getByText('fast fixture answer', { exact: true }).waitFor()
    assert.equal(sends.length, 2)
    await page.screenshot({ path: path.join(evidence, `conversation-${lang}-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await chat.getByRole('button', { name: say('Đóng chat AI', 'Close AI chat'), exact: true }).click()
    await page.getByTestId('theme-toggle').click()
    await page.getByTestId('ai-toggle').click()
    await chat.getByText('fast fixture answer', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `conversation-light-${lang}-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await input.isEnabled(), true)
    await chat.getByRole('button', { name: say('Chat gần đây', 'Recent chats'), exact: true }).click()
    await chat.getByRole('button', { name: `${say('Đổi tên chat', 'Rename chat')}: First conversation`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: say('Đổi tên chat', 'Rename chat'), exact: true })
    await dialog.getByRole('textbox').fill('Renamed chat'); await dialog.getByRole('button', { name: say('Xác nhận', 'Confirm') }).click()
    await chat.getByRole('button', { name: 'Renamed chat', exact: true }).waitFor()
    await chat.getByRole('button', { name: `${say('Xóa chat', 'Delete chat')}: Renamed chat`, exact: true }).click()
    await page.getByRole('dialog', { name: say('Xóa cuộc trò chuyện?', 'Delete conversation?') }).getByRole('button', { name: say('Xóa', 'Delete'), exact: true }).click()
    assert.equal(conversations.size, 1)
    await chat.getByRole('button', { name: say('Đóng chat AI', 'Close AI chat'), exact: true }).click()
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=models&lang=${lang}`)
    await page.getByRole('heading', { name: say('Model', 'Models'), exact: true }).waitFor()
    const profile = page.locator('.ai-model-profile-row').first().locator('.fx-select-trigger').first()
    await profile.click()
    const saveFast = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/profiles/system/default'))
    await page.getByRole('option', { name: /Fixture Fast/ }).click()
    assert.equal((await saveFast).status(), 200)
    assert.deepEqual(profileWrites.at(-1).selection, { provider: 'local-gateway', model: 'fast', effort: null })
    await page.waitForFunction(() => document.querySelector('.ai-model-profile-row .fx-select-value')?.textContent.includes('Fixture Fast'))
    await page.reload()
    await page.getByRole('heading', { name: say('Model', 'Models'), exact: true }).waitFor()
    await profile.click()
    const saveWeb = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/profiles/system/default'))
    await page.getByRole('option', { name: /Fixture Web/ }).click()
    assert.equal((await saveWeb).status(), 200)
    assert.deepEqual(profileWrites.at(-1).selection, { provider: 'chatgpt-web', model: 'pro', effort: 'high' })
    await page.waitForFunction(() => document.querySelector('.ai-model-profile-row .fx-select-value')?.textContent.includes('Fixture Web'))
    assert.equal(profileWrites.at(-1).revision, 1)
    assert.equal(await page.getByRole('button', { name: `${say('Model hệ thống', 'System model')} · ${say('Mức suy luận', 'Reasoning effort')}`, exact: true }).count(), 1)
    await page.screenshot({ path: path.join(evidence, `profiles-${lang}-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    checks.push({ width, lang, submissions: sends.length, cancelled: cancellations.length, default_mutations: defaultWrites, status: 'pass' })
    await context.close()
  }
} finally { await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'production UI with isolated API fixtures; no real inference', checks }, null, 2)); await browser.close() }
console.log(JSON.stringify({ passed: checks.length, checks }))
