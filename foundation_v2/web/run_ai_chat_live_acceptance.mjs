import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

// Explicit opt-in: two synthetic questions to the account already connected in this product.
assert.equal(process.env.TW_CHATGPT_LIVE_ACCEPTANCE, '1', 'Set TW_CHATGPT_LIVE_ACCEPTANCE=1 to use the saved account')
const origin = process.env.TW_CHATGPT_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve('../.runtime/ai-chat-live')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { checks: [], turns: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1368, height: 790 } })
  page.on('pageerror', error => report.errors.push(error.message))
  let sends = 0
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/ai/assistant/chat') sends++ })
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
  await page.getByTestId('ai-toggle').click()
  const chat = page.getByTestId('ai-chat')
  const state = await page.evaluate(async () => (await fetch('/api/v2/ai/assistant/account', { headers: { 'X-Workspace-Id': 'tenant-a' } })).json())
  assert.equal(state.provider, 'chatgpt-web', 'This opt-in test is only authorized for the selected WebGPT provider')
  if (state.status === 'stopped') await chat.getByRole('button', { name: 'Nạp kết nối đã lưu' }).click()
  await chat.getByRole('button', { name: 'Model và mức suy luận AI', exact: true }).waitFor()
  for (const [index, question] of ['Chào Mentor. Hãy trả lời đúng hai từ: REPLAY READY', 'Tôi vừa yêu cầu bạn trả lời hai từ gì? Chỉ nhắc lại hai từ đó.'].entries()) {
    const started = Date.now()
    await chat.getByRole('textbox', { name: 'Tin nhắn cho AI' }).fill(question)
    await chat.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click()
    await page.waitForFunction(expected => {
      const panel = document.querySelector('#wm-ai-chat')
      return panel.querySelectorAll('.is-assistant').length >= expected || !!panel.querySelector('.wm-ai-error')
    }, index + 1, { timeout: 195000 })
    const error = await chat.locator('.wm-ai-error').count() ? await chat.locator('.wm-ai-error').textContent() : null
    assert.equal(error, null, error || 'unexpected chat failure')
    const answer = await chat.locator('.is-assistant > div').nth(index).innerText()
    assert.equal(answer.trim(), 'REPLAY READY')
    assert.doesNotMatch(answer, /codex_context|codex_transport|Local tools unavailable|MCP|assistant instructions|app_context/)
    assert.equal(sends, index + 1, 'one submission per question; no resend')
    report.turns.push({ question, answer, elapsed_ms: Date.now() - started, submissions: 1 })
    await page.screenshot({ path: path.join(evidence, `turn-${index + 1}.png`) })
  }
  assert.deepEqual(report.errors, [])
  report.checks.push('Cold saved-connection start and follow-up: each answer arrives after one send, history retained, no harness/transcript text, no page errors')
} catch (error) {
  report.errors.push(String(error))
  throw error
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
