import { useLayoutEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { ReportBars } from './ReportChart.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function MonthlyPerformance({ title, items, currency, emptyLabel }) {
  const { t, fmt } = useTestingLocale()
  const [selection, setSelection] = useState('all')
  const controlsRef = useRef(null), focusYear = useRef(false)
  const years = [...new Set(items.map(item => item.label.slice(0, 4)))].sort()
  const selected = years.includes(selection) ? selection : years.length === 1 ? years[0] : 'all'
  const selectYear = value => { focusYear.current = true; setSelection(value) }
  useLayoutEffect(() => {
    if (focusYear.current) { controlsRef.current?.querySelector('button')?.focus({ preventScroll: true }); focusYear.current = false }
  }, [selected])
  const controls = years.length > 1 && <div ref={controlsRef}><FxSelect className="report-year-select" label={t('Năm hiệu suất')} value={selected} onChange={selectYear} options={[{ value: 'all', label: 'Tất cả các năm' }, ...years.map(year => ({ value: year, label: year }))]} /></div>
  const showMatrix = years.length > 1 && selected === 'all'
  if (!showMatrix) {
    const visible = selected === 'all' ? items : items.filter(item => item.label.startsWith(`${selected}-`))
    return <ReportBars title={title} items={visible} period="month" currency={currency} horizontal={visible.length <= 6} signed split controls={controls} emptyLabel={emptyLabel} />
  }
  const byMonth = new Map(items.map(item => [item.label, item]))
  const maximum = items.reduce((max, item) => Math.max(max, Math.abs(item.value)), 0)
  const amount = value => fmt(value, currency ? ` ${currency}` : '')
  const description = item => `${item.label}: ${t('Lãi')}: ${amount(item.profit)}; ${t('Lỗ')}: ${amount(item.loss)}; ${t('Net PnL')}: ${amount(item.value)}`
  return <section className="fxs-chart-panel report-chart report-month-overview">
    <div className="report-heading"><h3>{t(title)}</h3>{controls}</div>
    <div className="report-month-matrix" role="table" aria-label={t('Lãi/lỗ ròng theo tháng')}>
      <div role="row" className="report-month-row"><span role="columnheader" />{Array.from({ length: 12 }, (_, index) => <span role="columnheader" key={index}>{index + 1}</span>)}</div>
      {years.map(year => <div role="row" className="report-month-row" key={year}>
        <span role="rowheader"><button type="button" onClick={() => selectYear(year)} aria-label={`${t('Năm hiệu suất')} ${year}`}>{year}</button></span>
        {Array.from({ length: 12 }, (_, index) => {
          const key = `${year}-${String(index + 1).padStart(2, '0')}`, item = byMonth.get(key)
          const intensity = item && maximum ? 18 + Math.sqrt(Math.abs(item.value) / maximum) * 72 : 0
          const style = item?.value ? { backgroundColor: `color-mix(in srgb, var(--report-${item.value > 0 ? 'positive' : 'negative'}) ${intensity}%, var(--wm-surface))` } : undefined
          return <div role="cell" key={key}><button type="button" className={`report-month-cell${!item ? ' is-missing' : item.value === 0 ? ' is-flat' : ''}`} style={style} disabled={!item} data-tooltip={item ? description(item).replaceAll('; ', '\n') : `${key}: ${t('Chưa có giao dịch')}`} aria-label={item ? description(item) : `${key}: ${t('Chưa có giao dịch')}`} onClick={() => selectYear(year)}>{!item ? '—' : ''}</button></div>
        })}
      </div>)}
    </div>
    <div className="report-month-legend"><span>{t('Net PnL')}</span><span className="is-negative">{t('Lỗ')}</span><span className="is-positive">{t('Lãi')}</span></div>
  </section>
}
