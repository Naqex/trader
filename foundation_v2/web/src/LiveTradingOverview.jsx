import { useEffect, useState } from 'react'
import DashboardMetric from './DashboardMetric.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { liveTradingHref } from './liveTradingNavigation.js'
import { navigate } from './clientNavigation.js'
import { readLiveStatus } from './liveStatusApi.js'
import { recentChartsKey, readRecentCharts } from './liveRecentCharts.js'
import { liveOverviewPerformance } from './liveOverviewModel.js'

export default function LiveTradingOverview({ workspace, connectionId, query, snapshot, status, reason, symbol, timeframe, onRefresh, onResetSymbol }) {
  const { t,fmt,locale }=useTestingLocale()
  const account=snapshot?.account, currency=account?.currency
  const money=(value,unit=currency)=>Number.isFinite(value)?fmt(value,unit?` ${unit}`:''):t('Chưa có dữ liệu')
  const scope=`${workspace}:${connectionId}`
  const [history,setHistory]=useState(null), [revision,setRevision]=useState(0)
  const performance=account && history?.scope===scope ? liveOverviewPerformance(history.payload,connectionId,account) : null
  const recent=readRecentCharts(recentChartsKey(workspace,connectionId,account))
  const date=value=>new Intl.DateTimeFormat(locale,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(value)
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
  return <section className="fx-dashboard mt5-overview" data-testid="mt5-overview" aria-label={t('Tổng quan giao dịch MT5')}>
    <h1 className="sr-only">{t('Tổng quan giao dịch MT5')}</h1>
    <nav className="fx-dashboard-quick-actions mt5-quick-actions" aria-label={t('Giao dịch MT5')}>
      <button type="button" className="fx-dashboard-quick-action is-primary" onClick={()=>open()}><TestingIcon kind="chart" size={24}/><span><strong>{t('Mở biểu đồ')}</strong><small>{[symbol,timeframe,account?.account_ref].filter(Boolean).join(' · ') || 'MetaTrader 5'}</small></span></button>
    </nav>
    {recent.length>0 && <section className="mt5-recent" aria-label={t('Biểu đồ gần đây')}>
      <h2>{t('Biểu đồ gần đây')}</h2>
      <div className="mt5-recent-list">{recent.map(item=><button type="button" key={`${item.symbol}:${item.timeframe}`} onClick={()=>open(item.symbol,item.timeframe)}><TestingIcon kind="chart"/><span><strong>{item.symbol}</strong><small>{item.timeframe}</small></span><TestingIcon kind="chevron-right"/></button>)}</div>
    </section>}
    <section className="fx-dashboard-results" aria-label={t('Tài khoản MT5')} aria-busy={status==='loading'}>
      <div className="fx-dashboard-section-head"><h2 className="fx-dashboard-performance-heading">{t('Tài khoản MT5')}</h2><button type="button" className="live-text-action" aria-label={t('Làm mới dữ liệu')} onClick={refresh}><TestingIcon kind="refresh"/></button></div>
      {status==='loading' && !account ? <TestingSkeleton label="Đang đọc tài khoản MT5…"/> : <>
      {reason && <TestingReadState message={reason} error={status==='error'} onRetry={onResetSymbol || (status==='error' ? refresh : undefined)}/>}
      {account && <div className="fx-dashboard-performance-layout has-no-trades"><div className="fx-dashboard-performance mt5-account-metrics">
        <DashboardMetric title="Balance" value={money(account?.balance)} icon="account"/>
        <DashboardMetric title="Equity" value={money(account?.equity)} icon="chart"/>
        <DashboardMetric title="P/L đang mở" value={money(account?.profit)} icon="chart"/>
        <DashboardMetric title="Margin" value={money(account?.margin)} icon="trades"/>
        <DashboardMetric title="Free margin" value={money(account?.margin_free)} icon="account"/>
      </div></div>}
      </>}
    </section>
    <section className="fx-dashboard-results mt5-performance" aria-label={t('Kết quả giao dịch')} aria-busy={history?.scope===scope&&history.status==='loading'}>
      <div className="fx-dashboard-section-head"><h2 className="fx-dashboard-performance-heading">{t('Kết quả giao dịch')}</h2>{performance && <span className="live-muted">{date(performance.from)} – {date(performance.to)}</span>}</div>
      {performance ? <>
        {performance.stale && <TestingReadState message="Dữ liệu trước đó · đang mất kết nối"/>}
        <div className="fx-dashboard-performance-layout has-no-trades"><div className="fx-dashboard-performance">
          <DashboardMetric title="P/L ròng đã đồng bộ" value={money(performance.net,performance.currency)} icon="chart"/>
          <DashboardMetric title="P/L trước phí" value={money(performance.gross,performance.currency)} icon="chart"/>
          <DashboardMetric title="Hoa hồng, swap và phí" value={money(performance.costs,performance.currency)} icon="account"/>
          <DashboardMetric title="Lượt khớp lệnh" value={fmt(performance.count,'',0)} icon="trades"/>
        </div></div>
      </> : history?.scope===scope&&history.status==='loading' ? <TestingSkeleton label="Đang đọc lịch sử giao dịch…"/> : <TestingReadState message="Chưa có lịch sử giao dịch đã đồng bộ." onRetry={connectionId?refresh:undefined}/>}
    </section>
  </section>
}
