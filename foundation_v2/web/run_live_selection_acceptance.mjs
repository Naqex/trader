import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_AI_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidence = path.resolve('../evidence/ai-workspace-20261023/account-selection')
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), mutations = [], errors = []
    await context.addInitScript(value => localStorage.setItem('tw-theme', value), theme)
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/v2/**', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname
      if (request.method() !== 'GET') { mutations.push(pathname); return route.fulfill({ status: 403, json: { detail: 'fixture_read_only' } }) }
      if (pathname === '/api/v2/live/status') return route.fulfill({ json: {
        status: 'ready', connections: [{ id: 'fixture-mt5', name: 'MT5', account_login: '123456', account_environment: 'demo', status: 'connected', last_synced_at: new Date().toISOString(), account: { currency: 'USD', balance: 10000 } }],
      } })
      if (pathname === '/api/v2/live/records') return route.fulfill({ json: { version: 'live-records-v1', items: [] } })
      return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    })
    await page.goto(`${origin}/?workspace=tenant-a&view=live&area=live&section=trading-accounts&lang=vi&theme=${theme}`)
    await page.getByRole('checkbox', { name: 'Chọn tài khoản MT5 123456 - demo', exact: true }).check()
    const toolbar = page.getByRole('region', { name: 'Thao tác tài khoản đã chọn', exact: true })
    const sync = toolbar.getByRole('button', { name: 'Đồng bộ', exact: true })
    assert.equal(await sync.isEnabled(), true)
    assert.equal(await sync.locator('svg').evaluate(el => getComputedStyle(el).color), await page.locator('.live-sync-all svg').evaluate(el => getComputedStyle(el).color))
    const style = locator => locator.evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, color: s.color, outline: s.outlineStyle, transition: s.transitionProperty } })
    const before = await style(sync)
    await sync.hover()
    const hover = await style(sync)
    assert.notEqual(hover.background, before.background, 'sync uses shared button hover')
    await sync.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    assert.equal((await style(sync)).outline, 'solid')
    const remove = toolbar.getByRole('button', { name: 'Xoá', exact: true })
    const deleteBefore = await style(remove)
    await remove.hover()
    assert.notEqual((await style(remove)).background, deleteBefore.background, 'delete uses shared danger hover')
    await remove.click()
    const dialog = page.getByRole('dialog', { name: 'Xóa tài khoản', exact: true })
    await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
    await toolbar.waitFor()
    await page.screenshot({ path: path.join(evidence, `selection-${theme}.png`) })
    const close = toolbar.locator('.live-selection-close')
    await page.mouse.move(0, 0)
    const closeBefore = await style(close)
    await close.hover()
    assert.notEqual((await style(close)).background, closeBefore.background)
    await close.click()
    assert.equal(await toolbar.count(), 0)
    assert.deepEqual(mutations, [], 'selection and cancel never sync or delete the broker account')
    assert.deepEqual(errors, [])
    checks.push(`${theme}: green sync icon, shared sync/delete hover, keyboard focus, cancel deletion, deselect, no mutations/page errors`)
    await context.close()
  }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'Product UI with labeled MT5 fixture; no owner account operations', checks }, null, 2))
  console.log(JSON.stringify({ checks }))
} finally { await browser.close() }
