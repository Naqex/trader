import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

// Real unmodified panel, fresh browser sessions; fixture metadata is labeled separately.
// Optional explicit local admin sign-in reads its key from the private file;
// never prints/stores it in evidence or submits OAuth/configuration/inference writes.
const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5188'
const live = process.env.TW_AI_EMBED_LIVE === '1'
const adminLogin = live && process.env.TW_AI_EMBED_ADMIN_LOGIN === '1'
const evidence = path.resolve(process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ai-gateway-embed-20261023/fixtures')
const management = 'http://127.0.0.1:17852/management.html'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: live ? 'Actual UI/API and upstream panel, read-only' : 'Fixture gateway metadata, real upstream panel, read-only', checks: [], writes: [], errors: [] }
try {
  for (const width of [1440, 768, 360]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), lang === 'en' ? 'light' : 'dark')
    const page = await context.newPage(), say = (vi, en) => lang === 'en' ? en : vi
    let status = 'stopped', metadataReads = 0, frameLoads = 0
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('request', request => { if (request.url() === management) frameLoads++ })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!['GET', 'HEAD'].includes(request.method())) {
        report.writes.push({ method: request.method(), path: url.pathname }); return route.abort('blockedbyclient')
      }
      if (![origin, 'http://127.0.0.1:17852'].includes(url.origin)) return route.abort('blockedbyclient')
      if (!live && url.pathname === '/api/v2/ai/assistant/connections/local-gateway') {
        metadataReads++
        if (status === 'error') return route.fulfill({ status: 503, json: { detail: 'ai_gateway_unavailable' } })
        return route.fulfill({ json: { runtime: { managed: true, management_available: true, running: status !== 'stopped',
          management_url: status === 'ready' ? management : status === 'untrusted' ? 'https://untrusted.invalid/management.html' : null } } })
      }
      return route.continue()
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=automation&lang=${lang}`)
    await page.locator('.ai-bots-empty').waitFor()
    assert.equal(await page.locator('iframe').count(), 0)
    assert.equal(frameLoads, 0, 'panel must not load outside its tab')
    const tab = () => page.locator('.fx-subnav').getByRole('link', { name: 'CLIProxyAPI', exact: true })
    await tab().click()
    if (!live) {
      await page.getByText(say('Bật kết nối để mở trang quản trị.', 'Start the connection to open management.'), { exact: true }).waitFor()
      assert.equal(frameLoads, 0)
      status = 'error'
      await page.getByRole('button', { name: say('Thử lại', 'Retry'), exact: true }).click()
      await page.getByRole('alert').waitFor()
      status = 'untrusted'
      await page.getByRole('button', { name: say('Thử lại', 'Retry'), exact: true }).click()
      await page.getByText(say('Trang quản trị chưa sẵn sàng.', 'Management is not available yet.'), { exact: true }).waitFor()
      assert.equal(frameLoads, 0, 'unexpected management URLs are never framed')
      status = 'ready'
      await page.getByRole('button', { name: say('Thử lại', 'Retry'), exact: true }).click()
    }
    const frame = page.locator('.ai-gateway-frame')
    const login = page.frameLocator('.ai-gateway-frame').getByPlaceholder('Enter the management key', { exact: true })
    await login.waitFor()
    assert.equal(await login.inputValue(), '')
    assert.equal(await frame.getAttribute('src'), management)
    assert.equal(await frame.evaluate(node => node.contentDocument), null, 'native UI cannot read the upstream DOM')
    const bounds = await frame.boundingBox(), content = await page.locator('.ai-gateway-host').boundingBox()
    for (const axis of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(bounds[axis] - content[axis]) < 2, `frame fills content ${axis}`)
    assert.ok(Math.abs(bounds.y + bounds.height - 940) < 2, 'frame reaches viewport bottom')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await page.locator('.ai-gateway-host').evaluate(node => node.scrollHeight > node.clientHeight + 1), false)
    const reads = metadataReads
    await page.waitForTimeout(1200)
    assert.equal(metadataReads, reads, 'no idle status polling')
    assert.equal(frameLoads, 1)
    await page.screenshot({ path: path.join(evidence, `embedded-${lang}-${width}.png`) })
    if (adminLogin) {
      const key = (await readFile(new URL('../../.runtime/mt5-ai-gateway/management.key', import.meta.url), 'utf8')).trim()
      await login.fill(key)
      const upstream = page.frameLocator('.ai-gateway-frame')
      await upstream.getByRole('button', { name: 'Login', exact: true }).click()
      await login.waitFor({ state: 'hidden' })
      const expand = upstream.getByRole('button', { name: 'Expand sidebar', exact: true })
      if (await expand.isVisible()) await expand.click()
      await upstream.getByRole('link', { name: 'AI Providers', exact: true }).click()
      await upstream.getByText('Gemini', { exact: false }).first().waitFor()
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(evidence, `providers-${lang}-${width}.png`) })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    const document = page.frames().find(item => item.url().startsWith(management))
    if (!adminLogin) await login.fill('unsaved-local-input')
    await page.locator('.fx-subnav').getByRole('link', { name: say('Bot', 'Bots'), exact: true }).click()
    await page.locator('.ai-bots-empty').waitFor()
    assert.equal(await frame.count(), 1)
    assert.equal(await frame.isVisible(), false)
    assert.equal(await page.locator('.ai-gateway-host').getAttribute('inert'), '')
    const hiddenReads = metadataReads
    await page.waitForTimeout(1200)
    assert.equal(metadataReads, hiddenReads, 'no native status polling while hidden')
    await tab().click()
    await frame.waitFor()
    assert.equal(page.frames().find(item => item.url().startsWith(management)), document, 'same iframe document on return')
    if (!adminLogin) assert.equal(await login.inputValue(), 'unsaved-local-input')
    else assert.ok(document.url().endsWith('#/ai-providers'), 'upstream route survives')
    assert.equal(frameLoads, 1)

    // Cross-area navigation goes through the real app router, outside the AI route boundary.
    await page.evaluate(() => { const a = document.createElement('a'); a.href = '/?workspace=tenant-a&view=settings'; document.body.append(a); a.click(); a.remove() })
    await page.waitForURL('**view=settings')
    await frame.waitFor({ state: 'hidden' })
    assert.equal(await frame.count(), 1)
    await page.goBack()
    await frame.waitFor()
    assert.equal(page.frames().find(item => item.url().startsWith(management)), document)
    assert.equal(frameLoads, 1)
    for (const toggle of ['language-toggle', 'theme-toggle']) {
      await page.getByTestId(toggle).click()
      await page.getByTestId(toggle).click()
      assert.equal(page.frames().find(item => item.url().startsWith(management)), document)
      assert.equal(frameLoads, 1, `${toggle} preserves the document`)
    }
    assert.equal(await page.locator('.fx-content').count(), 1)

    if (!live) {
      status = 'stopped'
      await page.locator('.fx-subnav').getByRole('link', { name: say('Bot', 'Bots'), exact: true }).click()
      await page.locator('.ai-bots-empty').waitFor()
      await tab().click()
      await page.getByText(say('Bật kết nối để mở trang quản trị.', 'Start the connection to open management.'), { exact: true }).waitFor()
      assert.equal(await frame.count(), 1, 'outage keeps the original document')
      assert.equal(await frame.isVisible(), false)
      status = 'ready'
      await page.getByRole('button', { name: say('Thử lại', 'Retry'), exact: true }).click()
      await login.waitFor()
      assert.equal(await login.inputValue(), '', 'explicit retry reloads recovered panel')
      assert.equal(frameLoads, 2)
      // Workspace selection discards the old document; it must not leak unsaved UI state.
      await page.evaluate(() => { const a = document.createElement('a'); a.href = '/?workspace=fixture-other&view=ai&area=ai&section=automation'; document.body.append(a); a.click(); a.remove() })
      await page.locator('.ai-bots-empty').waitFor()
      assert.equal(await frame.count(), 0)
      await tab().click()
      await login.waitFor()
      assert.equal(frameLoads, 3)
    }
    await page.reload()
    if (!adminLogin) await login.waitFor()
    else await frame.waitFor()
    assert.equal(await tab().getAttribute('aria-current'), 'page')
    report.checks.push({ width, lang, status: 'pass', full_content_viewport: true, persistent_document: true, admin_read_only: adminLogin })
    await context.close()
  }
  assert.deepEqual(report.writes, [])
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ passed: report.checks.length, writes: report.writes.length, errors: report.errors.length }))
