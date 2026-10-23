import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve(process.env.TW_AI_UI_EVIDENCE || '../evidence/ai-workspace-20261023/navigation')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
try {
  for (const [width, lang, theme] of [[1440, 'vi', 'dark'], [360, 'en', 'light']]) {
    const en = lang === 'en', say = (vi, english) => en ? english : vi
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' })
    await context.addInitScript(value => localStorage.setItem('tw-theme', value), theme)
    const page = await context.newPage(), errors = [], accountReads = [], mutations = [], resources = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => resources.push(request.url()))
    await page.route('**/api/v2/**', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname
      if (request.method() !== 'GET') { mutations.push(pathname); return route.fulfill({ status: 403, json: { detail: 'fixture_read_only' } }) }
      if (pathname.includes('/ai/') && pathname.endsWith('/account')) {
        accountReads.push(pathname)
        return route.fulfill({ json: { provider: 'chatgpt-web', status: 'stopped', login_state_present: false, operation: null, models: [] } })
      }
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    const visit = (view, section = '') => page.goto(`${origin}/?workspace=tenant-a&view=${view}&section=${section}&lang=${lang}&theme=${theme}`)
    const tab = name => page.locator('.fx-subnav').getByRole('link', { name, exact: true })
    await visit('ai')
    await page.getByTestId('ai-workspace').getByRole('heading', { name: 'Mentor', exact: true }).waitFor()
    assert.equal(await page.locator('.fx-subnav-link.is-active').innerText(), say('Trợ lý', 'Assistant'))
    assert.equal(accountReads.length, 0)
    assert.ok(!resources.some(url => /AiProviderSettings-.*\.js/.test(url)), 'provider chunk stays lazy on Assistant')
    const rail = page.locator('.fx-rail-ai')
    assert.equal((await rail.textContent()).trim(), say('AI và Bot', 'AI and Bots'))
    assert.equal(await rail.locator('svg').evaluate(el => getComputedStyle(el).width), '18px')
    assert.equal(await rail.evaluate(el => el.previousElementSibling.className), 'fx-rail-primary')
    assert.equal(await rail.evaluate(el => getComputedStyle(el).borderBottomWidth), '1px')
    if (width > 1000) {
      await page.getByRole('button', { name: 'Thu gọn điều hướng', exact: true }).click()
      assert.equal(await page.locator('.fx-app').evaluate(el => el.classList.contains('is-rail-collapsed')), true)
      await page.getByRole('button', { name: 'Mở rộng điều hướng', exact: true }).click()
    } else {
      await page.locator('.fx-menu-button').click()
      await rail.getByRole('link').click()
      assert.equal(await page.locator('.fx-app').evaluate(el => el.classList.contains('is-mobile-nav-open')), false)
    }
    await page.getByRole('button', { name: say('Mở trò chuyện', 'Open chat'), exact: true }).click()
    await page.getByTestId('ai-chat').getByRole('textbox').waitFor()
    await page.getByTestId('ai-chat').getByRole('button', { name: say('Đóng chat AI', 'Close AI chat'), exact: true }).click()
    const readsAfterChat = accountReads.length
    await tab(say('Tự động hóa', 'Automation')).click()
    await page.getByTestId('ai-workspace').locator('.ai-unavailable').first().waitFor()
    assert.equal(await page.getByTestId('ai-workspace').getByRole('button').count(), 0)
    assert.equal(accountReads.length, readsAfterChat, 'Automation does not read providers')
    await page.reload()
    await page.getByTestId('ai-workspace').locator('.ai-unavailable').first().waitFor()
    const readsBeforeConnections = accountReads.length
    await tab(say('Kết nối', 'Connections')).click()
    await page.getByTestId('chatgpt-account').getByText(say('Chưa khởi động', 'Not started'), { exact: true }).waitFor()
    assert.ok(accountReads.length > readsBeforeConnections)
    await page.getByTestId('chatgpt-account').getByRole('button', { name: say('Kết nối ChatGPT', 'Connect ChatGPT'), exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('lang'), lang)
    const idleReads = accountReads.length
    await page.waitForTimeout(1700)
    assert.equal(accountReads.length, idleReads, 'idle Connections does not poll')
    await page.screenshot({ path: path.join(evidence, `connections-${lang}-${width}.png`) })
    await page.goBack()
    await page.getByTestId('ai-workspace').locator('.ai-unavailable').first().waitFor()
    await page.goForward()
    await page.getByTestId('chatgpt-account').waitFor()
    await visit('ai', 'invalid')
    await page.getByTestId('ai-workspace').getByRole('heading', { name: 'Mentor', exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `assistant-${lang}-${width}.png`) })
    const beforeSettings = accountReads.length
    await visit('settings')
    await page.locator('.settings-ai-link').waitFor()
    assert.equal(await page.getByTestId('ai-provider-settings').count(), 0)
    assert.equal(accountReads.length, beforeSettings, 'general Settings no longer reads AI accounts')
    await page.locator('.settings-ai-link').click()
    await page.getByTestId('ai-provider-settings').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('section'), 'connections')
    assert.equal(new URL(page.url()).searchParams.get('workspace'), 'tenant-a')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(mutations, [], 'navigation never logs in, changes provider or submits inference')
    assert.deepEqual(errors, [])
    checks.push(`${width}px ${lang}/${theme}: sidebar placement, collapse/drawer, shared chat, lazy provider, no idle polling, navigation/reload/history, Settings migration, localization, no mutations/overflow/page errors`)
    await context.close()
  }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'Product UI with labeled read-only HTTP fixtures; no provider login or inference', checks }, null, 2))
  console.log(JSON.stringify({ checks }))
} finally { await browser.close() }
