import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const [origin, output, phase = 'candidate', expectedBundle] = process.argv.slice(2)
const controlsOnly = phase === 'paperclip-controls'
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.equal(new URL(origin).origin, origin, 'Use an origin without a path or trailing slash')
assert.ok(!['5180', '8010', '17852', '17860'].includes(new URL(origin).port), 'Use an isolated preview')
const out = path.resolve(output)
await mkdir(out, { recursive: true })
// Fixed sidebar denominator; detail/workspace transitions have separate focused tests.
const routes = [
  ['dashboard', 'overview', 'testing', 'dashboard'],
  ['sessions', 'replay', 'testing', 'sessions', '&select=1'],
  ['testing-trades', 'trade', 'testing', 'trades', '&select=1'],
  ['testing-analytics', 'analytics', 'testing', 'analytics', '&select=1'],
  ['market-data', 'market-data', 'testing', 'market-data'],
  ...['terminal', 'calendar', 'trades', 'notes', 'tag-analytics', 'analytics', 'trading-accounts'].map(section => [`live-${section}`, 'live', 'live', section]),
  ['strategies', 'playbook', 'strategies', 'my-strategies'],
  ...['paperclip', 'workflows', 'models', 'connections'].map(section => [`ai-${section}`, 'ai', 'ai', section]),
  ['education', 'learn', 'learn', 'learn'], ['settings', 'settings', 'settings', 'settings'],
]
assert.equal(routes.length, 19, 'Fixed sidebar: Testing5 + Live7 + Strategies1 + Studio4 + Learn1 + Settings1')
const selectedRoutes = controlsOnly ? routes.filter(([name]) => name === 'ai-paperclip') : routes
const configurations = phase === 'baseline' ? [[1920, 'dark', 'vi']] : [
  [1920, 'dark', 'vi'], [1440, 'light', 'en'], [768, 'light', 'vi'], [360, 'dark', 'en'],
]
const report = {
  scope: 'Isolated preview sidebar/error-state census. API, integration health and service reads are labeled 503 fixtures; events are 204. Only same-origin static resources reach the preview. No owner data, chart trades, provider, or database accessed. Unavailable/error-only evidence does not establish healthy workflows, loaded-data or whole-product acceptance.',
  navigation: { testing: 5, live: 7, strategies: 1, studio: 4, learn: 1, settings: 1 },
  origin,
  phase, expectedBundle, routes: selectedRoutes.length, sidebarDestinations: routes.length, expectedCases: selectedRoutes.length * configurations.length,
  cases: [], errors: [], blockedWrites: [], blockedExternal: [], blockedUnexpected: [], fixtureReads: {},
}
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, theme, lang] of configurations) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    await context.addInitScript(({ theme, lang }) => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', lang)
    }, { theme, lang })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { report.blockedExternal.push(url.origin); return route.abort() }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        report.blockedWrites.push({ method: request.method(), path: url.pathname }); return route.abort()
      }
      const fixture = url.pathname.startsWith('/api/') || url.pathname.startsWith('/integrations/') || /^\/health(?:z|\/|$)/.test(url.pathname)
      if (fixture) {
        report.fixtureReads[url.pathname] = (report.fixtureReads[url.pathname] || 0) + 1
        if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
        return route.fulfill({ status: 503, json: { status: 'unavailable', detail: 'owner_audit_labeled_unavailable_fixture' } })
      }
      const staticAsset = /^\/assets\/[^/]+\.(?:js|css|svg|png|jpe?g|webp|gif|woff2?|ttf|ico|avif|map)$/.test(url.pathname)
        || url.pathname === '/project-palette.css' || /^\/(?:favicon\.(?:ico|svg)|vite\.svg)$/.test(url.pathname)
      const document = request.isNavigationRequest() && url.pathname === '/'
      if ((staticAsset || document) && ['document', 'script', 'stylesheet', 'image', 'font', 'other'].includes(request.resourceType())) return route.continue()
      report.blockedUnexpected.push({ path: url.pathname, type: request.resourceType() })
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    let currentRoute = ''
    page.on('pageerror', error => report.errors.push({ route: currentRoute, width, theme, lang, message: error.message }))
    const readControl = locator => locator.evaluate(node => {
      const style = getComputedStyle(node)
      return { tag: node.tagName, height: node.getBoundingClientRect().height,
        ...Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'minHeight', 'borderRadius', 'display', 'paddingTop', 'paddingLeft', 'textDecorationLine', 'backgroundColor', 'color'].map(key => [key, style[key]])) }
    })
    let normalControl
    if (controlsOnly) {
      currentRoute = 'ai-models-normal-control-reference'
      await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=models&lang=${lang}`, { waitUntil: 'domcontentloaded' })
      const reference = page.locator('.fx-content .ai-inline-error .wm-button')
      await reference.waitFor()
      normalControl = await readControl(reference)
    }
    for (const [name, view, area, section, extra = ''] of selectedRoutes) {
      currentRoute = name
      const start = performance.now()
      let record
      try {
        await page.goto(`${origin}/?workspace=tenant-a&view=${view}&area=${area}&section=${section}&lang=${lang}${extra}`, { waitUntil: 'domcontentloaded' })
        const contentSelector = name === 'ai-paperclip' ? '.ai-gateway-host[aria-label="Paperclip"]:not([hidden])' : '.fx-content'
        await page.locator(contentSelector).waitFor()
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
        const layout = await page.evaluate(contentSelector => {
          const content = document.querySelector(contentSelector)
          const visible = selector => [...content.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height)
          return {
            overflow: document.documentElement.scrollWidth - innerWidth,
            contentText: content.innerText.trim().slice(0, 650),
            alertCount: visible('[role=alert]').length,
            skeletonCount: visible('.wm-skeleton,.testing-skeleton').length,
            headings: visible('h1,h2').map(node => node.textContent.trim()).slice(0, 8),
          }
        }, contentSelector)
        assert.ok(layout.contentText, 'Route content must not be empty')
        assert.equal(layout.skeletonCount, 0, 'Route must leave its initial loading skeleton')
        record = { name, width, theme, lang, settledMs: +(performance.now() - start).toFixed(1), ...layout }
        if (controlsOnly) {
          record.bundleScripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => new URL(node.src).pathname))
          if (expectedBundle) assert.ok(record.bundleScripts.some(src => src.endsWith(`/${expectedBundle}`)), 'Focused evidence must use the expected rebuilt bundle')
          const host = page.locator(contentSelector)
          await host.getByRole('alert').waitFor()
          const retry = host.getByRole('button', { name: lang === 'en' ? 'Retry' : 'Thử lại', exact: true })
          const open = host.getByRole('link', { name: lang === 'en' ? 'Open separately' : 'Mở riêng', exact: true })
          record.controls = { reference: normalControl, retry: await readControl(retry), open: await readControl(open) }
          record.controlDifferences = []
          for (const [role, control] of Object.entries(record.controls).filter(([role]) => role !== 'reference')) {
            for (const property of ['height', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'minHeight', 'borderRadius', 'paddingTop', 'paddingLeft', 'textDecorationLine'])
              if (control[property] !== normalControl[property]) record.controlDifferences.push({ role, property, actual: control[property], expected: normalControl[property] })
            // Flex items blockify inline-flex; compare its formatting context, not the outer display type.
            assert.ok(['flex', 'inline-flex'].includes(control.display), `${role} must use flex alignment`)
            assert.ok(parseFloat(control.borderRadius) > 0, `${role} must use the shared rounded control role`)
          }
          assert.equal(record.controlDifferences.length, 0, `Persistent host controls differ from normal controls: ${JSON.stringify(record.controlDifferences)}`)
          assert.equal(record.controls.retry.tag, 'BUTTON')
          assert.equal(record.controls.open.tag, 'A')
          assert.equal(await host.locator('iframe').count(), 0, 'Unavailable health fixture must not mount a live iframe')
        }
        const capture = controlsOnly ? width === 768 : (name === 'dashboard' && width === 1920) || (name === 'ai-models' && width === 1440)
          || (name === 'ai-paperclip' && width === 768) || (name === 'settings' && width === 360)
        if (capture) {
          record.screenshot = `${name}${controlsOnly ? '-controls' : ''}-${width}-${theme}-${lang}.png`
          await page.screenshot({ path: path.join(out, record.screenshot), animations: 'disabled' })
        }
        report.cases.push(record)
      } catch (error) { report.cases.push({ ...record, name, width, theme, lang, failure: error.message }) }
      console.log(`${phase} ${name} ${width} ${theme} ${lang}`)
    }
    await context.close()
  }
} finally { await browser.close() }
report.summary = {
  observedCases: report.cases.length,
  failedCases: report.cases.filter(item => item.failure).length,
  overflowCases: report.cases.filter(item => item.overflow > 1).map(({ name, width, overflow }) => ({ name, width, overflow })),
  pageErrors: report.errors.length, blockedWrites: report.blockedWrites.length,
  blockedExternal: report.blockedExternal.length, blockedUnexpected: report.blockedUnexpected.length,
}
await writeFile(path.join(out, controlsOnly ? 'paperclip-controls.json' : 'census.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.summary))
if (report.summary.failedCases || report.summary.pageErrors || report.summary.overflowCases.length || report.summary.blockedWrites
  || report.summary.blockedExternal || report.summary.blockedUnexpected) process.exitCode = 1
