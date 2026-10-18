import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.argv[2], output = process.argv[3]
assert.ok(origin, 'Pass the isolated Vite origin explicitly')
assert.equal(new URL(origin).hostname, '127.0.0.1')
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Isolated real React components on existing local Vite; synthetic ledger only; no API/owner state access', cases: [], errors: [] }
try {
  const page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort()
    if (url.pathname !== '/__legacy-projection-test') return route.continue()
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="vi"><body><div id="test-root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {default:Positions}=await import('/src/LegacyPositions.jsx');
      const {default:Journal}=await import('/src/LegacyJournal.jsx');
      const {projectionFixture}=await import('/tests/legacyProjectionFixture.mjs');
      const root=createRoot(document.getElementById('test-root'));
      const fixture=projectionFixture(300,10); window.ledgerReads=0;
      function execution(){const value={...fixture}; Object.defineProperty(value,'ledger',{enumerable:false,get(){window.ledgerReads++;return fixture.ledger}}); return value}
      window.projectionProps={execution:execution(),symbol:'EURUSD',active:true,cutoff:1700000300,onClose:()=>{},onOpenJournal:'#'};
      window.renderProjection=(type='positions')=>root.render(React.createElement(type==='journal'?Journal:Positions,window.projectionProps));
      window.replaceProjectionExecution=()=>{window.projectionProps.execution=execution()};
      window.renderProjection();
    </script></body></html>` })
  })
  await page.goto(`${origin}/__legacy-projection-test`)
  await page.getByRole('tab', { name: 'Vị thế đã đóng', exact: true }).click()
  await page.locator('tbody tr').first().waitFor()
  const initialReads = await page.evaluate(() => window.ledgerReads)
  assert.equal(initialReads, 1)
  await page.getByRole('button', { name: 'Trang 2', exact: true }).click()
  assert.equal(await page.evaluate(() => window.ledgerReads), initialReads, 'paging reuses the existing closed projection')
  const firstRow = await page.locator('tbody tr').first().textContent()
  await page.evaluate(() => { window.projectionProps.active = false; window.renderProjection() })
  await page.locator('.legacy-positions').waitFor({ state: 'detached' })
  await page.evaluate(() => { window.replaceProjectionExecution(); window.renderProjection() })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => window.ledgerReads), initialReads, 'hidden dock does not project replacement execution')
  await page.evaluate(() => { window.projectionProps.active = true; window.renderProjection() })
  await page.locator('tbody tr').first().waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Vị thế đã đóng', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('button', { name: 'Trang 2', exact: true }).getAttribute('aria-current'), 'page')
  assert.equal(await page.locator('tbody tr').first().textContent(), firstRow)
  assert.equal(await page.evaluate(() => window.ledgerReads), initialReads + 1)
  report.cases.push('Closed-tab projection cached during pagination; hidden replacement skipped; tab/page/rows preserved after reopen')

  await page.evaluate(() => { window.ledgerReads=0; window.renderProjection('journal') })
  await page.getByRole('searchbox', { name: 'Tìm giao dịch', exact: true }).fill('EURUSD')
  await page.getByRole('tab', { name: 'Lịch', exact: true }).click()
  await page.locator('.legacy-calendar-month').waitFor()
  assert.equal(await page.evaluate(() => window.ledgerReads), 1, 'journal search and calendar tabs reuse the same projection')
  report.cases.push('Journal search/calendar changes reuse the closed projection')
  assert.deepEqual(report.errors, [])
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`) }
  console.log(JSON.stringify(report))
} finally { await browser.close() }
