import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { ReportLineChart, ReportBars } from './ReportChart.jsx'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useMemo, useState } from 'react'
import { averagePerformanceDays, closeTime, sessionPeriods } from './sessionPerformanceModel.js'
import PaginationFooter from './PaginationFooter.jsx'
import TestingIcon from './TestingIcon.jsx'
import { SessionChartLink } from './SessionDetails.jsx'
import MonthlyPerformance from './MonthlyPerformance.jsx'
import ReportInfo from './ReportInfo.jsx'



export function PeriodBars({ title, help, items, currency, period, horizontal = false, totalCount = items.length, emptyLabel = 'Chưa có dữ liệu giao dịch đóng.' }) {
  const { t } = useTestingLocale()
  return period === 'month' ? <MonthlyPerformance title={title} help={help} items={items} currency={currency} emptyLabel={emptyLabel} /> : <ReportBars title={totalCount > items.length ? `${t(title)} · ${items.length}/${totalCount}` : title} help={help} items={period === 'weekday' ? averagePerformanceDays(items) : items} averagePeriod={period === 'weekday' ? 'day' : undefined} currency={currency} period={period} horizontal={horizontal} emptyLabel={emptyLabel} />
}

export function Metric({ title, value, detail }) {
  const { t } = useTestingLocale()

  return <div className="fxs-metric"><span>{t(title)}{detail && <ReportInfo title={title} text={detail} />}</span><strong>{value}</strong></div>
}

export default function SessionPerformance({ model, payload, item, href, chartsOnly = false }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '-' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`
  const dashboardMoney = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { t, locale, fmt, timezone } = useTestingLocale()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5), sorting = useTableSort(()=>setPage(1))
  const timeBasis = model?.summaryPeriods?.time_basis || model?.result?.scope?.time_basis || 'activity'
  const tradeTime = trade => timeBasis === 'market' ? trade.close_time_utc : trade.report_time_utc
  const periods = useMemo(() => model?.summaryPeriods || sessionPeriods(model?.ledger || [], timezone, new Date(), timeBasis), [model?.ledger, model?.summaryPeriods, timezone, timeBasis])
  const equity = model?.summaryEquityCurve || model?.result?.equity_curve
  const performancePeriods = periods.performance || periods
  const equityPoints = (equity?.points || []).flatMap(point => { const date = closeTime(point.time_utc); return date && Number.isFinite(point.equity) ? [{ value: point.equity, time: date.getTime(), segment: point.segment }] : [] })
  const currency = model?.result?.account_currency
  const rows = useMemo(() => {
    return sorting.rows(model?.ledger || [],(trade,key)=>key === 'date' ? closeTime(tradeTime(trade))?.getTime() : key === 'symbol' ? trade.symbol : trade.pnl,[{key:'date',direction:'desc'}])
  }, [model?.ledger, timeBasis, sorting.sorts, locale])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * pageSize, current * pageSize)
  const limited = payload.partial || payload.stale || ['partial', 'stale'].includes(payload.freshness) || ['partial', 'stale'].includes(payload.provenance?.status) || payload.provenance?.freshness === 'stale'
  return <section className="fxs-performance" data-testid="session-performance">
    {limited && <p role="status">{payload.stale || payload.freshness === 'stale' || payload.provenance?.freshness === 'stale' || payload.provenance?.status === 'stale' ? t("Dữ liệu chưa cập nhật.") : t("Dữ liệu một phần.")}{t("Kết quả chỉ phản ánh phạm vi nguồn đã đọc.")}</p>}
    {rows.length || equityPoints.length || model?.summaryPeriods?.months?.length ? <div className="fxs-charts">
      <ReportLineChart title="Equity" currency={currency} points={equityPoints} emptyLabel={timeBasis === 'market' ? 'Chưa có lịch sử Equity của phiên.' : 'Chưa có lịch sử Equity theo thời gian thực.'} />
      <PeriodBars title="Hiệu suất trung bình theo tháng" help="Mỗi tháng trong năm hiển thị lãi và lỗ ròng trung bình của các tháng cùng tên có giao dịch đóng, sau phí. Không tính tháng không có giao dịch." period="month" items={performancePeriods.months} currency={currency} horizontal />
      <PeriodBars title="Hiệu suất trung bình theo ngày" help="Mỗi thứ hiển thị tổng PnL ròng chia số ngày có giao dịch đóng của thứ đó, sau phí. Ngày hòa vốn vẫn được tính; thứ chưa có mẫu hiển thị chưa có giao dịch." period="weekday" items={performancePeriods.weekdays} currency={currency} />
    </div> : <p className="fxs-no-analytics">{t("Chưa có phân tích giao dịch.")}</p>}
    {!chartsOnly && <><section className="fxs-metrics" aria-label={t("Chỉ số phiên")}>
      <Metric title="Total PnL" value={dashboardMoney(model?.netPnl, currency)} detail="Tổng PnL ròng sau phí của các giao dịch đã đóng trong phiên. Không gồm lãi/lỗ đang mở." />
      <Metric title="Win rate" value={dashboardNumber(model?.winRate, '%')} detail="Số giao dịch có lãi ròng sau phí chia tổng giao dịch đã đóng, gồm cả hòa vốn, nhân 100. Mỗi lần đóng một phần được tính riêng. Chưa có giao dịch thì chưa có tỷ lệ thắng." />
      <Metric title="Tỉ số lãi/lỗ trung bình" value={dashboardNumber(model?.payoffRatio)} detail="Lãi ròng trung bình của các lệnh thắng chia độ lớn lỗ ròng trung bình của các lệnh thua, sau phí. Cần cả lệnh thắng và lệnh thua; đây không phải RR dựa trên mức rủi ro ban đầu." />
      <Metric title="PnL TB/tháng" value={dashboardMoney(periods.averages?.month, currency)} detail={t("Tổng PnL ròng sau phí chia số tháng có giao dịch đóng trong toàn phiên. Tính riêng tháng của từng năm, gồm tháng hòa vốn; bỏ tháng không có giao dịch. Thiếu ngày đóng hoặc PnL thì chưa tính.") + `\n\n${timezone}`} />
      <Metric title="PnL TB/tuần" value={dashboardMoney(periods.averages?.week, currency)} detail={t("Tổng PnL ròng sau phí chia số tuần T2–CN có giao dịch đóng trong toàn phiên. Gồm tuần hòa vốn; bỏ tuần không có giao dịch. Thiếu ngày đóng hoặc PnL thì chưa tính.") + `\n\n${timezone}`} />
      <Metric title="PnL TB/ngày" value={dashboardMoney(periods.averages?.day, currency)} detail={t("Tổng PnL ròng sau phí chia số ngày có giao dịch đóng trong toàn phiên. Nhiều lệnh cùng ngày chỉ tính một ngày; gồm ngày hòa vốn, bỏ ngày không có giao dịch. Thiếu ngày đóng hoặc PnL thì chưa tính.") + `\n\n${timezone}`} />
    </section>
    <section className="fxs-recent"><div className="fxs-section-heading"><h2>{t("Recent Trades")}</h2>{href && <a className="fxr-button fxr-button-secondary fxs-journal" href={href('trade')}><TestingIcon kind="ledger" size={16} />{t("Journal")}</a>}</div>
      {rows.length ? <><DataTable className="fxs-table-scroll" label={t("Giao dịch gần đây")}><thead><tr><SortResetColumn active={sorting.sorts.length > 0} onClear={sorting.clear}/><th>{t("Session")}</th>{[['date','Ngày đóng lệnh'],['symbol','Symbol'],['pnl','Net PnL']].map(([key,label])=><SortableColumn key={key} className={key==='pnl'?'is-numeric':undefined} {...sorting.columnProps(key,t(label))}>{t(label)}</SortableColumn>)}</tr></thead><tbody>{visible.map((trade,index) => <tr key={trade.tradeId}><td className="wm-table-row-number">{(current-1)*pageSize+index+1}</td><td>{item.name || item.record_id}</td><td>{closeTime(tradeTime(trade)) ? displayDate(closeTime(tradeTime(trade)), { timeStyle: 'short' }) : '-'}</td><td>{trade.symbol || model.result?.instrument_id || '-'}</td><td className={`is-numeric ${trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}`}>{dashboardMoney(trade.pnl, currency)}</td></tr>)}</tbody></DataTable>
      <PaginationFooter totalCount={rows.length} label="Phân trang giao dịch" page={current} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} sizes={[5,10,20]} /></> : <div className="fxs-trades-empty" data-testid="session-trades-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 12h28v24H10ZM10 20h28M16 27h8m-8 5h16" /></svg><h3>{t("Chưa có giao dịch đóng")}</h3><p>{!model ? t("Mở chart để bắt đầu phiên luyện tập.") : t("Giao dịch đã đóng sẽ xuất hiện tại đây.")}</p>{!model?.result?.preview && !item.archived && item.dataset_available && <SessionChartLink href={href('replay', { select: null, surface: 'workspace' })} />}</div>}
    </section></>}
  </section>
}
