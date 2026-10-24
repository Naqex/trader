import { ReportLineChart } from './ReportChart.jsx'
import { useState } from 'react'
import { displayDate } from './dateFormat.js'
import { dealNet } from './liveWorkspaceModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import { Metric, PeriodBars } from './SessionPerformance.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import './session-performance.css'

function PnlCurve({ series, currency }) {
  return <ReportLineChart title="Cumulative deal PnL" points={series} currency={currency} />
}

export default function LiveOverviewReport({ performance, tradesHref }) {
  const { t,fmt }=useTestingLocale(), [page,setPage]=useState(1), [size,setSize]=useState(5)
  const money=value=>fmt(value,performance.currency?` ${performance.currency}`:'')
  const pages=Math.max(1,Math.ceil(performance.deals.length/size)), current=Math.min(page,pages)
  const rows=performance.deals.slice((current-1)*size,current*size)
  return <section className="fxs-performance mt5-report" aria-label={t('Kết quả giao dịch')}>
    <div className="fxs-scope"><h2>{t('Kết quả giao dịch')}</h2><span>{displayDate(performance.from)} – {displayDate(performance.to)}</span></div>
    {performance.stale&&<p role="status">{t('Dữ liệu trước đó · đang mất kết nối')}</p>}
    {!performance.chartComplete&&<p role="status">{t('Chưa đủ thời gian hoặc phí để vẽ biểu đồ PnL.')}</p>}
    <div className="fxs-charts"><PnlCurve series={performance.series} currency={performance.currency}/><PeriodBars title="Hiệu suất theo tháng" period="month" items={performance.performance?.months || performance.months} currency={performance.currency} horizontal emptyLabel="Chưa có dữ liệu để vẽ biểu đồ."/><PeriodBars title="Hiệu suất theo ngày" period="weekday" items={performance.performance?.weekdays || performance.weekdays} currency={performance.currency} emptyLabel="Chưa có dữ liệu để vẽ biểu đồ."/></div>
    <div className="fxs-metrics mt5-report-metrics">
      <Metric title="P/L ròng đã đồng bộ" value={money(performance.net)}/><Metric title="P/L trước phí" value={money(performance.gross)}/><Metric title="Hoa hồng, swap và phí" value={money(performance.costs)}/><Metric title="Lượt khớp lệnh" value={fmt(performance.count,'',0)}/>
    </div>
    <section className="fxs-recent"><div className="fxs-section-heading"><h2>{t('Khớp lệnh gần đây')}</h2><a className="fxr-button fxr-button-secondary" href={tradesHref}>{t('Trades')}</a></div>
      {rows.length?<><div className="fxs-table-scroll" role="region" aria-label={t('Khớp lệnh gần đây')} tabIndex={0}><table><thead><tr><th>{t('Ngày khớp lệnh')}</th><th>{t('Symbol')}</th><th>{t('Side')}</th><th>{t('Khối lượng (lot)')}</th><th>{t('Net PnL')}</th></tr></thead><tbody>{rows.map((deal,index)=><tr key={deal.ticket??index}><td>{displayDate(deal.time_msc,{timeStyle:'short'})}</td><td>{deal.symbol||'—'}</td><td>{t(deal.type===0?'Buy':'Sell')}</td><td>{fmt(deal.volume,'',2)}</td><td className={dealNet(deal)>0?'is-positive':dealNet(deal)<0?'is-negative':''}>{money(dealNet(deal))}</td></tr>)}</tbody></table></div><PaginationFooter label="Phân trang giao dịch" page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value=>{setSize(value);setPage(1)}} sizes={[5,10,20]}/></>:<div className="fxs-trades-empty"><h3>{t('Chưa có lượt khớp trong khoảng đã đồng bộ.')}</h3></div>}
    </section>
  </section>
}
