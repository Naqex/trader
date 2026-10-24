import { ReportBars } from './ReportChart.jsx'
import Metric from './DashboardMetric.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { TestingResourceStatus } from './TestingPageState.jsx'
import { previewReadRecovery } from './demoMode.js'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import useReadRefresh from './useReadRefresh.js'
import { dashboardDurationParts, dashboardFilterError, readDashboardOverview } from './dashboardModel.js'

function Duration({ seconds }) {
  const { t, locale } = useTestingLocale()
  const parts = dashboardDurationParts(seconds)
  return parts ? <span className="fx-dashboard-duration">{parts.map(([value, unit]) => <span key={unit}><span>{value.toLocaleString(locale)}</span><small>{t(`duration.${unit}`)}</small></span>)}</span> : '—'
}

function timingDetail(performance, kind, t) {
  const scope = performance?.timing_scope
  if (!scope) return t('Thời gian đã ghi nhận')
  const measured = scope[`${kind}_measured_session_count`], unknown = scope[`unknown_${kind}_session_count`]
  return unknown > 0 ? t('{measured}/{total} phiên được ghi nhận', { measured, total: measured + unknown }) : t('Từ khi bật theo dõi · toàn phiên')
}

function SideSplit({ counts, total }) {
  const { t, locale } = useTestingLocale()
  const buy = counts?.buy, sell = counts?.sell
  if (!Number.isSafeInteger(buy) || !Number.isSafeInteger(sell) || buy < 0 || sell < 0 || !Number.isSafeInteger(total) || total <= 0 || buy + sell !== total) return null
  const buyRate = buy / total * 100, sellRate = sell / total * 100
  const percent = value => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + '%'
  return <div className="fx-dashboard-side-split">
    <div className="fx-dashboard-side-bar" aria-hidden="true"><span className="is-buy" style={{ width: `${buyRate}%` }} /><span className="is-sell" style={{ width: `${sellRate}%` }} /></div>
    <small><span className="is-buy">{percent(buyRate)} {t('Buy')}</span><span aria-hidden="true"> · </span><span className="is-sell">{percent(sellRate)} {t('Sell')}</span></small>
  </div>
}

function MonthlyChart({ title, items, field, rate = false, accent = 'gold' }) {
  const { fmt } = useTestingLocale()
  return <ReportBars title={title} items={items.filter(item => typeof item[field] === 'number' && item[field] >= 0).map(item => ({ label: `${item.month.slice(5)}/${item.month.slice(0,4)}`, value: item[field] }))} accent={accent} maximum={rate ? 100 : undefined} valueFormat={value => rate ? fmt(value, '%', 0) : fmt(value)} />
}
function SymbolChart({ items }) {
  return <ReportBars title="Trades by symbol" items={items.map(item => ({ label: item.symbol, value: item.closed_trade_count }))} horizontal accent="pink" />
}
function ActivityChart({ items }) {
  const { t, fmt } = useTestingLocale()
  return <ReportBars title={t('Thời gian luyện tập theo tháng')} items={items.map(item => ({ label: `${item.month.slice(5)}/${item.month.slice(0,4)}`, value: item.time_invested_seconds / 3600 }))} accent="gold" valueFormat={value => `${fmt(value, '', 1)} ${t('duration.hour')}`} emptyLabel="Chưa có dữ liệu thời gian luyện tập" />
}

export default function DashboardPerformance({ workspace, filters, reload, controls, dateControls, sourceHeading, previewPayload, previewState }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale, timezone } = useTestingLocale()

  const [retry, setRetry] = useState(0)
  const [state, setState] = useState({ status: 'loading', payload: null, error: '', key: '' })
  const key = JSON.stringify([workspace, filters.session, filters.from, filters.to, timezone])
  const filterError = dashboardFilterError(filters)
  const recovery = useReadRefresh(() => setRetry(value => value + 1), !previewPayload && !filterError, { workspace, resources: ['sessions'], scopeKey: key, error: state.key === key ? state.readError : null, pending: state.key !== key || state.status === 'loading' || state.pending })
  useEffect(() => {
    if (filterError) return
    if (previewPayload) { setState({ status: previewState === 'error' ? 'error' : previewState === 'stale' ? 'stale' : 'ready', refreshing: previewState === 'refreshing', payload: previewState === 'error' ? null : previewPayload, error: '', key }); return }
    const controller = new AbortController()
    setState(current => current.key === key && (current.payload || current.readError) ? { ...current, pending: true, refreshing: Boolean(current.payload) } : { status: 'loading', payload: null, error: '', pending: true, key })
    readDashboardOverview(workspace, filters, controller.signal).then(payload => {
      if (!controller.signal.aborted) setState({ status: 'ready', payload, error: '', pending: false, readError: null, key })
    }).catch(error => {
      if (!controller.signal.aborted) setState(current => current.key === key && current.payload && ![401, 403].includes(error.status) ? { ...current, status: 'stale', refreshing: false, pending: false, error: error.message, readError: error } : { status: 'error', payload: null, pending: false, error: error.message, readError: error, httpStatus: error.status, key })
    })
    return () => controller.abort()
  }, [key, reload, retry, filterError, previewPayload, previewState])
  // Hide results immediately when scope changes, before its request completes.
  const performance = !filterError && state.key === key ? state.payload?.performance : null
  const metrics = performance?.metrics
  const loading = !filterError && (state.key !== key || state.status === 'loading')
  const partial = performance?.status === 'partial'
  const blocked = performance?.status === 'blocked' || performance?.scope?.readable_session_count === 0 && performance?.scope?.session_count > 0
  const partialNotice = partial && !blocked ? t("Performance chỉ tổng hợp {readable}/{total} phiên có dữ liệu.", { readable: performance.scope.readable_session_count, total: performance.scope.session_count }) : ''
  const failed = !loading && state.key === key && state.status === 'error'
  const denied = failed && [401, 403].includes(state.httpStatus)
  const unavailable = failed && state.error === 'dashboard_performance_unavailable'
  const noSessions = performance?.scope?.session_count === 0
  const noTrades = !blocked && !noSessions && metrics?.closed_trade_count === 0
  const groupMessage = filterError || (denied ? 'Bạn không có quyền xem Performance.' : unavailable ? 'Nguồn Performance chưa khả dụng.' : failed ? 'Chưa tải được Performance.' : blocked ? 'Chưa đủ dữ liệu thực thi để tính Performance.' : noSessions ? 'Chưa có phiên backtest trong phạm vi này. Tạo phiên đầu tiên để xem kết quả.' : '')
  const readStatus = state.key === key && state.status === 'stale' ? 'stale' : state.key === key && state.refreshing ? 'refreshing' : partialNotice ? 'partial' : undefined
  const groupState = filterError ? 'invalid' : loading ? 'loading' : denied ? 'denied' : unavailable || blocked ? 'unavailable' : failed ? 'error' : noSessions ? 'empty' : noTrades ? 'no-trades' : 'ready'
  return <section className="fx-dashboard-results" aria-label={t("Performance")} aria-busy={loading || (!filterError && state.key === key && Boolean(state.refreshing))} aria-description={partialNotice || undefined}>
    <div className="fx-dashboard-section-head"><div className="wm-resource-heading"><h2 className="fx-dashboard-performance-heading">{t("Performance")}</h2><TestingResourceStatus state={!groupMessage ? readStatus : undefined} resource="Performance" detail={readStatus === 'partial' ? partialNotice : undefined} recovery={previewPayload ? previewReadRecovery(previewState) : recovery} /></div><div className="fx-dashboard-performance-filters">{controls}{dateControls}</div></div>
    {sourceHeading && <h3 className="fx-dashboard-source-heading">{sourceHeading}</h3>}
    <div data-testid="dashboard-result-group" data-state={groupState}>
    {loading ? <TestingSkeleton label="Đang tải Performance…" /> : groupMessage ? <TestingReadState message={groupMessage} error={Boolean(filterError || failed)} recovery={!previewPayload && failed && !denied ? recovery : undefined} /> : <><div className={`fx-dashboard-performance-layout${noTrades ? ' has-no-trades' : ''}`} data-testid="dashboard-performance"><div className="fx-dashboard-performance">
      <Metric title={t("Time invested")} value={<Duration seconds={performance?.time_invested_seconds} />} tooltip={dashboardDurationParts(performance?.time_invested_seconds) ? previewPayload ? t("Thời gian luyện tập mẫu") : timingDetail(performance, 'practice', t) : t("Chưa có dữ liệu thời gian luyện tập")} icon="clock" />
      <Metric title={t("Historical time replayed")} value={<Duration seconds={performance?.historical_time_replayed_seconds} />} tooltip={dashboardDurationParts(performance?.historical_time_replayed_seconds) ? previewPayload ? t("Thời gian replay mẫu") : timingDetail(performance, 'historical', t) : t("Chưa có dữ liệu thời gian replay")} icon="history" />
      <Metric title={t("Trades taken")} value={dashboardNumber(metrics?.closed_trade_count)} icon="trades">
        <SideSplit counts={performance?.side_counts} total={metrics?.closed_trade_count} />
      </Metric>
      <Metric title={t("Overall win rate")} value={dashboardNumber(metrics?.win_rate_pct, '%')} icon="target" />
    </div><ActivityChart items={performance?.activity_months || []} /></div>
    {noTrades ? <TestingReadState message={filters.from || filters.to ? 'Không có giao dịch đóng trong khoảng ngày đã chọn. Đổi khoảng ngày để xem kết quả.' : 'Chưa có giao dịch đóng. Biểu đồ sẽ xuất hiện sau giao dịch đầu tiên.'} /> : <div className="fx-dashboard-secondary-charts"><MonthlyChart title={t("Win rate by month")} items={performance?.months || []} field="win_rate_pct" rate accent="blue" /><SymbolChart items={performance?.symbols || []} /></div>}</>}
    </div>
  </section>
}
