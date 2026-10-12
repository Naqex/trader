import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
const fixture=JSON.parse(await readFile(new URL('../../../web/tests/visual/chart-fixture.json',import.meta.url)))
const browser=await chromium.launch({headless:true}), context=await browser.newContext({viewport:{width:1440,height:987}}), blocked=[]
await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
await context.route('**/*',async route=>{
 const r=route.request(),u=new URL(r.url());if(u.origin!=='http://127.0.0.1:5180'||r.method()!=='GET'){blocked.push(r.method()+' '+u.pathname);return route.abort()}
 if(!u.pathname.startsWith('/api/'))return route.continue()
 const body=u.pathname.includes('/replay/sessions/')?{...fixture.latest,dataset_sha256:null}:u.pathname.endsWith('/data/datasets')?fixture.datasets:{items:[],available:false}
 return route.fulfill({json:body})
})
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)))
try {
 await page.goto(`http://127.0.0.1:5180/?workspace=${fixture.workspace}&view=replay&surface=workspace&session=${fixture.session}`)
 await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
 await page.getByRole('button',{name:'Mua',exact:true}).click()
 await page.locator('.legacy-order-modal').waitFor()
 await page.locator('.legacy-order-modal').getByRole('button',{name:'Hướng',exact:true}).click()
 await page.locator('.fx-select-menu').waitFor()
 const style=await page.locator('.legacy-order-modal .fx-select').first().evaluate(n=>{const trigger=n.querySelector('button'),menu=n.querySelector('.fx-select-menu');return {rootPosition:getComputedStyle(n).position,triggerBorder:getComputedStyle(trigger).borderWidth,menuPosition:getComputedStyle(menu).position,menuBg:getComputedStyle(menu).backgroundColor,menuRect:menu.getBoundingClientRect().toJSON(),radiusToken:getComputedStyle(n).getPropertyValue('--wm-control-radius')}})
 await writeFile(new URL('modal-portal-style.json',import.meta.url),JSON.stringify(style,null,2))
 await page.screenshot({path:new URL('modal-menu-open.png',import.meta.url).pathname.replace(/^\/([A-Z]):/,'$1:')})
 await page.keyboard.press('Escape')
 const state={modalCount:await page.locator('.legacy-order-modal').count(),menuCount:await page.locator('.fx-select-menu').count(),active:await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,250))}
 console.log(JSON.stringify({state,errors,blocked}))
 await writeFile(new URL('modal-baseline.json',import.meta.url),JSON.stringify({state,errors,blocked},null,2))
} finally {await browser.close()}
