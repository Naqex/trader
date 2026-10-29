import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const web = fileURLToPath(new URL('..', import.meta.url))
const out = process.env.TW_UI_EVIDENCE_DIR || path.join(web, '.artifacts', 'brand')
const server = createServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const preview = spawn(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: 'pipe', windowsHide: true })
let output = ''
preview.stdout.on('data', chunk => { output += chunk })
preview.stderr.on('data', chunk => { output += chunk })
const origin = `http://127.0.0.1:${port}`
let browser
const results = []
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    if (attempt >= 60 || preview.exitCode !== null) throw new Error(`Preview failed: ${output}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.TW_UI_QA_CHROMIUM, headless: true })
  await mkdir(out, { recursive: true })
  for (const theme of ['dark', 'light']) {
    for (const width of [1920, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors = []
      const assets = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('response', response => { if (response.url().includes('naqex') && response.url().includes('.svg')) assets.push(response.status()) })
      await page.addInitScript(value => { localStorage.setItem('tw-theme', value); localStorage.setItem('tw-language', 'vi') }, theme)
      // Shell-only fixture: block broker, external calls and every API mutation.
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort()
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [], datasets: [], reports: [], accounts: [], connections: [], rows: [], items: [], total: 0 }) })
        return route.continue()
      })
      await page.goto(`${origin}/?workspace=brand-fixture&view=overview&lang=vi`, { waitUntil: 'networkidle' })
      await page.getByRole('img', { name: 'Naqex Trader' }).first().waitFor()
      assert.equal(await page.title(), 'Naqex Trader')
      const logo = page.locator('.fx-wordmark-svg')
      const href = await logo.locator('use').getAttribute('href')
      assert.match(href, /naqex.*\.svg#wordmark$/)
      const svgResponse = await context.request.get(new URL(href.split('#')[0], origin).href)
      assert.equal(svgResponse.status(), 200)
      assert.match(await svgResponse.text(), /id="wordmark"/)
      assert.doesNotMatch(await page.locator('body').innerText(), /WMREPLAY|WMReplay/)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document overflow')
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(out, `${theme}-${width}.png`) })
      results.push({ theme, width, passed: true, svg: href, networkStatuses: assets })
      await context.close()
    }
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ scope: 'Isolated shell/brand fixture; no broker or real data acceptance', cases: results }, null, 2))
  console.log(JSON.stringify({ passed: results.length, out }))
} finally {
  await browser?.close()
  preview.kill()
  if (preview.exitCode === null) await Promise.race([once(preview, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))])
}
