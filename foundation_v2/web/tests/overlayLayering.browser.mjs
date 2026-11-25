import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { splitTestingCopy } from '../vite.config.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(process.argv[2] || path.join(root, '.artifacts/overlay-layering'))
const virtualId = '\0overlay-layering-fixture.jsx'

const fixture = `
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import LegacyModal from '/src/LegacyModal.jsx'
import LegacyPopover from '/src/LegacyPopover.jsx'
import ConfirmationDialog from '/src/ConfirmationDialog.jsx'
import { TestingLocaleProvider } from '/src/testingLocale.jsx'
import '/src/styles.css'
import '/src/fx-shell-story.css'
import '/src/compact-system.css'
import '/src/product-ui-profile.css'

function OverlayFixture({ theme }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverTriggerRef = useRef(null)

  useEffect(() => {
    window.overlayFixture = {
      setConfirmPending,
    }
    return () => { delete window.overlayFixture }
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <button id="open-modal" type="button" onClick={() => setModalOpen(true)}>Open parent modal</button>
      {modalOpen && (
        <LegacyModal theme={theme} label="Parent LegacyModal" onClose={() => setModalOpen(false)}>
          <div style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button id="modal-open-confirm" type="button" onClick={() => setConfirmOpen(true)}>
              Open nested confirmation
            </button>
            <button
              id="modal-open-popover"
              ref={popoverTriggerRef}
              type="button"
              onClick={() => setPopoverOpen(open => !open)}
            >
              Open nested popover
            </button>
            <button id="modal-last-btn" type="button">Last modal button</button>
          </div>
          {popoverOpen && (
            <LegacyPopover
              anchor={popoverTriggerRef.current}
              theme={theme}
              label="Nested popover menu"
              onClose={() => setPopoverOpen(false)}
            >
              <button id="popover-item-1" type="button" onClick={() => setPopoverOpen(false)}>Popover item 1</button>
              <button id="popover-item-2" type="button" onClick={() => setPopoverOpen(false)}>Popover item 2</button>
            </LegacyPopover>
          )}
          {confirmOpen && (
            <ConfirmationDialog
              title="Nested confirmation"
              confirmLabel="Xóa"
              pending={confirmPending}
              onConfirm={() => {}}
              onClose={() => setConfirmOpen(false)}
            >
              <p>Nested confirmation body inside LegacyModal.</p>
            </ConfirmationDialog>
          )}
        </LegacyModal>
      )}
    </div>
  )
}

const params = new URLSearchParams(location.search)
const theme = params.get('theme') || 'dark'
const lang = params.get('lang') || 'vi'
createRoot(document.getElementById('root')).render(
  <TestingLocaleProvider language={lang}>
    <div className="fx-app fx-shell-story" data-theme={theme}>
      <main className="fx-content"><OverlayFixture theme={theme} /></main>
    </div>
  </TestingLocaleProvider>,
)
`

const server = await createServer({
  root,
  configFile: false,
  cacheDir: path.join(process.env.TEMP || out, 'naqex-overlay-layering-vite-cache'),
  plugins: [
    react(),
    splitTestingCopy(),
    {
      name: 'overlay-layering-fixture',
      resolveId(id) {
        if (id === '/overlay-layering-fixture.jsx') return virtualId
      },
      async load(id) {
        if (id === virtualId) {
          return transformWithEsbuild(fixture, 'overlay-layering-fixture.jsx', { loader: 'jsx', jsx: 'automatic' })
        }
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/overlay-layering-fixture.html')) return next()
          const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/project-palette.css"></head><body><div id="root"></div><script type="module" src="/overlay-layering-fixture.jsx"></script></body></html>'
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml(req.url, html))
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0, hmr: false },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'lucide-react'] },
})

await server.listen()
const address = server.httpServer.address()
const origin = `http://127.0.0.1:${address.port}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'LegacyModal + ConfirmationDialog + LegacyPopover layering fixture', cases: [], errors: [] }

try {
  for (const [theme, lang, width] of [['dark', 'vi', 1440], ['light', 'en', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(`${origin}/overlay-layering-fixture.html?theme=${theme}&lang=${lang}`)

    const openModalBtn = page.locator('#open-modal')
    const modal = page.locator('.legacy-modal')
    const confirm = page.locator('.wm-confirmation-dialog')
    const popover = page.locator('.legacy-popover')

    // 1. Open parent LegacyModal -> open nested ConfirmationDialog -> Escape closes ONLY confirm
    await openModalBtn.click()
    await modal.waitFor()
    await page.locator('#modal-open-confirm').click()
    await confirm.waitFor()

    // 2. While nested ConfirmationDialog is open, Tab / Shift+Tab must stay strictly inside <dialog>
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab')
      const insideConfirm = await page.evaluate(() => Boolean(document.activeElement?.closest('.wm-confirmation-dialog')))
      assert.equal(insideConfirm, true, `Tab step ${i + 1} escaped nested ConfirmationDialog into background LegacyModal`)
    }
    await page.keyboard.press('Shift+Tab')
    const stillInside = await page.evaluate(() => Boolean(document.activeElement?.closest('.wm-confirmation-dialog')))
    assert.equal(stillInside, true, 'Shift+Tab escaped nested ConfirmationDialog')

    // 3. Synthetic keyboard click (detail=0, clientX=0, clientY=0) on <dialog> must NOT falsely dismiss it
    await page.evaluate(() => {
      const dlg = document.querySelector('.wm-confirmation-dialog')
      dlg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: 0, clientY: 0 }))
    })
    assert.equal(await confirm.isVisible(), true, 'detail=0 synthetic click falsely dismissed ConfirmationDialog')

    // 4. While pending=true, Escape must keep BOTH ConfirmationDialog AND parent LegacyModal open, and Tab stays trapped
    await page.evaluate(() => window.overlayFixture.setConfirmPending(true))
    await page.locator('.wm-confirmation-dialog[aria-busy="true"]').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await confirm.isVisible(), true, 'pending ConfirmationDialog closed on Escape')
    assert.equal(await modal.isVisible(), true, 'parent LegacyModal closed while nested pending ConfirmationDialog was open')
    await page.keyboard.press('Tab')
    const busyStillInside = await page.evaluate(() => Boolean(document.activeElement?.closest('.wm-confirmation-dialog')))
    assert.equal(busyStillInside, true, 'Tab escaped busy ConfirmationDialog while buttons were disabled')

    // 5. Once pending=false, Escape closes ONLY ConfirmationDialog; parent LegacyModal stays open & opener regains focus
    await page.evaluate(() => window.overlayFixture.setConfirmPending(false))
    await page.locator('.wm-confirmation-dialog[aria-busy="false"]').waitFor()
    await page.keyboard.press('Escape')
    await confirm.waitFor({ state: 'detached' })
    assert.equal(await modal.isVisible(), true, 'parent LegacyModal closed when nested ConfirmationDialog was dismissed with Escape')
    assert.equal(await page.locator('#modal-open-confirm').evaluate(n => n === document.activeElement), true, 'focus did not return to modal opener button')

    // 6. Nested LegacyPopover inside LegacyModal: Escape closes ONLY popover, returns focus to trigger
    await page.locator('#modal-open-popover').click()
    await popover.waitFor()
    await page.keyboard.press('Escape')
    await popover.waitFor({ state: 'detached' })
    assert.equal(await modal.isVisible(), true, 'parent LegacyModal closed when nested LegacyPopover was dismissed')
    assert.equal(await page.locator('#modal-open-popover').evaluate(n => n === document.activeElement), true, 'focus did not return to popover trigger')

    // 7. Parent LegacyModal Tab loop & Escape -> closes modal and returns focus to #open-modal
    await page.locator('#modal-last-btn').focus()
    await page.keyboard.press('Tab')
    const wrappedInsideModal = await page.evaluate(() => Boolean(document.activeElement?.closest('.legacy-modal')))
    assert.equal(wrappedInsideModal, true, 'Tab did not loop inside LegacyModal')
    await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'detached' })
    assert.equal(await openModalBtn.evaluate(n => n === document.activeElement), true, 'focus did not return to #open-modal')

    report.cases.push({
      theme,
      lang,
      width,
      nestedDialogTabTrap: true,
      syntheticClickGuarded: true,
      pendingEscapeGuarded: true,
      nestedEscapeTopOnly: true,
      nestedPopoverEscape: true,
      parentModalRestore: true,
    })
    await context.close()
  }

  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify({ passed: true, cases: report.cases.length, errors: report.errors }))
} finally {
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify(report, null, 2))
  await browser.close()
  await server.close()
}
