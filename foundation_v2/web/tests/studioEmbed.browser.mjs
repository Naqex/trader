import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { GATEWAY_HEALTH_PATH, GATEWAY_MANAGEMENT_URL } from '../cliProxyBridge.mjs'
import { PAPERCLIP_HEALTH_PATH, PAPERCLIP_ORIGIN } from '../paperclipBridge.mjs'

// Host behavior against synthetic cross-origin documents. No service is contacted.
const origin = process.argv[2]
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(!['5180', '8010', '17852', '17860'].includes(new URL(origin).port))
const gatewayOrigin = new URL(GATEWAY_MANAGEMENT_URL).origin
const out = path.resolve('../.runtime/studio-embed-fixture')
await mkdir(out, { recursive: true })
const report = { scope: 'Offline host/iframe fixture, not native app acceptance', cases: [], writes: [], errors: [] }
const documentHtml = '<!doctype html><html><body><h1>Fixture</h1><input aria-label="Draft"><script>addEventListener("message",e=>{if(e.data?.type==="naqex:preferences")document.documentElement.lang=e.data.language});parent.postMessage({type:"paperclip:ready",version:1},"*")</script></body></html>'
const browser = await chromium.launch()
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(() => {
      localStorage.setItem('tw-theme', 'dark')
      localStorage.setItem('tw-language', 'vi')
      localStorage.setItem('tw-shell-rail-collapsed', 'false')
    })
    let unavailable = false, native = false, refreshes = 0
    const documents = { gateway: 0, paperclip: 0 }
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (!['GET', 'HEAD'].includes(request.method())) {
        if (native && url.origin === origin && url.pathname.endsWith('/local-gateway/refresh')) {
          refreshes++
          return route.fulfill({ json: {} }) // intercepted catalog sync, never reaches an API
        }
        report.writes.push(request.method() + ' ' + url.pathname)
        return route.abort()
      }
      if (url.origin === gatewayOrigin || url.origin === PAPERCLIP_ORIGIN) {
        const key = url.origin === gatewayOrigin ? 'gateway' : 'paperclip'
        if (request.isNavigationRequest()) { documents[key]++; return route.fulfill({ contentType: 'text/html', body: documentHtml }) }
        return route.abort()
      }
      if (url.origin !== origin) return route.abort()
      if ([GATEWAY_HEALTH_PATH, PAPERCLIP_HEALTH_PATH].includes(url.pathname))
        return route.fulfill({ status: unavailable ? 503 : 200, json: { status: unavailable ? 'unavailable' : 'ok' } })
      if (url.pathname.endsWith('/connections/local-gateway') && native)
        return route.fulfill({ json: { runtime: { management_url: GATEWAY_MANAGEMENT_URL } } })
      if (url.pathname.startsWith('/api/'))
        return route.fulfill({ status: url.pathname === '/api/v2/events' ? 204 : 503, body: url.pathname === '/api/v2/events' ? '' : JSON.stringify({ detail: 'ui_preview_services_not_connected' }), contentType: 'application/json' })
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', failure => report.errors.push(failure.message))
    page.setDefaultTimeout(12000)
    const href = section => origin + '/?workspace=tenant-a&view=ai&area=ai&section=' + section + '&lang=vi'
    await page.goto(href('gateway'))
    const gatewayFrame = page.frameLocator('iframe[src="' + GATEWAY_MANAGEMENT_URL + '"]')
    await gatewayFrame.getByRole('textbox', { name: 'Draft' }).fill('gateway draft')
    if (width === 390) await page.setViewportSize({ width: 1440, height: 940 })
    await page.locator('.fx-subnav a[href*="section=connections"]').click()
    await page.goBack()
    await page.locator('iframe[src="' + GATEWAY_MANAGEMENT_URL + '"]:visible').waitFor()
    assert.equal(await gatewayFrame.getByRole('textbox', { name: 'Draft' }).inputValue(), 'gateway draft')
    assert.equal(documents.gateway, 1)
    assert.equal(refreshes, 0)
    report.cases.push({ width, name: 'Gateway navigation retains document/draft; preview does not write', result: 'pass' })
    unavailable = true
    await page.reload()
    await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor()
    assert.equal(await page.locator('iframe[src="' + GATEWAY_MANAGEMENT_URL + '"]').count(), 0)
    unavailable = false
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page.locator('iframe[src="' + GATEWAY_MANAGEMENT_URL + '"]:visible').waitFor()
    native = true
    await page.reload()
    await gatewayFrame.getByRole('textbox', { name: 'Draft' }).waitFor()
    await page.locator('.fx-subnav a[href*="section=connections"]').click()
    await page.waitForFunction(() => document.querySelector('.ai-page-heading'))
    await page.waitForTimeout(100)
    assert.equal(refreshes, 1, 'native catalog handoff is intercepted and documented')
    native = false
    await page.goto(href('paperclip'))
    const paperclipFrame = page.frameLocator('iframe[title$="Paperclip"]')
    await paperclipFrame.getByRole('textbox', { name: 'Draft' }).fill('paperclip draft')
    await paperclipFrame.locator('html[lang="vi"]').waitFor()
    const firstDocumentCount = documents.paperclip
    await page.getByTestId('language-toggle').click()
    await paperclipFrame.locator('html[lang="en"]').waitFor()
    assert.equal(await paperclipFrame.getByRole('textbox', { name: 'Draft' }).inputValue(), 'paperclip draft')
    await page.locator('.fx-subnav a[href*="section=connections"]').click()
    assert.equal(await page.locator('iframe[title$="Paperclip"]').isVisible(), false)
    await page.locator('.fx-subnav a[href*="section=paperclip"]').click()
    assert.equal(await paperclipFrame.getByRole('textbox', { name: 'Draft' }).inputValue(), 'paperclip draft')
    assert.equal(documents.paperclip, firstDocumentCount)
    await page.setViewportSize({ width, height: 940 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(out, 'paperclip-' + width + '.png') })
    unavailable = true
    await page.reload()
    await page.getByRole('button', { name: /Retry|Thử lại/, exact: true }).waitFor()
    unavailable = false
    await page.getByRole('button', { name: /Retry|Thử lại/, exact: true }).click()
    await paperclipFrame.getByRole('textbox', { name: 'Draft' }).waitFor()
    report.cases.push({ width, name: 'Paperclip preference/navigation retention and unavailable/Retry', result: 'pass' })
    await context.close()
  }
  assert.deepEqual(report.writes, [])
  assert.deepEqual(report.errors, [])
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))