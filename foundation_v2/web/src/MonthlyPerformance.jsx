import { ReportBars } from './ReportChart.jsx'
import { groupPerformanceMonths } from './sessionPerformanceModel.js'

export default function MonthlyPerformance({ title, items, currency, emptyLabel }) {
  const years = [...new Set(items.map(item => item.label.slice(0, 4)))].sort()
  const merged = years.length > 1
  return <ReportBars title={title} items={merged ? groupPerformanceMonths(items) : items} period={merged ? 'month-of-year' : 'month'} scopeLabel={merged ? `${years[0]}–${years.at(-1)}` : undefined} currency={currency} horizontal signed split emptyLabel={emptyLabel} />
}
