import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const origin = 'http://127.0.0.1:5180'
const output = '../evidence/testing-realtime-20261012/live'
await mkdir(output, { recursive: true })
const abort = new AbortController()
const timer = setTimeout(() => abort.abort(), 10000)
const response = await fetch(`${origin}/api/v2/events`, { headers: { 'X-Workspace-Id': 'tenant-a', Accept: 'text/event-stream' }, signal: abort.signal })
assert.equal(response.status, 200)
const reader = response.body.getReader()
let buffer = '', snapshot
while (!snapshot) {
  const chunk = await reader.read()
  if (chunk.done) throw new Error('No snapshot')
  buffer += new TextDecoder().decode(chunk.value)
  for (const frame of buffer.split('\n\n')) {
    if (frame.includes('event: snapshot') && frame.includes('data: ')) {
      try { snapshot = JSON.parse(frame.split('data: ')[1]) } catch {}
    }
  }
}
assert.equal(snapshot.workspace_id, 'tenant-a')
for (const resource of ['sessions', 'datasets']) {
  assert.equal(typeof snapshot.resources[resource].revision, 'string')
  assert.equal(typeof snapshot.resources[resource].count, 'number')
}
await reader.cancel(); clearTimeout(timer); abort.abort()
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const report = { liveApi: { schema: snapshot.schema_version, resourceFields: Object.keys(snapshot.resources), bytes: JSON.stringify(snapshot.resources).length }, cases: [], pageErrors: [], writes: [] }
try {
  for (const [view, state, width, locale] of [
    ['overview', 'ready', 1563, 'vi'], ['market-data', 'filtered', 1563, 'vi'],
    ['market-data', 'filtered', 390, 'vi'], ['overview', 'reconnecting', 1563, 'en'],
    ['overview', 'offline', 390, 'en'], ['analytics', 'error', 1563, 'en'],
    ['overview', 'live', 1563, 'vi'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(locale => { localStorage.setItem('tw-language', locale); localStorage.setItem('tw-theme', 'dark') }, locale)
    await context.route('**/*', route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { report.writes.push(route.request().url()); return route.abort() }
      if (new URL(route.request().url()).origin !== origin) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.pageErrors.push(error.message))
    const preview = state !== 'live'
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=${view}${preview ? `&demo=1&ui_state=${state}` : ''}`)
    await page.waitForTimeout(1400)
    if (view === 'overview' && state === 'ready') {
      const card = page.locator('.fx-dashboard-session-card').first()
      await card.locator('.fx-dashboard-session-card-head').click()
      await page.waitForTimeout(350)
      await card.locator('.fx-dashboard-card-disclosure-inner').hover()
      await page.waitForTimeout(200)
      assert.equal(await card.evaluate(node => getComputedStyle(node).backgroundColor), await card.evaluate(node => getComputedStyle(node).getPropertyValue('--wm-hover').trim()).then(async token => await page.evaluate(token => { const node=document.createElement('div');node.style.backgroundColor=token;document.body.append(node);const result=getComputedStyle(node).backgroundColor;node.remove();return result }, token)))
    }
    if (state === 'filtered') { assert.equal(await page.locator('[data-empty-kind="filtered-datasets"]').count(), 1); assert.equal(await page.locator('nav.wm-pagination').count(), 0) }
    if (state === 'reconnecting') await page.getByTestId('workspace-connection').filter({ hasText: 'Reconnecting updates' }).waitFor()
    if (state === 'offline') await page.getByTestId('workspace-connection').filter({ hasText: 'Offline' }).waitFor()
    if (state === 'error') assert.match(await page.getByTestId('read-recovery').first().textContent(), /Retrying automatically/)
    await page.screenshot({ path: `${output}/${view}-${state}-${width}-${locale}.png` })
    report.cases.push({ view, state, width, locale })
    await context.close()
  }
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.writes, [])
  await writeFile(`${output}/live-smoke.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
