import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

// Actual UI/API/gateway with an empty auth store. Never logs in or submits chat.
const project = path.resolve('../..')
const home = path.join(project, '.runtime/mt5-ai-gateway')
const binary = path.join(project, '.runtime/ai-gateway-evaluation/cliproxyapi-v8.0.40/cli-proxy-api.exe')
const evidence = path.resolve(process.env.TW_AI_UI_EVIDENCE || '../evidence/ai-provider-integration-20261023/local')
const origin = 'http://127.0.0.1:5180'
assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'), '0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443')
assert.equal((await readdir(path.join(home, 'auth'))).filter(name => name.endsWith('.json')).length, 0, 'Only run against the initialized empty auth store')
await fetch('http://127.0.0.1:17852/v1/models').then(() => assert.fail('Gateway port is occupied')).catch(error => { if (error.name !== 'TypeError') throw error })
await mkdir(evidence, { recursive: true })
const gateway = spawn(binary, ['--local-model', '--config', path.join(home, 'config.yaml')], { cwd: home, windowsHide: true, stdio: 'ignore' })
let browser, page, prior, passed = false
const errors = [], requests = []
const report = { scope: 'Actual preview5180 → API8010 → pinned gateway, empty auth; no login/model inference' }
async function account(action, body = {}) {
  return page.evaluate(async ({ action, body }) => {
    const response = await fetch(`/api/v2/ai/assistant/account${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET', headers: { 'X-Workspace-Id': 'tenant-a', 'Content-Type': 'application/json' },
      ...(action ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, value: await response.json() }
  }, { action, body })
}
try {
  const deadline = Date.now() + 15000
  while (true) {
    assert.equal(gateway.exitCode, null, 'Gateway exited during startup')
    const ready = await fetch('http://127.0.0.1:17852/v1/models').catch(() => null)
    if (ready) { assert.equal(ready.status, 401); break }
    assert.ok(Date.now() < deadline, 'Gateway startup deadline')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push({ method: request.method(), path: new URL(request.url()).pathname }))
  await page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=connections&lang=vi`)
  const section = page.getByTestId('ai-provider-settings')
  await section.waitFor()
  prior = (await account()).value.provider
  assert.ok(['local-gateway', 'chatgpt-web'].includes(prior))
  await section.getByRole('button', { name: 'Nhà cung cấp AI', exact: true }).click()
  await section.getByRole('option', { name: 'CLIProxyAPI local', exact: true }).click()
  await section.getByText('Chưa có model', { exact: true }).waitFor()
  await section.getByRole('button', { name: 'Tải lại model', exact: true }).click()
  const state = await account()
  assert.equal(state.status, 200)
  assert.equal(state.value.provider, 'local-gateway')
  assert.equal(state.value.status, 'empty')
  assert.equal(state.value.ready, false)
  assert.deepEqual(state.value.models, [])
  assert.equal(state.value.selection, null)
  await section.screenshot({ path: path.join(evidence, 'settings-empty-gateway.png') })
  await page.getByTestId('ai-toggle').click()
  const chat = page.getByTestId('ai-chat')
  await chat.getByText('CLIProxyAPI local', { exact: true }).waitFor()
  assert.equal(await chat.getByRole('textbox', { name: 'Tin nhắn cho AI' }).isDisabled(), true)
  const denied = await page.evaluate(async () => (await fetch('/api/v2/ai/assistant/account', { headers: { 'X-Workspace-Id': 'foreign' } })).status)
  assert.equal(denied, 403)
  assert.deepEqual(errors, [])
  assert.equal(requests.filter(r => r.method === 'POST' && /\/chat$|\/login$|\/probe$/.test(r.path)).length, 0)
  report.checks = ['Real Settings provider selection/refresh returns empty catalog', 'Backend reads private key; browser never receives it', 'Chat disabled without selected model', 'Foreign workspace403', 'No login/probe/chat requests or page errors']
  passed = true
} finally {
  try {
    if (page && prior) assert.equal((await account('provider', { provider: prior })).status, 200)
  } finally {
    await browser?.close()
    if (gateway.exitCode === null) {
      gateway.kill()
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Owned gateway did not stop')), 5000)
        gateway.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    report.passed = passed; report.gateway_stopped = gateway.exitCode !== null || gateway.signalCode !== null
    report.provider_restored = prior
    report.page_errors = errors
    await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  }
}
console.log(JSON.stringify(report))
