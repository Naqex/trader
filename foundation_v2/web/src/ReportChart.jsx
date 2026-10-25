import { useId, useLayoutEffect, useRef, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { chartDomain, reportCurvePath } from './reportChartModel.js'
import './report-chart.css'

const W = 560, H = 250, left = 88, top = 24, bottom = 208
const finite = value => typeof value === 'number' && Number.isFinite(value)
function axisLabels(ticks, fmt, locale) {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1
  let digits = 0
  while (digits < 8 && Math.abs(step * 10 ** digits - Math.round(step * 10 ** digits)) > 1e-8) digits++
  const full = ticks.map(value => fmt(value, '', digits))
  const compact = ticks.map(value => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value))
  // Close balances must keep their visible differences, even at large magnitudes.
  const labels = full.some(label => label.length > 10) && new Set(compact).size === new Set(full).size ? compact : full
  return new Map(ticks.map((value, index) => [value, labels[index]]))
}
function usePlotSize(hasData, minimumHeight) {
  const ref = useRef(null), [size, setSize] = useState({ width: W, height: minimumHeight })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      if (element.clientWidth > 0) setSize(current => current.width === element.clientWidth && current.height === element.clientHeight ? current : { width: element.clientWidth, height: element.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasData, minimumHeight])
  return [ref, size.width, size.height]
}
export function ReportLineChart({ title, points, currency, emptyLabel = 'Chưa có dữ liệu để vẽ biểu đồ.', area = true }) {
  const { t, fmt, locale } = useTestingLocale(), id = useId()
  const valid = points.length > 0 && points.every(point => finite(point.value))
  const domain = valid ? chartDomain(points.map(point => point.value), { zero: false }) : null
  const [plotRef, width, height] = usePlotSize(Boolean(domain), H), right = width - 24, edge = height - 42
  const axis = axisLabels(domain?.ticks || [], fmt, locale)
  const timed = valid && points.every(point => finite(point.time)) && points.at(-1).time > points[0].time
  const x = (point, index) => left + (timed ? (point.time - points[0].time) / (points.at(-1).time - points[0].time) : index / Math.max(1, points.length - 1)) * (right - left)
  const y = value => edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const groups = []
  if (valid) points.forEach((point, index) => {
    if (!index || point.segment !== points[index - 1].segment) groups.push([])
    groups.at(-1).push({ point, index })
  })
  const paths = groups.map(group => ({ group, path: reportCurvePath(group.map(({ point, index }) => [x(point, index), y(point.value)])) }))
  const labels = [...new Set(right - left < 180 ? [points.length - 1] : width < 420 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])].filter(index => index >= 0)
  return <section className="fxs-chart-panel report-chart is-blue"><h3>{t(title)}</h3>{domain ? <div ref={plotRef} className="report-plot" style={{ minHeight: H }} role="group" aria-label={t(title)}><svg className="report-svg" viewBox={`0 0 ${width} ${height}`} style={{ height }} role="img" aria-label={`${t(title)}: ${fmt(points[0].value, currency ? ` ${currency}` : '')} → ${fmt(points.at(-1).value, currency ? ` ${currency}` : '')}`}>
    <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--report-accent)" stopOpacity=".2"/><stop offset="1" stopColor="var(--report-accent)" stopOpacity=".015"/></linearGradient></defs>
    {domain.ticks.map(value => <g key={value}><line className="report-grid" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 12} y={y(value)} dominantBaseline="middle" textAnchor="end">{axis.get(value)}</text></g>)}
    {paths.map(({ path, group }, index) => <g key={index}>{area && <path d={`${path} L${x(group.at(-1).point, group.at(-1).index)},${edge} L${x(group[0].point, group[0].index)},${edge} Z`} fill={`url(#${id})`}/>}<path className="report-line" d={path}/></g>)}
    {points.filter((_, index) => points.length <= 20 || labels.includes(index)).map((point, index) => <circle key={`${point.time}:${index}`} cx={x(point, points.indexOf(point))} cy={y(point.value)} r="3" className="report-point"><title>{`${finite(point.time) ? displayDate(point.time, { timeStyle: 'short' }) : point.label || ''}: ${fmt(point.value, currency ? ` ${currency}` : '')}`}</title></circle>)}
    {labels.map(index => <text key={index} x={x(points[index], index)} y={height - 14} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{finite(points[index].time) ? displayDate(points[index].time) : points[index].label || index}</text>)}
  </svg></div> : <div className="fxs-chart-empty">{t(emptyLabel)}</div>}</section>
}

export function ReportBars({ title, items, currency, period, scopeLabel, horizontal = false, accent = 'blue', signed = false, split = false, maximum, integer = false, valueFormat, emptyLabel = 'Chưa có dữ liệu để vẽ biểu đồ.' }) {
  const { t, fmt, locale } = useTestingLocale()
  const divided = split && items.every(item => finite(item.profit) && item.profit >= 0 && finite(item.loss) && item.loss <= 0)
  const series = item => divided ? [item.loss, item.profit].filter(value => value !== 0) : [item.value]
  const values = items.flatMap(item => divided ? [item.loss, item.profit] : [item.value]), valid = items.length > 0 && values.every(finite)
  const centered = signed || split || period === 'weekday'
  const domain = valid ? chartDomain(values, { maximum, symmetric: centered, integer }) : null
  const weekday = period === 'weekday'
  const angled = weekday
  const minimumHeight = horizontal ? Math.max(H, items.length * 30 + 58) : angled ? bottom + 88 : H
  const [plotRef, width, height] = usePlotSize(Boolean(domain), minimumHeight), right = width - 24
  const axis = axisLabels(domain?.ticks || [], valueFormat ? (value, _, digits) => valueFormat(value, true, digits) : fmt, locale)
  const left = horizontal ? 88 : Math.max(40, ...[...axis.values()].map(label => label.length * 6.5 + 16))
  const plotRight = right
  const edge = height - (horizontal ? 40 : angled ? 88 : 42)
  const x = value => left + (value - domain.low) / (domain.high - domain.low) * (plotRight - left)
  const y = value => edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const amount = value => valueFormat ? valueFormat(value) : fmt(value, currency ? ` ${currency}` : '')
  const monthKeys = period === 'month' && items.length && items.every(item => /^\d{4}-(0[1-9]|1[0-2])$/.test(item.label))
  const monthOfYear = period === 'month-of-year'
  const labels = items.map(item => {
    let label = t(item.label)
    if (monthKeys) label = `${item.label.slice(5)}/${item.label.slice(0, 4)}`
    if (monthOfYear) label = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`2024-${item.label}-01T00:00:00Z`))
    const day = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].indexOf(item.label)
    if (weekday && day >= 0) label = locale.startsWith('vi') ? day === 6 ? 'Chủ nhật' : `Thứ ${day + 2}` : new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + day)))
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
  })
  const description = (item, index) => `${monthKeys ? item.label : labels[index]}${scopeLabel ? ` (${scopeLabel})` : ''}: ${divided ? `${t('Lãi')}: ${amount(item.profit)}; ${t('Lỗ')}: ${amount(item.loss)}; ${t('Net PnL')}: ` : ''}${amount(item.value)}`
  const tickLabel = value => maximum === 100 ? `${fmt(value, '', 0)}%` : axis.get(value) ?? fmt(value, '', 2)
  const tickCount = domain ? Math.min(domain.ticks.length, Math.max(2, Math.floor((plotRight - left) / Math.max(...domain.ticks.map(value => tickLabel(value).length * 7 + 12))) + 1)) : 0
  const tickStride = domain ? Array.from({ length: domain.ticks.length - 1 }, (_, index) => index + 1).find(stride => (domain.ticks.length - 1) % stride === 0 && (domain.ticks.length - 1) / stride + 1 <= tickCount) || 1 : 1
  const ticks = horizontal && domain ? centered ? tickCount < domain.ticks.length ? [domain.low, 0, domain.high] : domain.ticks : domain.ticks.filter((_, index) => index % tickStride === 0) : domain?.ticks
  // Keep every bar; thin category labels only when their text would overlap.
  const labelWidth = Math.max(40, ...labels.map(label => (angled ? 0 : label.length) * 7 + 12))
  const labelStride = Math.ceil(items.length / Math.max(1, Math.floor((right - left) / labelWidth)))
  return <section className={`fxs-chart-panel report-chart is-${accent}`}><div className="report-heading"><h3>{t(title)}</h3></div>{domain ? <div ref={plotRef} className="report-plot" style={{ minHeight: minimumHeight }} role="group" aria-label={t(title)}><svg className="report-svg" viewBox={`0 0 ${width} ${height}`} style={{ height }} role="group" aria-label={t(title)}>
    {horizontal && <line className="report-grid" x1={left} x2={right} y1={top} y2={top}/>}
    {ticks.map(value => <g key={value}>{horizontal ? <text x={x(value)} y={height - 14} textAnchor="middle">{tickLabel(value)}</text> : <><line className="report-grid" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 12} y={y(value)} dominantBaseline="middle" textAnchor="end">{tickLabel(value)}</text></>}</g>)}
    {items.map((item, index) => {
      const step = (horizontal ? edge - top : right - left) / items.length
      const center = (horizontal ? top : left) + (index + .5) * step
      const barWidth = horizontal ? step * .6 : Math.min(36, step * .55)
      const points = series(item)
      const rotation = weekday && step < 32 ? -90 : -45
      const showCategory = weekday || index % (angled ? Math.max(1, Math.ceil(30 / step)) : labelStride) === 0
      const detail = description(item, index)
      return <g key={item.label} className="report-bar" role="img" tabIndex={0} aria-label={detail} data-tooltip={detail.replaceAll('; ', '\n')} data-tooltip-touch="">
        {horizontal ? <><line className="report-grid" x1={left} x2={right} y1={center + step / 2} y2={center + step / 2}/><text className="report-category" x={left - 12} y={center} dominantBaseline="middle" textAnchor="end">{labels[index]}</text></> : showCategory && <text className="report-category" x={center} y={angled ? edge + 22 : height - 14} textAnchor={angled ? 'end' : 'middle'} transform={angled ? `rotate(${rotation} ${center} ${edge + 22})` : undefined}>{labels[index]}</text>}
        {(points.length ? points : [0]).map((value, part) => {
          const zero = value === 0, negative = value < 0
          const length = horizontal ? Math.abs(x(value) - x(0)) : Math.abs(y(value) - y(0))
          return <g key={part} className={`report-bar-segment${divided || signed ? negative ? ' is-negative' : ' is-positive' : ''}`}>
            {!zero && (horizontal ? <rect x={Math.min(x(0), x(value))} y={center - barWidth / 2} width={length} height={barWidth} rx="2"/> : <rect x={center - barWidth / 2} y={Math.min(y(0), y(value))} width={barWidth} height={length} rx="2"/>)}
          </g>
        })}
        <rect className="report-hit" x={horizontal ? left : center - step / 2} y={horizontal ? center - step / 2 : top} width={horizontal ? right - left : step} height={horizontal ? step : edge - top} />
      </g>
    })}
  </svg></div> : <div className="fxs-chart-empty">{t(emptyLabel)}</div>}</section>
}
