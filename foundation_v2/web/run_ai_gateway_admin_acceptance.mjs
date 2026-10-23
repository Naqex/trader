import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

// Official panel + real pinned gateway, fresh synthetic credentials; no user account, OAuth or inference.
const evidence = path.resolve(process.env.TW_AI_ADMIN_EVIDENCE || 'E:/BACKUP-TRADINGWORKSPACE/ai-gateway-admin-20261023')
const project = path.resolve(import.meta.dirname, '../..')
const binary = path.join(project, '.runtime/ai-gateway-evaluation/cliproxyapi-v8.0.40/cli-proxy-api.exe')
const panel = path.join(evidence, 'management.html'), home = path.join(evidence, `panel-fixture-${randomUUID()}`)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(await readFile(binary)), '0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443')
assert.equal(sha(await readFile(panel)), '8c9c6b7d3fb311e6aad5d06e1993e53a2d28389e640448a1bc6304ed20b057b5')
await mkdir(path.join(home, 'auth'), { recursive: true })
const admin = randomBytes(32).toString('base64url'), key = randomBytes(32).toString('base64url')
const port = 17854, origin = `http://127.0.0.1:${port}`
const guard = createServer()
await new Promise((resolve, reject) => guard.once('error', reject).listen(port, '127.0.0.1', resolve))
await new Promise(resolve => guard.close(resolve))
const config = path.join(home, 'config.yaml')
await writeFile(config, JSON.stringify({ 'config-version': 8,
  server: { host: '127.0.0.1', port, 'commercial-mode': true, discovery: { enabled: false } },
  management: { 'allow-remote': false, 'secret-key': admin, 'disable-control-panel': false, 'disable-auto-update-panel': true },
  access: { 'api-keys': [key] }, oauth: { 'auth-dir': path.join(home, 'auth') },
  routing: { retry: { 'request-retry': 0, 'max-retry-credentials': 1 } },
  observability: { logs: { 'request-log': false, 'logging-to-file': false }, usage: { 'usage-statistics-enabled': false } },
}))
const child = spawn(binary, ['--local-model', '--config', config], { cwd: home, windowsHide: true,
  env: { ...process.env, MANAGEMENT_PASSWORD: '', MANAGEMENT_STATIC_PATH: panel }, stdio: 'ignore' })
const report = { scope: 'Official pinned Management Center on isolated gateway; synthetic admin only', checks: [], denied: [], errors: [] }
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Isolated gateway exited')
    try { ready = (await fetch(`${origin}/v1/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(500) })).ok } catch {}
    if (ready) break
    await delay(150)
  }
  assert.ok(ready, 'isolated gateway becomes ready')
  browser = await chromium.launch({ headless: true })
  for (const width of [1440, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, locale: 'en-US', reducedMotion: 'reduce' })
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin || request.method() !== 'GET' || /\/oauth\/|auth-url|api-call/.test(url.pathname)) {
        report.denied.push({ path: url.pathname, method: request.method() }); return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/management.html`)
    const input = page.getByPlaceholder('Enter the management key', { exact: true })
    await input.waitFor()
    await page.screenshot({ path: path.join(evidence, `panel-login-${width}.png`) })
    await input.fill(admin)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await input.waitFor({ state: 'hidden' })
    if (width === 360) await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await page.getByRole('link', { name: 'AI Providers', exact: true }).click()
    await page.getByText('Gemini', { exact: false }).first().waitFor()
    // Upstream uses JS route/sidebar transitions even with reduced motion.
    // Sample after the short transition; navigation assertions above still auto-wait.
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(evidence, `panel-providers-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const storage = await page.evaluate(() => JSON.stringify(localStorage))
    assert.ok(!storage.includes(admin), 'remember password is off')
    report.checks.push({ width, status: 'pass', login: 'synthetic management key', providers_page: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
} finally {
  await browser?.close()
  if (child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill(); await exited
  }
  await writeFile(path.join(evidence, 'panel-browser-report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ passed: report.checks.length, errors: report.errors.length, denied: report.denied.length }))
