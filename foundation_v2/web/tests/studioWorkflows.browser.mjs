import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { localStudioWorkflows } from '../studioWorkflowBridge.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(process.argv[2] || '../.runtime/studio-workflow-observation')
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import StudioWorkflows from '/src/StudioWorkflows.jsx';
import {TestingLocaleProvider} from '/src/testingLocale.jsx';
import '/src/styles.css'; import '/src/fx-shell-story.css'; import '/src/compact-system.css'; import '/src/product-ui-profile.css';
const query=new URLSearchParams(location.search),language=query.get('lang')||'vi';
document.documentElement.dataset.twTheme=query.get('theme')||'dark';
createRoot(document.getElementById('root')).render(<TestingLocaleProvider language={language}>
 <div className="fx-app" data-theme={query.get('theme')||'dark'}><StudioWorkflows language={language} onClose={()=>{window.closedFixture=true}} onNavigate={id=>{window.openedTask=id}}/></div>
</TestingLocaleProvider>);`
const virtual = '\0studio-observation-fixture.jsx'
const server = await createServer({ root, configFile: false,
  cacheDir: path.join(process.env.TEMP || out, 'naqex-studio-observation-vite'),
  plugins: [react(), localStudioWorkflows(), {
    name: 'studio-observation-fixture',
    resolveId(id) { if (id === '/studio-observation-fixture.jsx') return virtual },
    load(id) { if (id === virtual) return transformWithEsbuild(fixture, 'studio-observation-fixture.jsx', { loader: 'jsx', jsx: 'automatic' }) },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/studio-observation-fixture.html')) return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/project-palette.css"></head><body><div id="root"></div><script type="module" src="/studio-observation-fixture.jsx"></script></body></html>'))
    }) },
  }], server: { host: '127.0.0.1', port: 0, hmr: false }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'fast-deep-equal', 'lucide-react'] } })
await mkdir(out, { recursive: true })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch()
const report = { scope: 'Actual Studio component; synthetic observation cases plus optional native draft/cancel, no model or broker calls', cases: [], errors: [] }
const graph = { id: 'parent', company: 'company', project: 'project', title: 'Kiểm luồng Forex', identifier: 'FIX-1', status: 'todo', profile: 'forex', can_start: false, can_cancel: true,
  steps: [{ id: 'source', title: 'Kiểm dữ liệu và mô phỏng EURUSD', role: 'research', status: 'todo', observation: { state: 'not_started', run: null } },
    { id: 'review', title: 'Phản biện kết quả', role: 'review', status: 'blocked', observation: { state: 'not_started', run: null } }] }
const overview = { company: 'company', project: 'project', companies: [{ id: 'company', name: 'Fixture' }], projects: [{ id: 'project', name: 'System check' }], profiles: [{ id: 'forex' }], workflows: [graph] }
try {
  for (const [theme, lang, width] of [['dark', 'vi', 1440], ['light', 'en', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await context.addInitScript(() => sessionStorage.setItem('naqex-studio-workflow:local', JSON.stringify({ company: 'company', project: 'project', parent: 'parent' })))
    let reads = 0, phase = 'queued'
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (url.pathname !== '/integrations/paperclip/workflows') return route.continue()
      const input = req.postDataJSON()
      assert(['overview', 'get'].includes(input.action), 'observation cannot mutate tasks')
      if (input.action === 'overview') return route.fulfill({ json: { ok: true, result: overview } })
      reads++
      if (phase === 'unavailable') return route.fulfill({ status: 503, json: { ok: false, error: 'paperclip_unavailable' } })
      const result = structuredClone(graph)
      if (phase !== 'queued') {
        result.steps[0].status = phase === 'active' ? 'in_progress' : 'blocked'
        result.steps[0].observation = { state: phase === 'active' ? 'active' : phase,
          run: { id: 'a0000000-0000-4000-8000-000000000001', status: phase === 'active' ? 'running' : 'failed', seconds: 64,
            requested_models: [], reported_model: null, input_tokens: null, output_tokens: null, cost_usd: null } }
        if (phase === 'interrupted' || phase === 'delivery_pending') result.status = 'blocked'
      }
      return route.fulfill({ json: { ok: true, result } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/studio-observation-fixture.html?theme=${theme}&lang=${lang}`)
    await page.locator('.studio-workflow-link').first().waitFor()
    await page.clock.install()
    phase = 'active'
    await page.clock.runFor(5200)
    await page.locator('.studio-workflow-run').waitFor()
    assert(reads >= 2, 'queued dispatch gap must keep polling')
    await page.locator('summary').first().click()
    assert.match(await page.locator('dl').innerText(), /Offline/)
    assert.match(await page.locator('dl').innerText(), lang === 'vi' ? /Chưa được báo cáo/ : /Not reported/)
    phase = 'interrupted'
    await page.clock.runFor(5200)
    await page.getByText(lang === 'vi' ? /Lượt chạy đã dừng nhưng/ : /The run stopped without/).waitFor()
    const terminalReads = reads
    await page.clock.runFor(6000)
    assert.equal(reads, terminalReads, 'terminal run must stop automatic polling')
    assert.equal(await page.locator('details[open]').count(), 1, 'expanded run survives polling')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(out, `interrupted-${theme}-${width}.png`) })
    phase = 'delivery_pending'
    await page.getByRole('button', { name: lang === 'vi' ? 'Kiểm tra lại' : 'Refresh', exact: true }).click()
    await page.getByText(lang === 'vi' ? /Kết quả đã lưu/ : /Output was saved/).waitFor()
    phase = 'unavailable'
    await page.getByRole('button', { name: lang === 'vi' ? 'Kiểm tra lại' : 'Refresh', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert(await page.getByRole('button', { name: lang === 'vi' ? 'Dừng' : 'Stop', exact: true }).isDisabled())
    phase = 'interrupted'
    await page.getByRole('button', { name: lang === 'vi' ? 'Kiểm tra lại' : 'Refresh', exact: true }).click()
    await page.getByText(lang === 'vi' ? /Lượt chạy đã dừng nhưng/ : /The run stopped without/).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    report.cases.push(`${theme}/${lang}/${width}: queued→running→interrupted, saved delivery, unknown cost, refresh recovery, no writes`)
    await context.close()
  }
  if (process.argv.includes('--native')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, reducedMotion: 'reduce' })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/studio-observation-fixture.html?lang=vi`)
    await page.getByRole('button', { name: 'Tạo quy trình', exact: true }).click()
    await page.getByRole('button', { name: 'Tạo bản nháp', exact: true }).click()
    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).waitFor()
    const intent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('naqex-studio-workflow:local')))
    assert(intent.parent && !intent.draft, 'native draft stored before cancel')
    await page.reload()
    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Dừng', exact: true }).click()
    await page.getByRole('button', { name: 'Dừng quy trình', exact: true }).click()
    await page.getByText('Đã hủy', { exact: true }).first().waitFor()
    const detail = await page.evaluate(async ({ company, parent }) => (await (await fetch('/integrations/paperclip/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get', company, parent }) })).json()).result, intent)
    assert.equal(detail.status, 'cancelled')
    assert(detail.steps.every(step => step.status === 'cancelled' && !step.observation.run))
    report.native = { parent: intent.parent, status: detail.status, runs: 0, model_calls: 0 }
    report.cases.push('Native authenticated board API via real bridge: draft→reload→cancel, all children cancelled, zero dispatch')
    await page.screenshot({ path: path.join(out, 'native-cancelled.png') })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error); throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close(); await server.close()
  console.log(JSON.stringify(report))
}
