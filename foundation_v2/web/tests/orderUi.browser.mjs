import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180'
const output = process.argv[2] || '../evidence/order-ui-20261019/ui'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const copy = JSON.parse(await readFile(new URL('../src/testing-copy.json', import.meta.url)))
const report = { scope: 'Synthetic API state and intercepted writes; real native chart library. Financial correctness is tested separately against a disposable database.', cases: [], errors: [], writes: [] }
const browser = await chromium.launch({ headless: true })
await mkdir(output, { recursive: true })
try {
  for (const [width, language, side, theme] of [[1368, 'vi', 'BUY', 'dark'], [1368, 'en', 'SELL', 'dark'], [390, 'vi', 'SELL', 'light'], [768, 'en', 'BUY', 'light']]) {
    const t = key => copy[key]?.[language] || key
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600, reducedMotion: 'reduce' })
    await context.addInitScript(({ language, theme }) => {
      localStorage.setItem('tw-language', language); localStorage.setItem('tw-theme', theme)
      document.addEventListener('load', event => {
        if (!event.target.src?.includes('charting_library.standalone.js')) return
        const Original = window.TradingView.widget
        window.TradingView.widget = function (...args) {
          const widget = new Original(...args)
          window.__qaLines = []
          widget.onChartReady(() => {
            const chart = widget.activeChart(), create = chart.createOrderLine.bind(chart)
            chart.createOrderLine = (...args) => {
              const line = create(...args), record = {}
              if (line) {
                window.__qaLines.push(record)
                for (const [method, key] of [['setTooltip', 'tooltip'], ['setLineColor', 'color'], ['setPrice', 'price']]) {
                  const original = line[method].bind(line)
                  line[method] = value => { record[key] = value; return original(value) }
                }
              }
              return line
            }
          })
          return widget
        }
      }, true)
    }, { language, theme })
    const spec = fixture.datasets.items[0].instrument_spec
    const execution = { cursor_index: 60, instrument_spec: spec, cost_model: { version: 'session-cost-v1', account_ccy: 'USD', quote_to_account_rate: '1', commission_per_side_account: '0', slippage_price_per_side: '0' }, spread_price: '0', starting_balance: '10000', balance: '10000', equity: '10000', floating_pl: '0', position: null, pending_market_order: null, ledger: [] }
    let replay = { ...fixture.latest, dataset_sha256: null, has_future_rows: true, execution_capabilities: { partial_close: true }, payload: { ...fixture.latest.payload, execution, starting_balance: '10000', starting_balance_ccy: 'USD' } }
    let rejectClose = false
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname.endsWith('/activity')) return route.abort()
      if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' })
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        report.writes.push({ width, language, path: url.pathname, body })
        if (url.pathname.endsWith('/orders/market')) {
          assert.equal(body.execution_timing, 'current_quote')
          assert.equal(body.side, side)
          const price = String(replay.visible_rows.at(-1).close)
          execution.position = { position_id: 'qa-position', source_operation_id: body.operation_id, side, quantity: body.quantity, entry_fill: price, stop_loss: null, take_profit: null, opened_time_utc: replay.cutoff_timestamp }
          execution.ledger.push({ kind: 'market_fill', details: { position_id: 'qa-position', operation_id: body.operation_id, side, quantity: body.quantity, fill_price: price } })
        } else if (url.pathname.endsWith('/orders/protection')) {
          assert.equal(body.target_id, 'qa-position')
          execution.position = { ...execution.position, stop_loss: body.stop_loss, take_profit: body.take_profit }
        } else if (url.pathname.endsWith('/orders/close')) {
          if (rejectClose) { rejectClose = false; return route.fulfill({ status: 422, json: { detail: 'QA partial close rejected' } }) }
          assert.equal(body.target_id, 'qa-position')
          const prior = Number(execution.position.quantity), amount = Number(body.quantity ?? prior)
          assert.ok(amount > 0 && amount <= prior)
          execution.position = amount === prior ? null : { ...execution.position, quantity: String(Number((prior - amount).toFixed(8))), original_quantity: '.10', realized_pnl: '0' }
        } else throw Error(`Unexpected fixture write ${url.pathname}`)
        replay = { ...replay, revision: replay.revision + 1, payload: { ...replay.payload, execution: { ...execution } } }
        return route.fulfill({ json: replay })
      }
      return route.fulfill({ json: url.pathname === `/api/v2/replay/sessions/${fixture.session}` ? replay : url.pathname === '/api/v2/data/datasets' ? fixture.datasets : { items: [], available: false } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => report.errors.push(error.message))
    const href = `${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&area=testing&session=${fixture.session}`
    const ready = async () => { await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 }); return page.frameLocator('.advanced-chart-host iframe') }
    await page.goto(href)
    let native = await ready()
    await page.locator('.legacy-quantity-control input').fill('0.10')
    await page.getByRole('button', { name: t(side === 'BUY' ? 'Buy' : 'Sell'), exact: true }).click()
    const toast = page.locator('.wm-notification.is-order')
    await toast.waitFor()
    assert.match(await toast.innerText(), language === 'vi' ? /Đã khớp lệnh market/ : /Market order executed/)
    assert.match(await toast.innerText(), language === 'vi' ? / tại / : / at /)
    assert.equal(await page.locator('.legacy-order-modal').count(), 0, 'quick trade never opens an order draft dialog')
    await native.locator('.wm-order-marker-quantity').first().waitFor()
    assert.equal(await native.locator('.wm-order-marker-text').first().evaluate(node => getComputedStyle(node).color), theme === 'dark' ? 'rgb(255, 96, 59)' : 'rgb(181, 71, 24)')
    const colors = await page.evaluate(() => window.__qaLines.map(line => ({ ...line })))
    assert.equal(colors.find(line => line.tooltip === 'Entry').color, side === 'SELL' ? '#FFBF00' : theme === 'dark' ? '#F5F8FF' : '#E8EBEF')
    assert.equal(colors.find(line => line.tooltip === 'Stop loss').color, theme === 'dark' ? '#46C7B7' : '#159989')
    const stop = native.locator('[data-order-drag=stop]')
    await stop.hover()
    await page.waitForFunction(() => window.__qaLines.find(line => line.tooltip === 'Stop loss')?.color === '#FFBF00')
    await page.screenshot({ path: `${output}/marker-${width}-${language}-${side}.png` })
    await page.reload(); native = await ready()
    assert.ok((await native.locator('.wm-order-marker-text').first().innerText()).startsWith(side), 'position is retained after reload')
    assert.doesNotMatch(await native.locator('.wm-order-marker-text').first().innerText(), /queued|Chờ khớp/)
    const beforeValidation = report.writes.length
    const invalidStop = side === 'BUY' ? 'ArrowUp' : 'ArrowDown', invalidTarget = side === 'BUY' ? 'ArrowDown' : 'ArrowUp'
    const protectionToast = page.locator('.wm-notification.is-structured').last()
    for (const [kind, invalid, message] of [['stop', invalidStop, side === 'BUY' ? 'Stop Loss price must be lower than the current price' : 'Stop Loss price must be higher than the current price'], ['target', invalidTarget, side === 'BUY' ? 'Take Profit price must be higher than the current price' : 'Take Profit price must be lower than the current price']]) {
      await native.locator(`[data-order-drag=${kind}]`).press(invalid)
      await page.getByRole('alert').filter({ hasText: t(message) }).waitFor()
      assert.match(await protectionToast.innerText(), new RegExp(t('Order Error')))
      assert.equal(await protectionToast.locator('.wm-notification-mark').innerText(), '×')
    }
    assert.equal(report.writes.length, beforeValidation, 'invalid direction never writes an order')
    await page.screenshot({ path: `${output}/protection-error-${width}-${language}.png` })
    for (const [kind, valid, added, moved] of [['target', invalidStop, 'Take profit added!', 'Take profit moved to {price}!'], ['stop', invalidTarget, 'Stop loss added!', 'Stop loss moved to {price}!']]) {
      const handle = native.locator(`[data-order-drag=${kind}]`)
      await handle.press(valid)
      await protectionToast.filter({ hasText: t(added) }).waitFor()
      assert.match(await protectionToast.innerText(), new RegExp(t('Order Added')))
      await handle.press(valid)
      await protectionToast.filter({ hasText: t(moved).split('{price}')[0] }).waitFor()
      assert.match(await protectionToast.innerText(), new RegExp(t('Position Updated')))
    }
    await page.screenshot({ path: `${output}/protection-moved-${width}-${language}.png` })
    const beforeDialog = report.writes.length
    await native.getByRole('button', { name: t('Chỉnh sửa vị thế'), exact: true }).click()
    const markerEdit = page.locator('.legacy-order-modal')
    await markerEdit.waitFor()
    assert.equal(await markerEdit.getByRole('heading').innerText(), t('Chỉnh sửa vị thế'))
    assert.equal(await page.locator('.partial-close-dialog').count(), 0, 'quantity opens edit, not close')
    const stopPrice = markerEdit.getByRole('spinbutton', { name: t('Stop loss'), exact: true })
    const stopPips = markerEdit.getByRole('spinbutton', { name: t('Stop loss in pips'), exact: true })
    assert.ok(Number(await stopPips.inputValue()) > 0)
    await stopPips.fill('')
    assert.equal(await stopPips.isVisible(), true, 'clearing pips keeps the editor available')
    assert.equal(await markerEdit.getByRole('switch', { name: t('Stop loss'), exact: true }).isChecked(), true)
    await markerEdit.getByRole('button', { name: t('Confirm'), exact: true }).click()
    assert.equal(report.writes.length, beforeDialog, 'an enabled but empty protection cannot be submitted')
    await stopPips.fill('10')
    const editEntry = Number(execution.position.entry_fill)
    assert.ok(Math.abs(Number(await stopPrice.inputValue()) - (editEntry + (side === 'BUY' ? -1 : 1) * Number(spec.pip_size) * 10)) < 1e-8)
    const wantedStop = await stopPrice.inputValue()
    await stopPrice.fill('')
    assert.equal(await stopPrice.isVisible(), true)
    await stopPrice.fill(wantedStop)
    assert.equal(Number(await stopPips.inputValue()), 10, 'price and pips update in both directions')
    assert.equal(await markerEdit.locator('.legacy-edit-protection .legacy-protection-row').first().evaluate(node => getComputedStyle(node).borderRadius), '8px')
    await page.screenshot({ path: `${output}/edit-pips-${width}-${language}.png` })
    await page.keyboard.press('Escape')
    assert.equal(report.writes.length, beforeDialog, 'opening/canceling an editor never trades')
    await native.getByRole('button', { name: t('Chỉnh sửa vị thế'), exact: true }).click()
    await page.locator('.legacy-order-modal').getByRole('switch', { name: t('Stop loss'), exact: true }).uncheck()
    await page.keyboard.press('Escape')
    await native.getByRole('button', { name: t('Chỉnh sửa vị thế'), exact: true }).click()
    assert.equal(await page.locator('.legacy-order-modal').getByRole('switch', { name: t('Stop loss'), exact: true }).isChecked(), true, 'reopening discards the unsaved disabled state')
    await page.locator('.legacy-order-modal').getByRole('spinbutton', { name: t('Stop loss in pips'), exact: true }).fill('10')
    await page.locator('.legacy-order-modal').getByRole('button', { name: t('Confirm'), exact: true }).click()
    await page.locator('.legacy-order-modal').waitFor({ state: 'detached' })
    assert.equal(Number(execution.position.stop_loss), Number(wantedStop))
    assert.equal(report.writes.at(-1).path.endsWith('/orders/protection'), true, 'edit submit never closes the position')
    await native.getByRole('button', { name: t('Đóng một phần vị thế'), exact: true }).click()
    const dialog = page.locator('.partial-close-dialog')
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button', { name: '100%', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await dialog.getByRole('spinbutton', { name: t('Khối lượng đóng'), exact: true }).inputValue(), '0.1')
    assert.equal(await dialog.getByRole('button', { name: t('Tối đa'), exact: true }).count(), 0)
    assert.equal(await dialog.locator('.partial-close-error').count(), 0)
    assert.equal(await dialog.getByRole('button', { name: t('Save'), exact: true }).isEnabled(), true)
    assert.equal(await dialog.evaluate(node => Number(getComputedStyle(node.parentElement).zIndex) > Number(getComputedStyle(document.querySelector('.wm-notifications')).zIndex)), true, 'chart notifications stay behind the dialog')
    const layout = await dialog.evaluate(node => {
      const rows = [...node.querySelectorAll('.partial-close-summary > div')].map(row => row.getBoundingClientRect().toJSON())
      const modal = node.getBoundingClientRect(), footer = node.querySelector('footer').getBoundingClientRect()
      return { stacked: rows[1].top > rows[0].bottom, aligned: rows[0].left === rows[1].left, fullDivider: Math.abs(footer.width - modal.width + 2) < 1, border: getComputedStyle(node.querySelector('footer')).borderTopWidth }
    })
    assert.deepEqual(layout, { stacked: true, aligned: true, fullDivider: true, border: '1px' })
    await page.screenshot({ path: `${output}/partial-default-${width}-${language}-${side}.png` })
    await dialog.getByRole('spinbutton', { name: t('Khối lượng đóng'), exact: true }).fill('0')
    assert.equal(await dialog.getByRole('button', { name: t('Save'), exact: true }).isEnabled(), false)
    assert.equal(await dialog.locator('.partial-close-error').count(), 0, 'no unsolicited validation hint')
    await dialog.getByRole('button', { name: '25%', exact: true }).click()
    assert.equal(await dialog.getByRole('button', { name: '25%', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor), theme === 'dark' ? 'rgb(255, 173, 124)' : 'rgb(184, 80, 24)', 'selected percentage keeps the action color on hover')
    assert.equal(await dialog.getByRole('radio').first().evaluate(node => getComputedStyle(node).width), '16px')
    assert.equal(await dialog.getByRole('radio').first().evaluate(node => getComputedStyle(node).height), '16px')
    assert.equal(await dialog.getByRole('spinbutton', { name: t('Khối lượng đóng'), exact: true }).inputValue(), '0.02')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `${output}/partial-${width}-${language}-${side}.png` })
    if (width === 1368 && language === 'vi') {
      rejectClose = true
      await dialog.getByRole('button', { name: t('Save'), exact: true }).click()
      await dialog.locator('.partial-close-error[role=alert]').waitFor()
      assert.equal(execution.position.quantity, '0.10', 'a rejected close never changes the position')
      assert.equal(await dialog.getByRole('button', { name: t('Save'), exact: true }).isEnabled(), true)
    }
    await dialog.getByRole('button', { name: t('Save'), exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.reload(); native = await ready()
    await native.getByRole('button', { name: t('Đóng một phần vị thế'), exact: true }).click()
    await page.locator('.partial-close-dialog').getByRole('button', { name: '50%', exact: true }).click()
    await page.locator('.partial-close-dialog').getByRole('radio', { name: t('Khối lượng ban đầu'), exact: true }).check()
    assert.equal(await page.locator('.partial-close-dialog').getByRole('spinbutton', { name: t('Khối lượng đóng'), exact: true }).inputValue(), '0.05')
    await page.locator('.partial-close-dialog').getByRole('radio', { name: t('Khối lượng còn lại'), exact: true }).check()
    await page.locator('.partial-close-dialog').getByRole('button', { name: '100%', exact: true }).click()
    assert.equal(await page.locator('.partial-close-dialog').getByRole('spinbutton', { name: t('Khối lượng đóng'), exact: true }).inputValue(), '0.08')
    await page.keyboard.press('Escape')
    await page.locator('.chart-utility-actions').getByRole('button', { name: t('Lệnh mô phỏng'), exact: true }).click()
    const edit = page.locator('.legacy-order-modal')
    await edit.waitFor()
    assert.equal(await edit.getByRole('button', { name: 'Preset', exact: true }).count(), 0)
    assert.equal(await edit.locator('.legacy-order-hint').count(), 0)
    assert.ok(await edit.locator('footer').evaluate(node => getComputedStyle(node).justifyContent === 'flex-end'))
    await page.screenshot({ path: `${output}/edit-${width}-${language}-${side}.png` })
    await page.keyboard.press('Escape')
    // Old servers expose an explicit full-close confirmation, never a partial request.
    replay.execution_capabilities = {}
    await page.reload(); native = await ready()
    assert.equal(await native.getByRole('button', { name: t('Chỉnh sửa vị thế'), exact: true }).isEnabled(), true)
    await native.getByRole('button', { name: t('Đóng/hủy lệnh'), exact: true }).click()
    await page.locator('.chart-order-close-dialog').waitFor()
    assert.equal(await page.locator('.partial-close-dialog').count(), 0)
    await page.keyboard.press('Escape')
    report.cases.push({ width, language, side, theme, colors, quickFilled: true, reload: true, partialUi: true, oldServerBlocked: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, errors: report.errors }))
