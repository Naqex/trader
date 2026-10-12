import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
const fixture=JSON.parse(await readFile(new URL('../../../web/tests/visual/chart-fixture.json',import.meta.url)))
const browser=await chromium.launch({headless:true}), context=await browser.newContext({viewport:{width:1440,height:987}})
await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
await context.route('**/*',async route=>{
 const r=route.request(),u=new URL(r.url());if(u.origin!=='http://127.0.0.1:5180'||r.method()!=='GET')return route.abort()
 if(u.pathname.includes('charting_library.standalone'))return route.abort('failed')
 if(!u.pathname.startsWith('/api/'))return route.continue()
 const body=u.pathname.includes('/replay/sessions/')?{...fixture.latest,dataset_sha256:null}:u.pathname.endsWith('/data/datasets')?fixture.datasets:{items:[]}
 return route.fulfill({json:body})
})
const page=await context.newPage();await page.goto(`http://127.0.0.1:5180/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
await page.locator('[data-chart-status=error]').waitFor()
console.log(await page.locator('.advanced-chart-message').evaluate(n=>({html:n.outerHTML,text:n.innerText,style:getComputedStyle(n).display,box:n.getBoundingClientRect().toJSON()})))
console.log(await page.getByRole('link').allTextContents())
await page.screenshot({path:new URL('library-error-debug.png',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:')})
await browser.close()
