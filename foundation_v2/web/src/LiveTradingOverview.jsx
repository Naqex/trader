import { useState } from 'react'
import DashboardMetric from './DashboardMetric.jsx'
import TestingIcon from './TestingIcon.jsx'
import Mt5ChartSetup from './Mt5ChartSetup.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { liveTradingHref } from './liveTradingNavigation.js'
import { navigate } from './clientNavigation.js'

export default function LiveTradingOverview({ workspace, query, snapshot, status, reason, symbol, timeframe, onSelect, onRefresh, onResetSymbol }) {
  const { t,fmt }=useTestingLocale(), [setup,setSetup]=useState(false)
  const account=snapshot?.account, currency=account?.currency
  const money=value=>Number.isFinite(value)?fmt(value,currency?` ${currency}`:''):t('Chưa có dữ liệu')
  const accounts=new URLSearchParams({workspace,view:'live',area:'live',section:'trading-accounts',account_tab:'connect'})
  return <section className="fx-dashboard mt5-overview" data-testid="mt5-overview" aria-label={t('Tổng quan giao dịch MT5')}>
    <h1 className="sr-only">{t('Tổng quan giao dịch MT5')}</h1>
    <nav className="fx-dashboard-quick-actions mt5-quick-actions" aria-label={t('Giao dịch MT5')}><button type="button" className="fx-dashboard-quick-action is-primary" onClick={()=>setSetup(true)}><TestingIcon kind="chart" size={28}/><span><strong>{t('Mở biểu đồ')}</strong><small>{t('Chọn mã và giao dịch qua MT5')}</small></span></button></nav>
    <section className="fx-dashboard-results" aria-label={t('Tài khoản MT5')} aria-busy={status==='loading'}>
      <div className="fx-dashboard-section-head"><h2>{t('Tài khoản MT5')}</h2><button type="button" className="fxa-button fxa-icon-button" aria-label={t('Làm mới terminal')} onClick={onRefresh}><TestingIcon kind="refresh"/></button></div>
      {account && <p className="mt5-account-heading"><strong>#{account.login}</strong><span>{account.server}</span><span className="live-badge">DEMO</span></p>}
      {reason && <div className="mt5-overview-state" role={status==='error'?'alert':'status'}><TestingIcon kind="info"/><span>{t(reason)}</span>{onResetSymbol && <button type="button" className="live-text-action" onClick={onResetSymbol}>{t('Tải lại danh sách mã')}</button>}{!account && <a href={`/?${accounts}`}>{t('Quản lý tài khoản')}</a>}</div>}
      <div className="fx-dashboard-performance mt5-account-metrics">
        <DashboardMetric title="Balance" value={money(account?.balance)} icon="account"/>
        <DashboardMetric title="Equity" value={money(account?.equity)} icon="chart"/>
        <DashboardMetric title="Margin" value={money(account?.margin)} icon="trades"/>
        <DashboardMetric title="Free margin" value={money(account?.margin_free)} icon="account"/>
      </div>
      <div className="mt5-overview-summary"><span>{t('Vị thế')} <strong>{account?snapshot.positions?.length: '—'}</strong></span><span>{t('Lệnh chờ')} <strong>{account?snapshot.orders?.length:'—'}</strong></span><a href={`/?${new URLSearchParams({workspace,view:'live',area:'live',section:'analytics'})}`}>{t('Phân tích giao dịch')}</a></div>
    </section>
    {setup && <Mt5ChartSetup snapshot={snapshot} status={status} reason={reason} symbol={symbol} timeframe={timeframe} onSelect={onSelect} onResetSymbol={onResetSymbol} onClose={()=>setSetup(false)} onOpen={()=>navigate(liveTradingHref(workspace,query,{chart:true,symbol,timeframe}))}/>}
  </section>
}
