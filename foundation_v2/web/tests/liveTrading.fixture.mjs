// Isolated visual/interaction fixture. It has no SDK, DB, terminal or upstream proxy.
import { preview } from 'vite'
import { readFile } from 'node:fs/promises'
const state={scenario:'ready',environment:'demo',paused:false,requests:[],commands:[],positions:[],reads:[]}
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))}
const body=async req=>{let text='';for await(const part of req)text+=part;return JSON.parse(text||'{}')}
const step={M1:60,M5:300,M15:900,H1:3600,H4:14400,D1:86400}
const fixture={name:'isolated-demo-trading-fixture',configurePreviewServer(server){
 server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://127.0.0.1:5192')
  if(url.pathname==='/__qa/state') {
   if(req.method==='POST')Object.assign(state,await body(req))
   return json(res,state)
  }
  if(url.pathname==='/') {
   const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8')
   res.setHeader('Content-Type','text/html');return res.end(html.replace('<title>','<title>UI FIXTURE · '))
  }
  if(!url.pathname.startsWith('/api/'))return next()
  state.reads.push({method:req.method,path:url.pathname});if(state.reads.length>200)state.reads.shift()
  if(url.pathname==='/api/v2/live/connections')return json(res,{available:true,items:[{id:'00000000-0000-4000-8000-000000000001',name:'SYNTHETIC UI FIXTURE',status:'connected',requested_mode:'trading',account_environment:state.environment}]})
  if(url.pathname==='/api/v2/live/trading') {
   if(url.searchParams.get('symbol') && !['EURUSD','GBPUSD'].includes(url.searchParams.get('symbol')))return json(res,{detail:'demo_symbol_denied'},403)
   if(state.scenario==='managed-symbol-error'&&url.searchParams.get('symbol'))return json(res,{status:'unavailable',reason:'demo_symbol_denied',mode:state.environment,execution_enabled:false})
   if(state.scenario==='error')return json(res,{detail:'fixture_disconnected'},503)
   if(state.scenario==='locked')return json(res,{status:'locked',reason:'demo_policy_locked',mode:'demo',execution_enabled:false})
   const seconds=step[url.searchParams.get('timeframe')]||60,end=Math.floor(Date.now()/1000/seconds)*seconds
   const bars=Array.from({length:300},(_,i)=>{const open=1.1+Math.sin(i/9)*.002,close=open+Math.cos(i/3)*.0003;return {timestamp:new Date((end-(299-i)*seconds)*1000).toISOString(),open,close,high:Math.max(open,close)+.0002,low:Math.min(open,close)-.0002,volume:100+i%17}})
   const unknown=state.requests.some(r=>r.requires_reconciliation)
   return json(res,{status:'ready',reason:unknown?'demo_unresolved_request':state.paused?'demo_paused':'',mode:state.environment,connection_id:url.searchParams.get('connection_id'),execution_enabled:!state.paused&&!unknown,paused:state.paused,
    account:{login:'999000111',server:'SYNTHETIC UI FIXTURE - NO BROKER',trade_mode:state.environment,currency:'USD',balance:10000,equity:10002,margin:20,margin_free:9982,leverage:100},
    symbol:url.searchParams.get('symbol')||'EURUSD',symbols:['EURUSD','GBPUSD'],timeframe:url.searchParams.get('timeframe')||'M1',bars,
    quote:{bid:1.1,ask:1.1002,time_msc:Date.now()-(state.scenario==='stale'?20000:0)},instrument:{tick_size:.00001,quantity_min:.01,quantity_max:10,quantity_step:.01,asset_class:'fx',stops_level:0,freeze_level:0},
    policy:{source:'broker',max_quote_age_ms:5000},
    capabilities:{market:!state.paused&&!unknown,limit:false,stop:false,close:!unknown,cancel:!unknown,protect:!state.paused&&!unknown},positions:state.positions,orders:[],requests:state.requests})
  }
  if(url.pathname==='/api/v2/live/trading/preview') {
   const draft=await body(req)
   return json(res,{passed:true,entry_price:draft.side==='BUY'?1.1002:1.1,estimated_stop_risk:10.2,margin_required:22,currency:'USD'})
  }
  if(url.pathname==='/api/v2/live/trading/commands') {
   if(state.scenario==='reject423')return json(res,{detail:'demo_paused'},423)
   const command=await body(req);state.commands.push(command)
   let receipt={request_id:command.request_id,action:command.action,status:'done'}
   if(command.action==='place') {
    receipt={...receipt,status:state.scenario==='unknown'?'accepted':'filled',requires_reconciliation:state.scenario==='unknown'}
    if(!receipt.requires_reconciliation)state.positions.push({ticket:1001,symbol:command.symbol,side:command.side,volume:command.volume,price_open:1.1002,sl:command.stop_loss,tp:command.take_profit,profit:2})
   }
   if(command.action==='pause')state.paused=true
   if(command.action==='resume')state.paused=false
   if(command.action==='close')state.positions=[]
   if(command.action==='protect')state.positions=state.positions.map(p=>p.ticket===command.ticket?{...p,sl:command.stop_loss,tp:command.take_profit}:p)
   state.requests.unshift(receipt);return json(res,receipt)
  }
  if(url.pathname==='/api/v2/live/trading/reconcile') {
   const {request_id}=await body(req), receipt=state.requests.find(r=>r.request_id===request_id)
   if(!receipt)return json(res,{detail:'demo_request_not_found'},404)
   if(state.scenario!=='unknown')Object.assign(receipt,{status:'filled',requires_reconciliation:false})
   return json(res,receipt)
  }
  return json(res,{detail:'Isolated UI fixture: endpoint unavailable'},404)
 })
}}
const server=await preview({plugins:[fixture],preview:{host:'127.0.0.1',port:5192,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:1'}}}})
console.log('SYNTHETIC UI FIXTURE ONLY http://127.0.0.1:5192; no broker or DB access')
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.httpServer.close(()=>process.exit(0)))
