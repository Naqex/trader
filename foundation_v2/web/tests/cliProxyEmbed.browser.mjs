import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { GATEWAY_HEALTH_PATH, GATEWAY_MANAGEMENT_URL } from '../cliProxyBridge.mjs'

const origin = 'http://127.0.0.1:5218'
const gatewayOrigin = new URL(GATEWAY_MANAGEMENT_URL).origin
const output = path.resolve('../.runtime/cli-proxy-embed-20261101')
await mkdir(output, { recursive: true })
const report = { scope: 'Unauthenticated management embedding; no credential changes, model calls or broker actions.', cases: [], gatewayRefreshes: 0, blockedWrites: [], pageErrors: [] }
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (![origin, gatewayOrigin].includes(url.origin)) return route.abort()
    if (!['GET', 'HEAD'].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), path: url.pathname })
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('request', request => { if (request.url().endsWith('/local-gateway/refresh')) report.gatewayRefreshes++ })
  const url = `${origin}/?workspace=tenant-a&view=ai&lang=vi&area=ai&section=gateway`
  const frame = () => page.frameLocator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]`)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]:visible`).waitFor()
  await frame().locator('body').filter({ hasText: /CLI.?Proxy|Management|quản trị/i }).waitFor()
  await frame().locator('body').evaluate(body => { body.dataset.embedQa = 'retained' })
  await page.screenshot({ path: path.join(output, 'gateway-desktop.png') })
  report.cases.push('Preview embeds the registry gateway without the Trader API')
  await page.locator('a[href*="section=connections"]').first().click()
  await page.locator('a[href*="section=gateway"]').first().click()
  await page.locator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]:visible`).waitFor()
  assert.equal(await frame().locator('body').getAttribute('data-embed-qa'), 'retained')
  assert.equal(report.gatewayRefreshes, 0)
  report.cases.push('Tab switching preserves the management document and skips preview refresh writes')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'gateway-mobile.png') })
  assert(await page.locator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]`).isVisible())
  report.cases.push('Gateway remains visible at 390px')
  await page.route(`**${GATEWAY_HEALTH_PATH}`, route => route.fulfill({ status: 503, json: { status: 'unavailable' } }))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor()
  assert.equal(await page.locator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]`).count(), 0)
  await page.unroute(`**${GATEWAY_HEALTH_PATH}`)
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await page.locator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]:visible`).waitFor()
  report.cases.push('Unavailable health blocks embedding and Retry recovers')
  await page.route('**/api/v2/ai/assistant/connections/local-gateway', route => route.fulfill({ json: { runtime: { management_url: GATEWAY_MANAGEMENT_URL } } }))
  await page.route(`**${GATEWAY_HEALTH_PATH}`, () => assert.fail('Native mode must use its own connection response'))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator(`iframe[src="${GATEWAY_MANAGEMENT_URL}"]:visible`).waitFor()
  report.cases.push('Native API contract still opens the panel without the preview bridge (fixture)')
  await page.route('**/local-gateway/refresh', route => route.fulfill({ json: {} }))
  await Promise.all([
    page.waitForRequest(request => request.url().endsWith('/local-gateway/refresh')),
    page.locator('a[href*="section=connections"]').first().click(),
  ])
  assert.equal(report.gatewayRefreshes, 1)
  report.cases.push('Native mode retains refresh on tab handoff (fixture; request intercepted)')
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.blockedWrites, [])
  await context.close()
} finally {
  await browser.close()
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
