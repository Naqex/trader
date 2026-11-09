import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(process.argv[2] || path.join(root, '../evidence/owner-system-audit-20261031/workflow-controls'))
const virtualId = '\0owner-workflow-fixture.jsx'
const fixture = `
import React,{useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import SessionFilter from '/src/SessionFilter.jsx'
import SessionPresetMenu from '/src/SessionPresetMenu.jsx'
import ConfirmationDialog from '/src/ConfirmationDialog.jsx'
import TradeMedia from '/src/TradeMedia.jsx'
import TradeTagGroups from '/src/TradeTagGroups.jsx'
import NoteTemplatesDialog from '/src/NoteTemplatesDialog.jsx'
import {useNoteTemplateLibrary} from '/src/noteTemplatesApi.js'
import {TestingLocaleProvider} from '/src/testingLocale.jsx'
import '/src/styles.css'
import '/src/fx-shell-story.css'
import '/src/compact-system.css'
import '/src/product-ui-profile.css'
import '/src/trade-journal-preview.css'
function Fixture(){
 const [disabled,setDisabled]=useState(false),[items,setItems]=useState([{record_id:'one',name:'One'},{record_id:'two',name:'Two'}]),[value,setValue]=useState(null)
 const [show,setShow]=useState(false),[pending,setPending]=useState(false),[problem,setProblem]=useState(''),[templates,setTemplates]=useState(false)
 const [catalog,setCatalog]=useState({status:'ready',groups:[{id:'group-one',name:'Fixture group',revision:1}],items:[]})
 const library=useNoteTemplateLibrary('fixture-workspace'),parent=useRef(null),[parentOpen,setParentOpen]=useState(false)
 const [presets,setPresets]=useState([{id:'preset-one',name:'Fixture preset'}]),rejectPreset=useRef(false)
 useEffect(()=>{window.workflowFixture={disable:()=>setDisabled(true),enable:()=>setDisabled(false),empty:()=>setItems([]),pending:setPending,error:setProblem,rejectPreset:value=>{rejectPreset.current=value}};return()=>delete window.workflowFixture},[])
 useEffect(()=>{if(parentOpen)parent.current.showModal()},[parentOpen])
 return <><button id="before">Before</button><SessionFilter items={items} value={value} multiple disabled={disabled} onChange={setValue}/><button id="after">After</button>
 <button id="confirmation-opener" onClick={()=>setShow(true)}>Confirm fixture</button>{show&&<ConfirmationDialog title="Confirmation fixture" confirmLabel="Xóa" pending={pending} error={problem} onClose={()=>setShow(false)} onConfirm={()=>setProblem('Fixture failure')}><p>Fixture description</p></ConfirmationDialog>}
 <button id="parent-opener" onClick={()=>setParentOpen(true)}>Parent fixture</button>{parentOpen&&<dialog ref={parent} aria-label="Parent fixture" onCancel={e=>{e.preventDefault();setParentOpen(false)}}><button onClick={()=>setShow(true)}>Nested confirmation</button><input aria-label="Parent field"/>
  <SessionPresetMenu items={presets} selected={null} disabled={false} onApply={()=>{}} onCreate={()=>{}} onEdit={()=>{}} onDelete={async item=>{if(rejectPreset.current)throw new Error('fixture_preset_failure');setPresets(current=>current.filter(preset=>preset.id!==item.id))}}/></dialog>}
 <section aria-label="Media fixture"><TradeMedia workspace="fixture-workspace" session="fixture-session" trade="fixture-trade"/></section>
 <section aria-label="Groups fixture"><TradeTagGroups workspace="fixture-workspace" session="fixture-session" row={{trade_id:'fixture-trade',tags:[]}} catalog={{...catalog,accept:p=>setCatalog({...p,status:'ready'}),refresh:()=>{}}}/></section>
 <button id="template-opener" onClick={()=>setTemplates(true)}>Templates fixture</button>{templates&&<NoteTemplatesDialog workspace="fixture-workspace" library={library} onClose={()=>setTemplates(false)}/>}</>
}
createRoot(document.getElementById('root')).render(<TestingLocaleProvider language={new URLSearchParams(location.search).get('lang')}><div className="fx-app fx-shell-story" data-theme={new URLSearchParams(location.search).get('theme')||'dark'}><main className="fx-content" style={{padding:24,overflow:'auto',display:'block'}}><Fixture/></main></div></TestingLocaleProvider>)
`
const server = await createServer({ root, configFile: false, cacheDir:path.join(process.env.TEMP || out,'naqex-owner-workflow-vite-cache'), plugins: [react(), {
  name: 'owner-workflow-fixture',
  resolveId(id) { if (id === '/owner-workflow-fixture.jsx') return virtualId },
  async load(id) { if (id === virtualId) return transformWithEsbuild(fixture, 'owner-workflow-fixture.jsx', { loader:'jsx', jsx:'automatic' }) },
  configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/owner-workflow-fixture.html')) return next()
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/project-palette.css"></head><body><div id="root"></div><script type="module" src="/owner-workflow-fixture.jsx"></script></body></html>'
    res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html))
  }) },
}], server: { host: '127.0.0.1', port: 0, hmr: false }, optimizeDeps: { include:['react','react-dom/client','react/jsx-runtime','fast-deep-equal','@blocknote/core','@blocknote/react','@blocknote/ariakit','@tanstack/react-query','lucide-react'] } })
await server.listen()
const address = server.httpServer.address(), origin = `http://127.0.0.1:${address.port}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Isolated React/Vite fixtures; API responses are mocked; no owner writes', cases: [], errors: [], writes: [] }
const document = { format: 'blocknote', version: 1, blocks: [{ id: 'p1', type: 'paragraph', content: 'Fixture note' }] }
try {
  for (const [theme, language, width] of [['dark', 'vi', 1440], ['light', 'en', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: 'reduce' })
    let mediaRemoved = false, templateRemoved = false, rejectMedia = true, releaseMedia
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (req.method() !== 'GET') report.writes.push({ path: url.pathname, body: req.postDataJSON(), fixture: true })
      if (url.pathname === '/api/v2/note-templates') {
        if (req.method() !== 'GET') templateRemoved = true
        return route.fulfill({ json: { version: 'note-templates-v1', items: templateRemoved ? [] : [{ id: 'custom', name: 'Fixture custom template', revision: 1, document, updated_at_utc: '2026-10-31T00:00:00Z' }], preferences: { revision: templateRemoved ? 2 : 1, favorites: [], defaults: {} } } })
      }
      if (url.pathname === '/api/v2/trade-media') {
        if (req.method() !== 'GET') {
          if (rejectMedia) return route.fulfill({ status: 422, json: { detail: 'fixture_rejected' } })
          await new Promise(resolve => { releaseMedia = resolve }); mediaRemoved = true
          return route.fulfill({ json: { removed: true } })
        }
        return route.fulfill({ json: { items: mediaRemoved ? [] : [{ id: 'image-one', name: 'fixture.png', mime_type: 'image/png' }] } })
      }
      if (url.pathname === '/api/v2/trade-media/image-one') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
      if (url.pathname === '/api/v2/trade-labels') return route.fulfill({ json: { schema_version: 'trade-labels-v1', items: [], groups: [] } })
      return route.fulfill({ status: 404, json: { detail: 'fixture_not_implemented' } })
    })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('dialog', dialog => { report.errors.push(`Unexpected native browser dialog: ${dialog.message()}`); void dialog.dismiss() })
    const vi = language === 'vi', say = (a, b) => vi ? a : b
    await page.goto(`${origin}/owner-workflow-fixture.html?theme=${theme}&lang=${language}`)
    const picker = page.locator('.fxa-session-trigger')
    await picker.click(); await page.locator('.fxa-session-menu').waitFor()
    await page.evaluate(() => window.workflowFixture.disable())
    await page.locator('.fxa-session-menu').waitFor({ state: 'detached' }); assert(await picker.isDisabled())
    await page.evaluate(() => window.workflowFixture.enable()); await picker.click()
    await page.keyboard.press('Escape'); await page.locator('.fxa-session-menu').waitFor({ state: 'detached' }); assert(await picker.evaluate(n => n === document.activeElement))
    await page.evaluate(() => window.workflowFixture.empty()); await picker.click()
    assert(await page.locator('.fxa-session-all').isDisabled())
    await page.keyboard.press('Escape')
    await page.locator('#confirmation-opener').click()
    const confirm = page.locator('.wm-confirmation-dialog')
    await confirm.waitFor(); assert(await confirm.getByRole('button', { name: say('Hủy', 'Cancel'), exact: true }).evaluate(n => n === document.activeElement))
    await page.evaluate(() => window.workflowFixture.pending(true)); await page.keyboard.press('Escape'); assert(await confirm.isVisible())
    await page.evaluate(() => window.workflowFixture.pending(false)); await page.keyboard.press('Escape'); await confirm.waitFor({ state: 'detached' })
    assert(await page.locator('#confirmation-opener').evaluate(n => n === document.activeElement))
    await page.locator('#parent-opener').click(); await page.getByRole('button', { name: 'Nested confirmation' }).click()
    await page.keyboard.press('Escape'); await confirm.waitFor({ state: 'detached' }); assert(await page.getByRole('dialog', { name: 'Parent fixture', exact: true }).isVisible())
    const parentDialog = page.getByRole('dialog', { name: 'Parent fixture', exact: true }), presetTrigger = page.locator('.session-preset-trigger'), presetMenu = page.locator('.session-preset-menu')
    await presetTrigger.click(); await presetMenu.waitFor()
    await page.getByRole('textbox', { name: 'Parent field' }).focus(); await presetMenu.waitFor({ state: 'detached' })
    await presetTrigger.click(); await presetMenu.waitFor(); await page.keyboard.press('Escape'); await presetMenu.waitFor({ state: 'detached' })
    assert(await parentDialog.isVisible()); assert(await presetTrigger.evaluate(n => n === document.activeElement))
    const deletePreset = presetMenu.getByRole('button', { name: say('Xóa preset Fixture preset', 'Delete preset Fixture preset'), exact: true })
    await page.evaluate(() => window.workflowFixture.rejectPreset(true))
    await presetTrigger.click(); await deletePreset.click(); await confirm.waitFor(); await presetMenu.waitFor({ state: 'detached' })
    await confirm.getByRole('button', { name: say('Xóa preset', 'Delete preset'), exact: true }).click(); await confirm.getByRole('alert').waitFor()
    await confirm.getByRole('button', { name: say('Không xóa', "Don't delete"), exact: true }).click(); await confirm.waitFor({ state: 'detached' })
    assert(await parentDialog.isVisible()); assert(await presetTrigger.evaluate(n => n === document.activeElement))
    await page.evaluate(() => window.workflowFixture.rejectPreset(false))
    await presetTrigger.click(); await deletePreset.click(); await confirm.getByRole('button', { name: say('Xóa preset', 'Delete preset'), exact: true }).click(); await confirm.waitFor({ state: 'detached' })
    await presetTrigger.click(); assert.equal(await presetMenu.locator('.session-preset-row').count(), 0); await page.keyboard.press('Escape'); await presetMenu.waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: say('Xóa ảnh fixture.png', 'Delete image fixture.png'), exact: true }).click()
    await confirm.getByRole('button', { name: say('Xóa', 'Delete'), exact: true }).click(); await confirm.getByRole('alert').waitFor()
    rejectMedia = false
    await confirm.getByRole('button', { name: say('Xóa', 'Delete'), exact: true }).click()
    await confirm.getByRole('button', { name: say('Đang xử lý…', 'Working…'), exact: true }).waitFor()
    await page.keyboard.press('Escape'); assert(await confirm.isVisible())
    releaseMedia(); await confirm.waitFor({ state: 'detached' }); await page.getByRole('button', { name: say('Xóa ảnh fixture.png', 'Delete image fixture.png'), exact: true }).waitFor({ state: 'detached' })
    const group = page.getByRole('button', { name: say('Sửa nhóm Fixture group', 'Edit group Fixture group'), exact: true })
    await group.click(); await page.locator('.wm-group-menu').getByRole('button', { name: say('Xóa nhóm', 'Delete group'), exact: true }).click()
    await confirm.waitFor(); await page.screenshot({ path: path.join(out, `confirmation-${theme}-${width}.png`) })
    await page.keyboard.press('Escape'); assert(await group.evaluate(n => n === document.activeElement))
    await group.click(); await page.locator('.wm-group-menu').getByRole('button', { name: say('Xóa nhóm', 'Delete group'), exact: true }).click()
    await confirm.getByRole('button', { name: say('Xóa nhóm', 'Delete group'), exact: true }).click(); await group.waitFor({ state: 'detached' })
    await page.locator('#template-opener').click(); await page.getByRole('button', { name: 'Fixture custom template', exact: false }).click()
    const templates = page.locator('.wm-note-templates')
    await templates.getByRole('textbox', { name: say('Tên mẫu', 'Template name'), exact: true }).waitFor()
    await templates.getByRole('button', { name: say('Xóa mẫu', 'Delete template'), exact: true }).click(); await confirm.waitFor()
    await page.keyboard.press('Escape'); assert(await templates.isVisible())
    await templates.getByRole('button', { name: say('Xóa mẫu', 'Delete template'), exact: true }).click()
    await confirm.getByRole('button', { name: say('Xóa mẫu', 'Delete template'), exact: true }).click()
    await confirm.waitFor({ state: 'detached' }); assert.equal(templateRemoved, true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    report.cases.push({ theme, language, width, pickerDisableTransition: true, emptyPicker: true, confirmationCancelFocus: true, nestedEscape: true, presetMenuBlurEscape: true, presetConfirmation: true, busyEscapeBlocked: true, mediaErrorRetry: true, groupConfirmation: true, templateConfirmation: true })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors, mockedWrites: report.writes.length, out }))
} finally {
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify(report, null, 2))
  await browser.close(); await server.close()
}
