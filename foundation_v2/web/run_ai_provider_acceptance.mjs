import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve('../evidence/ai-provider-integration-20261023/ui')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
try {
  for (const [width, language, theme] of [[1440, 'vi', 'dark'], [1440, 'en', 'light'], [360, 'vi', 'dark'], [360, 'en', 'light']]) {
    const en = language === 'en', say = (vi, english) => en ? english : vi
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' })
    await context.addInitScript(value => localStorage.setItem('tw-theme', value), theme)
    const page = await context.newPage(), failures = [], actions = [], sends = []
    let state = { provider: 'chatgpt-web', status: 'stopped', ready: false, models: [], selection: null, operation: null }
    let mode = 'empty', turn, accountReads = 0
    page.on('pageerror', failure => failures.push(failure.message))
    await page.route('**/api/v2/ai/chatgpt/account', route => route.fulfill({ json: { status: 'stopped', login_state_present: false, operation: null, models: [] } }))
    await page.route('**/api/v2/ai/assistant/**', async route => {
      const req = route.request(), suffix = new URL(req.url()).pathname.split('/assistant')[1]
      if (suffix.startsWith('/account')) {
        accountReads++
        const action = suffix.split('/')[2]
        if (action) actions.push(action)
        if (action === 'provider') state = { ...state, provider: req.postDataJSON().provider, endpoint: 'http://127.0.0.1:17852/v1', status: 'empty', models: [], ready: false }
        if (action === 'refresh') state = mode === 'auth'
          ? { ...state, status: 'unavailable', ready: false, error: 'ai_gateway_auth_failed', models: [], selection: null }
          : { ...state, status: 'catalog_ready', error: null, models: [{ id: 'gemini-fixture-pro', name: 'Gemini fixture Pro', efforts: [] }, { id: 'gemini-fixture-fast', name: 'Gemini fixture Fast', efforts: [] }] }
        if (action === 'selection') state = { ...state, selection: req.postDataJSON(), ready: true }
        return route.fulfill({ json: state })
      }
      if (suffix === '/chat') {
        sends.push(req.postDataJSON())
        turn = { id: `synthetic-${sends.length}`, status: 'running', provider: state.provider, selection: state.selection }
        return route.fulfill({ status: 202, json: turn })
      }
      if (req.method() === 'DELETE') turn = { ...turn, status: 'cancelled' }
      else if (mode === 'quota') turn = { ...turn, status: 'failed', error: 'ai_gateway_rate_limited' }
      else if (mode !== 'pending') turn = { ...turn, status: 'completed', text: 'Synthetic gateway response' }
      return route.fulfill({ json: turn })
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=settings&lang=${language}&theme=${theme}`)
    const settings = page.getByTestId('ai-provider-settings')
    await page.waitForFunction(value => document.querySelector('.fx-app')?.dataset.theme === value, theme)
    await settings.getByRole('button', { name: say('Nhà cung cấp AI', 'AI provider'), exact: true }).click()
    await settings.getByRole('option', { name: 'CLIProxyAPI local', exact: true }).click()
    await settings.getByText(say('Chưa có model', 'No models available'), { exact: true }).waitFor()
    assert.deepEqual(actions, ['provider'], 'switching provider never starts login or sends inference')
    mode = 'auth'
    await settings.getByRole('button', { name: say('Tải lại model', 'Refresh models'), exact: true }).click()
    await settings.getByText(say('Gateway từ chối khóa kết nối. Kiểm tra cấu hình máy chủ.', 'The gateway rejected the connection key. Check the server configuration.'), { exact: true }).waitFor()
    mode = 'success'
    await settings.getByRole('button', { name: say('Tải lại model', 'Refresh models'), exact: true }).click()
    await settings.getByRole('button', { name: 'Model AI', exact: true }).click()
    await settings.getByRole('option', { name: 'Gemini fixture Pro', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="ai-provider-settings"] .fx-select-trigger[aria-label="Model AI"]')?.textContent.includes('Gemini fixture Pro'))
    assert.equal(sends.length, 0)
    const reads = accountReads
    await page.waitForRequest(req => req.url().includes('/ai/assistant/account'), { timeout: 1800 })
      .then(() => assert.fail('idle provider settings must not poll')).catch(error => { if (error.name !== 'TimeoutError') throw error })
    assert.equal(accountReads, reads)
    await settings.screenshot({ path: path.join(evidence, `settings-${language}-${theme}-${width}.png`) })
    await page.getByTestId('ai-toggle').click()
    const chat = page.getByTestId('ai-chat')
    await chat.getByRole('button', { name: say('Model AI', 'AI model'), exact: true }).click()
    assert.equal(await chat.getByRole('slider').count(), 0, 'gateway does not invent reasoning capabilities')
    await page.keyboard.press('Escape')
    const input = chat.getByRole('textbox', { name: say('Tin nhắn cho AI', 'Message AI'), exact: true })
    await input.fill('Synthetic gateway question'); await input.press('Enter')
    await chat.getByText('Synthetic gateway response', { exact: true }).waitFor()
    assert.deepEqual(sends[0].expected_selection, { provider: 'local-gateway', model: 'gemini-fixture-pro', effort: null })
    assert.deepEqual(sends[0].context, { screen: 'settings', locale: language })
    mode = 'quota'
    await input.fill('Synthetic quota case'); await input.press('Enter')
    await chat.getByRole('alert').filter({ hasText: say('Model đang chạm hạn mức.', 'The model is rate limited.') }).waitFor()
    assert.equal(sends.length, 2, 'quota error does not resend or change provider')
    mode = 'pending'
    await input.fill('Synthetic cancellation case'); await input.press('Enter')
    await chat.getByRole('button', { name: say('Dừng phản hồi', 'Stop response'), exact: true }).click()
    await chat.getByText(say('Đã dừng chờ phản hồi.', 'Response stopped.'), { exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `chat-${language}-${theme}-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(failures, [])
    assert.ok(actions.every(action => ['provider', 'selection', 'refresh'].includes(action)))
    checks.push(`${width}px ${language}/${theme}: provider/model, empty/auth/quota, no implicit login/inference/retry, idle, no fabricated effort, send/cancel, expected selection, no overflow/page errors`)
    await context.close()
  }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'Product UI with labeled HTTP fixtures; no Google account or model inference', checks }, null, 2))
  console.log(JSON.stringify({ checks }))
} finally { await browser.close() }
