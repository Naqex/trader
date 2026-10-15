import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.env.CHART_DS_OUTPUT || '../evidence/chart-design-system-20261012'
const widths = (process.env.CHART_DS_WIDTHS || '1440,390').split(',').map(Number)
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const copy = JSON.parse(await readFile(new URL('../src/testing-copy.json', import.meta.url)))
const vi = key => copy[key]?.vi || key
const spec = fixture.datasets.items[0].instrument_spec
const execution = { cursor_index: 60, instrument_spec: spec, cost_model: { account_ccy: 'USD', quote_to_account_rate: '1', commission_per_side_account: '1', slippage_price_per_side: '0' }, spread_price: '0.0002', starting_balance: '10000', balance: '10000', equity: '10000', floating_pl: '0', position: null, pending_market_order: null, ledger: [] }
// Labeled synthetic fills exercise pagination, never the financial engine.
for (let i = 0; i < 27; i++) {
  execution.ledger.push({ sequence: i * 2, kind: 'market_fill', virtual_time_utc: 1704067200 + i * 60, details: { position_id: `fixture-${i}`, side: 'BUY', quantity: '0.01', fill_price: '1.1' } })
  execution.ledger.push({ sequence: i * 2 + 1, kind: 'protective_fill', virtual_time_utc: 1704067260 + i * 60, details: { position_id: `fixture-${i}`, side: 'BUY', quantity: '0.01', fill_price: '1.101', net_pnl: '1', cost_breakdown: { commission_account: '0' }, closed_position: { quantity: '0.01', stop_loss: '1.09', take_profit: '1.101' } } })
}
const replay = { ...fixture.latest, dataset_sha256: null, has_future_rows: true, payload: { ...fixture.latest.payload, execution, starting_balance: '10000', starting_balance_ccy: 'USD' } }
const report = { scope: 'Synthetic replay and intercepted requests only; real native library, no owner/backend/broker writes', cases: [], errors: [], unexpected: [], blockedActivity: [], simulatedOrders: [] }
const browser = await chromium.launch({ headless: true })
await mkdir(output, { recursive: true })
const href = `${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&area=testing&session=${fixture.session}`
async function setup(width, theme, payload = replay) {
  const context = await browser.newContext({ viewport: { width, height: 987 }, hasTouch: width <= 600, reducedMotion: 'reduce' })
  await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && request.method() === 'POST' && url.pathname === `/api/v2/replay/sessions/${fixture.session}/activity`) { report.blockedActivity.push(url.pathname); return route.abort() }
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.unexpected.push(`${request.method()} ${request.url()}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
    return route.fulfill({ json: url.pathname === `/api/v2/replay/sessions/${fixture.session}` ? payload : url.pathname === '/api/v2/data/datasets' ? fixture.datasets : { items: [], available: false } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(href)
  await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
  return { context, page }
}
async function utility(page, width, name) {
  await page.locator('.chart-utility-actions').getByRole('button', { name: vi(name), exact: true }).click()
}
try {
  for (const width of widths) for (const theme of ['dark', 'light']) {
    const { context, page } = await setup(width, theme)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (width <= 600) {
      assert.equal(await page.locator('.chart-utility-toggle').count(), 0)
      assert.equal(await page.locator('.chart-utility-actions').isVisible(), true)
      report.cases.push({ width, theme, case: 'mobile utility rail remains directly accessible without a redundant toggle' })
    }
    await page.screenshot({ path: `${output}/chart-${width}-${theme}.png` })
    assert.ok(await page.locator('.legacy-replay-toolbar button,.legacy-replay-toolbar .legacy-sync-toggle').evaluateAll(nodes => nodes.every(node => {
      const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return hit && node.contains(hit)
    })), 'replay controls are not covered by the utility rail')
    const quantity = page.locator('.legacy-quantity-control input')
    await quantity.focus()
    assert.equal(await quantity.evaluate(node => getComputedStyle(node).fontSize), '13px')
    await page.waitForFunction(() => {
      const node = document.querySelector('.legacy-quantity-control')
      const probe = document.createElement('span'); probe.style.color = 'var(--project-primary)'; node.append(probe)
      const matches = getComputedStyle(node).borderTopColor === getComputedStyle(probe).color
      probe.remove(); return matches
    })
    await page.locator('.legacy-scalper-button').click()
    const scalper = page.locator('.legacy-scalper-settings')
    await scalper.waitFor()
    assert.equal(await scalper.evaluate(node => getComputedStyle(node).display), 'grid', 'scalper groups use the intended spacing')
    assert.equal(await page.locator('.legacy-scalper-modal').evaluate(node => getComputedStyle(node).animationName), 'none', 'portal modal respects reduced motion')
    const strategy = scalper.getByRole('button', { name: 'Chiến lược', exact: true })
    assert.equal(await strategy.isDisabled(), true)
    assert.equal(await strategy.evaluate(node => getComputedStyle(node).borderRadius), '8px')
    assert.equal(await strategy.evaluate(node => getComputedStyle(node).height), width <= 600 ? '44px' : '36px')
    const scalperSaveBackground = await scalper.locator('.legacy-scalper-save').evaluate(node => getComputedStyle(node).backgroundColor)
    assert.equal(scalperSaveBackground, theme === 'dark' ? 'rgb(255, 173, 124)' : 'rgb(184, 80, 24)')
    const scalperField = scalper.locator('input[type=number]').first()
    assert.equal(await scalperField.evaluate(node => getComputedStyle(node).height), width <= 600 ? '44px' : '36px')
    assert.equal(await scalperField.evaluate(node => getComputedStyle(node).borderRadius), '8px')
    const scalperFieldBackground = await scalperField.evaluate(node => getComputedStyle(node).backgroundColor)
    const scalperSwitch = scalper.locator('input[role=switch]').first()
    const scalperSwitchSize = await scalperSwitch.evaluate(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height }))
    assert.equal(await scalper.locator(':scope > p').count(), 0, 'scalper dialog has no redundant helper copy')
    const scalperSurfaceShadow = await page.locator('.legacy-scalper-modal').evaluate(node => getComputedStyle(node).boxShadow)
    const scalperHeadingWeight = await page.locator('.legacy-scalper-modal h2').evaluate(node => getComputedStyle(node).fontWeight)
    const scalperClose = page.locator('.legacy-scalper-modal .wm-dialog-close')
    await scalperClose.hover()
    const scalperCloseHover = await scalperClose.evaluate(node => getComputedStyle(node).backgroundColor)
    assert.equal(scalperCloseHover, 'rgba(0, 0, 0, 0)', 'dialog close remains a quiet icon action on hover')
    const cancel = scalper.getByRole('button', { name: 'Hủy', exact: true })
    const save = scalper.getByRole('button', { name: 'Lưu', exact: true })
    const cancelBase = await cancel.evaluate(node => getComputedStyle(node).backgroundColor)
    const cancelBaseBorder = await cancel.evaluate(node => getComputedStyle(node).borderColor)
    const cancelRadius = await cancel.evaluate(node => getComputedStyle(node).borderRadius)
    const cancelHeight = await cancel.evaluate(node => getComputedStyle(node).height)
    const saveBase = await save.evaluate(node => getComputedStyle(node).backgroundColor)
    await cancel.hover()
    assert.equal(await cancel.evaluate(node => getComputedStyle(node).borderColor), cancelBaseBorder, 'cancel hover does not add a bright border')
    await save.hover()
    assert.notEqual(await save.evaluate(node => getComputedStyle(node).backgroundColor), saveBase, 'save hover uses its action state instead of the generic modal hover')
    assert.notEqual(cancelBase, '', 'cancel baseline is measurable')
    await page.screenshot({ path: `${output}/scalper-${width}-${theme}.png` })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.legacy-scalper-button').evaluate(node => node === document.activeElement), true, 'closing scalper settings restores keyboard focus')
    await utility(page, width, 'Lệnh mô phỏng')
    const dialog = page.locator('.legacy-order-modal')
    await dialog.waitFor()
    assert.equal(await dialog.locator('.legacy-init-details').count(), 0, 'order dialog does not expose a duplicate simulator initializer')
    assert.equal(await dialog.getByText('Chưa có dữ liệu lệnh tại cutoff này.', { exact: true }).count(), 0, 'order dialog omits redundant cutoff copy')
    assert.equal(await dialog.evaluate(node => getComputedStyle(node).borderRadius), '12px')
    assert.equal(await dialog.evaluate(node => getComputedStyle(node).boxShadow), scalperSurfaceShadow, 'order and scalper dialogs share the dialog surface shadow')
    assert.equal(await dialog.locator('h2').evaluate(node => getComputedStyle(node).fontWeight), scalperHeadingWeight, 'order and scalper dialog headings share the type token')
    const field = dialog.getByRole('spinbutton', { name: 'Khối lượng lệnh', exact: true })
    assert.equal(await field.evaluate(node => getComputedStyle(node).borderRadius), '8px')
    assert.equal(await field.evaluate(node => getComputedStyle(node).height), width <= 600 ? '44px' : '36px')
    const orderCancel = dialog.getByRole('button', { name: 'Hủy', exact: true })
    assert.equal(await orderCancel.evaluate(node => getComputedStyle(node).backgroundColor), cancelBase, 'order and scalper cancel actions share the control surface')
    assert.equal(await orderCancel.evaluate(node => getComputedStyle(node).borderRadius), cancelRadius, 'order and scalper secondary actions share radius')
    assert.equal(await orderCancel.evaluate(node => getComputedStyle(node).height), cancelHeight, 'order and scalper secondary actions share height')
    const orderCancelBorder = await orderCancel.evaluate(node => getComputedStyle(node).borderColor)
    await orderCancel.hover()
    assert.equal(await orderCancel.evaluate(node => getComputedStyle(node).borderColor), orderCancelBorder, 'order cancel hover does not add a bright border')
    assert.equal(await field.evaluate(node => getComputedStyle(node).backgroundColor), scalperFieldBackground, 'order and scalper fields share their base surface')
    const orderSwitch = dialog.locator('input[role=switch]').first()
    assert.deepEqual(await orderSwitch.evaluate(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height })), scalperSwitchSize, 'order and scalper switches share geometry')
    assert.equal(await dialog.locator('footer input[type=checkbox]').evaluate(node => getComputedStyle(node).appearance), 'none', 'journal checkbox uses the shared control drawing')
    assert.equal(await dialog.locator('.legacy-order-save').evaluate(node => getComputedStyle(node).backgroundColor), scalperSaveBackground, 'order and scalper save actions share the action surface')
    if (width > 600) assert.equal(await dialog.locator('footer').evaluate(node => {
      const label = node.querySelector('label')?.getBoundingClientRect()
      const buttons = [...node.querySelectorAll('button')].map(item => item.getBoundingClientRect())
      if (!label || buttons.length !== 2) return false
      const labelCenter = label.top + label.height / 2
      return buttons.every(button => Math.abs(button.top + button.height / 2 - labelCenter) < 3)
    }), true, 'journal option stays on the footer action row')
    const direction = dialog.getByRole('button', { name: 'Hướng', exact: true })
    assert.equal(await direction.evaluate(node => getComputedStyle(node).borderTopWidth), '1px')
    assert.equal(await direction.evaluate(node => getComputedStyle(node).outlineStyle), 'none')
    await direction.hover()
    await page.waitForFunction(() => {
      const node = document.querySelector('.legacy-order-modal .fx-select-trigger')
      const probe = document.createElement('span'); probe.style.color = 'var(--wm-control-hover-border)'; node.append(probe)
      const matches = getComputedStyle(node).borderTopColor === getComputedStyle(probe).color
      probe.remove(); return matches
    })
    await direction.click()
    const menu = dialog.locator('.fx-select-menu')
    assert.notEqual(await menu.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)')
    assert.equal(await menu.evaluate(node => getComputedStyle(node).position), 'absolute')
    assert.equal(await menu.evaluate(node => getComputedStyle(node).borderRadius), '12px')
    await page.waitForFunction(() => {
      const node = document.querySelector('.legacy-order-modal .fx-select-trigger')
      const probe = document.createElement('span'); probe.style.color = 'var(--wm-focus)'; node.append(probe)
      const matches = getComputedStyle(node).borderTopColor === getComputedStyle(probe).color
      probe.remove(); return matches
    })
    await page.screenshot({ path: `${output}/order-menu-${width}-${theme}.png` })
    await dialog.getByRole('option', { name: 'Bán', exact: true }).click()
    assert.ok(Number(await dialog.getByRole('spinbutton', { name: vi('Stop loss'), exact: true }).inputValue()) > Number(await dialog.getByRole('textbox', { name: 'Giá vào lệnh', exact: true }).inputValue()), 'SELL protection recalculates above entry')
    await dialog.getByRole('button', { name: 'Hướng', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), true)
    assert.equal(await dialog.locator('.fx-select-menu').count(), 0)
    const close = dialog.getByRole('button', { name: vi('Đóng panel'), exact: true })
    await close.hover()
    assert.equal(await close.evaluate(node => getComputedStyle(node).backgroundColor), scalperCloseHover, 'order and scalper close actions share the dialog hover state')
    await page.screenshot({ path: `${output}/order-${width}-${theme}.png` })
    await page.keyboard.press('Escape')
    assert.equal(await dialog.count(), 0)
    assert.equal(await page.locator('.fx-app').evaluate(node => node.inert), false)
    report.cases.push({ width, theme, case: 'quantity, semantic actions, modal geometry, dropdown side update, Escape and close hover' })
    const grip = page.locator('.legacy-positions-grip')
    await grip.focus(); await page.keyboard.press('ArrowUp')
    const positions = page.locator('.legacy-positions')
    await positions.locator('[data-empty-kind=chart-open]').waitFor()
    assert.equal(await positions.locator('table,.wm-pagination').count(), 0)
    await positions.getByRole('tab', { name: 'Vị thế đang mở', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await positions.locator('[data-empty-kind=chart-pending]').waitFor()
    await page.keyboard.press('ArrowRight')
    await positions.locator('tbody tr').first().waitFor()
    assert.equal(await positions.locator('tbody tr').count(), 10)
    await positions.getByRole('button', { name: 'Trang sau', exact: true }).click()
    await positions.getByRole('button', { name: 'Trang sau', exact: true }).click()
    assert.equal(await positions.locator('tbody tr').count(), 7)
    await positions.getByRole('button', { name: 'Số dòng mỗi trang', exact: true }).click()
    await page.screenshot({ path: `${output}/positions-menu-${width}-${theme}.png` })
    await positions.getByRole('option', { name: '25', exact: true }).click()
    assert.equal(await positions.locator('tbody tr').count(), 25)
    await page.screenshot({ path: `${output}/positions-${width}-${theme}.png` })
    report.cases.push({ width, theme, case: 'known empty states no table/pager, keyboard tabs, 27-row pagination and size reset' })
    await grip.focus(); await page.keyboard.press('Home')
    await utility(page, width, 'Journal tại cutoff này')
    await page.locator('.legacy-journal-search input').fill('no-synthetic-match')
    await page.locator('.legacy-journal [data-empty-kind=filtered-trades]').waitFor()
    await page.getByRole('button', { name: 'Đóng nhật ký', exact: true }).click()
    report.cases.push({ width, theme, case: 'journal filtered empty reuses shared state' })
    if (width === 1440 && theme === 'dark') {
      await page.evaluate(() => { window.__chartHost = document.querySelector('.advanced-chart-host') })
      let release; const pending = new Promise(resolve => { release = resolve })
      let requested; const started = new Promise(resolve => { requested = resolve })
      await page.route(`**/api/v2/replay/sessions/${fixture.session}*`, async route => { requested(); await pending; await route.fulfill({ status: 503, json: { detail: 'fixture source offline' } }) })
      await page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete('cursor'); history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')) })
      await started
      await page.locator('.chart-trading-account [data-resource-state=refreshing]').waitFor()
      const box = await page.getByTestId('replay-chart').boundingBox()
      release()
      await page.locator('.chart-trading-account [data-resource-state=stale]').waitFor()
      assert.equal(await page.getByTestId('chart-loading').count(), 0)
      assert.equal(await page.evaluate(() => window.__chartHost === document.querySelector('.advanced-chart-host')), true)
      assert.deepEqual(await page.getByTestId('replay-chart').boundingBox(), box)
      assert.equal(await page.getByRole('button', { name: 'Mua', exact: true }).isDisabled(), true)
      await page.locator('.chart-trading-account summary').click()
      await page.getByText('fixture source offline', { exact: false }).waitFor()
      report.cases.push({ case: 'same-session failed GET keeps proven chart/cutoff, fixed status, disabled writes' })
    }
    await context.close()
  }
  {
    const { context, page } = await setup(1440, 'dark', { ...replay, payload: { ...replay.payload, execution: null } })
    await page.locator('.legacy-positions-grip').focus(); await page.keyboard.press('ArrowUp')
    await page.locator('.legacy-positions [data-empty-kind=chart-unknown]').waitFor()
    assert.equal(await page.locator('.legacy-positions table,.legacy-positions .wm-pagination').count(), 0)
    report.cases.push({ case: 'missing execution stays unknown rather than known empty' })
    await context.close()
  }
  {
    const { context, page } = await setup(1440, 'dark')
    let attempts = 0
    await page.route(`**/api/v2/replay/sessions/${fixture.session}/orders/market`, async route => {
      assert.equal(route.request().method(), 'POST')
      const body = route.request().postDataJSON()
      assert.equal(body.side, 'SELL'); assert.equal(body.quantity, '0.01')
      assert.equal(body.expected_revision, replay.revision)
      assert.equal(body.stop_loss, null)
      assert.equal(body.take_profit, null)
      report.simulatedOrders.push({ intercepted: true, side: body.side, attempt: ++attempts })
      if (attempts === 1) return route.fulfill({ status: 422, json: { detail: 'fixture quick order rejected' } })
      return route.fulfill({ json: { ...replay, revision: replay.revision + 1, payload: { ...replay.payload, execution: { ...execution, pending_market_order: { ...body, operation_id: 'fixture-queued' } } } } })
    })
    await page.getByRole('button', { name: 'Bán', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'fixture quick order rejected' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Bán', exact: true }).isEnabled(), true)
    await page.getByRole('button', { name: 'Bán', exact: true }).click()
    assert.equal(await page.locator('.legacy-order-modal').count(), 0)
    await page.waitForFunction(() => document.querySelector('.legacy-trading-bar button.buy')?.disabled === true)
    assert.equal(attempts, 2)
    assert.equal(await page.getByRole('button', { name: 'Mua', exact: true }).isDisabled(), true)
    report.cases.push({ case: 'quick Sell rejects safely and retries with an unforced click while its error toast remains visible; no dialog, nullable protections and queued state lock' })
    await page.route(`**/api/v2/replay/sessions/${fixture.session}*`, route => route.fulfill({ status: 403, json: { detail: 'fixture access revoked' } }))
    await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('cursor', '59'); history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')) })
    await page.locator('[data-empty-kind=denied]').waitFor()
    assert.equal(await page.locator('.advanced-chart-host,.legacy-trading-bar').count(), 0)
    report.cases.push({ case: '403 clears protected chart and action controls' })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpected, [])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ result: report.result, cases: report.cases.length, errors: report.errors, unexpected: report.unexpected }))
