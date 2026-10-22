import DashboardMetric from './DashboardMetric.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { liveTradingHref } from './liveTradingNavigation.js'
import { navigate } from './clientNavigation.js'

export default function LiveTradingOverview({ workspace, query, snapshot, status, reason, symbol, timeframe, onRefresh, onResetSymbol }) {
  const { t,fmt }=useTestingLocale()
  const account=snapshot?.account, currency=account?.currency
  const money=value=>Number.isFinite(value)?fmt(value,currency?` ${currency}`:''):t('Chưa có dữ liệu')
  return <section className="fx-dashboard mt5-overview" data-testid="mt5-overview" aria-label={t('Tổng quan giao dịch MT5')}>
    <h1 className="sr-only">{t('Tổng quan giao dịch MT5')}</h1>
    <nav className="fx-dashboard-quick-actions mt5-quick-actions" aria-label={t('Giao dịch MT5')}><button type="button" className="fx-dashboard-quick-action is-primary" onClick={()=>navigate(liveTradingHref(workspace,query,{chart:true,symbol,timeframe}))}><TestingIcon kind="chart" size={28}/><span><strong>{t('Mở biểu đồ')}</strong></span></button></nav>
    <section className="fx-dashboard-results" aria-label={t('Performance')} aria-busy={status==='loading'}>
      <div className="fx-dashboard-section-head"><div className="wm-resource-heading"><h2 className="fx-dashboard-performance-heading">{t('Performance')}</h2></div></div>
      {status==='loading' && !account ? <TestingSkeleton label="Đang tải Performance…"/> : <>
      {reason && <TestingReadState message={reason} error={status==='error'} onRetry={onResetSymbol || (status==='error' ? onRefresh : undefined)}/>}
      {account && <div className="fx-dashboard-performance-layout has-no-trades"><div className="fx-dashboard-performance">
        <DashboardMetric title="Balance" value={money(account?.balance)} icon="account"/>
        <DashboardMetric title="Equity" value={money(account?.equity)} icon="chart"/>
        <DashboardMetric title="Margin" value={money(account?.margin)} icon="trades"/>
        <DashboardMetric title="Free margin" value={money(account?.margin_free)} icon="account"/>
      </div></div>}
      </>}
    </section>
  </section>
}
