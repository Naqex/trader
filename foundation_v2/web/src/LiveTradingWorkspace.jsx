import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { navigate } from './clientNavigation.js'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import OrderEntryFields from './OrderEntryFields.jsx'
import { readDemoTrading, previewDemoOrder, commandDemoOrder, reconcileDemoOrder } from './liveTradingApi.js'
import { DEMO_DRAFT, DEMO_TIMEFRAMES, demoIdentity, demoDraftError, demoIntent, tradingReady, previewMatches, demoReason, finalDemoReceipt } from './liveTradingModel.js'
import './live-trading.css'

const AdvancedChart = lazy(() => import('./TradingViewReplayChart.jsx'))
const SimpleChart = lazy(() => import('./LightweightReplayChart.jsx'))
const EMPTY = []
const noop = () => {}
const finalReceipt = finalDemoReceipt
function recoverPending(key) {
  try { const item = JSON.parse(sessionStorage.getItem(key)); return item?.request_id && item?.mode === 'demo' ? item : null } catch { return null }
}

export default function LiveTradingWorkspace({ workspace, query, preview: demoPreview = false }) {
  const { t,fmt } = useTestingLocale(), {appearance} = useFxReplayContext()
  const theme = appearance?.theme || 'dark'
  const symbol = query.get('mt5_symbol') || '', timeframe = DEMO_TIMEFRAMES[query.get('mt5_timeframe')] ? query.get('mt5_timeframe') : 'M1'
  const scope = `${workspace}:${symbol}:${timeframe}`, receiptKey = `tw:mt5-demo-pending:v1:${workspace}`
  const currentScope = useRef(scope); currentScope.current = scope
  const [read,setRead] = useState({scope,status:'loading',payload:null}), [refresh,setRefresh] = useState(0)
  const [clock,setClock] = useState(Date.now()), [draft,setDraft] = useState({...DEMO_DRAFT}), [checked,setChecked] = useState(null)
  const [busy,setBusy] = useState(false), running = useRef(false), [notice,setNotice] = useState('')
  const [pending,setPending] = useState(() => recoverPending(receiptKey)), [confirmation,setConfirmation] = useState(null), [tab,setTab] = useState('positions')
  const snapshot = read.scope === scope ? read.payload : null
  const unresolved = pending || snapshot?.requests?.find(item=>item.status==='unknown'||item.requires_reconciliation===true)
  const identity = demoIdentity(snapshot), activeSymbol = symbol || snapshot?.symbol || ''
  const now = Math.max(clock,Date.now())
  const marketReady = !demoPreview && read.status === 'ready' && tradingReady(snapshot,now)
  const canAct = !demoPreview && read.status === 'ready' && tradingReady(snapshot,now,true) && !busy && !unresolved
  const paused = snapshot?.paused === true
  const intent = identity && activeSymbol ? demoIntent(snapshot,activeSymbol,draft) : null
  const validPreview = intent && previewMatches(checked,intent,now)
  const instrument = snapshot?.instrument && {...snapshot.instrument,quantity_max:Math.min(snapshot.instrument.quantity_max,snapshot.policy?.max_volume||Infinity),asset_class:'fx'}
  const error = demoDraftError(draft,instrument,snapshot?.quote)
  const reference = draft.side === 'BUY' ? snapshot?.quote?.ask : snapshot?.quote?.bid
  useEffect(() => { const timer=setInterval(()=>setClock(Date.now()),1000); return ()=>clearInterval(timer) },[])
  useEffect(() => {setConfirmation(null);setChecked(null)},[scope])
  useEffect(() => {
    setPending(recoverPending(receiptKey)); setConfirmation(null); setChecked(null); setDraft({...DEMO_DRAFT}); setNotice('')
  },[receiptKey,identity,activeSymbol])
  useEffect(() => {
    const controller = new AbortController()
    let reading = false
    setRead(previous=>({scope,status:demoPreview ? 'locked' : 'loading',payload:!demoPreview&&previous.scope===scope?previous.payload:null}))
    if (demoPreview) return () => controller.abort()
    const poll = async () => {
      if (reading || controller.signal.aborted) return
      reading = true
      try {
        const payload = await readDemoTrading(workspace,symbol,timeframe,controller.signal)
        if (!controller.signal.aborted) setRead({scope,status:'ready',payload})
      } catch (error) {
        if (!controller.signal.aborted) setRead(previous=>({scope,status:'error',payload:error.status === 403 ? null : previous.scope === scope ? previous.payload : null,error:error.message}))
      } finally {reading=false}
    }
    poll()
    const timer=setInterval(poll,2000)
    return () => {controller.abort();clearInterval(timer)}
  },[workspace,scope,symbol,timeframe,refresh,demoPreview])
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
    const url=new URL(window.location.href)
    Object.entries(patch).forEach(([key,value])=> value ? url.searchParams.set(key,value) : url.searchParams.delete(key))
    navigate(url.pathname+url.search)
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
    if (confirmation.action==='place' && (!validPreview || paused)) {setConfirmation(null);setChecked(null);setNotice('Kiểm tra lại lệnh để lấy báo giá mới.');return}
    running.current=true;setBusy(true);setNotice('')
    const origin=scope
    const command={...(confirmation.action==='place' ? intent : {mode:'demo',account_id:String(snapshot.account.login),server:snapshot.account.server,...confirmation.body}),action:confirmation.action,request_id:crypto.randomUUID()}
    if (command.action==='protect') {command.stop_loss=Number(command.stop_loss);command.take_profit=command.take_profit===''?null:Number(command.take_profit)}
    // Persist before sending. Reloads must not turn an unknown result into a new order.
    try {sessionStorage.setItem(receiptKey,JSON.stringify(command));setPending(command)}
    catch {running.current=false;setBusy(false);setNotice('Không lưu được mã yêu cầu; lệnh chưa được gửi.');return}
    try {
      const receipt=await commandDemoOrder(workspace,command)
      if (finalReceipt(receipt)) {
        sessionStorage.removeItem(receiptKey)
        if(currentScope.current===origin){setPending(null);setNotice(receipt.status==='rejected'?'MT5 đã từ chối yêu cầu.':'Đã nhận phản hồi MT5. Xem trạng thái bên dưới.')}
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
      const receipt=await reconcileDemoOrder(workspace,unresolved.request_id)
      if (currentScope.current!==origin) return
      if(finalReceipt(receipt)) {
        sessionStorage.removeItem(receiptKey);setPending(null);setNotice('Đã nhận kết quả đối soát từ MT5.')
      } else setNotice('Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.')
    } catch(error) {if(currentScope.current===origin)setNotice(demoReason(error.message))}
    finally {running.current=false;setBusy(false);if(currentScope.current===origin)setRefresh(value=>value+1)}
  }
  const capability = action => !['place','close','protect','cancel'].includes(action) || snapshot?.capabilities?.[action==='place'?'market':action] === true
  const openAction=(action,body,label) => {if(canAct&&capability(action))setConfirmation({action,body,label,identity,scope})}
  const rows = snapshot?.bars || EMPTY, positions=snapshot?.positions || EMPTY, orders=snapshot?.orders || EMPTY
  const currency=snapshot?.account?.currency || '', money=value=>fmt(value,currency?` ${currency}`:'')
  const reason = demoPreview ? 'Gửi lệnh không khả dụng trong chế độ xem thử.' : read.status==='loading' ? 'Đang đọc terminal giao dịch demo…' : read.status==='error' ? 'Mất kết nối dữ liệu giao dịch. Đang giữ ảnh chụp trước đó.' : !marketReady ? demoReason(snapshot?.reason || 'demo_quote_stale') : ''
  return <section className="live-trading wm-page" aria-label={t('Giao dịch MT5')} data-testid="live-trading-workspace">
    <header className="live-terminal-toolbar">
      <div className="live-terminal-account"><strong>MT5 <span className="live-badge">DEMO</span></strong><span>{identity ? `#${snapshot.account.login} · ${snapshot.account.server}` : t('Chưa kết nối terminal giao dịch')}</span></div>
      <FxSelect label="Mã giao dịch MT5" searchable value={activeSymbol} triggerContent={activeSymbol || t('Chọn mã')} disabled={!snapshot?.symbols?.length || busy} options={(snapshot?.symbols || []).map(value=>({value,label:value,localize:false}))} onChange={value=>route({mt5_symbol:value})} />
      <FxSelect label="Khung thời gian MT5" value={timeframe} options={Object.keys(DEMO_TIMEFRAMES).map(value=>({value,label:value,localize:false}))} onChange={value=>route({mt5_timeframe:value})} />
      <button type="button" className="fxa-button fxa-icon-button" aria-label={t('Làm mới terminal')} onClick={()=>setRefresh(value=>value+1)} disabled={busy}><TestingIcon kind="refresh" /></button>
      {identity && <button className="fxa-button" type="button" disabled={!canAct} onClick={()=>openAction(paused?'resume':'pause',{},paused?'Tiếp tục mở lệnh mới':'Tạm dừng mở lệnh mới')}>{t(paused?'Tiếp tục mở lệnh mới':'Tạm dừng mở lệnh mới')}</button>}
    </header>
    {(reason || paused || unresolved) && <div className="live-terminal-state" role={read.status==='error'||unresolved?'alert':'status'}><TestingIcon kind="info" /><span>{unresolved?t('Chưa rõ kết quả. Đối soát MT5 trước khi gửi lệnh khác.'):t(reason || 'Đã tạm dừng mở lệnh mới.')}</span>{unresolved && <button className="live-text-action" type="button" disabled={busy} onClick={reconcile}>{t(busy?'Đang đối soát…':'Đối soát')}</button>}</div>}
    <div className="live-terminal-main">
      <div className="live-terminal-market">
        <div className="live-terminal-quote"><strong>{activeSymbol || 'MT5'}</strong><span>Bid <b>{fmt(snapshot?.quote?.bid,'',8)}</b></span><span>Ask <b>{fmt(snapshot?.quote?.ask,'',8)}</b></span><span>{t('Spread')} <b>{snapshot?.quote ? fmt(snapshot.quote.ask-snapshot.quote.bid,'',8):'—'}</b></span><small>UTC{snapshot?.quote?.time_msc ? ` · ${new Date(snapshot.quote.time_msc).toISOString().slice(11,19)}`:''}</small></div>
        <div className="live-terminal-chart chart-frame"><div className="chart-canvas">
          {rows.length ? <Suspense fallback={<div className="live-empty">{t('Đang tải biểu đồ…')}</div>}>{query.get('chart_engine')==='lightweight' ? <SimpleChart rows={rows} sessionId={`${identity}:${activeSymbol}:${timeframe}`} chartType="candles" showVolume theme={theme} drawings={EMPTY} /> : <AdvancedChart drawings={EMPTY} marketMode="live" workspace={workspace} sessionId={`live:${identity}:${activeSymbol}:${timeframe}`} datasetId="mt5-live" symbol={activeSymbol} assetClass={snapshot?.instrument?.asset_class || 'fx'} seconds={DEMO_TIMEFRAMES[timeframe]} tickSize={snapshot?.instrument?.tick_size} rows={rows} cutoff={Number(rows.at(-1).timestamp)} theme={theme} orderEditable={false} orderCloseable={false} onOrderDragStart={noop} orderGeneration={scope} />}</Suspense> : <div className="live-empty"><TestingIcon kind="chart" size={48}/><h2>{t('Chưa có biểu đồ MT5')}</h2><p>{t('Biểu đồ dùng dữ liệu terminal giao dịch, tách khỏi phiên replay.')}</p></div>}
        </div></div>
        <div className="live-terminal-ledger">
          <nav className="live-terminal-tabs" aria-label={t('Quản lý lệnh MT5')}>{[['positions','Vị thế'],['orders','Lệnh chờ'],['requests','Yêu cầu']].map(([key,label])=><button type="button" className="live-text-action" aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)} key={key}>{t(label)} <span>{key==='positions'?positions.length:key==='orders'?orders.length:snapshot?.requests?.length||0}</span></button>)}</nav>
          <div className="live-table-scroll" role="region" tabIndex={0} aria-label={t('Quản lý lệnh MT5')}>
            {tab==='requests' ? <table><thead><tr>{['Mã yêu cầu','Thao tác','Trạng thái'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{(snapshot?.requests||EMPTY).map(item=><tr key={item.request_id}><td>{item.request_id}</td><td>{item.action||item.operation||'—'}</td><td>{t(({filled:'Đã khớp',accepted:'Đã tiếp nhận',rejected:'Bị từ chối',unknown:'Chưa rõ kết quả',done:'Hoàn tất',cancelled:'Đã hủy'})[item.status]||item.status)}</td></tr>)}</tbody></table> : <table><thead><tr>{['Ticket','Asset','Side','Lot','Entry price','SL / TP','PnL','Thao tác'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{(tab==='positions'?positions:orders).map(item=><tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{item.side}</td><td>{fmt(item.volume,'',5)}</td><td>{fmt(item.price_open,'',8)}</td><td>{fmt(item.sl||null,'',8)} / {fmt(item.tp||null,'',8)}</td><td>{money(item.profit)}</td><td>{tab==='positions'?<div className="live-terminal-row-actions"><button className="live-text-action" disabled={!canAct||!capability('protect')} onClick={()=>openAction('protect',{ticket:item.ticket,symbol:item.symbol,stop_loss:item.sl||'',take_profit:item.tp||''},'Sửa SL/TP')}>{t('Sửa SL/TP')}</button><button className="live-text-action" disabled={!canAct||!capability('close')} onClick={()=>openAction('close',{ticket:item.ticket,symbol:item.symbol},'Đóng vị thế demo')}>{t('Đóng')}</button></div>:<button className="live-text-action" disabled={!canAct||!capability('cancel')} onClick={()=>openAction('cancel',{ticket:item.ticket,symbol:item.symbol},'Hủy lệnh chờ demo')}>{t('Hủy')}</button>}</td></tr>)}</tbody></table>}
            {!(tab==='positions'?positions.length:tab==='orders'?orders.length:snapshot?.requests?.length) && <p className="live-terminal-empty">{t(snapshot?.status==='ready' ? tab==='positions'?'Không có vị thế đang mở.':tab==='orders'?'Không có lệnh chờ.':'Chưa có yêu cầu giao dịch.' : 'Chưa có dữ liệu terminal giao dịch.')}</p>}
          </div>
        </div>
      </div>
      <aside className="live-terminal-ticket" aria-label={t('Phiếu lệnh demo')}>
        <h2>{t('Lệnh mới')} <span className="live-badge">DEMO</span></h2>
        <dl className="live-terminal-values">{[['Balance',snapshot?.account?.balance],['Equity',snapshot?.account?.equity],['Free margin',snapshot?.account?.margin_free]].map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd>{money(value)}</dd></div>)}</dl>
        <form onSubmit={checkOrder} className="live-terminal-form">
          <OrderEntryFields draft={draft} instrument={instrument || {asset_class:'fx'}} disabled={busy||Boolean(unresolved)} conditionalOrders={false} onSide={value=>change('side',value)} onType={value=>change('orderType',value)} onChange={change} reference={reference}/>
          {[['stopLoss','Stop loss'],['takeProfit','Take profit']].map(([key,label])=><label key={key}>{t(label)}{key==='stopLoss'&&<span className="live-required"> *</span>}<input type="number" aria-label={t(label)} min="0" step={snapshot?.instrument?.tick_size||'any'} required={key==='stopLoss'} value={draft[key]} onChange={event=>change(key,event.target.value)} disabled={busy||Boolean(pending)}/></label>)}
          {snapshot?.policy && <p className="live-muted">{t('Giới hạn tổng rủi ro')}: {money(snapshot.policy.max_risk_amount)} · {fmt(snapshot.policy.max_risk_pct)}% · {snapshot.policy.max_positions} {t('Vị thế')}</p>}
          {marketReady && error && (draft.quantity!==''||draft.stopLoss!=='') && <p className="live-muted" role="status">{t(error)}</p>}
          {checked && <dl className="live-terminal-values"><div><dt>{t('Risk tới SL')}</dt><dd>{money(checked.value.estimated_stop_risk)}</dd></div><div><dt>{t('Margin cần thiết')}</dt><dd>{money(checked.value.margin_required)}</dd></div></dl>}
          <button className="fxa-button" type="submit" disabled={!canAct||paused||!capability('place')||Boolean(error)}>{t(busy?'Đang kiểm tra…':'Kiểm tra lệnh')}</button>
          <button className="fxa-button is-primary" type="button" disabled={!canAct||paused||!capability('place')||!validPreview} onClick={()=>openAction('place',null,'Xác nhận lệnh demo')}>{t('Xem và xác nhận lệnh')}</button>
          <p className="live-muted">{t('Lệnh demo gửi tới MT5. Không dùng khớp lệnh mô phỏng của replay.')}</p>
        </form>
        {notice && <p className="live-terminal-notice" role="status">{t(notice)}</p>}
      </aside>
    </div>
    {confirmation && <LegacyModal label={t(confirmation.label)} theme={theme} className="live-terminal-confirm" onClose={()=>{if(!busy)setConfirmation(null)}}>
      <div className="live-terminal-confirm-body"><p><strong>DEMO · #{snapshot?.account?.login}</strong><br/>{snapshot?.account?.server}</p>
        {confirmation.action==='place' && <><p>{draft.side} · {activeSymbol} · {fmt(draft.quantity,' lot',5)}</p><dl className="live-terminal-values"><div><dt>SL / TP</dt><dd>{draft.stopLoss} / {draft.takeProfit||'—'}</dd></div><div><dt>{t('Risk tới SL')}</dt><dd>{money(checked?.value.estimated_stop_risk)}</dd></div><div><dt>{t('Margin cần thiết')}</dt><dd>{money(checked?.value.margin_required)}</dd></div></dl><p className="live-muted">{t('Giá khớp thực tế có thể thay đổi. MT5 sẽ kiểm tra lại trước khi gửi.')}</p></>}
        {confirmation.body?.ticket && <p>Ticket #{confirmation.body.ticket} · {confirmation.body.symbol}</p>}
        {confirmation.action==='place'&&!validPreview&&<div role="status"><p className="live-muted">{t('Kiểm tra lại lệnh để lấy báo giá mới.')}</p><button className="live-text-action" disabled={!canAct} onClick={()=>checkOrder({preventDefault:noop})}>{t('Kiểm tra lệnh')}</button></div>}
        {confirmation.action==='protect' && ['stop_loss','take_profit'].map((key,index)=><label key={key}>{t(index?'Take profit':'Stop loss')}<input aria-label={t(index?'Take profit mới':'Stop loss mới')} type="number" min="0" step="any" value={confirmation.body[key]} onChange={event=>setConfirmation(previous=>({...previous,body:{...previous.body,[key]:event.target.value}}))}/></label>)}
        <footer><button className="wm-button" disabled={busy} onClick={()=>setConfirmation(null)}>{t('Hủy')}</button><button className="wm-button is-primary" disabled={!canAct || !capability(confirmation.action) || confirmation.action==='place'&&!validPreview || confirmation.action==='protect'&&!(Number(confirmation.body.stop_loss)>0)} onClick={send}>{t(busy?'Đang gửi…':confirmation.action==='place'?'Gửi lệnh demo':'Xác nhận')}</button></footer>
      </div>
    </LegacyModal>}
  </section>
}
