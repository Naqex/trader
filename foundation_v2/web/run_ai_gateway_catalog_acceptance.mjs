import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5188'
const evidence = process.env.TW_AI_UI_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ai-catalog-pool-20261023/catalog-fixtures'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Fixture model changes through native UI; real upstream login document; no inference, OAuth or configuration writes', checks: [], errors: [], forbidden: [] }
try {
  for (const lang of ['vi', 'en']) for (const width of [1440, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), say = (vi, en) => lang === 'en' ? en : vi
    const model = id => ({ id, name: id, efforts: [], capabilities: { tools: 'unverified', effort: 'unverified' } })
    let cached = [model('Fixture Original')], next = cached, fail = false, refreshes = 0, frames = 0
    let delayCatalog = false, staleStarted, releaseStale
    const staleRequest = new Promise(resolve => { staleStarted = resolve })
    const staleResponse = new Promise(resolve => { releaseStale = resolve })
    const selection = { provider: 'local-gateway', model: 'Fixture Original', effort: null }
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('request', request => { if (request.url() === 'http://127.0.0.1:17852/management.html') frames++ })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), base = '/api/v2/ai/assistant'
      const refresh = url.pathname === `${base}/connections/local-gateway/refresh`
      if (request.method() !== 'GET' && request.method() !== 'HEAD' && !(refresh && request.method() === 'POST' && request.postData() === '{}')) {
        report.forbidden.push(url.pathname); return route.abort()
      }
      if (![origin, 'http://127.0.0.1:17852'].includes(url.origin)) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (refresh) {
        refreshes++
        if (fail) return route.fulfill({ status: 503, json: { detail: 'ai_gateway_unavailable' } })
        if (delayCatalog) await staleRequest
        cached = next
      }
      if (url.pathname.startsWith(`${base}/connections/local-gateway`)) return route.fulfill({ json: { status: 'catalog_ready', ready: true, models: cached, selection, runtime: { managed: true, running: true, accounts: 3, management_url: 'http://127.0.0.1:17852/management.html' } } })
      if (url.pathname.startsWith(`${base}/connections/chatgpt-web`)) return route.fulfill({ json: { status: 'stopped', models: [] } })
      if (url.pathname === `${base}/account`) return route.fulfill({ json: { provider: 'local-gateway', ready: true, models: cached, selection } })
      if (url.pathname === `${base}/catalog`) {
        const models = cached
        if (delayCatalog) { delayCatalog = false; staleStarted(); await staleResponse }
        return route.fulfill({ json: { routes: [{ provider: 'local-gateway', ready: true, models }] } })
      }
      if (url.pathname === `${base}/profiles`) return route.fulfill({ json: { items: [], chat_default: { selection } } })
      if (url.pathname === `${base}/conversations`) return route.fulfill({ json: { items: [], next: null } })
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=gateway&lang=${lang}`)
    const frame = page.locator('.ai-gateway-frame')
    await page.frameLocator('.ai-gateway-frame').getByPlaceholder('Enter the management key', { exact: true }).waitFor()
    const doc = page.frames().find(f => f.url().includes('/management.html'))
    next = [...cached, model('Fixture Added In Panel')]
    await page.locator('.fx-subnav').getByRole('link', { name: say('Model', 'Models'), exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-profile="system/default"] .fx-select-trigger')?.disabled === false)
    const profile = page.locator('[data-profile="system/default"] .fx-select-trigger')
    await profile.click()
    await page.getByRole('option', { name: /Fixture Added In Panel/ }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(refreshes, 1)
    assert.equal(frames, 1)
    await page.waitForTimeout(1100)
    assert.equal(refreshes, 1, 'hidden panel does not poll for changes')
    await page.locator('.fx-subnav').getByRole('link', { name: 'CLIProxyAPI', exact: true }).click()
    await frame.waitFor()
    assert.equal(page.frames().find(f => f.url().includes('/management.html')), doc)
    next = [...cached, model('Fixture Added Before Chat')]
    delayCatalog = true
    await page.getByTestId('ai-toggle').click()
    const picker = page.locator('.wm-ai-model-trigger')
    await picker.waitFor()
    await picker.click()
    await page.getByRole('option', { name: /Fixture Added Before Chat/ }).waitFor()
    assert.equal(refreshes, 2, 'opening chat from management synchronizes models')
    releaseStale()
    await page.waitForTimeout(100)
    assert.equal(await page.getByRole('option', { name: /Fixture Added Before Chat/ }).count(), 1, 'late stale catalog cannot overwrite the refreshed result')
    assert.match(await picker.innerText(), /Fixture Original/, 'refresh preserves the selected model')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.wm-ai-effort-slider').count(), 0, 'unknown effort never becomes an invented slider')
    await page.getByRole('button', { name: say('Đóng chat AI', 'Close AI chat'), exact: true }).click()
    fail = true
    await page.locator('.fx-subnav').getByRole('link', { name: say('Model', 'Models'), exact: true }).click()
    await page.locator('.ai-inline-error').waitFor()
    assert.equal(await profile.isDisabled(), true, 'failed synchronization does not expose a stale healthy picker')
    fail = false
    await page.locator('.fx-subnav').getByRole('link', { name: 'CLIProxyAPI', exact: true }).click()
    await frame.waitFor()
    await page.locator('.fx-subnav').getByRole('link', { name: say('Model', 'Models'), exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-profile="system/default"] .fx-select-trigger')?.disabled === false)
    assert.equal(await page.locator('.ai-inline-error').count(), 0)
    assert.equal(frames, 1)
    await page.screenshot({ path: path.join(evidence, `models-${lang}-${width}.png`) })
    report.checks.push({ lang, width, pass: true, refreshes, iframe_loads: frames })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.forbidden, [])
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
