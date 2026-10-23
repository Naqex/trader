import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

// Actual managed API/gateway, empty auth only. Never starts OAuth or inference.
const evidence = path.resolve('../evidence/ai-gateway-managed-20261023/local')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = [], actions = []
let reads = 0, started = false
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => {
  const url = new URL(request.url())
  if (url.pathname.startsWith('/api/v2/ai/assistant/account')) {
    if (request.method() === 'GET') reads++
    else actions.push(url.pathname.split('/').at(-1))
  }
  assert.ok(!/accounts\.google\.com/.test(url.hostname), 'No Google login during smoke test')
  assert.ok(!/\/ai\/assistant\/chat/.test(url.pathname), 'No inference during smoke test')
})
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
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=ai&area=ai&section=connections&lang=vi')
  const section = page.getByTestId('ai-provider-settings')
  await section.getByRole('button', { name: 'Nhà cung cấp AI', exact: true }).waitFor()
  if ((await account()).value.provider !== 'local-gateway') {
    await section.getByRole('button', { name: 'Nhà cung cấp AI', exact: true }).click()
    await page.getByRole('option', { name: 'CLIProxyAPI local', exact: true }).click()
  }
  await section.getByRole('button', { name: 'Kết nối Google', exact: true }).waitFor()
  const before = (await account()).value
  assert.equal(before.runtime.managed, true)
  assert.equal(before.runtime.running, false)
  assert.equal(before.runtime.accounts, 0, 'Only run against empty auth')
  assert.equal(before.operation, null)
  const idle = reads
  await page.waitForTimeout(1800)
  assert.equal(reads, idle)
  const running = await account('start')
  started = true
  assert.equal(running.status, 200)
  assert.equal(running.value.runtime.running, true)
  assert.equal(running.value.runtime.external, false)
  assert.equal(running.value.ready, false)
  assert.deepEqual(running.value.models, [])
  await page.reload()
  await section.getByRole('button', { name: 'Tắt kết nối', exact: true }).click()
  await section.getByText('Đã tắt', { exact: true }).waitFor()
  const stopped = (await account()).value
  assert.equal(stopped.runtime.running, false)
  assert.equal(stopped.runtime.accounts, 0)
  assert.equal(stopped.operation, null)
  assert.equal(stopped.ready, false)
  assert.deepEqual(errors, [])
  assert.ok(actions.every(action => ['provider', 'start', 'stop'].includes(action)))
  await section.screenshot({ path: path.join(evidence, 'managed-stopped-vi.png') })
  const report = { scope: 'Actual UI5180 → new API8010 → owned pinned gateway; no OAuth/inference/broker orders',
    checks: ['Managed controls exposed', 'Page load is lazy; no idle polling', 'Empty gateway starts through actual API', 'Real UI stop cleans owned gateway', 'Credentials remain empty; no page errors'], passed: true }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  if (started) await account('stop').catch(() => {})
  await browser.close()
}
