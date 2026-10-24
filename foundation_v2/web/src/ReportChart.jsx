import { useId, useLayoutEffect, useRef, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { currencyLabel } from './moneyFormat.js'
import './report-chart.css'

const W = 560, H = 250, left = 88, top = 24, bottom = 208
const finite = value => typeof value === 'number' && Number.isFinite(value)
function axisLabels(ticks, fmt, locale) {
  const full = ticks.map(value => fmt(value, '', 2))
  const compact = ticks.map(value => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value))
  // Close balances must keep their visible differences, even at large magnitudes.
  const labels = full.some(label => label.length > 10) && new Set(compact).size === new Set(full).size ? compact : full
  return new Map(ticks.map((value, index) => [value, labels[index]]))
}
function usePlotWidth(hasData) {
  const ref = useRef(null), [width, setWidth] = useState(W)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasData])
  return [ref, width]
}
export function chartDomain(values, { zero = true, maximum } = {}) {
  let low = Math.min(...values, ...(zero ? [0] : [])), high = maximum ?? Math.max(...values, ...(zero ? [0] : []))
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  if (high === low) { const pad = Math.max(Math.abs(high) * .0001, 1); low -= zero && low === 0 ? 0 : pad; high += pad }
  return { low, high, ticks: Array.from({ length: maximum === 100 ? 6 : 5 }, (_, index) => low + (high - low) * index / (maximum === 100 ? 5 : 4)) }
}
function Unit({ currency }) { return currency ? <text className="report-unit" x={left - 12} y="12" textAnchor="end">{currencyLabel(currency)}</text> : null }
export function ReportLineChart({ title, points, currency, emptyLabel = 'Chưa có dữ liệu để vẽ biểu đồ.', area = true }) {
  const { t, fmt, locale } = useTestingLocale(), id = useId()
  const valid = points.length > 0 && points.every(point => finite(point.value))
  const domain = valid ? chartDomain(points.map(point => point.value), { zero: false }) : null
  const [plotRef, width] = usePlotWidth(Boolean(domain)), right = width - 24
  const axis = axisLabels(domain?.ticks || [], fmt, locale)
  const timed = valid && points.every(point => finite(point.time)) && points.at(-1).time > points[0].time
  const x = (point, index) => left + (timed ? (point.time - points[0].time) / (points.at(-1).time - points[0].time) : index / Math.max(1, points.length - 1)) * (right - left)
  const y = value => bottom - (value - domain.low) / (domain.high - domain.low) * (bottom - top)
  const path = valid ? points.map((point, index) => `${index ? 'L' : 'M'}${x(point, index)},${y(point.value)}`).join(' ') : ''
  const labels = [...new Set(width < 420 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])].filter(index => index >= 0)
  return <section className="fxs-chart-panel report-chart is-blue"><h3>{t(title)}</h3>{domain ? <div ref={plotRef} className="report-plot" role="group" aria-label={t(title)}><svg className="report-svg" viewBox={`0 0 ${width} ${H}`} style={{ height: H }} role="img" aria-label={`${t(title)}: ${fmt(points[0].value, currency ? ` ${currency}` : '')} → ${fmt(points.at(-1).value, currency ? ` ${currency}` : '')}`}>
    <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--report-accent)" stopOpacity=".2"/><stop offset="1" stopColor="var(--report-accent)" stopOpacity=".015"/></linearGradient></defs><Unit currency={currency}/>
    {domain.ticks.map(value => <g key={value}><line className="report-grid" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 12} y={y(value)} dominantBaseline="middle" textAnchor="end">{axis.get(value)}</text></g>)}
    {area && <path d={`${path} L${x(points.at(-1), points.length - 1)},${bottom} L${left},${bottom} Z`} fill={`url(#${id})`}/>}
    <path className="report-line" d={path}/>
    {points.filter((_, index) => points.length <= 20 || labels.includes(index)).map((point, index) => <circle key={`${point.time}:${index}`} cx={x(point, points.indexOf(point))} cy={y(point.value)} r="3" className="report-point"><title>{`${finite(point.time) ? displayDate(point.time, { timeStyle: 'short' }) : point.label || ''}: ${fmt(point.value, currency ? ` ${currency}` : '')}`}</title></circle>)}
    {labels.map(index => <text key={index} x={x(points[index], index)} y="236" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{finite(points[index].time) ? displayDate(points[index].time) : points[index].label || index}</text>)}
  </svg></div> : <div className="fxs-chart-empty">{t(emptyLabel)}</div>}</section>
}

export function ReportBars({ title, items, currency, horizontal = false, accent = 'blue', signed = false, maximum, valueFormat, emptyLabel = 'Chưa có dữ liệu để vẽ biểu đồ.' }) {
  const { t, fmt, locale } = useTestingLocale()
  const values = items.map(item => item.value), valid = items.length > 0 && values.every(finite)
  const domain = valid ? chartDomain(values, { maximum }) : null
  const [plotRef, width] = usePlotWidth(Boolean(domain)), right = width - 24
  const axis = axisLabels(domain?.ticks || [], fmt, locale)
  const plotRight = horizontal ? right - 72 : right
  const height = horizontal ? Math.max(H, items.length * 36 + 58) : H
  const edge = horizontal ? height - 40 : bottom
  const x = value => left + (value - domain.low) / (domain.high - domain.low) * (plotRight - left)
  const y = value => edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const amount = value => valueFormat ? valueFormat(value) : fmt(value, currency ? ` ${currency}` : '')
  const tickLabel = value => maximum === 100 ? `${fmt(value, '', 0)}%` : axis.get(value)
  const tickCount = domain ? Math.min(domain.ticks.length, Math.max(2, Math.floor((plotRight - left) / Math.max(...domain.ticks.map(value => tickLabel(value).length * 7 + 12))) + 1)) : 0
  const ticks = horizontal && domain ? Array.from({ length: tickCount }, (_, index) => domain.ticks[Math.round(index * (domain.ticks.length - 1) / (tickCount - 1))]) : domain?.ticks
  // Keep every bar; thin axis/value labels only when their text would overlap.
  const labelWidth = Math.max(40, ...items.map(item => Math.max(t(item.label).length, (valueFormat ? valueFormat(item.value) : fmt(item.value)).length) * 7 + 12))
  const labelStride = Math.ceil(items.length / Math.max(1, Math.floor((right - left) / labelWidth)))
  return <section className={`fxs-chart-panel report-chart is-${accent}`}><h3>{t(title)}</h3>{domain ? <div ref={plotRef} className="report-plot" role="group" aria-label={t(title)}><svg className="report-svg" viewBox={`0 0 ${width} ${height}`} style={{ height }} role="img" aria-label={`${t(title)}: ${items.map(item => `${t(item.label)}: ${amount(item.value)}`).join('; ')}`}><Unit currency={currency}/>
    {ticks.map(value => <g key={value}>{horizontal ? <><line className="report-grid" x1={x(value)} x2={x(value)} y1={top} y2={edge}/><text x={x(value)} y={height - 14} textAnchor="middle">{tickLabel(value)}</text></> : <><line className="report-grid" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 12} y={y(value)} dominantBaseline="middle" textAnchor="end">{valueFormat ? valueFormat(value) : axis.get(value)}</text></>}</g>)}
    {horizontal ? <line className="report-zero" x1={x(0)} x2={x(0)} y1={top} y2={edge}/> : <line className="report-zero" x1={left} x2={right} y1={y(0)} y2={y(0)}/>}
    {items.map((item, index) => {
      const step = (horizontal ? edge - top : right - left) / items.length
      const center = (horizontal ? top : left) + (index + .5) * step, width = Math.min(36, step * .55)
      const negative = signed && item.value < 0
      return <g key={item.label} className={`report-bar${signed ? negative ? ' is-negative' : ' is-positive' : ''}`}>
        {horizontal ? <><line className="report-grid" x1={left} x2={right} y1={center + step / 2} y2={center + step / 2}/><text x={left - 12} y={center} dominantBaseline="middle" textAnchor="end">{t(item.label)}</text><rect x={Math.min(x(0), x(item.value))} y={center - width / 2} width={Math.max(item.value === 0 ? 2 : 0, Math.abs(x(item.value) - x(0)))} height={width} rx="2"/><text className="report-bar-value" x={x(item.value) + (negative && x(item.value) >= left + 48 ? -8 : 8)} y={center} dominantBaseline="middle" textAnchor={negative && x(item.value) < left + 48 ? 'start' : negative ? 'end' : 'start'}>{valueFormat ? valueFormat(item.value) : fmt(item.value)}</text></> : <><rect x={center - width / 2} y={Math.min(y(0), y(item.value))} width={width} height={Math.max(item.value === 0 ? 2 : 0, Math.abs(y(item.value) - y(0)))} rx="2"/>{index % labelStride === 0 && <><text className="report-bar-value" x={center} y={item.value < 0 ? y(item.value) + 14 : y(item.value) - 9} textAnchor="middle">{valueFormat ? valueFormat(item.value) : fmt(item.value)}</text><text x={center} y={height - 14} textAnchor="middle">{t(item.label)}</text></>}</>}
        <title>{`${t(item.label)}: ${amount(item.value)}`}</title>
      </g>
    })}
  </svg></div> : <div className="fxs-chart-empty">{t(emptyLabel)}</div>}</section>
}
