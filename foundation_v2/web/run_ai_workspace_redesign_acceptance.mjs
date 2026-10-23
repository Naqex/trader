import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5187'
const evidence = path.resolve(process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ui-ai-bot-20261023/fixtures')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true }), checks = []
try {
  for (const width of [1440, 768, 360]) for (const lang of ['vi', 'en']) {
    const en = lang === 'en', say = (vi, english) => en ? english : vi
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), en ? 'light' : 'dark')
    const page = await context.newPage(), errors = [], writes = [], resources = []
    let reads = 0, failGateway = false, operation = null, stopped = false
    const models = [{ id: 'pro', name: 'Fixture Pro', efforts: [] }, { id: 'fast', name: 'Fixture Fast', efforts: [] }]
    const selection = { provider: 'local-gateway', model: 'pro', effort: null }
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => resources.push(request.url()))
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname, method = request.method()
      if (method !== 'GET') writes.push(pathname)
      if (pathname.includes('/assistant/connections/')) {
        reads++
        const [provider, action] = pathname.split('/connections/')[1].split('/')
        if (provider === 'local-gateway') {
          if (action === 'login') operation = { kind: 'login', auth_url: null }
          if (action === 'cancel') operation = null
          if (action === 'stop') stopped = true
          if (action === 'start') stopped = false
          if (failGateway) return route.fulfill({ status: 503, json: { detail: 'ai_gateway_unavailable' } })
          return route.fulfill({ json: { provider, status: stopped ? 'unavailable' : 'catalog_ready', error: stopped ? 'ai_gateway_unavailable' : null, operation, models: operation || stopped ? [] : models, selection, runtime: { managed: true, running: !stopped, external: false, accounts: 2, management_available: true, management_version: 'v1.26.7', management_url: stopped ? null : 'http://127.0.0.1:17852/management.html' }, endpoint: 'http://127.0.0.1:17852/v1' } })
        }
        return route.fulfill({ json: { provider, status: 'stopped', login_state_present: null, models: [], operation: null } })
      }
      if (pathname.endsWith('/assistant/account')) return route.fulfill({ json: { provider: 'local-gateway', status: 'catalog_ready', models, selection } })
      if (pathname.endsWith('/assistant/catalog')) return route.fulfill({ json: { routes: [{ provider: 'local-gateway', models, ready: true }] } })
      if (pathname.endsWith('/assistant/profiles')) return route.fulfill({ json: { items: [{ feature: 'system', role: 'default', revision: 1, selection }], chat_default: { selection } } })
      if (pathname.endsWith('/assistant/conversations')) return route.fulfill({ json: { items: [], next: null } })
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    const visit = section => page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=${section}&lang=${lang}`)
    const tab = name => page.locator('.fx-subnav').getByRole('link', { name, exact: true })
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&lang=${lang}`)
    const gateway = page.getByTestId('connection-local-gateway')
    await gateway.getByText(say('2 tài khoản đã lưu', '2 saved accounts'), { exact: false }).waitFor()
    assert.equal(await page.locator('.ai-connection-row').count(), 2)
    assert.equal(await tab(say('Kết nối', 'Connections')).getAttribute('aria-current'), 'page')
    assert.equal(await page.locator('.ai-model-profile-row').count(), 0)
    assert.equal(await page.getByRole('button', { name: say('Nhà cung cấp AI', 'AI provider'), exact: true }).count(), 0)
    assert.ok(!resources.some(url => /AiModelProfiles/.test(url)), 'model configuration stays lazy')
    assert.deepEqual(writes, [], 'opening connections never mutates provider or starts login')
    await gateway.getByRole('button').click()
    const drawer = page.getByRole('dialog', { name: 'CLIProxyAPI', exact: true })
    await drawer.waitFor()
    const management = drawer.getByRole('link', { name: say('Mở trang quản trị', 'Open management'), exact: false })
    assert.equal(new URL(await management.getAttribute('href'), origin).searchParams.get('section'), 'gateway')
    assert.equal(await management.getAttribute('target'), null)
    await drawer.getByText(say('Chưa có dữ liệu', 'No data'), { exact: true }).waitFor()
    assert.equal(await drawer.locator('input').count(), 0, 'no editable endpoint or secrets')
    assert.equal(await drawer.getByText('http://127.0.0.1:17852/v1', { exact: true }).isVisible(), false)
    await drawer.locator('summary').click()
    assert.equal(await drawer.getByText('http://127.0.0.1:17852/v1', { exact: true }).isVisible(), true)
    await drawer.getByRole('button', { name: say('Tải lại model', 'Refresh models'), exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.ai-connection-drawer .ai-connection-actions button')?.disabled)
    assert.deepEqual(writes, ['/api/v2/ai/assistant/connections/local-gateway/refresh'])
    await drawer.getByRole('button', { name: say('Thêm tài khoản Google', 'Add Google account'), exact: true }).click()
    await drawer.getByRole('button', { name: say('Hủy', 'Cancel'), exact: true }).click()
    await drawer.getByRole('button', { name: say('Thêm tài khoản Google', 'Add Google account'), exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `details-${lang}-${width}.png`) })
    await page.keyboard.press('Escape')
    assert.equal(await drawer.count(), 0)
    assert.equal(await gateway.getByRole('button').evaluate(button => button === document.activeElement), true, 'drawer restores focus')
    const idleReads = reads
    await page.waitForTimeout(1700)
    assert.equal(reads, idleReads, 'idle connections do not poll')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(evidence, `connections-${lang}-${width}.png`) })
    failGateway = true
    await page.getByRole('button', { name: say('Làm mới', 'Refresh'), exact: true }).click()
    await gateway.getByText(say('Chưa cập nhật được', 'Update failed'), { exact: true }).waitFor()
    await page.getByTestId('connection-chatgpt-web').getByText(say('Chưa khởi động', 'Not started'), { exact: true }).waitFor()
    await gateway.getByRole('button').click()
    await drawer.getByRole('alert').waitFor()
    await page.keyboard.press('Escape'); failGateway = false
    await tab(say('Model', 'Models')).click()
    await page.getByRole('heading', { name: say('Model', 'Models'), exact: true }).waitFor()
    await page.getByRole('button', { name: say('Trò chuyện', 'Chat'), exact: true }).getByText(/Fixture Pro/).waitFor()
    assert.equal(await page.locator('[data-profile="evidence-review/analyst"]').isVisible(), false)
    await page.locator('.ai-workflow-profiles summary').click()
    assert.equal(await page.locator('[data-profile="evidence-review/analyst"]').isVisible(), true)
    await page.screenshot({ path: path.join(evidence, `models-${lang}-${width}.png`) })
    await tab(say('Bot', 'Bots')).click()
    await page.locator('.ai-bots-empty').waitFor()
    assert.equal(await page.getByTestId('ai-workspace').getByRole('button').count(), 0, 'no pretend bot actions')
    assert.equal(await tab(say('Trò chuyện', 'Chat')).count(), 0)
    await page.getByTestId('ai-toggle').click()
    const chat = page.getByTestId('ai-chat')
    await chat.getByRole('textbox').waitFor()
    await page.waitForFunction(() => !document.querySelector('#wm-ai-input').disabled)
    assert.equal(await chat.count(), 1)
    assert.equal(await chat.getAttribute('aria-modal'), width <= 1100 ? 'true' : null)
    assert.equal(await chat.locator('[data-chat-close]').count(), 1)
    assert.equal(await page.locator('.wm-ai-backdrop').count(), width <= 1100 ? 1 : 0)
    assert.equal(await chat.evaluate(node => node.closest('[inert]') !== null), false)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(evidence, `chat-${lang}-${width}.png`) })
    await page.keyboard.press('Escape'); assert.equal(await chat.isVisible(), false)
    if (width === 1440) {
      await page.evaluate(() => { document.documentElement.style.zoom = '2' })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    assert.deepEqual(errors, [])
    assert.ok(writes.every(url => /^\/api\/v2\/ai\/assistant\/connections\/local-gateway\/(refresh|login|cancel)$/.test(url)))
    checks.push({ width, lang, status: 'pass', inference_submissions: 0, fixture_actions: writes.length })
    await context.close()
  }
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'Labeled API fixtures, no OAuth or inference upstream; connection management and responsive UI', checks }, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ passed: checks.length, checks }))
