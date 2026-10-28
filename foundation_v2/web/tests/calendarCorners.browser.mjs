import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const origin=process.env.TW_UI_ORIGIN||'http://127.0.0.1:5180',out=process.env.TW_UI_EVIDENCE_DIR||'E:/BACKUP-TRADINGWORKSPACE/calendar-corners-20261028/baseline',baseline=process.env.TW_CORNER_BASELINE==='1'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const report={scope:'Labeled Analytics corner fixtures; external/broker calls and writes blocked',cases:[],errors:[],writes:[]}
try{
 for(const [width,theme] of [[1440,'dark'],[1440,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-timezone','UTC')},theme)
  const session_id='calendar-corners-fixture',provenance={session_id,dataset_id:session_id,dataset_sha256:'fixture',revision:1,cursor_index:100,execution_event_sequence:1,account_currency:'USD'}
  const ledger=[['2026-05-01',100],['2026-05-25',100],['2026-05-31',-100]].map(([day,net_pnl],i)=>({trade_id:`fixture-${i}`,session_id,status:'closed',side:'buy',symbol:'EURUSD',quantity:1,net_pnl,planned_risk_budget:100,realized_r:net_pnl/100,starting_balance:1000,account_currency:'USD',open_time_utc:`${day}T06:00:00Z`,close_time_utc:`${day}T07:00:00Z`,report_time_utc:`${day}T07:00:00Z`}))
  await context.route('**/*',route=>{
   const q=route.request(),u=new URL(q.url())
   if(!['GET','HEAD','OPTIONS'].includes(q.method())){report.writes.push(u.pathname);return route.abort()}
   if(u.origin!==origin||/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname))return route.abort()
   if(u.pathname==='/api/v2/journal/context')return route.fulfill({json:{schema_version:'replay-journal-context-v1',workspace_id:'tenant-a',session_id,record_count:0,trades:[]}})
   if(u.pathname===`/api/v2/replay/sessions/${session_id}/analytics`)return route.fulfill({json:{schema_version:'analytics-read-model-v1',analytics_available:true,provenance,ledger,scope:{time_basis:'market',total_trade_count:3,selected_trade_count:3},metrics:{starting_balance:1000,ending_closed_trade_balance:1100,closed_trade_count:3,closed_trade_balance_curve:[{sequence:0,closed_trade_balance:1000},{sequence:1,trade_id:'fixture-0',closed_trade_balance:1100},{sequence:2,trade_id:'fixture-1',closed_trade_balance:1200},{sequence:3,trade_id:'fixture-2',closed_trade_balance:1100}]}}})
   if(u.pathname.includes('/analytics/experiments'))return route.fulfill({status:422,json:{detail:'fixture_no_path'}})
   return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=analytics&area=testing&section=analytics&select=1&session=${session_id}&lang=vi`)
  const cal=page.getByTestId('analytics-calendar');await cal.waitFor();await cal.scrollIntoViewIfNeeded()
  const left=cal.locator('[data-date="2026-05-25"]'),right=cal.locator('[data-date="2026-05-31"]')
  const styles=el=>{const s=getComputedStyle(el),p=getComputedStyle(el,'::after');return {left:s.borderBottomLeftRadius,right:s.borderBottomRightRadius,pseudoLeft:p.borderBottomLeftRadius,pseudoRight:p.borderBottomRightRadius,border:s.borderColor,background:s.backgroundColor,cursor:s.cursor}}
  const leftBefore=await left.evaluate(styles);await left.hover();await left.screenshot({path:`${out}/left-${width}-${theme}.png`});const leftHover=await left.evaluate(styles)
  const rightBefore=await right.evaluate(styles);await right.hover();await right.screenshot({path:`${out}/right-${width}-${theme}.png`});const rightHover=await right.evaluate(styles)
  assert.deepEqual(leftBefore,leftHover);assert.deepEqual(rightBefore,rightHover);assert.equal(await cal.locator('button.wm-calendar-day,[data-date][data-tooltip]').count(),0)
  const innerRadius=await cal.locator(':scope>.wm-calendar-scroll').evaluate(el=>getComputedStyle(el).borderBottomLeftRadius)
  if(!baseline){assert.equal(leftBefore.left,innerRadius);assert.equal(leftBefore.pseudoLeft,innerRadius);assert.equal(rightBefore.right,innerRadius);assert.equal(rightBefore.pseudoRight,innerRadius)}
  const middle=await cal.locator('[data-date="2026-05-26"]').evaluate(styles);assert.equal(middle.left,'0px');assert.equal(middle.right,'0px')
  await cal.screenshot({path:`${out}/calendar-${width}-${theme}.png`})
  if(process.env.TW_DARK_PROPOSAL==='1'&&width===1440&&theme==='dark'){
   await page.evaluate(()=>scrollTo(0,0));await page.locator('.fxa-profit-panel').scrollIntoViewIfNeeded()
   await page.screenshot({path:`${out}/dark-current.png`})
   await page.addStyleTag({content:`:root.theme-dark,html[data-tw-theme=dark],.fx-app.fx-shell-story[data-theme=dark]{--project-canvas:#080808;--project-chrome:#080808;--project-surface:#121212;--project-raised:#1B1B1B;--project-control:#242424;--project-hover:#383838;--project-row-hover:#1B1B1B;--project-border:#454545;--project-border-strong:#6B6B6B;--project-text:#F0F0F0;--project-muted:#BDBDBD;--project-subtle:#969696;--project-grid:#2B2B2B;--project-on-primary:#080808;--project-on-action:#080808;--project-on-positive:#080808;--project-on-negative:#080808}.fx-app.fx-shell-story[data-theme=dark] .fxa-panel{background:var(--project-surface)}.fx-app.fx-shell-story[data-theme=dark] .fx-content :is(.fxa-button,.fxa-icon-button,button,input,select,textarea):disabled{opacity:1;color:#858585}`})
   await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))))
   await page.screenshot({path:`${out}/dark-proposal.png`})
  }
  report.cases.push({width,theme,innerRadius,leftBefore,rightBefore,passiveHover:true});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status=baseline?'BASELINE':'PASS';console.log(`${report.status} ${report.cases.length} calendar corner cases`)
}catch(error){report.status='FAIL';report.failure=error.stack;throw error}
finally{await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close()}
