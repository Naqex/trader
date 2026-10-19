import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_CHATGPT_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve('../.runtime/ai-chat-ui')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
const models = [
  { id: 'chatgpt-web/gpt-6-sol', name: 'GPT-6 Sol', efforts: ['medium', 'high'] },
  { id: 'chatgpt-web/gpt-6-sol-instant', name: 'GPT-6 Sol Instant', efforts: ['low'] },
]
const account = { status: 'connected', models, selection: { model: models[0].id, effort: 'high' }, login_state_present: true, operation: null }
try {
  if (process.env.TW_CHATGPT_CHAT_LIVE_UI === '1') {
    const context = await browser.newContext({ viewport: { width: 1368, height: 790 } })
    const page = await context.newPage()
    await page.goto(`${origin}/?workspace=tenant-a&view=playbook&area=strategies&section=my-strategies`)
    await page.getByTestId('ai-toggle').click()
    const chat = page.getByTestId('ai-chat')
    const load = chat.getByRole('button', { name: 'Nạp kết nối đã lưu' })
    const state = await page.evaluate(async () => (await fetch('/api/v2/ai/chatgpt/account', { headers: { 'X-Workspace-Id': 'tenant-a' } })).json())
    if (state.status === 'stopped') await load.click()
    await chat.getByRole('button', { name: 'Model AI', exact: true }).waitFor()
    await page.locator('.pb-empty').waitFor()
    const result = await page.evaluate(async () => {
      const headers = { 'X-Workspace-Id': 'tenant-a', 'Content-Type': 'application/json' }
      const invalid = await fetch('/api/v2/ai/chatgpt/chat', { method: 'POST', headers, body: JSON.stringify({ messages: [], tools: [] }) })
      const absent = await fetch('/api/v2/ai/chatgpt/chat/not-a-turn', { headers })
      return [invalid.status, absent.status]
    })
    assert.deepEqual(result, [422, 404])
    await page.screenshot({ path: path.join(evidence, 'actual-local-connected.png') })
    checks.push('Actual local API/UI: saved connection loaded, model/effort available, invalid chat rejected, missing turn isolated; no external inference')
    await context.close()
  }
  for (const width of [360, 768, 1368]) {
    const context = await browser.newContext({ viewport: { width, height: 790 } })
    const page = await context.newPage()
    const failures = [], sends = [], cancellations = []
    let state = structuredClone(account), turn = null, mode = 'success', reads = 0
    page.on('pageerror', error => failures.push(error.message))
    await page.route('**/api/v2/ai/chatgpt/**', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method()
      assert.ok(['tenant-a', 'tenant-b'].includes(req.headers()['x-workspace-id']))
      const endpoint = url.pathname.split('/chatgpt')[1]
      if (endpoint === '/account' || endpoint.startsWith('/account/')) {
        reads++
        if (mode === 'denied') return route.fulfill({ status: 403, json: { detail: 'workspace_access_denied' } })
        if (endpoint.endsWith('/selection')) state.selection = req.postDataJSON()
        return route.fulfill({ json: state })
      }
      if (endpoint === '/chat') {
        sends.push(req.postDataJSON())
        turn = { id: `fixture-${sends.length}`, status: 'running', selection: state.selection }
        return route.fulfill({ status: 202, json: turn })
      }
      assert.ok(endpoint.startsWith('/chat/'))
      if (method === 'DELETE') { cancellations.push(endpoint); turn = { ...turn, status: 'cancelled' } }
      else if (mode === 'success') turn = { ...turn, status: 'completed', text: sends.length === 1 ? 'Đây là phản hồi kiểm thử giao diện.' : 'Tôi đã nhận câu hỏi tiếp theo.' }
      else if (mode === 'failure') turn = { ...turn, status: 'failed', error: 'chatgpt_response_failed' }
      await route.fulfill({ json: turn })
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=playbook&area=strategies&section=my-strategies`)
    const toggle = page.getByTestId('ai-toggle'), chat = page.getByTestId('ai-chat')
    await toggle.waitFor()
    assert.equal(reads, 0, 'closed chat does no provider work')
    await toggle.focus(); await page.keyboard.press('Enter')
    await chat.getByRole('button', { name: 'Model AI', exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `empty-dark-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const bounds = await chat.boundingBox()
    assert.equal(Math.round(bounds.x + bounds.width), width)
    assert.equal(bounds.y, 0)
    const input = chat.getByRole('textbox', { name: 'Tin nhắn cho AI' })
    await input.fill('Giải thích expectancy bằng một ví dụ đơn giản.')
    await input.press('Enter')
    await chat.getByText('Đây là phản hồi kiểm thử giao diện.', { exact: true }).waitFor()
    assert.deepEqual(sends[0], { messages: [{ role: 'user', content: 'Giải thích expectancy bằng một ví dụ đơn giản.' }] })
    await chat.getByRole('button', { name: 'Đóng chat AI' }).click()
    await page.waitForFunction(() => document.activeElement?.dataset.testid === 'ai-toggle')
    await toggle.click()
    await chat.getByText('Đây là phản hồi kiểm thử giao diện.', { exact: true }).waitFor()
    await input.fill('Cho tôi thêm một ví dụ.')
    await input.press('Enter')
    await chat.getByText('Tôi đã nhận câu hỏi tiếp theo.', { exact: true }).waitFor()
    assert.equal(sends[1].messages.length, 3)
    assert.equal(sends[1].messages[1].role, 'assistant')
    await chat.getByRole('button', { name: 'Model AI', exact: true }).click()
    await chat.getByRole('option', { name: 'GPT-6 Sol Instant', exact: true }).click()
    assert.equal(state.selection.model, models[1].id)
    assert.equal(state.selection.effort, 'low')
    await page.screenshot({ path: path.join(evidence, `conversation-dark-${width}.png`) })
    mode = 'wait'
    await input.fill('Tin nhắn đang chờ kiểm thử.'); await input.press('Enter')
    await chat.getByRole('button', { name: 'Dừng phản hồi' }).click()
    await chat.getByText('Đã dừng chờ phản hồi.', { exact: true }).waitFor()
    assert.equal(cancellations.length, 1)
    mode = 'failure'
    await input.fill('Tin nhắn lỗi kiểm thử.'); await input.press('Enter')
    await chat.getByRole('alert').waitFor()
    assert.equal(sends.at(-1).messages.length, 5, 'cancelled message excluded from subsequent context')
    assert.equal(await chat.getByRole('button', { name: 'Gửi tin nhắn' }).isDisabled(), true)
    await chat.getByRole('button', { name: 'Cuộc trò chuyện mới' }).click()
    assert.equal(await chat.locator('.wm-ai-message').count(), 0)
    await input.focus(); await page.keyboard.press('Escape')
    assert.equal(await chat.isVisible(), false)
    await page.waitForFunction(() => document.activeElement?.dataset.testid === 'ai-toggle')
    await page.getByTestId('theme-toggle').click(); await toggle.click()
    await page.screenshot({ path: path.join(evidence, `empty-light-${width}.png`) })
    if (width <= 1100) {
      assert.equal(await page.locator('.fx-main').evaluate(item => item.inert), true)
      const close = chat.getByRole('button', { name: 'Đóng chat AI' })
      await close.focus(); await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement.closest('#wm-ai-chat') !== null), true)
    }
    await chat.getByRole('button', { name: 'Đóng chat AI' }).click()
    state = { status: 'disconnected', login_state_present: false, models: [], selection: null }
    await toggle.click()
    await chat.getByText('Kết nối ChatGPT để bắt đầu trò chuyện.', { exact: true }).waitFor()
    assert.equal(await input.isDisabled(), true)
    assert.ok((await chat.getByRole('link', { name: 'Mở Cài đặt AI' }).getAttribute('href')).includes('workspace=tenant-a'))
    await page.screenshot({ path: path.join(evidence, `disconnected-${width}.png`) })
    mode = 'denied'
    await chat.getByRole('button', { name: 'Đóng chat AI' }).click(); await toggle.click()
    await chat.getByRole('alert').filter({ hasText: 'Workspace này chưa được cấp quyền dùng AI.' }).waitFor()
    assert.equal(await input.isDisabled(), true)
    assert.deepEqual(failures, [])
    if (width === 1368) {
      mode = 'wait'; state = structuredClone(account)
      await chat.getByRole('button', { name: 'Đóng chat AI' }).click(); await toggle.click()
      await input.fill('Workspace isolation fixture.'); await input.press('Enter')
      await chat.getByRole('button', { name: 'Dừng phản hồi' }).waitFor()
      await page.evaluate(() => { history.pushState({}, '', '/?workspace=tenant-b&view=playbook'); dispatchEvent(new PopStateEvent('popstate')) })
      await page.waitForFunction(() => document.querySelectorAll('.wm-ai-message').length === 0)
      await page.waitForFunction(() => document.querySelector('.wm-ai-composer textarea')?.value === '')
      await page.waitForTimeout(150)
      assert.equal(cancellations.length, 2, 'workspace change cancels previous turn')
      await chat.getByRole('link', { name: 'Cài đặt AI', exact: true }).click()
      assert.equal(await chat.isVisible(), false, 'settings link reveals the settings page')
      await page.evaluate(() => { history.pushState({}, '', '/?workspace=tenant-b&view=replay&surface=workspace'); dispatchEvent(new PopStateEvent('popstate')) })
      await page.locator('.fx-chart-topbar').waitFor()
      await toggle.click()
      await chat.getByRole('button', { name: 'Model AI', exact: true }).waitFor()
      await page.screenshot({ path: path.join(evidence, 'replay-shell-chat.png') })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      checks.push('SPA workspace switch clears transcript/draft and cancels exact turn; Settings reveals page; Replay topbar opens chat without overflow')
    }
    checks.push(`${width}px: keyboard/focus, empty + conversation dark/light, upstream model/effort, send/history, close/reopen, cancellation, error, new chat, disconnected/denied, no overflow or page errors`)
    await context.close()
  }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'UI fixtures only; no real ChatGPT request', checks }, null, 2))
  console.log(JSON.stringify({ checks }))
} finally { await browser.close() }
