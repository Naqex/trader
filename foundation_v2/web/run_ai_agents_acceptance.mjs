import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5188'
const evidence = process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ai-agents-20261023/browser'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'Production UI with isolated agent/run fixtures; no real inference or account changes', checks: [], errors: [] }
try {
  for (const width of [360, 768, 1440]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), lang === 'en' ? 'light' : 'dark')
    const page = await context.newPage(), say = (vi, en) => lang === 'en' ? en : vi
    const mentor = { id: 'mentor', name: 'Mentor', description: '', builtin: true, revision: 0 }
    const agents = [mentor], conversations = new Map(), sends = []
    const selection = { provider: 'local-gateway', model: 'gemini-fixture', effort: null }
    let saveFails = true
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.split('/ai/assistant')[1], method = request.method()
      if (endpoint === '/account') return route.fulfill({ json: { provider: 'local-gateway', ready: true, selection } })
      if (endpoint === '/catalog') return route.fulfill({ json: { routes: [{ provider: 'local-gateway', ready: true, models: [{ id: selection.model, name: 'Fixture Gemini', efforts: [] }] }] } })
      if (endpoint === '/profiles') return route.fulfill({ json: { items: [], chat_default: { selection } } })
      if (endpoint === '/agents' && method === 'GET') return route.fulfill({ json: { items: agents } })
      if (endpoint === '/agents' && method === 'POST') {
        if (saveFails) { saveFails = false; return route.fulfill({ status: 503, json: { detail: 'database_unavailable' } }) }
        const agent = { ...request.postDataJSON(), id: crypto.randomUUID(), revision: 1, builtin: false }
        agents.push(agent); return route.fulfill({ status: 201, json: agent })
      }
      if (endpoint?.startsWith('/agents/')) {
        const agent = agents.find(a => a.id === endpoint.split('/')[2]); assert.ok(agent)
        if (method === 'PATCH') Object.assign(agent, request.postDataJSON(), { revision: agent.revision + 1 })
        return route.fulfill({ json: agent })
      }
      if (endpoint === '/conversations') return route.fulfill({ json: { items: [...conversations.values()].filter(c => c.agent_id === url.searchParams.get('agent_id')), next: null } })
      if (endpoint?.startsWith('/conversations/')) {
        const conversation = conversations.get(endpoint.split('/')[2])
        return conversation ? route.fulfill({ json: conversation }) : route.fulfill({ status: 404, json: { detail: 'chatgpt_turn_not_found' } })
      }
      if (endpoint === '/chat') {
        const body = request.postDataJSON(); sends.push(body)
        assert.ok(agents.some(a => a.id === body.agent.id && a.revision === body.agent.revision))
        const id = crypto.randomUUID(), run = { id, status: 'completed', text: `Reply for ${body.agent.id}`, sequence: 3 }
        conversations.set(body.conversation_id, { id: body.conversation_id, title: body.messages.at(-1).content, agent_id: body.agent.id, selection, revision: 1, next: null, run, messages: [{ id, role: 'user', content: body.messages.at(-1).content }, { id, role: 'assistant', content: run.text, status: 'completed' }] })
        return route.fulfill({ status: 202, json: run })
      }
      if (endpoint?.startsWith('/chat/')) {
        const run = [...conversations.values()].find(c => c.run.id === endpoint.split('/')[2]).run
        return endpoint.endsWith('/events') ? route.fulfill({ contentType: 'text/event-stream', body: `event: run\nid: 3\ndata: ${JSON.stringify(run)}\n\n` }) : route.fulfill({ json: run })
      }
      assert.ok(['GET', 'HEAD'].includes(method), `Unexpected write: ${url}`)
      return route.fulfill({ json: {} })
    })
    const open = async () => { await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=automation&lang=${lang}`); await page.getByTestId('ai-toggle').click() }
    await open()
    const panel = page.getByTestId('ai-chat'), dialog = panel.locator('dialog'), composer = panel.locator('#wm-ai-input')
    await panel.getByRole('button', { name: say('Cài đặt trợ lý', 'Assistant settings'), exact: true }).click()
    assert.equal(await dialog.getByLabel(say('Tên', 'Name'), { exact: true }).getAttribute('readonly'), '')
    assert.equal(await dialog.getByLabel(say('Mô tả', 'Description'), { exact: true }).getAttribute('readonly'), '')
    await dialog.getByRole('button', { name: say('Đóng', 'Close'), exact: true }).click()
    await composer.fill('Mentor chat'); await composer.press('Enter')
    await panel.getByText('Reply for mentor', { exact: true }).waitFor()
    await panel.getByRole('button', { name: say('Chat gần đây', 'Recent chats'), exact: true }).click()
    const geometry = await panel.evaluate(p => { const bounds = p.getBoundingClientRect(); return [...p.querySelectorAll('.wm-ai-history h3,.wm-ai-history li')].map(el => { const rect = el.getBoundingClientRect(); return { inset: rect.left - bounds.left, gap: bounds.right - rect.right } }) })
    assert.ok(geometry.length > 1 && geometry.every(r => r.inset <= 1.1 && r.gap <= 1.1), 'History rules span panel width')
    await page.screenshot({ path: path.join(evidence, `history-${lang}-${width}.png`) })
    await panel.getByRole('button', { name: say('Tạo agent', 'Create agent'), exact: true }).click()
    await dialog.getByLabel(say('Tên', 'Name'), { exact: true }).fill('Breakout')
    await dialog.getByLabel(say('Mô tả', 'Description'), { exact: true }).fill('Trade lifecycle rules')
    await dialog.getByLabel(say('Hướng dẫn trả lời', 'Instructions'), { exact: true }).fill('Explain entry, risk and exit.')
    assert.match(await dialog.getByRole('link').getAttribute('href'), /Strategy-File-Sample-Template/)
    const upload = dialog.locator('input[type=file]')
    await upload.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') })
    await dialog.getByRole('alert').waitFor()
    await upload.setInputFiles({ name: 'rules.md', mimeType: 'text/markdown', buffer: Buffer.from('Risk: 0.5%. Skip news.') })
    await dialog.getByText('rules.md', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `create-${lang}-${width}.png`) })
    await dialog.getByRole('button', { name: say('Tạo', 'Create'), exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByLabel(say('Tên', 'Name'), { exact: true }).inputValue(), 'Breakout', 'Failed save retains draft')
    await dialog.getByRole('button', { name: say('Tạo', 'Create'), exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await panel.locator('.wm-ai-create').count(), 0)
    await panel.getByRole('button', { name: say('Chọn agent', 'Choose agent'), exact: true }).click()
    await panel.getByRole('menuitem', { name: say('Tạo agent', 'Create agent'), exact: false }).waitFor()
    await page.screenshot({ path: path.join(evidence, `agents-${lang}-${width}.png`) })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.wm-ai-agent-trigger')?.getAttribute('aria-expanded') === 'false')
    assert.equal(await panel.getByRole('button', { name: say('Chọn agent', 'Choose agent'), exact: true }).getAttribute('aria-expanded'), 'false')
    await composer.fill('Custom chat'); await composer.press('Enter')
    await panel.getByText(`Reply for ${agents[1].id}`, { exact: true }).waitFor()
    assert.equal(sends[1].messages.length, 1, 'Selecting agent starts a separate conversation')
    assert.equal(agents[1].knowledge[0].text, 'Risk: 0.5%. Skip news.')
    await page.reload(); await page.getByTestId('ai-toggle').click()
    await panel.getByText(`Reply for ${agents[1].id}`, { exact: true }).waitFor()
    await panel.getByRole('button', { name: say('Cài đặt trợ lý', 'Assistant settings'), exact: true }).click()
    assert.equal(await dialog.getByLabel(say('Tên', 'Name'), { exact: true }).getAttribute('readonly'), null)
    await dialog.getByLabel(say('Tên', 'Name'), { exact: true }).fill('Edited Breakout')
    await dialog.getByRole('button', { name: say('Lưu', 'Save'), exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await composer.fill('After edit'); await composer.press('Enter')
    await panel.getByText(`Reply for ${agents[1].id}`, { exact: true }).nth(1).waitFor()
    assert.equal(sends.at(-1).agent.revision, 2)
    await panel.getByRole('button', { name: say('Chọn agent', 'Choose agent'), exact: true }).click()
    await panel.getByRole('menuitemradio', { name: 'Mentor', exact: false }).click()
    await panel.getByRole('button', { name: say('Chat gần đây', 'Recent chats'), exact: true }).click()
    await panel.locator('.wm-ai-history-open').getByText('Mentor chat', { exact: true }).waitFor()
    assert.equal(await panel.locator('.wm-ai-history-open').count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    report.checks.push({ width, lang, passed: true, sends: sends.length })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
} finally { await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report))
