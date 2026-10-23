import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_CHATGPT_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve(process.env.TW_CHATGPT_UI_EVIDENCE || '../.runtime/chatgpt-account-ui')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
const catalog = [{ id: 'chatgpt-web/gpt-6-sol', name: 'GPT-6 Sol (Web)', efforts: ['medium', 'high'] }]
const initial = { status: 'disconnected', models: [], selection: null, operation: null, login_state_present: false }
const connected = { ...initial, status: 'connected', login_state_present: true, models: catalog, selection: { model: catalog[0].id, effort: 'high' } }

try {
  // Actual Workspace API -> Rust -> owned Bun bridge. No mocked login or external inference.
  if (process.env.TW_CHATGPT_INTEGRATED === '1') {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/?workspace=tenant-a&view=settings`)
    await page.getByTestId('chatgpt-account').getByText('Chưa khởi động', { exact: true }).waitFor()
    const call = (action, body = {}) => page.evaluate(async ({ action, body }) => {
      const response = await fetch(`/api/v2/ai/chatgpt/account${action ? `/${action}` : ''}`, {
        method: action ? 'POST' : 'GET', headers: { 'X-Workspace-Id': 'tenant-a', 'Content-Type': 'application/json' },
        ...(action ? { body: JSON.stringify(body) } : {}),
      })
      return { status: response.status, body: await response.json() }
    }, { action, body })
    assert.equal((await call('start')).body.status, 'disconnected')
    assert.equal((await call('selection', { model: catalog[0].id, effort: 'high' })).status, 400)
    assert.equal((await call('probe')).status, 400)
    await page.getByTestId('chatgpt-account').getByRole('button', { name: 'Làm mới' }).click()
    await page.getByTestId('chatgpt-account').getByText('Chưa đăng nhập', { exact: true }).waitFor()
    const denied = await page.evaluate(async () => (await fetch('/api/v2/ai/chatgpt/account', { headers: { 'X-Workspace-Id': 'foreign' } })).status)
    assert.equal(denied, 403)
    await page.screenshot({ path: path.join(evidence, 'integrated-disconnected.png') })
    checks.push('Real isolated API starts owned core, denies missing login and foreign workspace, renders disconnected state')
    await context.close()
  }
  for (const width of [360, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } })
    const page = await context.newPage()
    let state = structuredClone(initial), mode = '', polls = 0
    const actions = [], pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/api/v2/ai/assistant/account', route => route.fulfill({ json: { ...state, provider: 'chatgpt-web' } }))
    await page.route('**/api/v2/ai/chatgpt/account**', async route => {
      const request = route.request(), suffix = new URL(request.url()).pathname.split('/account')[1]
      const action = suffix?.slice(1)
      if (!action && mode === 'denied') return route.fulfill({ status: 403, json: { detail: 'workspace_access_denied' } })
      if (!action && mode === 'stale') return route.fulfill({ status: 503, json: { detail: 'offline' } })
      if (action) actions.push({ action, body: request.postDataJSON() })
      if (action === 'login') { polls = 0; state = { ...initial, status: 'waiting_for_browser', operation: { kind: 'login' } } }
      if (action === 'cancel') state = structuredClone(initial)
      if (action === 'selection') state = { ...connected, selection: request.postDataJSON(), test: null }
      if (action === 'probe') { polls = 0; state = { ...connected, status: 'testing', operation: { kind: 'probe' } } }
      if (!action && state.operation && ++polls >= 2 && mode !== 'wait') state = state.operation.kind === 'probe'
        ? { ...connected, test: { ...connected.selection, at: new Date().toISOString() } } : structuredClone(connected)
      if (action === 'disconnect') state = structuredClone(initial)
      await route.fulfill({ status: action === 'login' || action === 'probe' ? 202 : 200, json: state })
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=settings`)
    const section = page.getByTestId('chatgpt-account')
    await section.getByText('Chưa đăng nhập', { exact: true }).waitFor()
    // Keyboard activation exercises the same button that pointer users see.
    await section.getByRole('button', { name: 'Kết nối ChatGPT' }).focus()
    await page.keyboard.press('Enter')
    await section.getByText('Đang chờ bạn đăng nhập', { exact: true }).waitFor()
    await section.getByRole('button', { name: 'Kiểm tra kết nối' }).waitFor({ timeout: 10000 })
    await section.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
    await section.getByText(/Đã nhận phản hồi/).waitFor({ timeout: 10000 })
    await section.getByRole('button', { name: 'Mức suy luận ChatGPT' }).click()
    await page.getByRole('option', { name: 'Vừa', exact: true }).click()
    assert.deepEqual(actions.at(-1), { action: 'selection', body: { model: catalog[0].id, effort: 'medium' } })
    await page.screenshot({ path: path.join(evidence, `connected-${width}.png`), fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert.equal(overflow, false)
    await section.getByRole('button', { name: 'Ngắt kết nối' }).click()
    mode = 'wait'
    await section.getByRole('button', { name: 'Kết nối ChatGPT' }).click()
    await section.getByRole('button', { name: 'Hủy đăng nhập' }).click()
    await section.getByText('Chưa đăng nhập', { exact: true }).waitFor()
    await section.getByRole('button', { name: 'Kết nối ChatGPT' }).click()
    mode = 'stale'
    await section.getByText('Trạng thái chưa cập nhật', { exact: true }).waitFor({ timeout: 5000 })
    mode = ''; state = structuredClone(initial)
    await section.getByRole('button', { name: 'Làm mới' }).click()
    await section.getByText('Chưa đăng nhập', { exact: true }).waitFor()
    mode = 'denied'
    await page.reload()
    await section.getByText('Workspace này không có quyền quản lý kết nối.').waitFor()
    assert.equal(await section.getByRole('button', { name: 'Kết nối ChatGPT' }).isDisabled(), true)
    assert.deepEqual(pageErrors, [])
    checks.push(`${width}px fixture: login/poll, test, model effort, disconnect, keyboard, cancel, stale/recovery, denied; no overflow or page errors`)
    await context.close()
  }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'isolated-runtime + labeled UI fixtures; no real account login/inference', checks }, null, 2))
  console.log(JSON.stringify({ checks }))
} finally { await browser.close() }
