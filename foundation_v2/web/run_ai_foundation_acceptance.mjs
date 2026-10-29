import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5188'
const evidence = process.env.TW_AI_UI_EVIDENCE || fileURLToPath(new URL('./.artifacts/run_ai_foundation_acceptance', import.meta.url))
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ downloadsPath: path.join(evidence, 'downloads') })
const report = { scope: 'Production bundle with isolated document/workflow fixtures; no paid inference, broker or OAuth', checks: [], errors: [] }
try {
  for (const width of [360, 768, 1440]) for (const lang of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' }), page = await context.newPage(), en = lang === 'en', say = (vi, english) => en ? english : vi
    await context.addInitScript(theme => localStorage.setItem('tw-theme', theme), en ? 'light' : 'dark')
    const documents = new Map(), runs = new Map(), posts = [], selection = { provider: 'local-gateway', model: 'fixture-fast', effort: 'high' }
    let reject = true, loseResponse = false, complete = false, linked = true
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.split('/ai/assistant')[1], method = request.method()
      if (endpoint === '/documents') {
        if (method === 'GET') return route.fulfill({ json: { items: [...documents.values()] } })
        const item = { id: crypto.randomUUID(), name: url.searchParams.get('name'), bytes: request.postDataBuffer().length, sha256: 'a'.repeat(64) }; documents.set(item.id, item)
        return route.fulfill({ status: 201, json: item })
      }
      if (endpoint?.startsWith('/documents/')) {
        const id = endpoint.split('/')[2]
        if (method === 'DELETE') {
          if (linked) return route.fulfill({ status: 409, json: { detail: 'ai_document_in_use' } })
          documents.delete(id); return route.fulfill({ status: 204 })
        }
        return route.fulfill({ body: 'Risk per trade: 0.5%.', contentType: 'text/plain' })
      }
      if (endpoint === '/sources') return route.fulfill({ json: { items: [{ kind: 'replay', id: 'replay-fixture', name: 'Fixture chart', revision: 3 }, { kind: 'research', id: 'quant-fixture', name: 'Fixture Quant' }] } })
      if (endpoint === '/workflows') return route.fulfill({ json: { items: [...runs.values()].map(run => ({ ...run, title: 'Review fixture evidence' })), next: null } })
      if (endpoint === '/workflows/evidence-review') {
        const body = request.postDataJSON(); posts.push(body)
        if (reject) { reject = false; return route.fulfill({ status: 422, json: { detail: 'invalid_ai_source' } }) }
        const existing = [...runs.values()].find(run => run.request_key === body.idempotency_key)
        const run = existing || { id: crypto.randomUUID(), request_key: body.idempotency_key, status: 'running', created_at: '2026-10-23T11:00:00Z', roles: { facts: { selection }, gaps: { selection: { ...selection, provider: 'chatgpt-web', model: 'fixture-strong', effort: 'medium' } }, reviewer: { selection } }, grounding: { source: { kind: 'replay', id: 'replay-fixture', revision: 3, cursor_index: 42, cutoff_timestamp: 1600000020, sha256: 'c'.repeat(64) } }, steps: [{ node: 'facts', selection, status: 'sent' }] }
        runs.set(run.id, run)
        if (loseResponse) { loseResponse = false; return route.abort('failed') }
        return route.fulfill({ status: 202, json: run })
      }
      if (endpoint?.startsWith('/workflows/')) {
        const run = runs.get(endpoint.split('/')[2]); assert.ok(run)
        if (method === 'DELETE') run.status = 'cancelled'
        if (complete && run.status === 'running') { run.status = 'completed'; run.text = 'Evidence reviewed. Remaining uncertainty is explicit.'; run.steps = ['facts', 'gaps', 'reviewer'].map(node => ({ node, selection: run.roles[node].selection, status: 'completed' })) }
        return route.fulfill({ json: run })
      }
      if (endpoint === '/agents') return route.fulfill({ json: { items: [{ id: 'mentor', name: 'Mentor', revision: 0, builtin: true }] } })
      if (endpoint === '/account') return route.fulfill({ json: { provider: 'local-gateway', ready: true, selection } })
      if (endpoint === '/catalog') return route.fulfill({ json: { routes: [{ provider: 'local-gateway', ready: true, models: [{ id: selection.model, name: 'Fixture Fast', efforts: ['high'] }] }] } })
      if (endpoint === '/profiles') return route.fulfill({ json: { items: [], chat_default: { selection } } })
      assert.ok(['GET', 'HEAD'].includes(method), `Unexpected write ${method} ${url}`)
      return route.fulfill({ json: {} })
    })
    const visit = section => page.goto(`${origin}/?workspace=tenant-a&view=ai&area=ai&section=${section}&lang=${lang}`)
    await visit('documents')
    const main = page.getByTestId('ai-workspace')
    await main.getByRole('heading', { name: say('Tài liệu', 'Documents'), exact: true }).waitFor()
    await main.locator('input[type=file]').setInputFiles({ name: 'strategy.md', mimeType: 'text/markdown', buffer: Buffer.from('Risk per trade: 0.5%.\n'.repeat(4000)) })
    await main.locator('.ai-document-list strong').getByText('strategy.md', { exact: true }).waitFor()
    assert.ok([...documents.values()][0].bytes > 65536)
    const downloadEvent = page.waitForEvent('download'); await main.getByRole('button', { name: say('Tải về', 'Download'), exact: true }).click(); const download = await downloadEvent; assert.equal(download.suggestedFilename(), 'strategy.md'); await download.cancel()
    await main.getByRole('button', { name: say('Xóa', 'Delete'), exact: true }).click(); await main.getByRole('button', { name: say('Xác nhận xóa', 'Confirm delete'), exact: true }).click()
    await main.getByRole('alert').filter({ hasText: say('đang được agent', 'used by an agent') }).waitFor()
    await page.screenshot({ path: path.join(evidence, `documents-${lang}-${width}.png`) })
    linked = false
    await main.getByRole('button', { name: say('Xác nhận xóa', 'Confirm delete'), exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.ai-document-list'))
    await visit('workflows')
    const input = main.locator('#ai-workflow-input')
    await input.fill('Review fixture evidence')
    await main.getByRole('button', { name: say('Nguồn dữ liệu chỉ đọc', 'Read-only data source'), exact: true }).click()
    await main.getByRole('option', { name: /Fixture chart/ }).click()
    await main.getByRole('button', { name: say('Chạy đánh giá', 'Run review'), exact: true }).click()
    await main.getByRole('alert').waitFor(); assert.equal(await input.isDisabled(), false, 'A definitive 422 unlocks the editor')
    await main.getByRole('button', { name: say('Chạy đánh giá', 'Run review'), exact: true }).click()
    await main.locator('.ai-workflow-steps li').nth(2).waitFor()
    await main.locator('.ai-workflow-steps').getByText(/fixture-strong/).waitFor()
    await page.screenshot({ path: path.join(evidence, `workflow-running-${lang}-${width}.png`) })
    const sent = posts.length
    await page.reload(); await main.locator('.ai-workflow-steps').waitFor(); assert.equal(posts.length, sent, 'Reload reads the admitted run without resubmitting')
    complete = true
    await main.getByText('Evidence reviewed. Remaining uncertainty is explicit.', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(evidence, `workflow-completed-${lang}-${width}.png`) })
    complete = false; loseResponse = true
    await input.fill('A response may be lost')
    await main.getByRole('button', { name: say('Chạy đánh giá', 'Run review'), exact: true }).click()
    const recover = main.getByRole('button', { name: say('Kiểm tra yêu cầu đã gửi', 'Recover submitted request'), exact: true })
    await recover.waitFor(); await main.getByRole('alert').waitFor(); const key = posts.at(-1).idempotency_key
    await page.reload(); await recover.waitFor(); assert.equal(posts.at(-1).idempotency_key, key, 'Reload never automatically retries an unresolved POST')
    await recover.click(); await main.locator('.ai-workflow-steps').waitFor(); assert.equal(posts.at(-1).idempotency_key, key, 'Explicit recovery reuses the immutable request')
    await main.getByRole('button', { name: say('Dừng', 'Stop'), exact: true }).click()
    await main.getByRole('heading', { name: say('Đã dừng', 'Stopped'), exact: true }).waitFor()
    assert.equal(runs.size, 2, 'Lost response recovery creates no duplicate logical run')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    report.checks.push({ width, lang, passed: true, logicalRuns: runs.size, posts: posts.length })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
} finally { await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report))
