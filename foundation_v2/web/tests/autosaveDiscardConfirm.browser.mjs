import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.AUTOSAVE_FIXTURE_PORT || 5243)
const virtualId = '\0autosave-discard-fixture.jsx'
// The adapter always rejects saves with 409, so a typed draft lands in the conflict state without any API.
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import useAutosave, {AutosaveStatus} from '/src/useAutosave.jsx'
import {TestingLocaleProvider} from '/src/testingLocale.jsx'
import '/src/styles.css'
const adapter = {
  load: async () => ({ value: 'server copy', record: { revision: 2 }, savedAt: '2026-11-01T00:00:00Z' }),
  save: async () => { throw Object.assign(new Error('conflict'), { status: 409 }) },
}
function Fixture(){
  const save = useAutosave({ identity: 'autosave-discard-fixture', initialValue: '', adapter })
  return <><textarea aria-label="Draft" value={save.value} onChange={event=>save.change(event.target.value)}/><button id="flush" onClick={()=>void save.flush()}>Flush</button><output id="value">{save.value}</output><output id="phase">{save.phase}</output><AutosaveStatus save={save}/></>
}
sessionStorage.clear()
createRoot(document.getElementById('root')).render(<TestingLocaleProvider language="vi"><Fixture/></TestingLocaleProvider>)
`
const server = await createServer({ root, configFile: false, cacheDir: path.join(process.env.TEMP || root, 'naqex-autosave-discard-vite-cache'), plugins: [react(), {
  name: 'autosave-discard-fixture',
  resolveId(id) { if (id === '/autosave-discard-fixture.jsx') return virtualId },
  async load(id) { if (id === virtualId) return transformWithEsbuild(fixture, 'autosave-discard-fixture.jsx', { loader: 'jsx', jsx: 'automatic' }) },
  configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/autosave-discard-fixture.html')) return next()
    const html = '<!doctype html><html><head><link rel="stylesheet" href="/project-palette.css"></head><body><div id="root"></div><script type="module" src="/autosave-discard-fixture.jsx"></script></body></html>'
    res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html))
  }) },
}], server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'fast-deep-equal'] } })
await server.listen()
const origin = `http://127.0.0.1:${port}`
const browser = await chromium.launch({ headless: true })
const errors = [], writes = []
try {
  const page = await browser.newPage()
  page.on('dialog', dialog => { errors.push(`native ${dialog.type()}: ${dialog.message()}`); void dialog.dismiss() })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname.startsWith('/api/')) { if (req.method() !== 'GET') writes.push(url.pathname); return route.abort() }
    return route.continue()
  })
  await page.goto(`${origin}/autosave-discard-fixture.html`)
  const value = page.locator('#value'), phase = page.locator('#phase')
  await page.getByLabel('Draft').waitFor()
  await page.getByLabel('Draft').fill('my draft')
  await page.locator('#flush').click()
  await page.waitForFunction(() => document.querySelector('#phase').textContent === 'conflict')
  const reload = page.getByRole('button', { name: 'Tải bản đã lưu', exact: true })
  const confirm = page.getByRole('dialog', { name: 'Tải bản đã lưu' })

  await reload.click(); await confirm.waitFor()
  await confirm.getByRole('button', { name: 'Hủy', exact: true }).click()
  await confirm.waitFor({ state: 'detached' })
  assert.equal(await value.textContent(), 'my draft'); assert.equal(await phase.textContent(), 'conflict')

  await reload.click(); await confirm.waitFor()
  await page.keyboard.press('Escape'); await confirm.waitFor({ state: 'detached' })
  assert.equal(await value.textContent(), 'my draft')

  await reload.click(); await confirm.waitFor()
  await confirm.getByRole('button', { name: 'Tải bản đã lưu', exact: true }).click()
  await confirm.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.querySelector('#value').textContent === 'server copy')
  assert.equal(await phase.textContent(), 'saved')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  console.log(JSON.stringify({ cancelKeepsDraft: true, escapeKeepsDraft: true, confirmDiscards: true, nativeDialogs: 0, writes: writes.length }))
} finally {
  await browser.close(); await server.close()
}
