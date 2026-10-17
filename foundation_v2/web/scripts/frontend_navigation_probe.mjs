import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.argv[2])
const fixtureFile = path.join(path.dirname(output), 'navigation-fixtures.json')
const capture = process.argv.includes('--capture-get-fixtures')
const fixture = capture ? {} : JSON.parse(await readFile(fixtureFile, 'utf8'))
const baseline = process.argv.includes('--baseline-source')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sources = ['DashboardSessions.jsx', 'AnalyticsWorkspace.jsx']
const overrides = new Map(sources.map(name => [path.join(root, 'src', name).replaceAll('\\', '/'), baseline
  ? execFileSync('git', ['show', `${revision}:foundation_v2/web/src/${name}`], { cwd: root, encoding: 'utf8' }) : null]))
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async name => [name, createHash('sha256').update(baseline ? overrides.get(path.join(root, 'src', name).replaceAll('\\', '/')) : await readFile(path.join(root, 'src', name))).digest('hex')])))
const built = await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', build: { write: false }, plugins: baseline ? [{ name: 'frozen-baseline-source', enforce: 'pre', load(id) { return overrides.get(id) ?? null } }] : [] })
const files = new Map(built.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]))
const errors = [], blocked = [], samples = []
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method !== 'GET') { blocked.push({ method: req.method, path: url.pathname }); res.writeHead(405); res.end(); return }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/v2/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`event: snapshot\ndata: ${JSON.stringify({ schema_version: 'workspace-events-v1', workspace_id: 'tenant-a', resources: { sessions: { revision: 'frozen' }, datasets: { revision: 'frozen' } } })}\n\n`)
        return
      }
      const key = req.url
      if (!fixture[key] && capture) {
        const response = await fetch('http://127.0.0.1:8010' + req.url, { headers: { 'X-Workspace-Id': 'tenant-a' }, signal: AbortSignal.timeout(20000) })
        fixture[key] = { status: response.status, body: await response.text() }
      }
      if (!fixture[key]) throw new Error(`No frozen GET fixture: ${key}`)
      res.writeHead(fixture[key].status, { 'Content-Type': 'application/json' }); res.end(fixture[key].body); return
    }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    let data = files.get(pathname)
    if (!data) {
      const file = path.resolve(root, 'public', '.' + pathname)
      if (!file.startsWith(path.join(root, 'public') + path.sep)) throw new Error('Invalid asset path')
      data = await readFile(file)
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
    res.writeHead(200, { 'Content-Type': mime[path.extname(pathname)] || 'application/octet-stream' }); res.end(data)
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end(error.message) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  for (let sample = 0; sample < 7; sample++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 987 } })
    await context.addInitScript(() => {
      localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark')
      window.__qaLongTasks = []
      new PerformanceObserver(list => window.__qaLongTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing`, { waitUntil: 'domcontentloaded' })
    await page.locator('.fx-dashboard-quick-actions').waitFor({ timeout: 30000 })
    await page.locator('.fx-dashboard-results[aria-busy="false"]').waitFor({ timeout: 30000 })
    const cold = await page.evaluate(() => ({ readyMs: performance.now(), scripts: performance.getEntriesByType('resource').filter(entry => entry.initiatorType === 'script').map(entry => ({ path: new URL(entry.name).pathname, bytes: entry.encodedBodySize })), longTasks: window.__qaLongTasks }))
    // Opening creation is reversible; no submit, no owner mutation.
    await page.locator('.fx-dashboard-quick-action.is-primary').click()
    await page.getByRole('dialog').waitFor({ timeout: 20000 })
    await page.getByRole('dialog').getByText('Đang tải danh mục dữ liệu…', { exact: true }).waitFor({ state: 'hidden' })
    await page.getByRole('dialog').evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
    assert.equal(await page.getByRole('dialog').count(), 1)
    const dialogStyles = await page.getByRole('dialog').evaluate(node => {
      const s = getComputedStyle(node), r = node.getBoundingClientRect()
      return { background: s.backgroundColor, color: s.color, border: s.border, width: r.width, height: r.height }
    })
    samples.push({ sample, cold, dialogOpened: true, dialogStyles })
    if (sample === 0) await page.screenshot({ path: path.join(path.dirname(output), path.basename(output, '.json') + '-dialog.png') })
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(blocked, [])
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await mkdir(path.dirname(output), { recursive: true })
  if (capture) await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + '\n')
  await writeFile(output, JSON.stringify({ scope: 'Production build; cold isolated Chromium contexts, loopback static assets, frozen local read-only API snapshots, no artificial latency. Timing includes Playwright ready observation, not field INP. Baseline/candidate use identical payload fixtures.', runtime: { node: process.version }, baseline, revision, sourceHashes, samples, errors, blocked }, null, 2) + '\n')
}
console.log(JSON.stringify({ output, samples: samples.length }))
