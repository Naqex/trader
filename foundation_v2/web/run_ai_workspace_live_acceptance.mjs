import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

// Read-only runtime QA: no mocked reads, OAuth, provider changes, probes or chat submissions.
const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve(process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ui-ai-bot-20261023/live')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual product UI and API, read-only, no mocked responses or upstream inference', checks: [], writes: [], errors: [] }
try {
  for (const width of [1440, 768, 360]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), lang === 'en' ? 'light' : 'dark')
    const page = await context.newPage(), say = (vi, en) => lang === 'en' ? en : vi
    page.on('pageerror', error => report.errors.push(error.message))
    await page.route('**/api/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        report.writes.push(route.request().url()); return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&lang=${lang}`)
    const baseline = await page.evaluate(async () => {
      const headers = { 'X-Workspace-Id': 'tenant-a' }
      const read = async path => {
        const response = await fetch(`/api/v2/ai/assistant/${path}`, { headers })
        if (!response.ok) throw new Error(`${path}: ${response.status}`)
        return response.json()
      }
      return { account: await read('account'), gateway: await read('connections/local-gateway'), web: await read('connections/chatgpt-web'), profiles: await read('profiles') }
    })
    const gateway = page.getByTestId('connection-local-gateway')
    if (Number.isInteger(baseline.gateway.runtime?.accounts)) await gateway.getByText(say(`${baseline.gateway.runtime.accounts} tài khoản đã lưu`, `${baseline.gateway.runtime.accounts} saved accounts`), { exact: false }).waitFor()
    assert.equal(await page.locator('.ai-connection-row').count(), 2)
    await page.screenshot({ path: path.join(evidence, `connections-${lang}-${width}.png`) })
    await gateway.getByRole('button').click()
    const drawer = page.getByRole('dialog', { name: 'CLIProxyAPI', exact: true })
    await drawer.waitFor()
    if (baseline.gateway.runtime?.management_url) {
      const management = drawer.getByRole('link', { name: say('Mở trang quản trị', 'Open management'), exact: false })
      assert.equal(new URL(await management.getAttribute('href'), origin).searchParams.get('section'), 'gateway')
      assert.equal(await management.getAttribute('target'), null)
    }
    assert.equal(await drawer.locator('.ai-catalog-list li').count(), baseline.gateway.models.length)
    await drawer.locator('summary').click()
    if (baseline.gateway.endpoint) assert.equal(await drawer.getByText(baseline.gateway.endpoint, { exact: true }).isVisible(), true)
    await page.screenshot({ path: path.join(evidence, `details-${lang}-${width}.png`) })
    const bounds = await drawer.boundingBox()
    assert.ok(Math.abs(bounds.x + bounds.width - width) < 2, 'connection details align to right edge')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.keyboard.press('Escape')
    await page.locator('.fx-subnav').getByRole('link', { name: say('Model', 'Models'), exact: true }).click()
    await page.getByRole('heading', { name: say('Model', 'Models'), exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.ai-model-profiles')?.getAttribute('aria-busy') === 'false')
    const system = baseline.profiles.items.find(item => item.feature === 'system' && item.role === 'default')
    if (system) assert.ok((await page.locator('[data-profile="system/default"] .fx-select-trigger').first().innerText()).includes(system.selection.model))
    await page.reload()
    await page.getByRole('heading', { name: say('Model', 'Models'), exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.ai-model-profiles')?.getAttribute('aria-busy') === 'false')
    await page.screenshot({ path: path.join(evidence, `models-${lang}-${width}.png`) })
    assert.equal(await page.locator('.fx-subnav').getByRole('link', { name: say('Trò chuyện', 'Chat'), exact: true }).count(), 0)
    await page.getByTestId('ai-toggle').click()
    const chat = page.getByTestId('ai-chat')
    await chat.getByRole('textbox').waitFor()
    await page.waitForFunction(() => !document.querySelector('#wm-ai-input')?.disabled)
    assert.equal(await chat.count(), 1)
    assert.equal(await chat.getAttribute('aria-modal'), width <= 1100 ? 'true' : null)
    assert.equal(await page.locator('.wm-ai-backdrop').count(), width <= 1100 ? 1 : 0)
    await page.screenshot({ path: path.join(evidence, `chat-${lang}-${width}.png`) })
    await page.keyboard.press('Escape')
    assert.equal(await chat.isVisible(), false)
    await page.locator('.fx-subnav').getByRole('link', { name: say('Bot', 'Bots'), exact: true }).click()
    await page.locator('.ai-bots-empty').waitFor()
    assert.equal(await page.getByTestId('ai-workspace').getByRole('button').count(), 0)
    const after = await page.evaluate(async () => {
      const read = async path => (await fetch(`/api/v2/ai/assistant/${path}`, { headers: { 'X-Workspace-Id': 'tenant-a' } })).json()
      return { account: await read('account'), profiles: await read('profiles') }
    })
    assert.equal(after.account.provider, baseline.account.provider)
    assert.deepEqual(after.account.selection, baseline.account.selection)
    assert.deepEqual(after.profiles, baseline.profiles)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    report.checks.push({ width, lang, status: 'pass', saved_accounts: baseline.gateway.runtime?.accounts, catalog_models: baseline.gateway.models.length, selection_unchanged: true })
    await context.close()
  }
  assert.deepEqual(report.writes, [])
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ passed: report.checks.length, writes: report.writes.length, errors: report.errors.length }))
