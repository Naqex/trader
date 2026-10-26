import { ReportBars } from './ReportChart.jsx'
import Metric from './DashboardMetric.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { TestingResourceStatus } from './TestingPageState.jsx'
import { previewReadRecovery } from './demoMode.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import useReadRefresh from './useReadRefresh.js'
import { dashboardDurationParts, dashboardFilterError, readDashboardOverview } from './dashboardModel.js'

function Duration({ seconds }) {
  const { t, locale } = useTestingLocale()
  const parts = dashboardDurationParts(seconds)
  return parts ? <span className="fx-dashboard-duration">{parts.map(([value, unit]) => <span key={unit}><span>{value.toLocaleString(locale)}</span><small>{t(`duration.${unit}`)}</small></span>)}</span> : '-'
}

function timingDetail(performance, kind, t) {
  const scope = performance?.timing_scope
  const clock = t(kind === 'practice' ? 'Thời gian thao tác thực tế trong WMReplay' : 'Tổng thời gian thị trường đã chạy qua trong các bước replay thành công; không phải thời gian bạn ngồi luyện tập.')
  if (!scope) return clock
  const measured = scope[`${kind}_measured_session_count`], unknown = scope[`unknown_${kind}_session_count`]
  const coverage = unknown > 0 ? t('{measured}/{total} phiên được ghi nhận', { measured, total: measured + unknown }) : ''
  const range = t(scope.from_utc || scope.to_utc ? 'Trong khoảng thời gian đã chọn' : 'Từ khi bật theo dõi · toàn phiên')
  const missing = kind === 'historical' && performance?.historical_time_replayed_seconds == null ? t('Chưa đủ dữ liệu thời gian để tính cho kỳ này. Các bước replay mới được ghi nhận theo ngày thao tác; dữ liệu cũ không được tự gán ngày.') : ''
  return [clock, range, coverage, missing].filter(Boolean).join('\n\n')
}

const closedHelp = 'Số lần khớp đóng giao dịch trong phạm vi đã chọn. Mỗi lần đóng một phần được tính riêng; lệnh đang mở chưa được tính. Buy/Sell dùng cùng tập giao dịch đã đóng. Lịch sử thừa kế khi tạo nhánh chỉ được tính một lần.'
const winHelp = 'Số giao dịch có lãi ròng sau phí chia tổng giao dịch đã đóng, gồm cả hòa vốn, nhân 100. Mỗi lần đóng một phần được tính riêng. Chưa có giao dịch thì chưa có tỷ lệ thắng.'

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

function WinRateChart({ items, period, unknownCount = 0 }) {
  const { t, locale } = useTestingLocale()
  const daily = period === 'day'
  const help = [t(daily ? 'Tỷ lệ thắng theo ngày thao tác thực tế trong múi giờ đã chọn. Mỗi ngày: số giao dịch lãi ròng sau phí chia tổng giao dịch đã đóng, gồm cả hòa vốn, nhân 100.' : 'Tỷ lệ thắng theo tháng thao tác thực tế trong múi giờ đã chọn. Mỗi tháng: số giao dịch lãi ròng sau phí chia tổng giao dịch đã đóng, gồm cả hòa vốn, nhân 100.'), unknownCount > 0 ? t('Có {count} giao dịch thiếu ngày ghi nhận nên chưa được phân bổ vào biểu đồ.', { count: unknownCount }) : ''].filter(Boolean).join('\n\n')
  return <ReportBars title="Win rate" help={help} period={period} items={items.filter(item => Number.isFinite(item.win_rate_pct) && item.win_rate_pct >= 0).map(item => ({ label: daily ? item.date : item.month, value: item.win_rate_pct }))} accent="blue" maximum={100} valueFormat={value => `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`} emptyLabel={unknownCount > 0 ? daily ? 'Chưa đủ dữ liệu thời gian để thống kê theo ngày' : 'Chưa đủ dữ liệu thời gian để thống kê theo tháng' : 'Chưa có dữ liệu để vẽ biểu đồ.'} />
}
function SymbolChart({ items }) {
  return <ReportBars title="Trades by symbol" help="Số giao dịch đã đóng theo từng mã trong phạm vi đã chọn. Mỗi lần đóng một phần được tính riêng; lịch sử thừa kế chỉ được tính một lần." items={items.map(item => ({ label: item.symbol, value: item.closed_trade_count }))} horizontal accent="pink" integer />
}
function ActivityChart({ items, period }) {
  const { t, fmt, locale } = useTestingLocale()
  return <ReportBars title={t('Time invested')} help={period === 'day' ? 'Thời gian luyện tập thực tế theo ngày trong múi giờ và kỳ đã chọn. Các khoảng thao tác trùng nhau giữa các phiên chỉ được tính một lần; trục dọc dùng đơn vị giờ.' : 'Thời gian luyện tập thực tế theo tháng trong múi giờ và kỳ đã chọn. Các khoảng thao tác trùng nhau giữa các phiên chỉ được tính một lần; trục dọc dùng đơn vị giờ.'} period={period} items={items.map(item => ({ label: period === 'day' ? item.date : item.month, value: item.time_invested_seconds / 3600 }))} accent="gold" valueFormat={(value, compact, digits = 2) => compact ? `${Math.abs(value) >= 1000 ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value) : fmt(value, '', digits)} ${t('duration.hour')}` : dashboardDurationParts(value * 3600, { days: false })?.map(([count, unit]) => `${count.toLocaleString(locale)} ${t(`duration.${unit}`)}`).join(' ') || '-'} emptyLabel="Chưa có dữ liệu thời gian luyện tập" />
}

export default function DashboardPerformance({ workspace, filters, reload, controls, dateControls, sourceHeading, previewPayload, previewState }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '-' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale, timezone } = useTestingLocale()

  const [retry, setRetry] = useState(0)
  const [state, setState] = useState({ status: 'loading', payload: null, error: '', key: '' })
  const key = JSON.stringify([workspace, filters.source, filters.session, filters.from, filters.to, timezone])
  const filterError = dashboardFilterError(filters)
  const recovery = useReadRefresh(() => setRetry(value => value + 1), !previewPayload && !filterError, { workspace, resources: ['sessions', 'prop'], scopeKey: key, error: state.key === key ? state.readError : null, pending: state.key !== key || state.status === 'loading' || state.pending })
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
  const chartPeriod = performance?.chart_period === 'day' ? 'day' : 'month'
  const loading = !filterError && (state.key !== key || state.status === 'loading')
  const partial = performance?.status === 'partial'
  const blocked = performance?.status === 'blocked' || performance?.scope?.readable_session_count === 0 && performance?.scope?.session_count > 0
  const partialNotice = partial && !blocked ? t("Performance chỉ tổng hợp {readable}/{total} phiên có dữ liệu.", { readable: performance.scope.readable_session_count, total: performance.scope.session_count }) : ''
  const failed = !loading && state.key === key && state.status === 'error'
  const denied = failed && [401, 403].includes(state.httpStatus)
  const unavailable = failed && state.error === 'dashboard_performance_unavailable'
  const noSessions = performance?.scope?.session_count === 0
  const noTrades = !blocked && !noSessions && metrics?.closed_trade_count === 0
  const groupMessage = filterError || (denied ? 'Bạn không có quyền xem Performance.' : unavailable ? 'Nguồn Performance chưa khả dụng.' : failed ? 'Chưa tải được Performance.' : blocked ? 'Chưa đủ dữ liệu thực thi để tính Performance.' : noSessions ? 'Chưa có phiên trong phạm vi này.' : '')
  const readStatus = state.key === key && state.status === 'stale' ? 'stale' : state.key === key && state.refreshing ? 'refreshing' : partialNotice ? 'partial' : undefined
  const groupState = filterError ? 'invalid' : loading ? 'loading' : denied ? 'denied' : unavailable || blocked ? 'unavailable' : failed ? 'error' : noSessions ? 'empty' : noTrades ? 'no-trades' : 'ready'
  return <section className="fx-dashboard-results" aria-label={t("Performance")} aria-busy={loading || (!filterError && state.key === key && Boolean(state.refreshing))} aria-description={partialNotice || undefined}>
    <div className="fx-dashboard-section-head"><div className="wm-resource-heading"><h2 className="fx-dashboard-performance-heading">{t("Performance")}</h2><TestingResourceStatus state={!groupMessage ? readStatus : undefined} resource="Performance" detail={readStatus === 'partial' ? partialNotice : undefined} recovery={previewPayload ? previewReadRecovery(previewState) : recovery} /></div><div className="fx-dashboard-performance-filters">{controls}{dateControls}</div></div>
    {sourceHeading && <h3 className="fx-dashboard-source-heading">{sourceHeading}</h3>}
    <div data-testid="dashboard-result-group" data-state={groupState}>
    {loading ? <TestingSkeleton label="Đang tải Performance…" /> : groupMessage ? <TestingReadState message={groupMessage} error={Boolean(filterError || failed)} recovery={!previewPayload && failed && !denied ? recovery : undefined} /> : <><div className={`fx-dashboard-performance-layout${noTrades ? ' has-no-trades' : ''}`} data-testid="dashboard-performance"><div className="fx-dashboard-performance">
      <Metric title={t("Time invested")} value={<Duration seconds={performance?.time_invested_seconds} />} tooltip={[timingDetail(performance, 'practice', t), performance?.time_invested_seconds == null ? t("Chưa có dữ liệu thời gian luyện tập") : ''].filter(Boolean).join('\n\n')} icon="clock" />
      <Metric title={t("Historical time replayed")} value={<Duration seconds={performance?.historical_time_replayed_seconds} />} tooltip={timingDetail(performance, 'historical', t)} icon="history" />
      <Metric title="Giao dịch đã đóng" value={dashboardNumber(metrics?.closed_trade_count)} tooltip={t(closedHelp)}>
        <SideSplit counts={performance?.side_counts} total={metrics?.closed_trade_count} />
      </Metric>
      <Metric title={t("Overall win rate")} value={dashboardNumber(metrics?.win_rate_pct, '%')} tooltip={t(winHelp)} icon="target" />
    </div><ActivityChart period={chartPeriod} items={(chartPeriod === 'day' ? performance?.activity_days : performance?.activity_months) || []} /></div>
    {noTrades ? <TestingReadState message={filters.from || filters.to ? 'Không có giao dịch đóng trong khoảng ngày đã chọn. Đổi khoảng ngày để xem kết quả.' : 'Chưa có giao dịch đóng. Biểu đồ sẽ xuất hiện sau giao dịch đầu tiên.'} /> : <div className="fx-dashboard-secondary-charts"><WinRateChart period={chartPeriod} items={(chartPeriod === 'day' ? performance?.days : performance?.months) || []} unknownCount={performance?.scope?.recording_coverage?.unknown_close_count || 0} /><SymbolChart items={performance?.symbols || []} /></div>}</>}
    </div>
  </section>
}
