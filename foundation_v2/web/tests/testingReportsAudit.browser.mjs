import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { DEMO_SESSIONS, demoDashboardAnalytics } from '../src/demoFixtures.js'

const origin = 'http://127.0.0.1:5180', output = '../evidence/testing-overall-audit-20261012/reports'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Testing Sessions/Trades/Analytics preview QA and GET-only real-component fixtures; persisted owner data untouched', cases: [], errors: [], writes: [] }
try {
  for (const width of [1563, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', theme) }, theme)
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/*', route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
      return new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    })
    for (const view of ['replay', 'trade', 'analytics']) {
      let readyTop
      for (const state of ['demo', 'refreshing', 'stale', 'error']) {
        await page.goto(`${origin}/?workspace=tenant-a&view=${view}&area=testing&select=1&demo=1&ui_state=${state}`)
        await page.getByTestId('view-state-preview').waitFor()
        await page.locator(view === 'replay' ? '.fxr-session-cards' : '[data-testid=analytics-filters]').waitFor()
        const target = page.locator(view === 'replay' ? '.fxr-session-report' : view === 'trade' ? '.fxa-trades' : '.fxa-report-tabs').first()
        if (state === 'demo') readyTop = (await target.boundingBox()).y
        if (['refreshing', 'stale'].includes(state)) {
          assert.equal((await target.boundingBox()).y, readyTop, `${view}/${width}/${theme}/${state}: content must not shift`)
          assert.equal(await page.locator('.wm-read-state').count(), 0, 'Background read state has no inline text row')
          const status = page.locator(`.wm-resource-status[data-resource-state=${state}]`)
          await status.locator('summary').click()
          await status.locator('.wm-resource-status-detail').waitFor()
          assert.equal((await target.boundingBox()).y, readyTop, 'Opening status popup cannot change layout')
          await page.keyboard.press('Escape')
        }
        if (state === 'error') {
          const alert = page.locator('.fx-content [role=alert]').first()
          await alert.waitFor()
          const filters = page.locator(view === 'replay' ? '.fxr-session-toolbar' : '[data-testid=analytics-filters]')
          assert.ok((await alert.boundingBox()).y >= (await filters.boundingBox()).y + (await filters.boundingBox()).height - 1, 'Error stays below controls')
          if (view === 'replay') {
            assert.equal(await page.locator('.fxs-balance strong').textContent(), '10.960 USD')
            assert.equal(await page.getByText('Đơn vị tiền tệ tài khoản', { exact: false }).count(), 0)
            await page.screenshot({ path: `${output}/sessions-${theme}-${width}-error.png`, animations: 'disabled' })
          }
        }
        report.cases.push({ view, width, theme, state })
      }
    }
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 1563, height: 987 } })
  await context.addInitScript(() => localStorage.setItem('tw-language', 'vi'))
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await context.route('**/*', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
    return new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  })
  await page.route('**/api/v2/replay/sessions', route => route.fulfill({ json: { items: DEMO_SESSIONS } }))
  await page.route('**/api/v2/replay/sessions/*/analytics*', route => {
    const id = new URL(route.request().url()).pathname.split('/')[5]
    const item = DEMO_SESSIONS.find(item => item.record_id === id)
    return route.fulfill({ json: demoDashboardAnalytics(item, 'tenant-a') })
  })
  await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=analytics&select=1&session=demo-london`)
  await page.locator('.fxa-filter-chips').getByText('Phiên · London Breakout').waitFor()
  await page.evaluate(async () => { const { navigate } = await import('/src/clientNavigation.js'); const url = new URL(location.href); url.searchParams.set('session', 'demo-gold'); navigate(url) })
  await page.locator('.fxa-filter-chips').getByText('Phiên · Gold Swing').waitFor()
  await page.goBack()
  await page.locator('.fxa-filter-chips').getByText('Phiên · London Breakout').waitFor()
  report.cases.push({ fixture: true, case: 'Client navigation and browser Back reconcile report session control with URL scope' })
  await context.close()
  const actual = await browser.newContext({ viewport: { width: 1563, height: 987 } })
  const actualPage = await actual.newPage()
  actualPage.on('pageerror', error => report.errors.push(error.message))
  await actual.route('**/*', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
    return new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  })
  for (const view of ['replay', 'trade', 'analytics']) {
    await actualPage.goto(`${origin}/?workspace=tenant-a&area=testing&view=${view}&select=1`)
    await actualPage.locator(view === 'replay' ? '.fxr-session-cards' : '[data-testid=analytics-filters]').waitFor()
    await actualPage.waitForFunction(() => !document.querySelector('.wm-page-skeleton,.fxr-session-report .wm-skeleton'))
    if (view === 'replay') {
      const summaryBalance = await actualPage.locator('.fxs-balance strong').textContent()
      await actualPage.locator('.fxr-session-control .fx-select-trigger').getByText(`Số dư tài khoản: ${summaryBalance}`, { exact: true }).waitFor()
    }
    const facts = await actualPage.locator('.fx-content').evaluate(element => ({ errors: [...element.querySelectorAll('[role=alert]')].map(element => element.textContent), sourceBlocked: Boolean(element.querySelector('[data-testid=analytics-blocked]')), currency: element.querySelector('.fxs-balance')?.textContent }))
    await actualPage.screenshot({ path: `${output}/actual-${view}.png`, animations: 'disabled' })
    report.cases.push({ actualGET: true, view, facts })
  }
  await actual.close()
  assert.deepEqual(report.errors, []); assert.deepEqual(report.writes, []); report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, writes: report.writes })) }
