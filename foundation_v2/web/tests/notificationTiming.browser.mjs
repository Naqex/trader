import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir,writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output=process.env.TW_NOTIFICATION_EVIDENCE || fileURLToPath(new URL('../.artifacts/notificationTiming.browser', import.meta.url))
await mkdir(output,{recursive:true})
const bundle=await build({stdin:{loader:'jsx',resolveDir:fileURLToPath(new URL('.',import.meta.url)),contents:`
  import {useEffect,useState} from 'react'
  import {createRoot} from 'react-dom/client'
  import {NotificationProvider,NotificationSlot,NotificationSurface,useNotifications} from '../src/Notifications.jsx'
  function Fixture(){
    const notify=useNotifications(),[shown,setShown]=useState(false),[critical,setCritical]=useState(false),[tick,setTick]=useState(0)
    useEffect(()=>{const timer=setInterval(()=>setTick(value=>value+1),100);return()=>clearInterval(timer)},[])
    return <><nav>{['success','info','warning','error'].map(tone=><button key={tone} onClick={()=>notify(tone,tone)}>{tone}</button>)}
      <button onClick={()=>setShown(true)}>state</button><button onClick={()=>setCritical(true)}>critical</button><button>outside</button></nav>
      <NotificationSlot>{shown&&<NotificationSurface tone="warning" onDismiss={()=>setShown(false)} data-testid="state"><p>State {tick}</p><button onClick={()=>setShown(false)}>close</button></NotificationSurface>}
      {critical&&<NotificationSurface tone="error" persistent onDismiss={()=>setCritical(false)} data-testid="critical"><p>Unresolved</p><button onClick={()=>setCritical(false)}>close</button></NotificationSurface>}</NotificationSlot></>
  }
  createRoot(document.getElementById('root')).render(<NotificationProvider><Fixture/></NotificationProvider>)
`},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},logLimit:1})
const browser=await chromium.launch(),report={fixture:true,brokerCalls:0,cases:[],errors:[]}
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  page.on('pageerror',error=>report.errors.push(error.message))
  const time=new Date('2026-10-24T00:00:00Z')
  await page.clock.install({time});await page.clock.pauseAt(time)
  await page.setContent('<main class="fx-app"><div id="root"></div></main>')
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  await page.getByRole('button',{name:'success',exact:true}).waitFor()
  for (const [tone,duration] of [['success',5000],['info',7000],['warning',8000],['error',10000]]) {
    await page.getByRole('button',{name:tone,exact:true}).click()
    const notice=page.locator('.wm-notification').filter({hasText:tone})
    await notice.waitFor();await page.clock.runFor(duration-1);assert.equal(await notice.count(),1)
    await page.clock.runFor(1);await notice.waitFor({state:'hidden'})
    report.cases.push({tone,duration,passed:true})
  }
  const success=page.locator('.wm-notification').filter({hasText:'success'})
  await page.getByRole('button',{name:'success',exact:true}).click();await success.waitFor()
  await page.clock.runFor(2000);await success.hover();await page.clock.runFor(20000);assert.equal(await success.count(),1)
  await page.mouse.move(1200,700);await page.clock.runFor(2999);assert.equal(await success.count(),1)
  await page.clock.runFor(1);await success.waitFor({state:'hidden'});report.cases.push({hoverPreservesRemaining:true})
  await page.getByRole('button',{name:'warning',exact:true}).click()
  const warning=page.locator('.wm-notification').filter({hasText:'warning'})
  await warning.waitFor();await page.clock.runFor(3000);await warning.getByRole('button').focus()
  await page.clock.runFor(20000);assert.equal(await warning.count(),1)
  await page.getByRole('button',{name:'outside',exact:true}).focus();await page.clock.runFor(4999);assert.equal(await warning.count(),1)
  await page.clock.runFor(1);await warning.waitFor({state:'hidden'});report.cases.push({focusPreservesRemaining:true})
  await page.getByRole('button',{name:'info',exact:true}).click()
  const info=page.locator('.wm-notification').filter({hasText:'info'})
  await info.waitFor();await page.clock.runFor(2000)
  const visibility=hidden=>page.evaluate(hidden=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:hidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'))},hidden)
  await visibility(true);await page.clock.runFor(30000);assert.equal(await info.count(),1)
  await visibility(false);await page.clock.runFor(4999);assert.equal(await info.count(),1)
  await page.clock.runFor(1);await info.waitFor({state:'hidden'});report.cases.push({hiddenTabPreservesRemaining:true})
  await page.getByRole('button',{name:'state',exact:true}).click()
  const state=page.getByTestId('state');await state.waitFor()
  await page.clock.runFor(7999);assert.equal(await state.count(),1)
  await page.clock.runFor(1);await state.waitFor({state:'hidden'});report.cases.push({rerendersDoNotReset:true})
  await page.getByRole('button',{name:'critical',exact:true}).click()
  const critical=page.getByTestId('critical');await critical.waitFor()
  await page.clock.runFor(60000);assert.equal(await critical.count(),1)
  await critical.getByRole('button').click();await critical.waitFor({state:'hidden'});report.cases.push({criticalPersistentButDismissible:true})
  assert.deepEqual(report.errors,[]);report.passed=true
} catch(error){report.failure=error.stack;process.exitCode=1}
finally {await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
