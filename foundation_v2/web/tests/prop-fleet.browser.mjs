import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const web = fileURLToPath(new URL('..', import.meta.url))
const out = process.env.TW_UI_EVIDENCE_DIR || path.join(web, '.artifacts', 'prop-fleet')
const w5ScreenshotDir = process.env.TW_W5_SCREENSHOT_DIR || out

function parseRgb(color) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(String(color || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function relativeLuminance([r, g, b]) {
  const lin = c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const server = createServer()
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
await new Promise(resolve => server.close(resolve))

const preview = spawn(
  process.execPath,
  [path.join(web, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: web, stdio: 'pipe', windowsHide: true },
)
let output = ''
preview.stdout.on('data', chunk => { output += chunk })
preview.stderr.on('data', chunk => { output += chunk })
const origin = `http://127.0.0.1:${port}`

let browser
const report = {
  scope: 'Prop Fleet Lifecycle Web Cockpit (?view=prop-fleet) offline QA-01..QA-06; zero /api/* calls, zero mutations',
  matrix: [],
  checks: {},
  errors: [],
  apiRequests: [],
  mutations: [],
}

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    if (attempt >= 60 || preview.exitCode !== null) throw new Error(`Preview failed: ${output}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await mkdir(out, { recursive: true })
  browser = await chromium.launch({ executablePath: process.env.TW_UI_QA_CHROMIUM, headless: true })

  // -------------------------------------------------------------------------
  // QA-01 & Matrix: 1440 / 768 / 360 x dark / light x vi / en
  // -------------------------------------------------------------------------
  const matrixCases = [
    [1440, 'dark', 'vi'],
    [1440, 'light', 'en'],
    [768, 'dark', 'en'],
    [768, 'light', 'vi'],
    [360, 'dark', 'vi'],
    [360, 'light', 'en'],
  ]
  for (const [width, theme, lang] of matrixCases) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const caseErrors = []
    const caseApi = []
    page.on('pageerror', error => { caseErrors.push(error.message); report.errors.push(error.message) })
    page.on('console', msg => { if (msg.type() === 'error') { caseErrors.push(msg.text()); report.errors.push(msg.text()) } })
    await page.addInitScript(({ themeValue, langValue }) => {
      localStorage.setItem('tw-theme', themeValue)
      localStorage.setItem('tw-language', langValue)
    }, { themeValue: theme, langValue: lang })
    await page.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort()
      if (url.pathname.startsWith('/api/')) {
        caseApi.push(`${request.method()} ${url.pathname}`)
        report.apiRequests.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      }
      if (request.method() !== 'GET' && request.method() !== 'HEAD') {
        report.mutations.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      }
      return route.continue()
    })

    await page.goto(`${origin}/?workspace=prop-fleet-fixture&view=prop-fleet&lang=${lang}`, { waitUntil: 'networkidle' })
    await page.getByTestId('prop-fleet-workspace').waitFor()
    assert.equal(await page.title(), 'Naqex Trader')
    const bodyText = await page.locator('body').innerText()
    assert.doesNotMatch(bodyText, /WMREPLAY|WMReplay/)
    assert.doesNotMatch(bodyText, /\bP\/L\b/)

    // Shell active navigation checks
    assert.equal(await page.locator('.fx-subnav a[aria-current="page"]').innerText(), 'Prop Fleet')
    assert.equal(await page.locator('main, [role="main"]').count(), 1, 'Strictly 1 main landmark')

    // Zero horizontal document overflow
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    assert.ok(overflow.scrollWidth <= overflow.innerWidth + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`)

    // Contrast & seam check on desktop
    const colors = await page.evaluate(() => {
      const pageEl = document.querySelector('.pf-page')
      const kpiCell = document.querySelector('.pf-kpi-cell')
      const ps = getComputedStyle(pageEl)
      const ks = getComputedStyle(kpiCell)
      return {
        pageFg: ps.color,
        pageBg: ps.backgroundColor,
        kpiBg: ks.backgroundColor,
        kpiBorderLeft: ks.borderLeftWidth,
        kpiBoxShadow: ks.boxShadow,
      }
    })
    const ratio = contrastRatio(parseRgb(colors.pageFg), parseRgb(colors.pageBg))
    assert.ok(ratio >= 4.5, `Contrast ratio too low (${ratio.toFixed(2)}) on ${theme}`)
    assert.equal(colors.kpiBorderLeft, '0px', 'KPI cell uses hairline grid gap without doubled borders')
    assert.equal(colors.kpiBoxShadow, 'none', 'Flat-first KPI cell must have zero drop shadow')

    assert.deepEqual(caseErrors, [], `Errors on ${width}/${theme}/${lang}`)
    assert.deepEqual(caseApi, [], `Unexpected /api/* requests on prop-fleet: ${caseApi.join(', ')}`)

    if (width === 1440) {
      await page.screenshot({ path: path.join(out, `prop-fleet-${theme}-1440-${lang}.png`), fullPage: false })
    }
    report.matrix.push({ width, theme, lang, contrast: Number(ratio.toFixed(2)), apiRequests: 0, passed: true })
    await context.close()
  }
  report.checks.QA01_matrix_landmark_overflow = true

  // -------------------------------------------------------------------------
  // QA-02..QA-06: Behavioral Oracle, Fail-Closed S4->S5, Reload, Export/Import, Keyboard
  // -------------------------------------------------------------------------
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', acceptDownloads: true })
  const page = await context.newPage()
  const flowErrors = []
  const flowApi = []
  page.on('pageerror', error => { flowErrors.push(error.message); report.errors.push(error.message) })
  page.on('console', msg => { if (msg.type() === 'error') { flowErrors.push(msg.text()); report.errors.push(msg.text()) } })
  await page.addInitScript(() => {
    localStorage.setItem('tw-theme', 'dark')
    localStorage.setItem('tw-language', 'vi')
  })
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort()
    if (url.pathname.startsWith('/api/')) {
      flowApi.push(`${request.method()} ${url.pathname}`)
      report.apiRequests.push(`${request.method()} ${url.pathname}`)
      return route.abort()
    }
    return route.continue()
  })

  // QA-02a: ?view=prop-fleet&demo=1 MUST render PropFleetWorkspace, NEVER <DemoJournal />
  await page.goto(`${origin}/?workspace=prop-fleet-fixture&view=prop-fleet&demo=1&lang=vi`, { waitUntil: 'networkidle' })
  await page.getByTestId('prop-fleet-workspace').waitFor()
  assert.equal(await page.locator('.ja-page').count(), 0, '?demo=1 must not hijack to DemoJournal')

  // QA-03: Bundled fixture oracle & safety badges
  await page.goto(`${origin}/?workspace=prop-fleet-fixture&view=prop-fleet&lang=vi`, { waitUntil: 'networkidle' })
  await page.getByTestId('prop-fleet-workspace').waitFor()
  const safetyText = await page.getByTestId('pf-safety-bar').innerText()
  assert.match(safetyText, /OrderSend = 0/)
  assert.match(safetyText, /Holdout 2025\+ SEALED/)
  for (const aid of ['FTMO-STD10K-001', 'FTMO-STD25K-004', 'FTMO-SWING10K-002', 'THE5ERS-HS5K-003']) {
    assert.equal(await page.getByTestId(`pf-account-row-${aid}`).count(), 1, `Missing row ${aid}`)
  }
  const reserveText = await page.getByTestId('pf-kpi-reserve').innerText()
  assert.match(reserveText, /486[.,]08/)
  assert.match(reserveText, /166[.,]43/)
  assert.match(reserveText, /221[.,]91/)
  const capText = await page.getByTestId('pf-kpi-funded-cap').innerText()
  assert.match(capText, /10[.,]000/)
  for (const code of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']) {
    const cell = page.getByTestId(`pf-guard-${code}`)
    assert.equal(await cell.count(), 1)
    assert.equal(await cell.locator('.pf-dot').count(), 1, `Guard ${code} must render semantic dot + text`)
  }
  assert.equal(await page.locator('[data-testid="pf-pareto-table"] tbody tr').count(), 9)
  report.checks.QA03_fixture_oracle_and_guards = true

  // QA-04: Fail-closed S4->S5 transition + localStorage reload + Reset Fixture
  await page.getByTestId('pf-advance-btn-FTMO-SWING10K-002').click()
  await page.getByTestId('pf-transition-modal').waitFor()

  // 4a: open_positions = 1 rejected fail-closed
  await page.getByTestId('pf-modal-open-positions').fill('1')
  await page.getByTestId('pf-modal-flat-confirm').check()
  await page.getByTestId('pf-modal-ops2-pass').check()
  await page.getByTestId('pf-modal-fill-sha').click()
  await page.getByTestId('pf-modal-submit').click()
  assert.match(await page.getByTestId('pf-modal-error').innerText(), /OPEN_POSITIONS_NONZERO_HANDOFF/)

  // 4b: Eval preset on Funded S4->S5 rejected fail-closed
  await page.getByTestId('pf-modal-open-positions').fill('0')
  await page.getByTestId('pf-modal-preset-mode').selectOption('EVAL_P1_SPRINT_4_5X')
  await page.getByTestId('pf-modal-submit').click()
  assert.match(await page.getByTestId('pf-modal-error').innerText(), /EVAL_PRESET_FORBIDDEN_ON_FUNDED/)

  // 4c: ops2_preflight_pass=false rejected fail-closed
  await page.getByTestId('pf-modal-preset-mode').selectOption('FUNDED_1X')
  await page.getByTestId('pf-modal-preset-name').fill('FTMO_Swing10K_Funded_Safe_1x.set')
  await page.getByTestId('pf-modal-ops2-pass').uncheck()
  await page.getByTestId('pf-modal-submit').click()
  assert.match(await page.getByTestId('pf-modal-error').innerText(), /OPS2_PREFLIGHT_NOT_PASSED/)

  // Account must still be in S4 before valid submit
  assert.match(await page.getByTestId('pf-account-row-FTMO-SWING10K-002').innerText(), /S4/)

  // 4d: Valid S4->S5 succeeds -> S5, 14 transitions, $20,000 funded nominal
  await page.getByTestId('pf-modal-ops2-pass').check()
  await page.getByTestId('pf-modal-submit').click()
  await page.getByTestId('pf-transition-modal').waitFor({ state: 'detached' })
  assert.match(await page.getByTestId('pf-account-row-FTMO-SWING10K-002').innerText(), /S5/)
  assert.match(await page.getByTestId('pf-transition-count').innerText(), /14/)
  assert.match(await page.getByTestId('pf-kpi-funded-cap').innerText(), /20[.,]000/)

  // 4e: Reload preserves localStorage draft
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('prop-fleet-workspace').waitFor()
  assert.match(await page.getByTestId('pf-account-row-FTMO-SWING10K-002').innerText(), /S5/)
  assert.match(await page.getByTestId('pf-transition-count').innerText(), /14/)

  // 4f: Reset Fixture restores 4 accounts / 13 transitions / S4
  await page.getByTestId('pf-reset-btn').click()
  assert.match(await page.getByTestId('pf-account-row-FTMO-SWING10K-002').innerText(), /S4/)
  assert.match(await page.getByTestId('pf-transition-count').innerText(), /13/)
  report.checks.QA04_fail_closed_s4_s5_and_persistence = true

  // QA-05: Tampered JSON Import rejected & Export -> Re-import round-trip
  await page.getByTestId('pf-import-input').setInputFiles({
    name: 'tampered.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema_version: 'naqex-prop-fleet-ledger-v1',
      order_send_capable: true,
      order_send_count: 1,
      holdout_rows_analysed: 0,
      accounts: [],
      transitions: [],
    })),
  })
  await page.getByTestId('pf-page-alert').filter({ hasText: 'ORDER_SEND_CAPABLE_TAMPER' }).waitFor()
  assert.match(await page.getByTestId('pf-page-alert').innerText(), /ORDER_SEND_CAPABLE_TAMPER/)
  assert.equal(await page.locator('[data-testid="pf-fleet-table"] tbody tr').count(), 4)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('pf-export-btn').click(),
  ])
  assert.equal(download.suggestedFilename(), 'fleet_ledger.json')
  const downloadPath = path.join(out, 'exported_fleet_ledger.json')
  await download.saveAs(downloadPath)
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'))
  assert.equal(exported.schema_version, 'naqex-prop-fleet-ledger-v1')
  assert.equal(exported.order_send_capable, false)
  assert.equal(exported.order_send_count, 0)
  assert.equal(exported.holdout_rows_analysed, 0)
  assert.equal(exported.transitions.length, 13)
  assert.equal(exported.transitions[0].prev_event_sha256, '0'.repeat(64))

  await page.getByTestId('pf-import-input').setInputFiles(downloadPath)
  await page.getByTestId('pf-page-alert').filter({ hasText: 'IMPORT_VERIFIED' }).waitFor()
  assert.match(await page.getByTestId('pf-page-alert').innerText(), /IMPORT_VERIFIED/)
  assert.match(await page.getByTestId('pf-transition-count').innerText(), /13/)
  report.checks.QA05_import_reject_and_export_roundtrip = true

  // QA-06: VI <-> EN toggle, Dark <-> Light toggle, Keyboard FxSelect & LegacyModal Escape
  await page.getByTestId('language-toggle').click()
  await page.locator('html[lang="en"]').waitFor()
  await page.locator('#pf-page-title').filter({ hasText: /Prop Fleet Lifecycle/i }).waitFor()
  const enTitle = await page.locator('#pf-page-title').innerText()
  assert.match(enTitle, /Prop Fleet Lifecycle/i)
  assert.doesNotMatch(await page.locator('body').innerText(), /\bP\/L\b/)

  await page.getByTestId('theme-toggle').click()
  await page.locator('.fx-app[data-theme="light"]').waitFor()
  await page.screenshot({ path: path.join(out, 'prop-fleet-light-1440-verified.png'), fullPage: false })

  // Keyboard Escape on FxSelect & LegacyModal returns focus to opener
  const stateTrigger = page.getByTestId('pf-filter-state')
  await stateTrigger.focus()
  await stateTrigger.click()
  await page.keyboard.press('Escape')
  assert.equal(await stateTrigger.getAttribute('aria-expanded'), 'false')
  assert.equal(await stateTrigger.evaluate(el => el === document.activeElement), true)

  const modalOpener = page.getByTestId('pf-open-transition-modal')
  await modalOpener.focus()
  await modalOpener.click()
  await page.getByTestId('pf-transition-modal').waitFor()
  await page.keyboard.press('Escape')
  await page.getByTestId('pf-transition-modal').waitFor({ state: 'detached' })
  assert.equal(await modalOpener.evaluate(el => el === document.activeElement), true)
  report.checks.QA06_i18n_theme_and_keyboard = true

  // -------------------------------------------------------------------------
  // QA-07: Wave 5 Spectrum & Alpha Bench Tabs (Dark VI & Light EN + Screenshots)
  // -------------------------------------------------------------------------
  await mkdir(w5ScreenshotDir, { recursive: true })

  // 7a: Switch to Dark VI and inspect Wave 5 Spectrum tab
  await page.getByTestId('language-toggle').click()
  await page.locator('html[lang="vi"]').waitFor()
  await page.getByTestId('theme-toggle').click()
  await page.locator('.fx-app:not([data-theme="light"])').waitFor()

  await page.getByTestId('pf-tab-spectrum').click()
  await page.getByTestId('pf-w5-spectrum-panel').waitFor()
  await page.getByTestId('pf-w5-scorecard-gauge').waitFor()
  assert.equal(await page.locator('[data-testid="pf-w5-spectrum-table"] tbody tr').count(), 9)
  assert.equal(await page.getByTestId('pf-w5-t5-row-badge').count(), 1)

  // Verify 100.0% partitions visible on default T3_BALANCED_EV 1.0x
  for (const partId of ['pf-w5-partition-p1', 'pf-w5-partition-p2', 'pf-w5-partition-eval']) {
    const partText = await page.getByTestId(partId).innerText()
    assert.match(partText, /100[.,]0%/, `${partId} must display exact 100.0% sum`)
  }
  assert.equal(await page.getByTestId('pf-w5-overall-grade').getAttribute('data-grade'), 'GOOD')
  assert.match(await page.getByTestId('pf-w5-w4-compare').innerText(), /Chưa tách riêng P1\/P2 ở dữ liệu Đợt 4/)

  // Verify zero bare '$' in Wave 5 Spectrum panel prose & >= 4.5:1 contrast & zero overflow
  const specPanelText = await page.getByTestId('pf-w5-spectrum-panel').innerText()
  assert.equal(specPanelText.includes('$'), false, 'Wave 5 Spectrum panel must use USD/VND, zero bare $')
  assert.doesNotMatch(specPanelText, /\bP\/L\b/)
  const specOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  assert.ok(specOverflow.scrollWidth <= specOverflow.innerWidth + 1, `Spectrum overflow: ${JSON.stringify(specOverflow)}`)
  const specColorsDark = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="pf-w5-scorecard-gauge"] .pf-w5-scorecard-cell')
    const st = getComputedStyle(el)
    return { fg: st.color, bg: st.backgroundColor }
  })
  const specRatioDark = contrastRatio(parseRgb(specColorsDark.fg), parseRgb(specColorsDark.bg))
  assert.ok(specRatioDark >= 4.5, `Spectrum dark contrast too low: ${specRatioDark.toFixed(2)}`)

  // Dismiss previous import banner and scroll to top for clean Wave 5 Spectrum Dark VI screenshot
  const closeAlert = page.locator('[data-testid="pf-page-alert"] button')
  if (await closeAlert.count()) await closeAlert.first().click()
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.fx-main, .fx-content')) el.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await page.screenshot({
    path: path.join(w5ScreenshotDir, 'prop-fleet-w5-spectrum-dark-vi.png'),
    fullPage: false,
  })

  // Toggle 1.0x -> 1.5x Stress and verify grade shift (GOOD -> ADEQUATE on T3) + 100K switch
  await page.getByTestId('pf-w5-friction-15x').click()
  assert.equal(await page.getByTestId('pf-w5-overall-grade').getAttribute('data-grade'), 'ADEQUATE')
  await page.getByTestId('pf-w5-profile-100k').click()
  assert.equal(await page.getByTestId('pf-w5-overall-grade').getAttribute('data-grade'), 'ADEQUATE')
  await page.getByTestId('pf-w5-friction-1x').click()
  assert.equal(await page.getByTestId('pf-w5-overall-grade').getAttribute('data-grade'), 'GOOD')

  // Click T5_MAX_THROTTLE_YOLO and verify loud research-boundary & gambling warning banner
  await page.getByTestId('pf-w5-sched-btn-T5_MAX_THROTTLE_YOLO').click()
  await page.getByTestId('pf-w5-t5-warning').waitFor()
  const t5WarnText = await page.getByTestId('pf-w5-t5-warning').innerText()
  assert.match(t5WarnText, /RESEARCH_BOUNDARY_ONLY/)
  assert.match(t5WarnText, /FTMO_GAMBLING_ALLIN_RISK/)
  assert.equal(await page.getByTestId('pf-w5-overall-grade').getAttribute('data-grade'), 'BAD')

  // 7b: Switch to Light EN and inspect Wave 5 Alpha Bench tab
  await page.getByTestId('pf-tab-alpha-bench').click()
  await page.getByTestId('pf-w5-alpha-bench-panel').waitFor()
  await page.getByTestId('language-toggle').click()
  await page.locator('html[lang="en"]').waitFor()
  await page.getByTestId('theme-toggle').click()
  await page.locator('.fx-app[data-theme="light"]').waitFor()

  const benchText = await page.getByTestId('pf-w5-alpha-bench-panel').innerText()
  assert.equal(benchText.includes('$'), false, 'Wave 5 Alpha Bench panel must use USD/VND, zero bare $')
  assert.doesNotMatch(benchText, /\bP\/L\b/)
  assert.match(benchText, /PORT_V5 == PORT_7E/)
  assert.match(benchText, /F5D_US30_TO_UK100_CNV_L2_LB30_A/)
  assert.match(benchText, /ALPHA_BENCH_RESERVE/)
  assert.match(benchText, /5 \/ 5 PASS/)
  assert.match(await page.getByTestId('pf-w5-autodeploy-lock').innerText(), /auto_deploy_permitted: false/)
  assert.equal(await page.locator('[data-testid="pf-w5-core7-table"] tbody tr').count(), 7)
  assert.equal(await page.locator('[data-testid="pf-w5-drills-table"] tbody tr').count(), 5)
  assert.equal(await page.locator('[data-testid="pf-w5-finalists-table"] tbody tr').count(), 6)

  // Verify switching read-only proposal diff previews (Drill 3 -> Drill 2 -> Drill 4 -> Drill 3)
  await page.getByTestId('pf-w5-prop-btn-REDUCE_WEIGHT_AMBER').click()
  assert.match(await page.getByTestId('pf-w5-proposal-diff').innerText(), /REDUCE_WEIGHT_AMBER/)
  await page.getByTestId('pf-w5-prop-btn-HALT_ONLY_EMPTY_BENCH').click()
  assert.match(await page.getByTestId('pf-w5-proposal-diff').innerText(), /HALT_ONLY_EMPTY_BENCH/)
  await page.getByTestId('pf-w5-prop-btn-RETIRE_AND_SWAP').click()
  assert.match(await page.getByTestId('pf-w5-proposal-diff').innerText(), /RETIRE_AND_SWAP/)

  const benchOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  assert.ok(benchOverflow.scrollWidth <= benchOverflow.innerWidth + 1, `Alpha Bench overflow: ${JSON.stringify(benchOverflow)}`)
  const benchColorsLight = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="pf-w5-reserve-card"] .pf-w5-panel-cell')
    const st = getComputedStyle(el)
    return { fg: st.color, bg: st.backgroundColor }
  })
  const benchRatioLight = contrastRatio(parseRgb(benchColorsLight.fg), parseRgb(benchColorsLight.bg))
  assert.ok(benchRatioLight >= 4.5, `Alpha Bench light contrast too low: ${benchRatioLight.toFixed(2)}`)

  // Scroll to top and capture Wave 5 Alpha Bench Light EN 1440px screenshot
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.fx-main, .fx-content')) el.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await page.screenshot({
    path: path.join(w5ScreenshotDir, 'prop-fleet-w5-bench-light-en.png'),
    fullPage: false,
  })

  // Also verify Spectrum tab in Light EN and Alpha Bench in Dark VI (no errors, contrast >= 4.5)
  await page.getByTestId('pf-tab-spectrum').click()
  await page.getByTestId('pf-w5-spectrum-panel').waitFor()
  assert.match(await page.getByTestId('pf-w5-w4-compare').innerText(), /P1\/P2 not instrumented separately in Wave 4 baseline/)

  await page.getByTestId('theme-toggle').click()
  await page.locator('.fx-app:not([data-theme="light"])').waitFor()
  await page.getByTestId('language-toggle').click()
  await page.locator('html[lang="vi"]').waitFor()
  await page.getByTestId('pf-tab-alpha-bench').click()
  await page.getByTestId('pf-w5-alpha-bench-panel').waitFor()

  report.checks.QA07_wave5_spectrum_and_alpha_bench = {
    passed: true,
    spectrumContrastDark: Number(specRatioDark.toFixed(2)),
    benchContrastLight: Number(benchRatioLight.toFixed(2)),
  }

  assert.deepEqual(flowErrors, [])
  assert.deepEqual(flowApi, [], `PropFleetWorkspace must initiate ZERO /api/* requests, got: ${flowApi.join(', ')}`)
  await context.close()

  // QA-02b: Verify legacy ?view=prop redirect still works cleanly (separate context)
  const propContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const propPage = await propContext.newPage()
  await propPage.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort()
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [], datasets: [], reports: [], accounts: [], items: [], total: 0 }) })
    return route.continue()
  })
  await propPage.goto(`${origin}/?workspace=prop-fleet-fixture&view=prop&lang=vi`, { waitUntil: 'networkidle' })
  const redirected = new URL(propPage.url())
  assert.equal(redirected.searchParams.get('view'), 'overview')
  assert.equal(redirected.searchParams.get('create'), 'prop')
  await propContext.close()
  report.checks.QA02_demo_and_legacy_prop_redirect = true

  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.apiRequests, [])
  assert.deepEqual(report.mutations, [])
  report.passed = true
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: true, matrix: report.matrix.length, checks: Object.keys(report.checks).length, apiRequests: 0, out }))
} finally {
  await browser?.close()
  preview.kill()
  if (preview.exitCode === null) await Promise.race([once(preview, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))])
}
