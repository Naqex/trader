// Synthetic GET fixtures and the public demo UI; no broker calls or API writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { journalRecords, brokerSnapshot, fixtureAccount } from './liveJournal.fixture.mjs'

const [origin, out] = process.argv.slice(2)
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert(out)
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { cases: [], errors: [], writes: [], scope: 'Notes presentation and existing search/tag/create UI with synthetic data' }
try {
  for (const [width, theme, language] of [[1920, 'dark', 'vi'], [1440, 'light', 'en'], [390, 'dark', 'vi']]) {
    const ctx = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    await ctx.addInitScript(theme => localStorage.setItem('tw-theme', theme), theme)
    let records = journalRecords().filter(record => record.kind !== 'note'), failRecords = false
    const broker = brokerSnapshot()
    await ctx.routeWebSocket('**/*', socket => socket.close())
    await ctx.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.writes.push(url.pathname); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/v2/live/records') return route.fulfill(failRecords ? { status: 503, json: { detail: 'fixture_unavailable' } } : { json: { version: 'live-records-v1', items: records } })
      if (url.pathname === '/api/v2/live/status') return route.fulfill({ json: broker })
      if (url.pathname === '/api/v2/live/connections') return route.fulfill({ json: { items: broker.connections } })
      if (url.pathname.startsWith('/api/v2/mt5')) return route.abort()
      return route.fulfill({ json: { items: [], available: false } })
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => report.errors.push(error.message))
    const route = `${origin}/?workspace=fixture&view=live&area=live&section=notes&lang=${language}`
    await page.goto(`${route}&demo=1`)
    const notes = page.locator('.live-notes'), toolbar = notes.locator('.live-notes-toolbar')
    await notes.locator('.live-notes-empty-art').waitFor()
    assert.equal(await page.locator('.is-notes > .live-toolbar').count(), 0, 'No separate account-only toolbar')
    assert.equal(await notes.locator('.wm-pagination').count(), 0, 'Empty notes have no pagination')
    assert.equal(await notes.getByRole('button', { name: /Leave Feedback|Gửi phản hồi/i }).count(), 0)
    assert.equal(await notes.locator('.live-notes-groups [aria-pressed=true]').count(), 1)
    assert(await toolbar.locator('.live-note-create').isDisabled(), 'Demo retains write restrictions')
    assert(await notes.locator('.live-notes-empty .is-primary').isDisabled())
    assert(await toolbar.locator('.live-note-group').isDisabled())
    assert(await notes.locator('.live-notes-groups .fxa-icon-button').isDisabled())
    const layout = await notes.evaluate(el => {
      const pane = el.getBoundingClientRect(), toolbar = el.querySelector('.live-notes-toolbar').getBoundingClientRect(), art = el.querySelector('.live-notes-empty-art').getBoundingClientRect()
      return { left: toolbar.left - pane.left, right: pane.right - toolbar.right, artCenter: art.left + art.width / 2 - (pane.left + pane.width / 2), overflow: el.scrollWidth - el.clientWidth }
    })
    assert(Object.values(layout).every(n => Math.abs(n) <= 1), 'Full-width toolbar, centered art, no horizontal overflow')
    const searchTrigger = toolbar.getByRole('button', { name: language === 'vi' ? 'Tìm ghi chú' : 'Search notes', exact: true })
    await searchTrigger.click()
    const searchbox = toolbar.getByRole('searchbox')
    await searchbox.focus()
    await page.keyboard.press('Escape')
    assert.equal(await searchbox.count(), 0)
    assert(await searchTrigger.evaluate(el => el === document.activeElement), 'Closing search restores keyboard focus to its trigger')
    await page.screenshot({ path: `${out}/empty-${width}-${theme}-${language}.png` })
    await notes.locator('.live-notes-groups .is-active').hover()
    await page.screenshot({ path: `${out}/hover-${width}-${theme}.png` })
    report.cases.push({ name: 'demo-empty-layout', width, theme, language, layout })
    if (width === 1920) {
      await page.goto(`${route}&live_account=${fixtureAccount}`)
      await notes.locator('.live-notes-empty-art').waitFor()
      await page.waitForFunction(() => !document.querySelector('.live-note-create')?.disabled)
      await toolbar.locator('.live-note-create').click()
      await page.locator('.live-record-dialog').waitFor()
      await page.keyboard.press('Escape')
      report.cases.push({ name: 'existing-create-dialog-preserved' })
      records = journalRecords()
      await page.reload()
      await notes.locator('.live-note-row').first().waitFor()
      assert.equal(await notes.locator('.live-note-row').count(), 20)
      assert.equal(await notes.locator('.wm-pagination').count(), 1)
      await toolbar.getByRole('button', { name: 'Tìm ghi chú', exact: true }).click()
      const search = toolbar.getByRole('searchbox', { name: 'Tìm ghi chú', exact: true })
      await search.fill('Synthetic observation 30')
      assert.equal(await notes.locator('.live-note-row').count(), 1)
      assert.match(await notes.locator('.live-note-row').innerText(), /Synthetic note 30/)
      await search.fill('no-matching-observation')
      await notes.getByRole('heading', { name: 'Không tìm thấy ghi chú' }).waitFor()
      assert.equal(await notes.locator('.wm-pagination').count(), 0)
      await notes.locator('.live-notes-empty button').click()
      assert.equal(await notes.locator('.live-note-row').count(), 20)
      await toolbar.getByRole('button', { name: 'Bộ lọc ghi chú', exact: true }).click()
      await toolbar.getByRole('option', { name: 'London', exact: true }).click()
      await page.keyboard.press('Escape')
      assert.equal(await notes.locator('.live-note-row').count(), 15)
      assert((await notes.locator('.live-note-row small').allTextContents()).every(text => text.includes('London')))
      await toolbar.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click()
      assert.equal(await notes.locator('.live-note-row').count(), 20)
      await page.screenshot({ path: `${out}/populated-${width}-${theme}.png` })
      report.cases.push({ name: 'populated-search-tags-reset-pagination' })
      failRecords = true
      await page.reload()
      await page.locator('.live-status-error').waitFor()
      assert.equal(await notes.locator('.live-notes-empty, .live-note-row').count(), 0, 'A failed initial read is not an empty journal')
      failRecords = false
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
      await notes.locator('.live-note-row').first().waitFor()
      report.cases.push({ name: 'notes-read-error-retry' })
      failRecords = true
      await page.goto(route.replace('section=notes', `section=tag-analytics&live_account=${fixtureAccount}`))
      await page.locator('.live-status-error').waitFor()
      assert.equal(await page.locator('.live-journal-tags .live-empty').count(), 0, 'Unavailable journal labels must not become a false empty report')
      failRecords = false
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
      await page.locator('.live-tag-bars').waitFor()
      report.cases.push({ name: 'tags-read-error-retry' })
    }
    await ctx.close()
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(`${out}/browser.json`, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, errors: report.errors, writes: report.writes }))
