import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.CHART_STARTUP_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname,'127.0.0.1')
const output = process.env.CHART_STARTUP_OUTPUT || '../evidence/chart-startup-20261019'
const fixture = JSON.parse(await readFile(new URL('./visual/chart-fixture.json', import.meta.url)))
const report = { scope:'Intercepted synthetic session; actual preview bundles and native chart; no backend writes', cases:[], errors:[], unexpected:[] }
const browser = await chromium.launch()
await mkdir(output, { recursive:true })
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }

async function setup(width, theme, denied = false) {
  const modules = gate(), session = gate(), native = gate()
  const context = await browser.newContext({ viewport:{ width,height:790 }, reducedMotion:'reduce' })
  await context.addInitScript(theme => {
    localStorage.setItem('tw-theme', theme)
    localStorage.setItem('tw-language', 'vi')
    window.startupFrames = []
    let started = false
    function sample() {
      const loaders = [...document.querySelectorAll('[data-testid=chart-loading]')]
      if (loaders.length) started = true
      const ready = document.querySelector('[data-chart-status=ready], [data-chart-status=error], [data-empty-kind=denied]')
      if (started && !ready) {
        const rect = loaders[0]?.getBoundingClientRect()
        window.startupFrames.push({ count:loaders.length, top:rect?.top, left:rect?.left, width:rect?.width, height:rect?.height,
          covered:Boolean(document.elementFromPoint(10,10)?.closest('[data-testid=chart-loading]')) })
      }
      if (!ready) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, theme)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && request.method() === 'POST' && url.pathname.endsWith('/activity')) return route.abort()
    if (url.origin !== origin || !['GET','HEAD','OPTIONS'].includes(request.method())) {
      report.unexpected.push(`${request.method()} ${url.pathname}`)
      return route.abort()
    }
    if (/\/assets\/ReplayWorkspace-[^/]+\.js$/.test(url.pathname)) await modules.promise
    if (url.pathname === '/charting_library/charting_library.standalone.js') await native.promise
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/v2/workspace/events') return route.fulfill({ contentType:'text/event-stream',body:': fixture\n\n' })
    if (url.pathname === `/api/v2/replay/sessions/${fixture.session}`) {
      await session.promise
      return route.fulfill(denied ? { status:403,json:{ detail:'fixture access denied' } } : { json:{ ...fixture.latest,dataset_sha256:null } })
    }
    return route.fulfill({ json:url.pathname === '/api/v2/data/datasets' ? fixture.datasets : { items:[],available:false } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`, { waitUntil:'domcontentloaded' })
  return { page,context,modules,session,native }
}

async function capture(page, name) {
  const loader = page.getByTestId('chart-loading')
  await loader.waitFor()
  assert.equal(await loader.count(), 1)
  const state = await loader.evaluate(node => {
    const rect = node.getBoundingClientRect(), content = node.firstElementChild.getBoundingClientRect(), css = getComputedStyle(node)
    return { top:rect.top,left:rect.left,width:rect.width,height:rect.height,centerX:content.x+content.width/2,centerY:content.y+content.height/2,
      background:css.backgroundColor,color:css.color,viewportWidth:innerWidth,viewportHeight:innerHeight,
      covered:Boolean(document.elementFromPoint(10,10)?.closest('[data-testid=chart-loading]')) }
  })
  await page.screenshot({ path:`${output}/${name}.png` })
  assert.deepEqual([state.left,state.top,state.width,state.height], [0,0,state.viewportWidth,state.viewportHeight], `${name}: loader must cover the header and viewport`)
  assert.equal(state.covered, true)
  return state
}

try {
  for (const [width,theme] of [[1368,'dark'],[390,'light']]) {
    const {page,context,modules,session,native} = await setup(width,theme)
    const route = await capture(page,`${width}-${theme}-route`)
    const reading = page.waitForRequest(request => new URL(request.url()).pathname === `/api/v2/replay/sessions/${fixture.session}`)
    modules.release(); await reading
    const data = await capture(page,`${width}-${theme}-session`)
    const library = page.waitForRequest('**/charting_library/charting_library.standalone.js*')
    session.release(); await library
    await page.locator('[data-chart-status=loading]').waitFor()
    const engine = await capture(page,`${width}-${theme}-native`)
    assert.deepEqual(data, route, 'Route and session loading have identical geometry and palette')
    assert.deepEqual(engine, route, 'Native chart initialization keeps the same loading surface')
    assert.equal(await page.locator('.advanced-chart-host').evaluate(node => getComputedStyle(node).visibility), 'hidden')
    native.release()
    await page.locator('[data-chart-status=ready]').waitFor({ timeout:30000 })
    await page.getByTestId('chart-loading').waitFor({ state:'detached' })
    const frames = await page.evaluate(() => window.startupFrames)
    assert.ok(frames.length > 0)
    assert.deepEqual(frames.filter(frame => frame.count !== 1 || !frame.covered || frame.top !== 0 || frame.left !== 0 || frame.width !== width || frame.height !== 790), [], 'No uncovered frame or duplicate loader during startup')
    await page.screenshot({ path:`${output}/${width}-${theme}-ready.png` })
    report.cases.push({ width,theme,route,data,engine,checkedFrames:frames.length,result:'PASS' })
    await context.close()
  }
  const {page,context,modules,session,native} = await setup(1368,'dark',true)
  modules.release(); session.release(); native.release()
  await page.locator('[data-empty-kind=denied]').waitFor()
  assert.equal(await page.getByTestId('chart-loading').count(), 0, 'Read failure must not leave the viewport covered')
  report.cases.push({ case:'403 exits loading and shows denied state', result:'PASS' })
  await context.close()
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.unexpected, [])
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error }
finally { await writeFile(`${output}/browser.json`, JSON.stringify(report,null,2)); await browser.close() }
console.log(JSON.stringify({ result:report.result,cases:report.cases.length,errors:report.errors }))
