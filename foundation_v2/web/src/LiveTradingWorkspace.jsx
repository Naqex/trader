import LiveTradingOverview from './LiveTradingOverview.jsx'
import ChartIcon from './ChartIcon.jsx'
import { liveTradingHref } from './liveTradingNavigation.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { navigate } from './clientNavigation.js'
import TestingIcon from './TestingIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import FxSelect from './FxSelect.jsx'
import { readDemoTrading, previewDemoOrder, commandDemoOrder, reconcileDemoOrder } from './liveTradingApi.js'
import { retainLiveChart, watchLiveMarket } from './liveMarketStream.js'
import Mt5SymbolPicker from './Mt5SymbolPicker.jsx'
import { mt5QuickDraft } from './mt5QuickOrder.js'
import { protectionPrice } from './orderProtection.js'
import OrderProtectionSection from './OrderProtectionSection.jsx'
import { DEMO_DRAFT, DEMO_TIMEFRAMES, demoIdentity, demoDraftError, demoIntent, tradingReady, tradingBlockReason, previewMatches, demoReason, finalDemoReceipt } from './liveTradingModel.js'
import { TestingSkeleton } from './TestingReadState.jsx'
import './live-trading.css'

const AdvancedChart = lazy(() => import('./TradingViewReplayChart.jsx'))
const SimpleChart = lazy(() => import('./LightweightReplayChart.jsx'))
const Mt5TradingConditions = lazy(() => import('./Mt5TradingConditions.jsx'))
const LegacyChartHeader = lazy(() => import('./LegacyChartHeader.jsx'))
const LegacyObjectTree = lazy(() => import('./LegacyObjectTree.jsx'))
const OrderEntryFields = lazy(() => import('./OrderEntryFields.jsx'))
const LiveChartSurface = lazy(() => import('./LiveChartSurface.jsx'))
const Mt5TradingBar = lazy(() => import('./Mt5TradingBar.jsx'))
const Mt5Positions = lazy(() => import('./Mt5Positions.jsx'))
const EMPTY = []
const noop = () => {}
const finalReceipt = finalDemoReceipt
function recoverPending(key) {
  try { const item = JSON.parse(sessionStorage.getItem(key)); return item?.request_id && ['demo','real'].includes(item?.mode) ? item : null } catch { return null }
}

export default function LiveTradingWorkspace({ workspace, query, preview: demoPreview = false }) {
  const { t,fmt,locale } = useTestingLocale(), {appearance,applyAppearance,openAi} = useFxReplayContext()
  const theme = appearance?.theme || 'dark'
  const chartSurface = query.get('surface') === 'workspace'
  const [panel,setPanel]=useState(null), [symbolAnchor,setSymbolAnchor]=useState(null), [headerSlots,setHeaderSlots]=useState(null)
  const symbol = query.get('mt5_symbol') || '', timeframe = DEMO_TIMEFRAMES[query.get('mt5_timeframe')] ? query.get('mt5_timeframe') : 'M1'
  const explicitConnection=(query.get('live_account')?.startsWith('broker:')?query.get('live_account').slice(7):'') || query.get('mt5_connection')
  const [connection,setConnection]=useState({workspace:null,id:''})
  const connectionId=explicitConnection || (connection.workspace===workspace?connection.id:'')
  const connectionReady=Boolean(explicitConnection)||connection.workspace===workspace
  const scope = `${workspace}:${connectionId}:${symbol}:${timeframe}:${chartSurface}`, receiptKey = `tw:mt5-pending:v2:${workspace}:${connectionId || 'external'}`
  const currentScope = useRef(scope); currentScope.current = scope
  const [read,setRead] = useState({scope,status:'loading',payload:null}), [refresh,setRefresh] = useState(0)
  const [clock,setClock] = useState(Date.now()), [draft,setDraft] = useState({...DEMO_DRAFT}), [checked,setChecked] = useState(null)
  const [busy,setBusy] = useState(false), running = useRef(false), [notice,setNotice] = useState('')
  const [pending,setPending] = useState(() => recoverPending(receiptKey)), [confirmation,setConfirmation] = useState(null)
  const [ledgerEvent,setLedgerEvent] = useState({tab:'positions',sequence:0})
  const snapshot = read.scope === scope ? read.payload : null
  const chartSnapshot = read.scope === scope ? read.chart : null
  const unresolved = pending || snapshot?.requests?.find(item=>item.status==='unknown'||item.requires_reconciliation===true)
  const identity = demoIdentity(snapshot), activeSymbol = symbol || snapshot?.symbol || ''
  const now = Math.max(clock,Date.now())
  const marketReady = !demoPreview && read.status === 'ready' && tradingReady(snapshot,now)
  const canAct = !demoPreview && read.status === 'ready' && tradingReady(snapshot,now,true) && !busy && !unresolved
  const paused = snapshot?.paused === true
  const intent = identity && activeSymbol ? demoIntent(snapshot,activeSymbol,draft) : null
  const validPreview = intent && previewMatches(checked,intent,now)
  const instrument = snapshot?.instrument && {...snapshot.instrument,quantity_max:Math.min(snapshot.instrument.quantity_max,snapshot.policy?.max_volume||Infinity)}
  const error = demoDraftError(draft,instrument,snapshot?.quote,snapshot?.policy?.source==='broker')
  const reference = draft.side === 'BUY' ? snapshot?.quote?.ask : snapshot?.quote?.bid
  useEffect(()=>{
    if(explicitConnection)return
    const controller=new AbortController()
    fetch('/api/v2/live/connections',{headers:{'X-Workspace-Id':workspace},signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('mt5_connection_not_available');return response.json()}).then(value=>{
      const items=value.items || [], eligible=items.find(item=>item.status==='connected'&&item.requested_mode==='trading') || items.find(item=>item.requested_mode==='trading') || items[0]
      setConnection({workspace,id:eligible?.id || ''})
    }).catch(()=>{if(!controller.signal.aborted)setConnection({workspace,id:''})})
    return ()=>controller.abort()
  },[workspace,explicitConnection])
  useEffect(() => {
    if (!chartSurface) return
    const tick=()=>{if(document.visibilityState !== 'hidden')setClock(Date.now())}
    const timer=setInterval(tick,1000)
    document.addEventListener('visibilitychange',tick)
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[chartSurface])
  useEffect(() => {setConfirmation(null);setChecked(null);setPanel(null);setSymbolAnchor(null)},[scope,chartSurface])
  useEffect(() => {
    setPending(recoverPending(receiptKey)); setConfirmation(null); setChecked(null); setDraft({...DEMO_DRAFT,quantity:String(snapshot?.instrument?.quantity_min || ''),protectionEnabled:{stopLoss:false,takeProfit:false}}); setNotice('')
  },[receiptKey,identity,activeSymbol])
  useEffect(() => {
    const controller = new AbortController()
    let reading = false
    setRead(previous=>({scope,status:demoPreview ? 'locked' : 'loading',payload:!demoPreview&&previous.scope===scope?previous.payload:null,chart:!demoPreview&&previous.scope===scope?previous.chart:null}))
    if (demoPreview || !connectionReady) return () => controller.abort()
    const receive=payload=>setRead(previous=>({scope,status:'ready',payload,chart:retainLiveChart(previous.scope===scope?previous.chart:null,payload)}))
    const failed=error=>setRead(previous=>({scope,status:'error',payload:[401,403].includes(error.status)?null:previous.scope===scope?previous.payload:null,chart:[401,403].includes(error.status)?null:previous.scope===scope?previous.chart:null,error:error.message}))
    if(chartSurface&&connectionId) {
      const stop=watchLiveMarket({workspace,symbol,timeframe,connectionId,onSnapshot:receive,onError:failed})
      return ()=>{controller.abort();stop()}
    }
    const poll = async () => {
      if (reading || controller.signal.aborted) return
      reading = true
      try {
        const payload = await readDemoTrading(workspace,symbol,timeframe,controller.signal,connectionId,{summary:!chartSurface})
        if (!controller.signal.aborted) receive(payload)
      } catch (error) {
        if (!controller.signal.aborted) failed(error)
      } finally {reading=false}
    }
    poll()
    const visiblePoll=()=>{if(document.visibilityState !== 'hidden')void poll()}
    const timer=setInterval(visiblePoll,chartSurface?2000:10000)
    document.addEventListener('visibilitychange',visiblePoll)
    return () => {controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visiblePoll)}
  },[workspace,scope,symbol,timeframe,refresh,demoPreview,connectionReady,connectionId,chartSurface])
  useEffect(() => {
    if (!pending || !snapshot) return
    const receipt = snapshot.requests?.find(item=>item.request_id===pending.request_id)
    if (!finalReceipt(receipt)) return
    try {sessionStorage.removeItem(receiptKey)} catch {return}
    setPending(null)
    setNotice(receipt.status === 'rejected' ? 'MT5 đã từ chối yêu cầu.' : 'Đã nhận kết quả đối soát từ MT5.')
  },[snapshot,pending,receiptKey])
  const change = (key,value) => {setDraft(previous=>({...previous,[key]:value}));setChecked(null);setNotice('')}
  const route = patch => {
    const next=new URLSearchParams(query)
    Object.entries(patch).forEach(([key,value])=>value ? next.set(key,value) : next.delete(key))
    if(connectionId)next.set('mt5_connection',connectionId)
    navigate(liveTradingHref(workspace,next,{chart:chartSurface}))
  }

  const beginOrder = () => {
    setDraft({...DEMO_DRAFT,quantity:String(instrument?.quantity_min || ''),protectionEnabled:{stopLoss:false,takeProfit:false}})
    setChecked(null);setNotice('');setPanel('order')
  }
  const quickOrder = (side,quantity,preset) => {
    if (!canAct || paused || !capability('place')) return
    setChecked(null)
    try { setDraft(mt5QuickDraft(snapshot,side,quantity,preset));setNotice('');setPanel('order') }
    catch (error) { setDraft({...DEMO_DRAFT,side,quantity,protectionEnabled:{stopLoss:false,takeProfit:false}});setNotice(error.message);setPanel('order') }
  }
  const toggleProtection = (key,enabled) => {
    const unit = Number(instrument?.pip_size) || Number(instrument?.tick_size)
    const price = enabled ? protectionPrice(key === 'stopLoss' ? 20 : 40,reference,draft.side,key,{...instrument,pip_size:unit}) : ''
    setDraft(current=>({...current,[key]:price,protectionEnabled:{...current.protectionEnabled,[key]:enabled}}));setChecked(null);setNotice('')
  }

  const checkOrder = async event => {
    event.preventDefault()
    if (!canAct || paused || error || !intent || running.current) return
    running.current=true; setBusy(true);setNotice('');setChecked(null)
    const origin=scope, key=JSON.stringify(intent)
    try {
      const value=await previewDemoOrder(workspace,intent)
      if (currentScope.current===origin) {setChecked({key,value,at:Date.now()});if (!value.passed) setNotice(demoReason(value.reason))}
    } catch(error) {if(currentScope.current===origin)setNotice(demoReason(error.message))}
    finally {running.current=false;setBusy(false)}
  }
  const send = async () => {
    if (!canAct || !confirmation || running.current || confirmation.identity!==identity || confirmation.scope!==scope || !capability(confirmation.action)) return
    if (confirmation.action==='protect' && protectionInvalid) return
    if (confirmation.action==='place' && (!validPreview || paused)) {setConfirmation(null);setChecked(null);setNotice('Kiểm tra lại lệnh để lấy báo giá mới.');return}
    running.current=true;setBusy(true);setNotice('')
    const origin=scope
    const command={...(confirmation.action==='place' ? intent : {mode:snapshot.mode,...(connectionId?{connection_id:connectionId}:{}),account_id:String(snapshot.account.login),server:snapshot.account.server,...confirmation.body}),action:confirmation.action,request_id:crypto.randomUUID()}
    if (command.action==='protect') {command.stop_loss=command.stop_loss===''?null:Number(command.stop_loss);command.take_profit=command.take_profit===''?null:Number(command.take_profit)}
    // Persist before sending. Reloads must not turn an unknown result into a new order.
    try {sessionStorage.setItem(receiptKey,JSON.stringify(command));setPending(command)}
    catch {running.current=false;setBusy(false);setNotice('Không lưu được mã yêu cầu; lệnh chưa được gửi.');return}
    try {
      const receipt=await commandDemoOrder(workspace,command)
      if (finalReceipt(receipt)) {
        sessionStorage.removeItem(receiptKey)
        if(currentScope.current===origin){setPending(null);setLedgerEvent(value=>({tab:'requests',sequence:value.sequence+1}));setNotice(receipt.status==='rejected'?'MT5 đã từ chối yêu cầu.':'');if(receipt.status!=='rejected')setPanel(null)}
      } else if(currentScope.current===origin) setNotice('Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.')
    } catch(error) {
      // A definite validation rejection is safe; transport/timeout outcomes stay pending.
      if ([400,401,403,404,422,423].includes(error.status)) {sessionStorage.removeItem(receiptKey);if(currentScope.current===origin)setPending(null)}
      if(currentScope.current===origin)setNotice(error.status?demoReason(error.message):'Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.')
    } finally {
      running.current=false;setBusy(false)
      if(currentScope.current===origin){setConfirmation(null);setChecked(null);setRefresh(value=>value+1)}
    }
  }
  const reconcile = async () => {
    if (!unresolved || busy || running.current || demoPreview) return
    const origin=scope
    running.current=true;setBusy(true)
    try {
      const receipt=await reconcileDemoOrder(workspace,unresolved.request_id,connectionId)
      if (currentScope.current!==origin) return
      if(finalReceipt(receipt)) {
        sessionStorage.removeItem(receiptKey);setPending(null);setNotice('Đã nhận kết quả đối soát từ MT5.')
      } else setNotice('Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.')
    } catch(error) {if(currentScope.current===origin)setNotice(demoReason(error.message))}
    finally {running.current=false;setBusy(false);if(currentScope.current===origin)setRefresh(value=>value+1)}
  }
  const capability = action => !['place','close','protect','cancel'].includes(action) || snapshot?.capabilities?.[action==='place'?'market':action] === true
  const openAction=(action,body,label) => {if(canAct&&capability(action))setConfirmation({action,body,label,identity,scope,protectionEnabled:{stopLoss:Boolean(body?.stop_loss),takeProfit:Boolean(body?.take_profit)}})}
  const rows = chartSnapshot?.bars || EMPTY, positions=snapshot?.positions || EMPTY
  const protectionTicket = confirmation?.action === 'protect' ? positions.find(item=>String(item.ticket)===String(confirmation.body.ticket)&&item.symbol===confirmation.body.symbol) : null
  const protectionInstrument = protectionTicket?.symbol === activeSymbol ? instrument : null
  const protectionDraft = { side:protectionTicket?.side,stopLoss:confirmation?.body?.stop_loss ?? '',takeProfit:confirmation?.body?.take_profit ?? '' }
  const protectionInvalid = !protectionTicket || ['stopLoss','takeProfit'].some(key=>(confirmation?.protectionEnabled?.[key] || key==='stopLoss'&&snapshot?.policy?.source!=='broker')&&!(Number(protectionDraft[key])>0))
  const changeProtection = (key,value) => setConfirmation(previous=>({...previous,body:{...previous.body,[key==='stopLoss'?'stop_loss':'take_profit']:value}}))
  const toggleTicketProtection = (key,enabled) => {
    const unit=Number(protectionInstrument?.pip_size)||Number(protectionInstrument?.tick_size)
    const value=enabled&&unit>0 ? protectionPrice(key==='stopLoss'?20:40,protectionTicket?.price_open,protectionDraft.side,key,{...protectionInstrument,pip_size:unit}) : ''
    setConfirmation(previous=>({...previous,protectionEnabled:{...previous.protectionEnabled,[key]:enabled},body:{...previous.body,[key==='stopLoss'?'stop_loss':'take_profit']:value}}))
  }
  const chartIdentity=demoIdentity(chartSnapshot), chartSymbol=symbol||chartSnapshot?.symbol||activeSymbol
  const currency=snapshot?.account?.currency || '', money=value=>Number.isFinite(value)?fmt(value,currency?` ${currency}`:''):t('Chưa xác định')
  const accountQuery=new URLSearchParams(query);if(connectionId)accountQuery.set('mt5_connection',connectionId)
  const resetSymbol = (read.error==='demo_symbol_denied'||snapshot?.reason==='demo_symbol_denied') ? ()=>route({mt5_symbol:null}) : undefined
  const blockReason=tradingBlockReason(snapshot,now), quoteTime=Number(snapshot?.quote?.time_msc), quoteAge=now-quoteTime
  const quoteUnit=quoteAge>=3600000?3600000:quoteAge>=60000?60000:1000
  const quoteNotice=blockReason==='demo_quote_stale'&&Number.isFinite(new Date(quoteTime).getTime())&&quoteTime>0 ? quoteAge < -1000
    ? t('Thời gian báo giá đi trước đồng hồ máy. Kiểm tra đồng bộ giờ Windows.')
    : t('Báo giá cuối: {time} · {count} {unit} trước. Chờ giá mới để giao dịch.',{time:new Intl.DateTimeFormat(locale,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(quoteTime),count:fmt(Math.floor(Math.max(0,quoteAge)/quoteUnit),'',0),unit:t(quoteUnit===3600000?'giờ':quoteUnit===60000?'phút':'giây')})
    : demoReason('demo_quote_stale')
  const reason = demoPreview ? 'Gửi lệnh không khả dụng trong chế độ xem thử.' : read.status==='loading' ? 'Đang đọc tài khoản MT5…' : resetSymbol ? demoReason('demo_symbol_denied') : read.status==='error' ? 'Mất kết nối dữ liệu giao dịch. Đang giữ ảnh chụp trước đó.' : !chartSurface && snapshot?.summary ? '' : !marketReady ? blockReason==='demo_quote_stale'?quoteNotice:demoReason(blockReason) : ''
  if (!chartSurface) return <LiveTradingOverview workspace={workspace} query={accountQuery} snapshot={snapshot} status={read.status} reason={unresolved ? 'Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.' : reason} symbol={activeSymbol} timeframe={timeframe} onRefresh={()=>setRefresh(value=>value+1)} onResetSymbol={resetSymbol}/>
  const fullscreen=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.()}
  const openTool=(tool,anchor)=>{if(tool==='data')setSymbolAnchor(current=>current===anchor?null:anchor);else if(tool==='context')setPanel('conditions');else if(tool==='mentor')openAi()}
  const journalHref = section => buildWorkspaceHref('live',workspace,accountQuery,{area:'live',section,surface:null,live_account:connectionId ? `broker:${connectionId}` : null,live_accounts:null})
  return <Suspense fallback={<TestingSkeleton label="Đang tải biểu đồ…" />}><LiveChartSurface headerHeight={headerSlots?.headerHeight || 38}>
    <LegacyChartHeader marketMode="live" controls={headerSlots} symbol={chartSymbol} timeframe={timeframe} timeframes={Object.keys(DEMO_TIMEFRAMES)} onTimeframe={value=>route({mt5_timeframe:value})} name={`MT5 · ${snapshot?.account?.login || chartSnapshot?.account?.login || 'MT5'}`} backHref={liveTradingHref(workspace,accountQuery)} theme={theme} onTheme={()=>applyAppearance({...appearance,theme:theme==='dark'?'light':'dark'})} onOpenTool={openTool} onFullscreen={fullscreen}/>
    {!headerSlots && <header className="live-terminal-toolbar"><a href={liveTradingHref(workspace,accountQuery)} aria-label={t('Trở về tổng quan MT5')}><ChartIcon name="arrow-left"/></a><strong>{chartSymbol || 'MetaTrader'}</strong><FxSelect label="Khung thời gian MT5" value={timeframe} options={Object.keys(DEMO_TIMEFRAMES).map(value=>({value,label:value}))} onChange={value=>route({mt5_timeframe:value})}/><button type="button" className="live-text-action" onClick={event=>openTool('data',event.currentTarget)}>{t('Chọn mã giao dịch MT5')}</button></header>}
    {(reason || paused || unresolved) && <div className="live-terminal-state" role={read.status==='error'||unresolved?'alert':'status'}><TestingIcon kind="info" /><span>{unresolved?t('Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.'):t(reason || 'Đã tạm dừng mở lệnh mới.')}</span>{unresolved && <button className="live-text-action" type="button" disabled={busy} onClick={reconcile}>{t(busy?'Đang đối soát…':'Đối soát')}</button>}{resetSymbol && <button type="button" className="live-text-action" onClick={resetSymbol}>{t('Tải lại danh sách mã')}</button>}</div>}
    <section className="replay-workspace live-terminal-main">
      <div className="replay-main live-terminal-market">
        <div className="live-terminal-chart chart-frame has-advanced-chart"><div className="chart-canvas">
          {rows.length ? <Suspense fallback={<div className="live-empty">{t('Đang tải biểu đồ…')}</div>}>{query.get('chart_engine')==='lightweight' ? <SimpleChart rows={rows} sessionId={`${chartIdentity}:${chartSymbol}:${timeframe}`} chartType="candles" showVolume theme={theme} drawings={EMPTY} /> : <AdvancedChart drawings={EMPTY} marketMode="live" workspace={workspace} sessionId={`live:${chartIdentity}:${chartSymbol}:${timeframe}`} datasetId="mt5-live" symbol={chartSymbol} assetClass={chartSnapshot?.instrument?.asset_class || 'fx'} seconds={DEMO_TIMEFRAMES[timeframe]} tickSize={chartSnapshot?.instrument?.tick_size} rows={rows} cutoff={Number(rows.at(-1).timestamp)} theme={theme} orderEditable={false} orderCloseable={false} onOrderDragStart={noop} orderGeneration={scope} onHeaderSlots={setHeaderSlots} />}</Suspense> : <div className="live-empty"><TestingIcon kind="chart" size={48}/><h2>{t('Chưa có biểu đồ MT5')}</h2><p>{t('Kết nối terminal MT5 để đọc giá và dữ liệu tài khoản.')}</p></div>}
        </div><nav className="chart-utility-rail" aria-label={t('Công cụ giao dịch MT5')}><div className="chart-utility-actions">
          <div className="legacy-rail-tools"><button type="button" disabled={!headerSlots} aria-label={t('Cây đối tượng chart')} data-tooltip={t('Cây đối tượng chart')} onClick={()=>setPanel('objects')}><ChartIcon name="layers"/></button></div>
          <button type="button" aria-label={t('Lệnh mới')} data-tooltip={t('Lệnh mới')} onClick={beginOrder}><ChartIcon name="place-order"/><span>{t('Order')}</span></button>
          <button type="button" aria-label={t('Chọn mã giao dịch MT5')} aria-haspopup="dialog" aria-expanded={Boolean(symbolAnchor)} data-tooltip={t('Chọn mã giao dịch MT5')} onClick={event=>openTool('data',event.currentTarget)}><ChartIcon name="search"/><span>{t('Asset')}</span></button>
          <a href={journalHref('notes')} aria-label={t('Ghi chú')} data-tooltip={t('Ghi chú')}><ChartIcon name="journal"/><span>{t('Journal')}</span></a>
          <button type="button" className="legacy-session-settings" aria-label={t('Điều kiện giao dịch')} data-tooltip={t('Điều kiện giao dịch')} onClick={()=>setPanel('conditions')}><ChartIcon name="settings"/></button>
          <button type="button" className="legacy-mobile-theme" aria-label={t('Đổi giao diện')} data-tooltip={t('Đổi giao diện')} onClick={()=>applyAppearance({...appearance,theme:theme==='dark'?'light':'dark'})}><ChartIcon name={theme==='dark'?'moon':'sun'}/></button>
        </div></nav></div>
        <Mt5TradingBar workspace={workspace} scopeId={`${connectionId}:${identity}:${activeSymbol}`} snapshot={snapshot} positions={positions} instrument={instrument}
          onQuickTrade={quickOrder} ledgerEvent={ledgerEvent} disabled={!canAct||paused||!capability('place')} analyticsHref={journalHref('analytics')} theme={theme}>
          {active => <Mt5Positions snapshot={snapshot} active={active} ledgerEvent={ledgerEvent} canAct={canAct} capability={capability} onAction={openAction} theme={theme}/>}
        </Mt5TradingBar>
      </div>
      {panel==='order' && <LegacyModal label={t('Lệnh mới')} theme={theme} className="legacy-order-modal live-mt5-order" onClose={()=>setPanel(null)}><div className="mt5-order-ticket" aria-label={t('Phiếu lệnh MT5')}>
        <p className="mt5-order-identity">{activeSymbol} · #{snapshot?.account?.login || '—'} <span className="live-badge">{snapshot?.mode==='real'?t('Real'):snapshot?.mode==='demo'?t('Demo'):'MT5'}</span></p>
        <form onSubmit={checkOrder} className="legacy-order-form">
          <Suspense fallback={<TestingSkeleton rows={2}/>}><OrderEntryFields draft={draft} instrument={instrument || {asset_class:'fx'}} quantityLabel="Khối lượng (lot)" disabled={busy||Boolean(unresolved)} conditionalOrders={false} onSide={value=>change('side',value)} onType={value=>change('orderType',value)} onChange={change} reference={reference}/></Suspense>
          {['stopLoss','takeProfit'].map(key => <OrderProtectionSection key={key} kind={key} draft={draft} instrument={instrument} reference={reference}
            enabled={key === 'stopLoss' && snapshot?.policy?.source !== 'broker' || (draft.protectionEnabled?.[key] ?? draft[key] !== '')}
            required={key === 'stopLoss' && snapshot?.policy?.source !== 'broker'} disabled={busy||Boolean(unresolved)}
            toggleDisabled={!marketReady || !(Number(instrument?.tick_size)>0)} onToggle={value=>toggleProtection(key,value)} onChange={change}/>) }
          {snapshot?.policy && snapshot.policy.source!=='broker' && <p className="live-muted">{t('Giới hạn tổng rủi ro')}: {money(snapshot.policy.max_risk_amount)} · {fmt(snapshot.policy.max_risk_pct)}% · {snapshot.policy.max_positions} {t('Vị thế')}</p>}
          {marketReady && error && (draft.quantity!==''||draft.stopLoss!=='') && <p className="live-muted" role="status">{t(error)}</p>}
          {checked && <dl className="live-terminal-values"><div><dt>{t('Risk tới SL')}</dt><dd>{money(checked.value.estimated_stop_risk)}</dd></div><div><dt>{t('Margin cần thiết')}</dt><dd>{money(checked.value.margin_required)}</dd></div></dl>}
          <footer><button type="button" onClick={()=>setPanel(null)}>{t('Hủy')}</button>
            <button type="submit" disabled={!canAct||paused||!capability('place')||Boolean(error)}>{t(busy?'Đang kiểm tra…':'Kiểm tra lệnh')}</button>
            <button className="legacy-order-save" type="button" disabled={!canAct||paused||!capability('place')||!validPreview} onClick={()=>openAction('place',null,'Xác nhận lệnh MT5')}>{t('Xem và xác nhận lệnh')}</button>
          </footer>
        </form>
        {notice && <p className="live-terminal-notice" role="status">{t(notice)}</p>}
      </div></LegacyModal>}
    </section>
    {panel==='conditions' && <LegacyModal label={t('Điều kiện giao dịch')} theme={theme} onClose={()=>setPanel(null)}><div className="live-terminal-confirm-body"><Suspense fallback={<TestingSkeleton rows={2}/>}><Mt5TradingConditions snapshot={snapshot} stale={read.status!=='ready'}/></Suspense><button type="button" className="wm-button" disabled={!canAct} onClick={()=>openAction(paused?'resume':'pause',{},paused?'Tiếp tục mở lệnh mới':'Tạm dừng mở lệnh mới')}>{t(paused?'Tiếp tục mở lệnh mới':'Tạm dừng mở lệnh mới')}</button></div></LegacyModal>}
    {panel==='objects' && <LegacyModal label={t('Cây đối tượng chart')} theme={theme} onClose={()=>setPanel(null)}><Suspense fallback={<TestingSkeleton rows={2}/>}><LegacyObjectTree controls={headerSlots} symbol={activeSymbol}/></Suspense></LegacyModal>}
    {symbolAnchor && <Mt5SymbolPicker anchor={symbolAnchor} theme={theme} symbols={snapshot?.symbols||chartSnapshot?.symbols||EMPTY} symbol={chartSymbol} status={read.status==='ready'&&snapshot?.status==='ready'?'ready':'unavailable'} onSelect={route} onClose={()=>setSymbolAnchor(null)}/>}
    {confirmation && <LegacyModal label={t(confirmation.label)} theme={theme} className="live-terminal-confirm" onClose={()=>{if(!busy)setConfirmation(null)}}>
      <div className="live-terminal-confirm-body"><p><strong>{t(snapshot?.mode==='real'?'Real':'Demo')} · #{snapshot?.account?.login}</strong><br/>{snapshot?.account?.server}</p>
        {confirmation.action==='place' && <><p>{draft.side} · {activeSymbol} · {fmt(draft.quantity,' lot',5)}</p><dl className="live-terminal-values"><div><dt>SL / TP</dt><dd>{draft.stopLoss||'—'} / {draft.takeProfit||'—'}</dd></div><div><dt>{t('Risk tới SL')}</dt><dd>{money(checked?.value.estimated_stop_risk)}</dd></div><div><dt>{t('Margin cần thiết')}</dt><dd>{money(checked?.value.margin_required)}</dd></div></dl><p className="live-muted">{t('Giá khớp thực tế có thể thay đổi. MT5 sẽ kiểm tra lại trước khi gửi.')}</p></>}
        {confirmation.body?.ticket && <p>Ticket #{confirmation.body.ticket} · {confirmation.body.symbol}</p>}
        {confirmation.action==='place'&&!validPreview&&<div role="status"><p className="live-muted">{t('Kiểm tra lại lệnh để lấy báo giá mới.')}</p><button className="live-text-action" disabled={!canAct} onClick={()=>checkOrder({preventDefault:noop})}>{t('Kiểm tra lệnh')}</button></div>}
        {confirmation.action==='protect' && <div className="legacy-order-form mt5-protection-editor">{['stopLoss','takeProfit'].map(key=><OrderProtectionSection key={key} kind={key} draft={protectionDraft} instrument={protectionInstrument} reference={protectionTicket?.price_open}
          enabled={key==='stopLoss'&&snapshot?.policy?.source!=='broker'||confirmation.protectionEnabled[key]}
          required={key==='stopLoss'&&snapshot?.policy?.source!=='broker'} disabled={busy||!canAct||!protectionTicket}
          onToggle={value=>toggleTicketProtection(key,value)} onChange={changeProtection}/>)}</div>}
        <footer><button className="wm-button" disabled={busy} onClick={()=>setConfirmation(null)}>{t('Hủy')}</button><button className="wm-button is-primary" disabled={!canAct || !capability(confirmation.action) || confirmation.action==='place'&&!validPreview || confirmation.action==='protect'&&protectionInvalid} onClick={send}>{t(busy?'Đang gửi…':confirmation.action==='place'?'Gửi lệnh MT5':'Xác nhận')}</button></footer>
      </div>
    </LegacyModal>}
  </LiveChartSurface></Suspense>
}
