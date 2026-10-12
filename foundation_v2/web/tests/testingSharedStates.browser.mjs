import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = '../evidence/testing-shared-states-20261012'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { cases: [], errors: [], writes: [], scope: 'Shared real components with labeled GET fixtures; preview and live SSE read-only smoke' }
try {
  for (const width of [1710, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      return route.continue()
    })
    for (const view of ['overview', 'replay', 'trade', 'analytics', 'market-data']) {
      await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=${view}&select=1&demo=1&ui_state=denied`)
      const state = page.locator('[data-empty-kind=denied]')
      await state.waitFor()
      assert.equal(await state.getAttribute('role'), 'alert')
      assert.equal(await state.locator('button').count(), 0)
      assert.equal(await page.locator('.fx-content .fxa-report,.fx-content .rd-table').count(), 0)
      const centered = await state.evaluate(element => {
        const box = element.getBoundingClientRect(), title = element.querySelector('h2').getBoundingClientRect()
        return Math.abs(box.x + box.width / 2 - title.x - title.width / 2) < 1
      })
      assert.ok(centered)
      report.cases.push({ view, width, theme, case: 'Shared denied preview; no refresh; no protected content' })
    }
    await page.screenshot({ path: `${output}/${theme}-${width}-denied.png`, animations: 'disabled' })
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=overview&select=1&demo=1&ui_state=filtered`)
    await page.locator('[data-empty-kind=filtered-sessions]').waitFor()
    assert.equal(await page.locator('[data-testid=dashboard-performance]').count(), 1)
    assert.match(await page.locator('.fx-dashboard-session-count').innerText(), /0 phiên trong tổng số 3/)
    await page.screenshot({ path: `${output}/${theme}-${width}-filtered.png`, animations: 'disabled' })
    await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.fx-dashboard-session-card').length === 3)
    report.cases.push({ width, theme, case: 'Clear filters restores three sessions and preserves Performance' })
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=analytics&select=1&demo=1&ui_state=empty`)
    await page.locator('[data-empty-kind=sessions]').waitFor()
    await page.screenshot({ path: `${output}/${theme}-${width}-sessions-empty.png`, animations: 'disabled' })
    await context.close()
  }
  const context = await browser.newContext()
  const page = await context.newPage()
  // Only the replay catalog is denied; metadata and SSE do not force a global deny.
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort()
    if (['/api/v2/replay/sessions', '/api/v2/dashboard/sessions'].includes(url.pathname)) return route.fulfill({ status: 403, json: { detail: 'fixture_catalog_denied' } })
    return route.continue()
  })
  for (const view of ['overview', 'replay', 'trade', 'analytics']) {
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=${view}&select=1`)
    await page.locator('[data-empty-kind=denied]').waitFor()
    assert.equal(await page.locator('.fx-content button').count(), 0)
    report.cases.push({ view, interceptedFixture: true, case: 'Actual catalog 403 uses shared denial; no retry or dependent report' })
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`${origin}/api/v2/events`, { headers: { 'X-Workspace-Id': 'tenant-a', Accept: 'text/event-stream' }, signal: controller.signal })
    assert.equal(response.status, 200)
    assert.ok(response.headers.get('content-type').startsWith('text/event-stream'))
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let frame = ''
    while (!frame.includes('event: snapshot') || !frame.includes('\n\n')) {
      const { value, done } = await reader.read()
      assert.ok(!done)
      frame += decoder.decode(value, { stream: true })
    }
    const snapshot = JSON.parse(frame.split('\n').find(line => line.startsWith('data:')).slice(5))
    assert.equal(snapshot.schema_version, 'workspace-events-v1')
    assert.equal(snapshot.workspace_id, 'tenant-a')
    report.liveSSE = { httpStatus: response.status, schema: snapshot.schema_version, workspace: snapshot.workspace_id, keys: Object.keys(snapshot), snapshotOnly: true }
    await reader.cancel()
  } finally { clearTimeout(timer); controller.abort() }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  await writeFile(`${output}/focused-browser.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: 'PASS', cases: report.cases.length, liveSSE: report.liveSSE, errors: report.errors }))
} finally { await browser.close() }
