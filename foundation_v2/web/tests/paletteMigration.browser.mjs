import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const origin=process.env.TW_UI_ORIGIN||'http://127.0.0.1:5180',out=process.env.TW_UI_EVIDENCE_DIR||'../evidence/palette-migration-20261028'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.TW_UI_QA_CHROMIUM||'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'})
const report={scope:'Approved palette and real component states; labeled demo and read-only Session',cases:[],errors:[],writes:[]}
const href=query=>`${origin}/?workspace=tenant-a&area=testing&lang=vi&${query}`
let page
try{
 for(const [theme,width] of [['dark',1920],['light',1920],['dark',390],['light',390]]){
  const context=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'})
  await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
  await context.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(!['GET','HEAD','OPTIONS'].includes(q.method())){report.writes.push(u.pathname);return route.abort()}return u.origin===origin&&!/^\/api\/v2\/(mt5|live|events)(\/|$)/.test(u.pathname)?route.continue():route.abort()})
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message))
  await page.goto(href('ui_reference=1'));await page.locator('#controls').waitFor()
  const palette=await page.locator('.fx-app').evaluate(el=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true})
   const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)}
   const luminance=color=>rgb(color).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0)
   const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
   const keys=['canvas','surface','raised','control','hover','row-hover','row-selected','text','muted','subtle','positive','negative','primary','primary-hover','on-primary','action','action-hover','on-action','danger-action','danger-hover','on-danger','border-strong']
   const colors=Object.fromEntries(keys.map(key=>{const p=document.createElement('i');p.style.color=`var(--project-${key})`;el.append(p);const color=getComputedStyle(p).color;p.remove();return [key,color]}))
   const ratios=[]
   for(const fg of ['text','muted'])for(const bg of ['canvas','surface','raised','control','hover','row-hover','row-selected'])ratios.push({fg,bg,value:ratio(colors[fg],colors[bg]),minimum:4.5})
   for(const fg of ['positive','negative','primary','subtle'])for(const bg of ['canvas','surface','row-selected'])ratios.push({fg,bg,value:ratio(colors[fg],colors[bg]),minimum:4.5})
   for(const [fg,bg] of [['on-primary','primary'],['on-primary','primary-hover'],['on-action','action'],['on-action','action-hover'],['on-danger','danger-action'],['on-danger','danger-hover']])ratios.push({fg,bg,value:ratio(colors[fg],colors[bg]),minimum:4.5})
   ratios.push({fg:'border-strong',bg:'surface',value:ratio(colors['border-strong'],colors.surface),minimum:3})
   return {colors,ratios}
  })
  assert.equal(palette.colors.positive,theme==='dark'?'rgb(34, 199, 138)':'rgb(6, 115, 79)')
  assert.equal(palette.colors.negative,theme==='dark'?'rgb(255, 83, 100)':'rgb(190, 36, 56)')
  assert.ok(palette.ratios.every(c=>c.value>=c.minimum),JSON.stringify(palette.ratios.filter(c=>c.value<c.minimum)))
  const neutral=page.locator('#controls .wm-reference-controls>.wm-button').nth(1),primary=page.locator('#controls .wm-reference-controls>.wm-button.is-primary')
  const style=el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,color:s.color,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}}
  const rest=await neutral.evaluate(style);await neutral.hover();const hover=await neutral.evaluate(style);assert.notEqual(rest.bg,hover.bg);assert.equal(rest.width,hover.width);assert.equal(rest.height,hover.height)
  assert.equal(hover.bg,palette.colors.hover);await primary.hover();const action=await primary.evaluate(style);assert.equal(action.bg,palette.colors['action-hover']);assert.equal(action.color,palette.colors['on-action'])
  const field=page.locator('.wm-reference-form-grid .wm-field').first();await field.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await field.evaluate(el=>getComputedStyle(el).borderTopColor),palette.colors.primary)
  assert.equal(await page.getByRole('button',{name:'Không khả dụng',exact:true}).isDisabled(),true)
  const row=page.locator('.wm-reference-row-sample tr.is-selected');assert.equal(await row.evaluate(el=>getComputedStyle(el).backgroundColor),palette.colors['row-selected'])
  await row.locator('button').hover();assert.notEqual(await row.locator('button').evaluate(el=>getComputedStyle(el).backgroundColor),palette.colors['row-selected'])
  await page.locator('#controls').screenshot({path:`${out}/controls-${theme}-${width}.png`})
  await page.goto(href('view=analytics&section=analytics&session=6428cf18b3f54a36b2e90207ef12392e&select=1'))
  await page.locator('.fxa-frequency-card').first().waitFor()
  const headings=await page.locator('.fxa-frequency-card .fxa-chart-heading').evaluateAll(nodes=>nodes.map(el=>{const b=el.getBoundingClientRect(),card=el.parentElement.getBoundingClientRect(),h=el.querySelector('h3').getBoundingClientRect(),n=el.querySelector(':scope>span').getBoundingClientRect();return {titleLeft:h.left-card.left,noteRight:card.right-n.right,sameLine:Math.abs(h.top-n.top)<2,width:b.width,cardWidth:card.width}}))
  assert.equal(headings.length,3);assert.ok(headings.every(h=>Math.abs(h.titleLeft-17)<1&&Math.abs(h.noteRight-17)<1),JSON.stringify(headings))
  await page.locator('.fxa-frequency-panel').screenshot({path:`${out}/frequency-${theme}-${width}.png`})
  await page.goto(href('view=trade&section=trades&select=1&sessions=all&demo=1'));await page.locator('.wm-data-table tbody tr').first().waitFor()
  const badges=await page.locator('.wm-return-badge,.wm-trade-label,.fxa-badge.is-buy,.fxa-badge.is-sell').evaluateAll(nodes=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true})
   const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)}
   return nodes.filter(el=>el.getClientRects().length).map(el=>{const s=getComputedStyle(el),a=lum(s.color),b=lum(s.backgroundColor);return {text:el.textContent,fg:s.color,bg:s.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}})
  })
  assert.ok(badges.length>0);assert.ok(badges.every(b=>b.ratio>=4.5),JSON.stringify(badges.filter(b=>b.ratio<4.5)))
  if(width===1920)await page.screenshot({path:`${out}/trade-${theme}.png`})
  await page.goto(href('view=analytics&section=analytics&demo=1&analytics_tab=simulation'))
  await page.locator('.fxa-scenario-panel').first().waitFor()
  assert.equal(await page.locator('.fxa-scenario-panel').count(),2)
  for(const [index,panel] of (await page.locator('.fxa-scenario-panel').all()).entries()){
   await panel.getByRole('button',{name:'Chạy mô phỏng',exact:true}).click()
   const add=panel.locator('.fxa-add-scenario');await add.waitFor();await add.hover()
   const addStyle=await add.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}))
   assert.equal(addStyle.bg,palette.colors['primary-hover']);assert.equal(addStyle.fg,palette.colors['on-primary'])
   const paths=await panel.locator('svg [data-series]>path').evaluateAll(nodes=>nodes.map(el=>({stroke:getComputedStyle(el).stroke,dash:el.getAttribute('stroke-dasharray')})))
   assert.ok(paths.length>=4);assert.ok(new Set(paths.map(p=>p.stroke)).size>=4);assert.deepEqual(paths.slice(0,4).map(p=>p.dash),['','6 4','2 3','8 3 2 3'])
   if(width===1920)await panel.screenshot({path:`${out}/scenario-${theme}-${index}.png`})
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  report.cases.push({theme,width,paletteMinimum:Math.min(...palette.ratios.filter(c=>c.minimum===4.5).map(c=>c.value)),headings,badgesMinimum:Math.min(...badges.map(b=>b.ratio)),states:true,keyboard:true,disabled:true,scenarioHover:true,scenarioDashes:true})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.status='PASS';console.log(`PASS ${report.cases.length} palette/state/heading journeys`)
}catch(e){report.status='FAIL';report.failure=e.stack;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw e}
finally{await writeFile(`${out}/browser.json`,JSON.stringify(report,null,2));await browser.close()}
