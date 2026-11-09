import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = process.argv[2] || fileURLToPath(new URL('../.artifacts/trade-note-presence', import.meta.url))
await mkdir(output, { recursive: true })
const bundle = await build({ stdin: { loader: 'jsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
  import {useState} from 'react'
  import {createRoot} from 'react-dom/client'
  import useTradeNotePresence from '../src/useTradeNotePresence.js'
  function Fixture() {
    const [workspace,setWorkspace]=useState('a'),[tick,setTick]=useState(0)
    const reader=useTradeNotePresence(workspace)
    window.reader=reader
    return <><button onClick={()=>setTick(value=>value+1)}>render</button>{['a','b','c'].map(name=><button key={name} onClick={()=>setWorkspace(name)}>{name}</button>)}<output>{JSON.stringify({workspace,tick,known:reader('session','7')})}</output></>
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' }, logLimit: 1 })
const browser = await chromium.launch(), report = { fixture: true, errors: [], requests: [], cases: [], writes: [] }
const origin = 'http://127.0.0.1:5279'
let releaseA, releaseB
const gateA = new Promise(resolve => { releaseA = resolve }), gateB = new Promise(resolve => { releaseB = resolve })
try {
  const page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (request.method() !== 'GET') { report.writes.push(url.pathname); return route.abort() }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
    if (url.pathname === '/api/v2/journal') {
      const workspace = request.headers()['x-workspace-id']; report.requests.push(workspace)
      if (workspace === 'a') { await gateA; return route.fulfill({ json: { items: [{ payload: { source: { session_id: 'session', trade_id: '7' }, note: 'Fixture note' } }] } }) }
      if (workspace === 'b') { await gateB; return route.fulfill({ json: { items: [] } }) }
      return route.fulfill({ status: 403, json: { detail: 'fixture_denied' } })
    }
    return route.fulfill({ status: 204, body: '' })
  })
  await page.goto(origin)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('"known":null'))
  releaseA(); await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('"known":true'))
  await page.evaluate(() => { window.previous = window.reader })
  await page.getByRole('button', { name: 'render', exact: true }).click()
  assert(await page.evaluate(() => window.previous === window.reader))
  assert.equal(await page.evaluate(() => window.reader('session', 'missing')), false)
  report.cases.push('loaded reader is stable across unrelated rerenders; true and known-false preserved')
  await page.getByRole('button', { name: 'b', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('"workspace":"b"') && window.reader('session','7') === null)
  releaseB(); await page.waitForFunction(() => document.querySelector('output')?.textContent.includes('"known":false'))
  report.cases.push('workspace change hides earlier notes immediately; known empty returns false')
  await page.getByRole('button', { name: 'c', exact: true }).click()
  await page.waitForResponse(response => response.url().endsWith('/api/v2/journal') && response.status() === 403)
  assert.equal(await page.evaluate(() => window.reader('session','7')), null)
  report.cases.push('denied read remains unknown rather than known-empty')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.writes, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { releaseA(); releaseB(); await browser.close(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
