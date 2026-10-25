import { ReportBars } from './ReportChart.jsx'
import { averagePerformanceMonths } from './sessionPerformanceModel.js'

export default function MonthlyPerformance({ title, items, currency, emptyLabel }) {
  return <ReportBars title={title} items={averagePerformanceMonths(items)} period="month-of-year" averagePeriod="month" currency={currency} horizontal signed split emptyLabel={emptyLabel} />
}
