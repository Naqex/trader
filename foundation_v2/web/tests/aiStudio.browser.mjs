// Studio (area=ai): nav, redirects, row states and alignment against mocked read-only APIs.
// Run against an isolated vite preview: node tests/aiStudio.browser.mjs http://127.0.0.1:5245 [shotDir]
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const [origin, shotArg] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(!['5180', '8010', '3100', '17852'].includes(new URL(origin).port))
const shots = shotArg || path.resolve('../.runtime/ai-studio-browser')
await mkdir(shots, { recursive: true })
const gateway = { status: 'catalog_ready', login_state_present: true, runtime: { accounts: 2, managed: true, running: true, external: false }, models: [{ id: 'gpt-5', name: 'GPT-5', efforts: ['low', 'high'] }, { id: 'opus', name: 'Claude Opus', efforts: [] }] }
const web = { status: 'stopped', login_state_present: false, models: [] }
const runs = [
  { id: 'run-1', title: 'Đánh giá chiến lược breakout EURUSD H1', status: 'completed', created_at: '2026-11-01T08:00:00Z' },
  { id: 'run-2', title: 'Tìm điểm còn thiếu của playbook London open', status: 'running', created_at: '2026-11-01T09:00:00Z' },
  { id: 'run-3', title: 'Rà rủi ro drawdown', status: 'failed', created_at: '2026-10-31T09:00:00Z' },
]
const detail = { id: 'run-1', status: 'completed', text: 'Kết luận: bằng chứng đủ cho bước tiếp theo.', steps: [{ node: 'facts', status: 'completed' }, { node: 'gaps', status: 'completed' }, { node: 'reviewer', status: 'completed' }], roles: {} }
function api(pathname) {
  if (pathname.endsWith('/connections/local-gateway')) return gateway
  if (pathname.endsWith('/connections/chatgpt-web')) return web
  if (pathname.endsWith('/assistant/workflows')) return { items: runs, next: null }
  if (pathname.includes('/assistant/workflows/')) return detail
  if (pathname.endsWith('/assistant/profiles')) return { items: [] }
  if (pathname.endsWith('/assistant/catalog')) return { routes: [{ provider: 'local-gateway', models: gateway.models }] }
  if (pathname.endsWith('/assistant/account')) return { provider: 'local-gateway', selection: { model: 'gpt-5', effort: 'high' } }
  if (pathname.endsWith('/assistant/sources')) return { items: [] }
  return { items: [], available: false }
}
const report = { writes: [], errors: [], cases: [] }
const browser = await chromium.launch()
async function open(context, query) {
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('dialog', dialog => { report.errors.push(`native dialog: ${dialog.message()}`); void dialog.dismiss() })
  await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&${query}`)
  return page
}
// Vertical centre of an element's first glyph run versus a sibling, measured in CSS pixels.
const centreGap = (page, selector, iconSelector) => page.locator(selector).first().evaluate((node, iconSelector) => {
  const icon = node.querySelector(iconSelector)
  const text = [...node.childNodes].find(child => child.nodeType === 3 && child.textContent.trim())
  const range = document.createRange(); range.selectNodeContents(text)
  const a = icon.getBoundingClientRect(), b = range.getBoundingClientRect()
  return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2))
}, iconSelector)
try {
  for (const [theme, lang] of [['dark', 'vi'], ['light', 'en'], ['light', 'vi'], ['dark', 'en']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, colorScheme: theme })
    await context.addInitScript(({ theme, lang }) => {
      localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', lang); localStorage.setItem('tw-shell-rail-collapsed', 'false')
      localStorage.setItem('wm-ai-workflow:tenant-a', JSON.stringify({ id: 'run-1' }))
    }, { theme, lang })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(`${request.method()} ${url.pathname}`); return route.abort() }
      if (url.pathname.startsWith('/integrations/')) return route.fulfill({ status: 503, json: { status: 'unavailable' } })
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/events') return route.fulfill({ status: 204, body: '' })
      return route.fulfill({ json: api(url.pathname) })
    })
    const en = lang === 'en'
    const page = await open(context, `section=connections&lang=${lang}`)
    await page.getByTestId('connection-local-gateway').waitFor()
    const nav = await page.locator('.fx-subnav-primary > a.fx-subnav-link').allInnerTexts()
    assert.deepEqual(nav.map(item => item.trim()), en ? ['AI team', 'Reviews', 'Models', 'Connections'] : ['Đội AI', 'Đánh giá', 'Model', 'Kết nối'])
    assert.equal(await page.locator('.fx-rail [data-nav-label="Studio"]').count(), 1, 'rail names the area Studio')
    assert.equal(await page.getByTestId('connection-local-gateway').locator('.ai-status.is-positive').count(), 1)
    await page.getByRole('button', { name: 'CLIProxyAPI', exact: true }).waitFor()
    assert.match(await page.getByTestId('connection-local-gateway').getAttribute('aria-describedby'), /ai-connection-state/)
    assert(await page.locator('.ai-workspace').evaluate(node => node.getBoundingClientRect().width <= 961), 'Studio column is capped at 960px')
    assert(await centreGap(page, '.ai-page-actions .wm-button', 'svg') <= 1, 'refresh icon and label share a centre')
    assert(await centreGap(page, '[data-testid="connection-local-gateway"] .ai-status', '.ai-status-dot') <= 1, 'status dot and text share a centre')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(shots, `connections-${theme}-${lang}.png`) })
    await page.getByTestId('connection-local-gateway').click()
    await page.locator('.ai-connection-drawer').waitFor()
    await page.waitForTimeout(400) // let the drawer finish entering before the screenshot
    await page.screenshot({ path: path.join(shots, `connection-drawer-${theme}-${lang}.png`) })
    await page.keyboard.press('Escape')

    await page.route('**/connections/local-gateway', route => route.fulfill({ json: { ...gateway, error: 'ai_gateway_unavailable' } }))
    await page.reload()
    await page.getByTestId('connection-local-gateway').locator('.ai-status.is-warning').waitFor()
    assert.equal((await page.getByTestId('connection-local-gateway').locator('.ai-status').innerText()).trim(), en ? 'Needs attention' : 'Cần kiểm tra')
    await page.getByTestId('connection-local-gateway').click()
    await page.locator('.ai-detail-status .ai-status.is-warning').waitFor()
    await page.keyboard.press('Escape')
    await page.unroute('**/connections/local-gateway')

    for (const [error, tone, label] of [
      ['ai_gateway_stopped', 'muted', en ? 'Stopped' : 'Đã tắt'],
      ['ai_gateway_unavailable', 'muted', en ? 'Stopped' : 'Đã tắt'],
      ['ai_gateway_login_failed', 'warning', en ? 'Needs attention' : 'Cần kiểm tra'],
    ]) {
      await page.route('**/connections/local-gateway', route => route.fulfill({ json: { ...gateway, runtime: { ...gateway.runtime, running: false }, error } }))
      await page.reload()
      const state = page.getByTestId('connection-local-gateway').locator(`.ai-status.is-${tone}`)
      await state.waitFor()
      assert.equal((await state.innerText()).trim(), label)
      await page.getByTestId('connection-local-gateway').click()
      await page.locator(`.ai-detail-status .ai-status.is-${tone}`).waitFor()
      assert.equal(await page.locator('.ai-connection-drawer [role="alert"]').count(), tone === 'warning' ? 1 : 0)
      await page.keyboard.press('Escape')
      await page.unroute('**/connections/local-gateway')
    }

    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=workflows&lang=${lang}`)
    const selected = page.locator('.ai-run-row.is-selected'), other = page.locator('.ai-run-row:not(.is-selected)').first()
    await selected.waitFor()
    await page.locator('.ai-workflow-steps > li').first().waitFor()
    await page.locator('#ai-workflow-input').focus()
    assert(await page.locator('.ai-workflow-form').evaluate(node => getComputedStyle(node).outlineStyle === 'solid'), 'composer has a visible focus ring')
    await page.mouse.move(0, 0)
    const bg = locator => locator.evaluate(node => getComputedStyle(node).backgroundColor)
    const plainSelected = await bg(selected)
    await other.hover(); await page.waitForTimeout(250); const plainHover = await bg(other)
    await selected.hover(); await page.waitForTimeout(250); const selectedHover = await bg(selected)
    assert.notEqual(selectedHover, plainSelected, 'selected+hover differs from selected')
    assert.notEqual(selectedHover, plainHover, 'selected+hover differs from hover')
    await page.mouse.move(0, 0)
    await page.screenshot({ path: path.join(shots, `reviews-${theme}-${lang}.png`) })

    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=models&lang=${lang}`)
    await page.locator('.ai-model-profile-row').first().waitFor()
    const wasOpen = await page.locator('.ai-workflow-profiles').evaluate(node => node.open)
    await page.locator('.ai-workflow-profiles summary').click()
    await page.waitForTimeout(300)
    const turned = await page.locator('.ai-summary-chevron').evaluate(node => getComputedStyle(node).transform)
    assert.equal(turned !== 'none', !wasOpen, 'chevron turns up only while the group is open')
    if (wasOpen) await page.locator('.ai-workflow-profiles summary').click()
    assert.equal(await page.locator('.ai-workflow-profiles summary').innerText().then(text => text.includes('⌄')), false)
    await page.screenshot({ path: path.join(shots, `models-${theme}-${lang}.png`) })
    report.cases.push({ theme, lang, nav, plainSelected, plainHover, selectedHover, result: 'pass' })
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(`${request.method()} ${url.pathname}`); return route.abort() }
    if (url.pathname.startsWith('/integrations/')) return route.fulfill({ status: 503, json: { status: 'unavailable' } })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    return route.fulfill({ json: api(url.pathname) })
  })
  const page = await open(context, 'section=automation&lang=vi')
  await page.waitForURL(url => new URL(url).searchParams.get('section') === 'paperclip')
  report.cases.push({ name: 'automation redirects to the AI team', result: 'pass' })
  for (const section of ['connections', 'workflows', 'models']) {
    await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=${section}&lang=vi`)
    await page.locator('.ai-page-heading').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${section} fits 390px`)
    await page.screenshot({ path: path.join(shots, `${section}-390.png`), fullPage: true })
  }
  await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=gateway&lang=vi`)
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.locator('.fx-subnav-link.is-active').waitFor()
  assert.equal((await page.locator('.fx-subnav-link.is-active').innerText()).trim(), 'Kết nối', 'gateway keeps Connections lit')
  report.cases.push({ name: 'gateway lights Connections; 390px pages fit', result: 'pass' })
  assert.deepEqual(report.writes, [])
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify({ passed: true, shots, cases: report.cases }, null, 1))
} finally { await browser.close() }
