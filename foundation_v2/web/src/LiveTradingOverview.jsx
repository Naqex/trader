import { useEffect, useState } from 'react'
import LiveOverviewReport from './LiveOverviewReport.jsx'
import FxSelect from './FxSelect.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import './session-picker.css'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { liveTradingHref } from './liveTradingNavigation.js'
import { navigate } from './clientNavigation.js'
import { readLiveStatus } from './liveStatusApi.js'
import { liveOverviewPerformance } from './liveOverviewModel.js'

export default function LiveTradingOverview({ workspace, connectionId, query, snapshot, status, reason, symbol, timeframe, onRefresh, onResetSymbol, connections, onSelectConnection }) {
  const { t,fmt }=useTestingLocale()
  const missing=connections.status==='ready'&&connectionId&&!connections.items.some(item=>item.id===connectionId)
  const account=missing?null:snapshot?.account, currency=account?.currency
  const money=(value,unit=currency)=>Number.isFinite(value)?fmt(value,unit?` ${unit}`:''):t('Chưa có dữ liệu')
  const scope=`${workspace}:${connectionId}`
  const [history,setHistory]=useState(null), [revision,setRevision]=useState(0)
  const performance=account && history?.scope===scope ? liveOverviewPerformance(history.payload,connectionId,account) : null
  useEffect(()=>{
    if(!connectionId)return
    const controller=new AbortController()
    setHistory({scope,status:'loading'})
    readLiveStatus(workspace,controller.signal,connectionId).then(payload=>{
      if(!controller.signal.aborted)setHistory({scope,status:'ready',payload})
    }).catch(()=>{if(!controller.signal.aborted)setHistory({scope,status:'error'})})
    return ()=>controller.abort()
  },[workspace,connectionId,scope,revision])
  const refresh=()=>{onRefresh();setRevision(value=>value+1)}
  const open=(selected=symbol,interval=timeframe)=>navigate(liveTradingHref(workspace,query,{chart:true,symbol:selected,timeframe:interval}))
  const selected=connections.items.find(item=>item.id===connectionId)
  const currentConnection=connections.status==='ready'&&status==='ready'&&snapshot?.status==='ready'&&!snapshot.stale?selected:null
  const name=missing?t('Tài khoản không khả dụng'):selected?.name || account?.account_ref || t('Tài khoản MT5')
  const accountHref=buildWorkspaceHref('live',workspace,query,{area:'live',section:'trading-accounts',surface:null,account_tab:null,live_account:connectionId?`broker:${connectionId}`:null})
  const tradesHref=buildWorkspaceHref('live',workspace,query,{area:'live',section:'trades',surface:null,live_account:connectionId?`broker:${connectionId}`:null})
  const connectionLabel=value=>t(value==='connected'?'Đã kết nối':value==='connecting'?'Đang kết nối…':value==='error'?'Lỗi kết nối':value==='disconnected'?'Chưa kết nối':'Chưa xác định')
  const permission=value=>t(value===true?'Được phép':value===false?'Không được phép':'Chưa xác định')
  return <section className="wm-page fx-session-picker fxr-integrated-sessions fxs-page mt5-overview" data-testid="mt5-overview" aria-label={t('Tổng quan giao dịch MT5')}>
    <h1 className="sr-only">{t('Tổng quan giao dịch MT5')}</h1>
    <div className="fxr-session-toolbar">
      <div className="fxr-session-control"><span className="fxs-select-label">{t('Chọn tài khoản')}</span>
        <FxSelect className="is-rich" label="Chọn tài khoản MT5" searchable placeholder="Tìm tài khoản…" value={connectionId} onChange={onSelectConnection} disabled={connections.status==='loading'||!connections.items.length}
          triggerContent={<><strong>{name}</strong><small>{selected?.server||account?.server||'MetaTrader 5'} · {selected?.login_hint||account?.account_ref||'—'}</small><small>{t('Account balance')}: {money(account?.balance)}</small><small>{connections.status==='error'?t('Không tải được danh sách tài khoản.'):connectionLabel(currentConnection?.status)}</small></>}
          options={connections.items.map(item=>({value:item.id,label:item.name||item.login_hint||item.id,localize:false,detail:[item.server,item.login_hint,connectionLabel(item.status)].filter(Boolean).join(' · ')}))}/>
      </div>
      <div className="fxr-session-actions"><a className="fxr-button fxr-button-primary" href={accountHref}><TestingIcon kind="account"/>{t('Quản lý tài khoản')}</a><button type="button" className="fxr-button fxr-button-secondary" onClick={refresh}><TestingIcon kind="refresh"/>{t('Làm mới dữ liệu')}</button></div>
    </div>
    {connections.status==='error'&&<TestingReadState error message="Không tải được danh sách tài khoản." onRetry={refresh}/>}
    {connections.status==='ready'&&!connections.items.length&&<TestingReadState message="Chưa có tài khoản MT5. Thêm tài khoản trong Quản lý tài khoản."/>}
    {missing&&connections.items.length>0&&<TestingReadState message="Tài khoản đã chọn không còn trong danh sách. Chọn tài khoản khác."/>}
    {status==='loading'&&!account?<TestingSkeleton label="Đang đọc tài khoản MT5…"/>:<>
      {reason&&connectionId&&!missing&&<TestingReadState message={reason} error={status==='error'} onRetry={onResetSymbol||(status==='error'?refresh:undefined)}/>}
      {account&&<>
        <div className="fxr-session-cards">
          <article className="fxr-session-card fxr-session-summary-card mt5-account-card"><div className="fxs-summary-heading"><h2>{name}</h2><div className="fxs-balance"><span>{t('Account balance')}</span><strong data-testid="mt5-account-balance">{money(account.balance)}</strong></div></div>
            <p>{[account.server,account.account_ref,snapshot.mode==='demo'?t('Tài khoản demo'):snapshot.mode==='real'?t('Tài khoản thật'):null].filter(Boolean).join(' · ')}</p>
            <dl className="mt5-account-values"><div><dt>{t('Equity')}</dt><dd>{money(account.equity)}</dd></div><div><dt>{t('P/L đang mở')}</dt><dd>{money(account.profit)}</dd></div></dl>
            <div className="fxr-session-links"><button type="button" className="fxr-button fxr-button-primary fxs-go-chart" disabled={!connectionId} onClick={()=>open()}>{t('Mở biểu đồ')}<TestingIcon kind="chart"/></button></div>
          </article>
          <article className="fxr-session-card mt5-connection-card"><h2>{t('Tài khoản MT5')}</h2><dl className="mt5-account-values">
            <div><dt>{t('Kết nối')}</dt><dd>{connectionLabel(currentConnection?.status)}</dd></div>
            <div><dt>{t('Margin')}</dt><dd>{money(account.margin)}</dd></div><div><dt>{t('Free margin')}</dt><dd>{money(account.margin_free)}</dd></div>
            <div><dt>{t('Quyền giao dịch')}</dt><dd>{permission(currentConnection?.status==='connected'?currentConnection?.verified_permissions?.trade:undefined)}</dd></div>
          </dl></article>
        </div>
        {performance?<LiveOverviewReport key={scope} performance={performance} tradesHref={tradesHref}/>:history?.scope===scope&&history.status==='loading'?<TestingSkeleton label="Đang đọc lịch sử giao dịch…"/>:<TestingReadState message="Chưa có lịch sử giao dịch đã đồng bộ." onRetry={connectionId?refresh:undefined}/>}
      </>}
    </>}
  </section>
}
