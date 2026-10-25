import { compareTableValues, nextTableSort } from './tableModel.js'
import DataTable, { SortableColumn } from './DataTable.jsx'
import { ReportLineChart, ReportBars } from './ReportChart.jsx'
import { displayDate } from './dateFormat.js'
import { zonedDateKey } from './timezone.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useMemo, useState } from 'react'
import { averagePerformanceDays, closeTime, sessionPeriods } from './sessionPerformanceModel.js'
import PaginationFooter from './PaginationFooter.jsx'
import TestingIcon from './TestingIcon.jsx'
import { SessionChartLink } from './SessionDetails.jsx'
import MonthlyPerformance from './MonthlyPerformance.jsx'



export function PeriodBars({ title, items, currency, period, horizontal = false, totalCount = items.length, emptyLabel = 'Chưa có dữ liệu giao dịch đóng.' }) {
  const { t } = useTestingLocale()
  return period === 'month' ? <MonthlyPerformance title={title} items={items} currency={currency} emptyLabel={emptyLabel} /> : <ReportBars title={totalCount > items.length ? `${t(title)} · ${items.length}/${totalCount}` : title} items={period === 'weekday' ? averagePerformanceDays(items) : items} averagePeriod={period === 'weekday' ? 'day' : undefined} currency={currency} period={period} horizontal={horizontal} emptyLabel={emptyLabel} />
}

export function Metric({ title, value, detail }) {
  const { t } = useTestingLocale()

  return <div className="fxs-metric"><span data-tooltip={detail}>{t(title)}</span><strong>{value}</strong></div>
}

export default function SessionPerformance({ model, payload, item, href, chartsOnly = false }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`
  const dashboardMoney = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { t, locale, fmt, timezone } = useTestingLocale()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5), [sort,setSort] = useState({key:'date',direction:'desc'})
  const timeBasis = model?.summaryPeriods?.time_basis || model?.result?.scope?.time_basis || 'activity'
  const tradeTime = trade => timeBasis === 'market' ? trade.close_time_utc : trade.report_time_utc
  const periods = useMemo(() => model?.summaryPeriods || sessionPeriods(model?.ledger || [], timezone, new Date(), timeBasis), [model?.ledger, model?.summaryPeriods, timezone, timeBasis])
  const equity = model?.summaryEquityCurve || model?.result?.equity_curve
  const performancePeriods = periods.performance || periods
  const equityPoints = (equity?.points || []).flatMap(point => { const date = closeTime(point.time_utc); return date && Number.isFinite(point.equity) ? [{ value: point.equity, time: date.getTime(), segment: point.segment }] : [] })
  const currency = model?.result?.account_currency
  const rows = useMemo(() => { const value = trade => sort.key === 'date' ? closeTime(tradeTime(trade))?.getTime() : sort.key === 'symbol' ? trade.symbol : trade.pnl; return [...(model?.ledger || [])].sort((a,b)=>compareTableValues(value(a),value(b),sort.direction,locale)||a.rowIndex-b.rowIndex) }, [model?.ledger,timeBasis,sort,locale])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * pageSize, current * pageSize)
  const anchor = periods.anchor ? zonedDateKey(periods.anchor) : ''
  const limited = payload.partial || payload.stale || ['partial', 'stale'].includes(payload.freshness) || ['partial', 'stale'].includes(payload.provenance?.status) || payload.provenance?.freshness === 'stale'
  return <section className="fxs-performance" data-testid="session-performance">
    {limited && <p role="status">{payload.stale || payload.freshness === 'stale' || payload.provenance?.freshness === 'stale' || payload.provenance?.status === 'stale' ? t("Dữ liệu chưa cập nhật.") : t("Dữ liệu một phần.")}{t("Kết quả chỉ phản ánh phạm vi nguồn đã đọc.")}</p>}
    {rows.length || equityPoints.length || model?.summaryPeriods?.months?.length ? <div className="fxs-charts">
      <ReportLineChart title="Equity" currency={currency} points={equityPoints} emptyLabel={timeBasis === 'market' ? 'Chưa có lịch sử Equity của phiên.' : 'Chưa có lịch sử Equity theo thời gian thực.'} />
      <PeriodBars title="Hiệu suất trung bình theo tháng" period="month" items={performancePeriods.months} currency={currency} horizontal />
      <PeriodBars title="Hiệu suất trung bình theo ngày" period="weekday" items={performancePeriods.weekdays} currency={currency} />
    </div> : <p className="fxs-no-analytics">{t("Chưa có phân tích giao dịch.")}</p>}
    {periods.incomplete && <p role="status">{t("Một số giao dịch cũ chưa có thời gian ghi nhận.")}</p>}
    {!chartsOnly && <><section className="fxs-metrics" aria-label={t("Chỉ số phiên")}>
      <Metric title={t("Total PnL")} value={dashboardMoney(model?.netPnl, currency)} detail={t("Net · giao dịch đóng")} />
      <Metric title={t("Win rate")} value={dashboardNumber(model?.winRate, '%')} detail={t('{wins} thắng · {losses} thua', { wins: dashboardNumber(model?.wins), losses: dashboardNumber(model?.losses) })} />
      <Metric title={t("Tỉ số lãi/lỗ trung bình")} value={dashboardNumber(model?.payoffRatio)} detail={t("Lãi trung bình / độ lớn lỗ trung bình · chưa biết nếu thiếu nguồn")} />
      <Metric title={t("Lãi/Lỗ tháng")} value={dashboardMoney(periods.month, currency)} detail={anchor ? `${anchor.slice(0, 7)} · ${timezone}` : t("Chưa có ngày đóng")} />
      <Metric title={t("Lãi/Lỗ tuần")} value={dashboardMoney(periods.week, currency)} detail={anchor ? `${t('Tuần T2–CN chứa {date}', { date: displayDate(anchor) })} · ${timezone}` : t("Chưa có ngày đóng")} />
      <Metric title={t("Lãi/Lỗ ngày")} value={dashboardMoney(periods.day, currency)} detail={anchor ? `${displayDate(anchor)} · ${timezone}` : t("Chưa có ngày đóng")} />
    </section>
    <section className="fxs-recent"><div className="fxs-section-heading"><h2>{t("Recent Trades")}</h2>{href && <a className="fxr-button fxr-button-secondary fxs-journal" href={href('trade')}><TestingIcon kind="ledger" size={16} />{t("Journal")}</a>}</div>
      {rows.length ? <><DataTable className="fxs-table-scroll" label={t("Giao dịch gần đây")}><thead><tr><th>{t("Session")}</th>{[['date','Ngày đóng lệnh'],['symbol','Symbol'],['pnl','Net PnL']].map(([key,label])=><SortableColumn key={key} className={key==='pnl'?'is-numeric':undefined} active={sort.key===key} direction={sort.direction} onSort={()=>{setSort(nextTableSort(sort,key));setPage(1)}}>{t(label)}</SortableColumn>)}</tr></thead><tbody>{visible.map(trade => <tr key={trade.tradeId}><td>{item.name || item.record_id}</td><td>{closeTime(tradeTime(trade)) ? displayDate(closeTime(tradeTime(trade)), { timeStyle: 'short' }) : '—'}</td><td>{trade.symbol || model.result?.instrument_id || '—'}</td><td className={`is-numeric ${trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}`}>{dashboardMoney(trade.pnl, currency)}</td></tr>)}</tbody></DataTable>
      <PaginationFooter totalCount={rows.length} label="Phân trang giao dịch" page={current} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} sizes={[5,10,20]} /></> : <div className="fxs-trades-empty" data-testid="session-trades-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 12h28v24H10ZM10 20h28M16 27h8m-8 5h16" /></svg><h3>{t("Chưa có giao dịch đóng")}</h3><p>{!model ? t("Mở chart để bắt đầu phiên luyện tập.") : t("Giao dịch đã đóng sẽ xuất hiện tại đây.")}</p>{!model?.result?.preview && !item.archived && item.dataset_available && <SessionChartLink href={href('replay', { select: null, surface: 'workspace' })} />}</div>}
    </section></>}
  </section>
}
