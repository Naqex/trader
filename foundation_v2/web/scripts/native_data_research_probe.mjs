import assert from 'node:assert/strict'
import { build } from 'vite'
import { chromium } from 'playwright'
import { createServer, request as httpRequest } from 'node:http'
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), args=process.argv.slice(2)
const arg=name=>args[args.indexOf(name)+1], api=arg('--api-base'), output=path.resolve(arg('--output')), artifacts=path.resolve(arg('--artifact-root')), worker=path.resolve(arg('--worker'))
assert.ok(args.includes('--api-base')&&args.includes('--output')&&args.includes('--artifact-root')&&args.includes('--worker'))
assert.equal(new URL(api).hostname,'127.0.0.1'); assert.ok(path.basename(path.dirname(artifacts)).startsWith('native-data-research-'))
await mkdir(output,{recursive:true})
const report={passed:false,scope:'Production React + native Rust HTTP + disposable PG; owned synthetic only',checks:[],errors:[],requests:[],sourceHashes:{},ownerRuntimeTouched:false}
for(const name of ['src/DataDeskWorkspace.jsx','src/ResearchWorkspace.jsx','scripts/native_data_research_probe.mjs']) report.sourceHashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex')
const built=await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',build:{write:false}})
const files=new Map(built.output.map(item=>['/'+item.fileName,item.type==='chunk'?item.code:item.source]))
const allowedWrite=pathname=>/^\/api\/v2\/(data\/(csv\/(preview|import)|datasets\/[^/]+(\/repair)?)|research\/jobs(\/[^/]+\/cancel)?)$/.test(pathname)
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1')
  if(url.pathname.startsWith('/api/')){
    assert.ok(req.method==='GET'||allowedWrite(url.pathname))
    const upstream=httpRequest(new URL(req.url,api),{method:req.method,headers:{...req.headers,host:new URL(api).host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)})
    upstream.on('error',error=>{res.writeHead(502);res.end(error.message)});req.pipe(upstream);res.on('close',()=>upstream.destroy());return
  }
  assert.equal(req.method,'GET');const pathname=url.pathname==='/'?'/index.html':url.pathname
  let data=files.get(pathname)
  if(data===undefined){const base=path.join(root,'public'),file=await realpath(path.resolve(base,'.'+pathname));assert.ok(file.startsWith(base+path.sep)&&(await stat(file)).isFile());data=await readFile(file)}
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'})[path.extname(pathname)]||'application/octet-stream'});res.end(data)
}catch(error){res.writeHead(404);res.end(error.message)}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
page.setDefaultTimeout(15000)
await page.context().route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['blob:','data:','about:'].includes(url.protocol)?route.continue():route.abort()})
await page.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
page.on('pageerror',error=>report.errors.push(error.message))
page.on('response',response=>{if(response.url().includes('/api/'))report.requests.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()})})
const capture=(suffix,method='POST')=>{const promise=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(suffix)&&r.request().method()===method);promise.catch(()=>{});return promise}
const check=(name,extra={})=>{report.checks.push({name,passed:true,...extra});console.log(name)}
const headers={'X-Workspace-Id':'tenant-a'}
const library=()=>page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
async function importCsv(symbol,count){
  await page.getByRole('button',{name:'Nhập CSV',exact:true}).click();const dialog=page.getByRole('dialog')
  const csv='time,open,high,low,close,volume\n'+Array.from({length:count},(_,i)=>`${1577923200+i*60},1.1,1.105,1.099,${(1.1000+(i%8)*.0001).toFixed(4)},10`).join('\n')
  await page.getByTestId('data-desk-file-input').setInputFiles({name:'owned-synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)})
  await dialog.locator('[name=instrumentId]').fill(symbol);await dialog.locator('[name=timeframeSeconds]').fill('60')
  const previewResponse=capture('/csv/preview');await page.getByTestId('data-desk-preview-button').click();const preview=await previewResponse;assert.equal(preview.status(),200)
  const previewBody=await preview.json();await page.getByTestId('data-desk-quality-report').waitFor()
  if(previewBody.preview.quality.disposition==='review')await dialog.locator('input[type=checkbox]').check()
  assert.equal(await page.getByTestId('data-desk-import-button').isEnabled(),true)
  const importing=capture('/csv/import');await page.getByTestId('data-desk-import-button').click();const response=await importing;assert.equal(response.status(),201)
  const result=await response.json();assert.equal(result.dataset.row_count,count);assert.equal(result.dataset.instrument_id,symbol)
  const repeat=await page.request.post(response.url(),{headers:response.request().headers(),data:response.request().postData()});assert.equal(repeat.status(),201);assert.deepEqual(await repeat.json(),result)
  const details=page.getByRole('dialog',{name:'Chi tiết dữ liệu và chất lượng',exact:true});await details.waitFor();await details.getByRole('button',{name:'Đóng',exact:true}).click()
  await page.getByTestId(`dataset-row-${result.dataset.dataset_id}`).waitFor();return {dataset:result.dataset,preview:previewBody.preview}
}
async function action(dataset,label){const row=page.getByTestId(`dataset-row-${dataset.dataset_id}`).locator('xpath=ancestor::tr');await row.getByRole('button',{name:/Thao tác dữ liệu/}).click();await page.getByRole('menuitem',{name:label,exact:true}).click()}
try{
  await library();await page.getByRole('button',{name:'Nhập CSV',exact:true}).waitFor();check('empty native Data Library loads')
  await page.getByRole('button',{name:'Nhập CSV',exact:true}).click()
  await page.getByTestId('data-desk-file-input').setInputFiles({name:'empty.csv',mimeType:'text/csv',buffer:Buffer.from('')});await page.getByTestId('data-desk-import-error').waitFor();assert.equal(await page.getByTestId('data-desk-import-button').isDisabled(),true)
  await page.getByTestId('data-desk-file-input').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('wrong,columns\n1,2')});const bad=capture('/csv/preview');await page.getByTestId('data-desk-preview-button').click();assert.equal((await bad).status(),422);await page.getByTestId('data-desk-import-error').waitFor();check('empty/bad CSV blocked with actual 422 error UI')
  await library();const first=await importCsv('OWNEDQA',40);report.imported=first.dataset;check('CSV UI preview/import/quality + exact HTTP idempotency',first)
  await page.reload();await page.getByTestId(`dataset-row-${first.dataset.dataset_id}`).waitFor();check('catalog survives production page reload')
  const file=path.resolve(artifacts,first.dataset.artifact_path);assert.ok(file.startsWith(artifacts+path.sep));const original=await readFile(file)
  await writeFile(file,'owned-corrupt-parquet');const repair=capture(`/${first.dataset.dataset_id}/repair`);await action(first.dataset,'Kiểm tra & khôi phục');assert.equal((await repair).status(),200);assert.deepEqual(await readFile(file),original);check('UI native repair quarantines corruption/restores pinned bytes')
  await page.goto(`${origin}/?workspace=tenant-a&view=research&dataset=${first.dataset.dataset_id}`);await page.getByTestId('research-run-submit').waitFor()
  await page.getByLabel('Starting balance',{exact:true}).fill('0');await page.getByTestId('research-run-submit').click();await page.getByRole('alert').filter({hasText:'Starting balance'}).waitFor();check('research invalid balance stays local/blocked')
  await page.getByLabel('Starting balance',{exact:true}).fill('10000');let creating=capture('/research/jobs');await page.getByTestId('research-run-submit').click();let created=await creating;assert.equal(created.status(),202);const canceled=await created.json();report.canceledJob=canceled.job_id
  await page.getByTestId('research-cancel').waitFor();const cancel=capture(`/${canceled.job_id}/cancel`);await page.getByTestId('research-cancel').click();assert.equal((await cancel).status(),200);await page.getByTestId('research-terminal-result').waitFor();assert.equal(await page.getByTestId('research-result').count(),0);check('queued research cancel yields honest terminal UI/no metrics')
  await page.goto(`${origin}/?workspace=tenant-a&view=research&dataset=${first.dataset.dataset_id}`);await page.getByTestId('research-run-submit').waitFor();creating=capture('/research/jobs');await page.getByTestId('research-run-submit').click();created=await creating;assert.equal(created.status(),202);report.job=(await created.json()).job_id
  const workerLog=execFileSync(worker,['--once'],{env:process.env,encoding:'utf8',timeout:60000,windowsHide:true});await writeFile(path.join(output,'worker.log'),workerLog)
  await page.getByTestId('research-result').waitFor({timeout:30000});const stored=await page.request.get(`${origin}/api/v2/research/jobs/${report.job}`,{headers});assert.equal(stored.status(),200);report.result=await stored.json();assert.equal(report.result.status,'completed');assert.equal(report.result.result.trade_count,39)
  await page.reload();await page.getByTestId('research-result').waitFor();await page.screenshot({path:path.join(output,'research-completed.png'),fullPage:true});check('native worker completes actual UI job; result/provenance survives reload',{job:report.job,tradeCount:39})
  const denied=await page.request.get(`${origin}/api/v2/research/jobs/${report.job}`,{headers:{'X-Workspace-Id':'tenant-b'}});assert.equal(denied.status(),404);check('cross-workspace research read denied')
  await library();await page.getByTestId(`dataset-row-${first.dataset.dataset_id}`).waitFor();await action(first.dataset,'Xoá');const deleting=capture(`/${first.dataset.dataset_id}`,'DELETE');await page.getByRole('dialog').getByRole('button',{name:'Xoá',exact:true}).click();assert.equal((await deleting).status(),409);await page.getByRole('dialog').getByRole('alert').waitFor();check('research-linked dataset delete protected with visible 409')
  await library();const second=await importCsv('DELETEQA',3);const response=capture(`/${second.dataset.dataset_id}`,'DELETE');await action(second.dataset,'Xoá');await page.getByRole('dialog').getByRole('button',{name:'Xoá',exact:true}).click();const removed=await response;assert.equal(removed.status(),200)
  const retry=await page.request.delete(removed.url(),{headers:removed.request().headers()});assert.equal(retry.status(),200);assert.deepEqual(await retry.json(),await removed.json());await page.getByTestId(`dataset-row-${second.dataset.dataset_id}`).waitFor({state:'hidden'});check('unreferenced dataset UI delete + exact HTTP retry', {dataset:second.dataset.dataset_id})
  await page.screenshot({path:path.join(output,'data-library.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'data-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('Data Library mobile no document overflow')
  assert.deepEqual(report.errors,[]);report.passed=true
}catch(error){report.error=error.stack;await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error}
finally{await writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(c=>c.name),job:report.job}))
