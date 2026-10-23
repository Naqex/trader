import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5188'
const evidence = process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ai-chat-continuation-20261023/browser'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Production UI with isolated API fixtures; no provider inference or configuration writes', checks: [], errors: [] }
try {
  for (const width of [360, 768, 1440]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), sends = [], runs = new Map()
    const say = (vi, en) => lang === 'en' ? en : vi
    const selection = { provider: 'local-gateway', model: 'route-high', effort: null }
    const models = [{ id: 'route-high', name: 'Friendly Gemini', efforts: ['low', 'medium', 'high'] }]
    let conversation = null, current = null, hold = 'thinking', olderPage = null, dropSubmission = false, failRead = false
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.split('/ai/assistant')[1], method = request.method()
      if (endpoint === '/account') return route.fulfill({ json: { provider: 'local-gateway', ready: true, selection, models } })
      if (endpoint === '/catalog') return route.fulfill({ json: { routes: [{ provider: 'local-gateway', ready: true, models }] } })
      if (endpoint === '/profiles') return route.fulfill({ json: { items: [], chat_default: { selection } } })
      if (endpoint === '/conversations') return route.fulfill({ json: { items: conversation ? [{ id: conversation.id, title: 'Fixture conversation', selection: conversation.selection }] : [], next: null } })
      if (endpoint?.startsWith('/conversations/')) {
        if (failRead) { failRead = false; return route.fulfill({ status: 503, json: { detail: 'ai_request_failed' } }) }
        return route.fulfill({ json: url.searchParams.has('before_id') ? olderPage : conversation })
      }
      if (endpoint === '/chat' && method === 'POST') {
        const body = request.postDataJSON(); sends.push(body)
        const replay = [...runs.values()].find(run => run.request_key === body.idempotency_key)
        if (replay) return route.fulfill({ status: 202, json: replay })
        const run = { id: crypto.randomUUID(), conversation_id: body.conversation_id, request_key: body.idempotency_key, sequence: 2, status: 'running', selection: { model: body.expected_selection.model, effort: body.expected_selection.effort }, provider: body.expected_selection.provider, continuation_of: body.continuation_of || null, phase: hold === 'thinking' ? 'thinking' : 'answering', text: hold === 'text' ? 'Đang viết ' : '' }
        current = run; runs.set(run.id, run)
        if (!conversation) conversation = { id: body.conversation_id, title: 'Fixture conversation', next: null, revision: 1, messages: [] }
        conversation.selection = body.expected_selection; conversation.run = run
        if (!body.continuation_of) conversation.messages.push({ role: 'user', content: body.messages.at(-1).content, id: run.id, status: 'running' })
        if (dropSubmission) { dropSubmission = false; return route.abort('failed') }
        return route.fulfill({ status: 202, json: run })
      }
      if (endpoint?.startsWith('/chat/')) {
        const run = runs.get(endpoint.split('/')[2]); assert.ok(run)
        if (method === 'DELETE' || (hold === 'complete' && run.status === 'running')) {
          run.status = method === 'DELETE' ? 'cancelled' : 'completed'; run.sequence++
          if (run.status === 'completed') run.text = run.continuation_of ? 'phần tiếp theo.' : 'Câu trả lời mới.'
          const previous = conversation.messages.at(-1)
          if (run.continuation_of && previous?.role === 'assistant') Object.assign(previous, { content: previous.content + run.text, id: run.id, status: run.status, phase: run.phase })
          else {
            if (previous?.role === 'user') previous.status = run.status
            conversation.messages.push({ role: 'assistant', id: run.id, content: run.text, status: run.status, phase: run.phase })
          }
        }
        if (endpoint.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: `event: run\nid: ${run.sequence}\ndata: ${JSON.stringify(run)}\n\n` })
        return route.fulfill({ json: run })
      }
      assert.ok(['GET', 'HEAD'].includes(method), `Forbidden write ${method} ${url.pathname}`)
      return route.fulfill({ json: {} })
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=automation&lang=${lang}`)
    await page.getByTestId('ai-toggle').click()
    const chat = page.getByTestId('ai-chat'), input = chat.locator('#wm-ai-input')
    await input.fill('Original question')
    const picker = chat.locator('.wm-ai-model-trigger')
    assert.match(await picker.innerText(), /Friendly Gemini/)
    await picker.click()
    const slider = chat.getByRole('slider', { name: say('Mức suy luận AI', 'AI reasoning effort') })
    await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight')
    await page.keyboard.press('Escape')
    await input.press('Enter')
    await chat.getByText(say('Đang suy nghĩ…', 'Thinking…'), { exact: true }).waitFor()
    assert.equal(sends[0].expected_selection.effort, 'low')
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).click()
    const resume = chat.getByRole('button', { name: say('Tiếp tục', 'Continue'), exact: true })
    await resume.waitFor()
    await chat.getByText(say('Đã dừng khi đang suy nghĩ.', 'Stopped while thinking.'), { exact: true }).waitFor()
    assert.equal(await input.isEnabled(), true)
    const firstId = current.id
    hold = 'complete'; await resume.click()
    await chat.getByText('phần tiếp theo.', { exact: true }).waitFor()
    assert.equal(sends[1].continuation_of, firstId)
    assert.equal(sends[1].conversation_id, sends[0].conversation_id)
    assert.equal(await chat.locator('.wm-ai-message.is-user').count(), 1, 'Continue does not invent a visible user bubble')
    hold = 'text'; await input.fill('Second question'); await input.press('Enter')
    await chat.getByText('Đang viết ', { exact: true }).waitFor()
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).click()
    await resume.waitFor()
    assert.equal(await chat.getByText('Đang viết ', { exact: true }).count(), 1)
    await page.reload(); await page.getByTestId('ai-toggle').click()
    await resume.waitFor(); await chat.getByText('Đang viết ', { exact: true }).waitFor()
    assert.equal(sends.length, 3, 'reload never resubmits')
    await input.fill('Draft to keep')
    hold = 'complete'; await resume.click()
    await chat.getByText('Đang viết phần tiếp theo.', { exact: true }).waitFor()
    assert.equal(await input.inputValue(), 'Draft to keep')
    assert.equal(sends[3].messages.at(-2).content, 'Đang viết ')
    await page.reload(); await page.getByTestId('ai-toggle').click()
    await chat.getByText('Đang viết phần tiếp theo.', { exact: true }).waitFor()
    assert.equal(await chat.locator('.wm-ai-message.is-user').count(), 2)
    hold = 'text'; await input.fill('Third question'); await input.press('Enter')
    await chat.getByText('Đang viết ', { exact: true }).waitFor()
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).click()
    await resume.waitFor(); hold = 'complete'; await input.fill('Different new prompt'); await input.press('Enter')
    await chat.getByText('Câu trả lời mới.', { exact: true }).waitFor()
    assert.equal(sends.at(-1).continuation_of, undefined)
    assert.equal(sends.at(-1).messages.at(-2).content, 'Đang viết ')
    assert.equal(await resume.count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(evidence, `chat-${lang}-${width}.png`) })
    await chat.getByRole('button', { name: say('Đóng chat AI', 'Close AI chat'), exact: true }).click()
    await page.getByTestId('theme-toggle').click(); await page.getByTestId('ai-toggle').click()
    await chat.getByText('Câu trả lời mới.', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `chat-light-${lang}-${width}.png`) })
    const oldId = crypto.randomUUID(), stoppedId = crypto.randomUUID()
    olderPage = { messages: [{ role: 'user', id: oldId, content: 'Older question', status: 'cancelled' }, { role: 'assistant', id: oldId, content: 'Phần đầu ', status: 'cancelled', continuation_of: null }], next: null }
    conversation.messages = [{ role: 'assistant', id: stoppedId, content: 'phần sau', status: 'cancelled', continuation_of: oldId }]
    conversation.run = { id: stoppedId, status: 'cancelled', text: 'phần sau', selection, continuation_of: oldId }
    conversation.next = { before_id: oldId, before_at: '2026-10-23T00:00:00Z' }
    await page.reload(); await page.getByTestId('ai-toggle').click()
    await chat.getByText('Phần đầu phần sau', { exact: true }).waitFor()
    assert.equal(await chat.locator('.is-user > div').innerText(), 'Older question')
    assert.equal(sends.length, 6, 'history restoration does not send inference')
    hold = 'complete'; await resume.click()
    await chat.getByText('Phần đầu phần sauphần tiếp theo.', { exact: true }).waitFor()
    assert.equal(sends.at(-1).messages[0].content, 'Older question')
    assert.equal(sends.at(-1).messages.at(-2).content, 'Phần đầu phần sau')
    conversation = null; olderPage = null; dropSubmission = true; failRead = true
    await chat.getByRole('button', { name: say('Cuộc trò chuyện mới', 'New chat'), exact: true }).click()
    await input.fill('Retry after lost POST response'); await input.press('Enter')
    await chat.locator('.wm-ai-error').waitFor()
    assert.equal(await input.inputValue(), 'Retry after lost POST response')
    await input.press('Enter')
    await chat.getByText('Câu trả lời mới.', { exact: true }).waitFor()
    assert.equal(sends.at(-1).idempotency_key, sends.at(-2).idempotency_key)
    assert.equal(await chat.locator('.is-user').count(), 1)
    assert.equal(await chat.locator('.is-assistant').count(), 1)
    report.checks.push({ width, lang, pass: true, submissions: sends.length })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
