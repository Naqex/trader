import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { PAPERCLIP_ORIGIN } from '../paperclipBridge.mjs'

const origin = process.argv[2] || 'http://127.0.0.1:5219'
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(!['5180', '8010'].includes(new URL(origin).port))
const out = path.resolve('../.runtime/paperclip-localization/browser')
await mkdir(out, { recursive: true })
const report = { scope: 'Trader production UI with native Paperclip source/API on an isolated database; no trading engine or provider jobs.', cases: [], errors: [], external: [], writes: [] }
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, theme, lang] of [[1920, 'dark', 'vi'], [1440, 'light', 'en'], [390, 'dark', 'vi']]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce', colorScheme: theme })
    await context.addInitScript(({ theme, lang }) => {
      localStorage.setItem('tw-theme', theme)
      localStorage.setItem('tw-language', lang)
      localStorage.setItem('tw-shell-rail-collapsed', 'false')
    }, { theme, lang })
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (![origin, PAPERCLIP_ORIGIN].includes(url.origin)) { report.external.push(url.origin); return route.abort() }
      if (!['GET', 'HEAD'].includes(req.method())) { report.writes.push({ origin: url.origin, path: url.pathname }); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push({ width, message: error.message }))
    page.setDefaultTimeout(20000)
    const url = `${origin}/?workspace=tenant-a&view=ai&area=ai&section=paperclip&lang=${lang}`
    await page.goto(url)
    const frame = page.frameLocator('iframe[title$="Paperclip"]')
    const empty = lang === 'vi' ? 'Không có công việc phù hợp với bộ lọc hoặc từ khóa.' : 'No tasks match the current filters or search.'
    const search = lang === 'vi' ? 'Tìm công việc' : 'Search tasks'
    const create = lang === 'vi' ? 'Tạo công việc' : 'Create Task'
    await frame.getByText(empty, { exact: true }).waitFor({ timeout: 90000 })
    assert.equal(await frame.locator('html').getAttribute('lang'), lang)
    await page.locator('[data-testid="paperclip-panel"] [role="status"]').waitFor({ state: 'hidden', timeout: 30000 })
    await writeFile(path.join(out, `native-${width}.txt`), await frame.locator('body').innerText())
    assert.equal(await page.locator('iframe[title$="Paperclip"]').count(), 1)
    assert.equal(await frame.locator('html').evaluate(node => node.classList.contains('dark')), theme === 'dark', 'Native UI supports the requested system color scheme')
    assert.equal(await page.getByTestId('fxreplay-shell').evaluate(node => node.classList.contains('is-rail-collapsed')), width < 760, 'Paperclip respects the desktop sidebar preference')
    const box = await page.locator('iframe[title$="Paperclip"]').boundingBox()
    assert(box.height > 650 && box.width > width - (width < 760 ? 15 : 300), JSON.stringify(box))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(out, `native-${width}-${theme}-${lang}.png`) })
    await frame.getByText(empty, { exact: true }).locator('..').getByRole('button', { name: create, exact: true }).click()
    const dialog = frame.getByRole('dialog')
    await dialog.waitFor()
    const dialogBox = await dialog.boundingBox()
    assert(dialogBox.x >= box.x - 1 && dialogBox.x + dialogBox.width <= box.x + box.width + 1, 'Native dialog fits the embedded viewport')
    await page.screenshot({ path: path.join(out, `dialog-${width}-${theme}-${lang}.png`) })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert(await page.locator('iframe[title$="Paperclip"]').evaluate(node => node === document.activeElement), 'Focus remains in the native frame after closing the dialog')
    report.cases.push({ name: 'native dialog open/Escape', width, focusAfterClose: await frame.locator('body').evaluate(() => document.activeElement.tagName), result: 'pass' })
    report.cases.push({ width, theme, lang, frame: box, result: 'pass' })
    if (width === 1920) {
      const instance = await page.locator('iframe[title$="Paperclip"]').elementHandle()
      const document = await (await instance.contentFrame()).evaluateHandle(() => document.documentElement)
      await frame.getByRole('textbox', { name: search, exact: true }).fill('owner-ui-review')
      await frame.getByText(empty, { exact: true }).locator('..').getByRole('button', { name: create, exact: true }).click()
      const draft = frame.getByRole('dialog').locator('[contenteditable="true"]').first()
      await draft.fill('Giữ nguyên bản nháp khi chuyển VI/EN')
      await page.getByTestId('language-toggle').click()
      await frame.getByRole('dialog', { name: 'New task', exact: true }).waitFor()
      assert.equal(await frame.locator('html').getAttribute('lang'), 'en')
      assert.equal(await draft.innerText(), 'Giữ nguyên bản nháp khi chuyển VI/EN')
      assert(await document.evaluate(node => node === window.document.documentElement), 'Language changes preserve the native document')
      await page.getByTestId('language-toggle').click()
      await frame.getByRole('dialog', { name: 'Tạo công việc', exact: true }).waitFor()
      assert.equal(await draft.innerText(), 'Giữ nguyên bản nháp khi chuyển VI/EN')
      await draft.press('Escape')
      await frame.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await frame.getByRole('textbox', { name: search, exact: true }).inputValue(), 'owner-ui-review')
      report.cases.push({ name: 'VI/EN live switch preserves iframe, open dialog, draft and search', result: 'pass' })
      await page.locator('.fx-subnav a[href*="section=connections"]').click()
      assert.equal(await page.locator('iframe[title$="Paperclip"]').isVisible(), false)
      assert.equal(await page.getByTestId('fxreplay-shell').evaluate(node => node.classList.contains('is-rail-collapsed')), false)
      await page.locator('.fx-subnav a[href*="section=paperclip"]').click()
      await page.locator('iframe[title$="Paperclip"]').waitFor()
      assert(await document.evaluate(node => node === window.document.documentElement), 'The native document survives navigation')
      assert.equal(await frame.getByRole('textbox', { name: search, exact: true }).inputValue(), 'owner-ui-review')
      const body = await frame.locator('body').innerText()
      assert.match(body, /Naqex AI/)
      await page.locator('.fx-menu-button').click()
      assert.equal(await page.evaluate(() => localStorage.getItem('tw-shell-rail-collapsed')), 'true')
      await page.locator('.fx-subnav a[href*="section=connections"]').click()
      assert(await page.getByTestId('fxreplay-shell').evaluate(node => node.classList.contains('is-rail-collapsed')))
      await page.locator('.fx-subnav a[href*="section=paperclip"]').click()
      assert(await page.getByTestId('fxreplay-shell').evaluate(node => node.classList.contains('is-rail-collapsed')))
      assert(await document.evaluate(node => node === window.document.documentElement))
      await page.locator('.fx-menu-button').click()
      assert.equal(await page.evaluate(() => localStorage.getItem('tw-shell-rail-collapsed')), 'false')
      report.cases.push({ name: 'native document and navigation preference survive route changes', result: 'pass' })
      await page.route('**/integrations/paperclip/health', route => route.fulfill({ status: 503, json: { status: 'unavailable' } }))
      await page.reload()
      await page.getByRole('alert').filter({ hasText: 'Chưa kết nối được Paperclip.' }).waitFor()
      await page.screenshot({ path: path.join(out, 'unavailable.png') })
      await page.unroute('**/integrations/paperclip/health')
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
      await frame.getByText(empty, { exact: true }).waitFor({ timeout: 30000 })
      report.cases.push({ name: 'unavailable state and explicit retry recover the real native UI', result: 'pass' })
    }
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.external, [])
  assert.deepEqual(report.writes, [])
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify(report))
}
