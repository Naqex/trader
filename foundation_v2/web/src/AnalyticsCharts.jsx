import { useId, useLayoutEffect, useRef , useState } from 'react'
import { chartDomain, chartTicks, reportCurvePath } from './reportChartModel.js'
import { useTestingLocale } from './testingLocale.jsx'

function useSize(height) {
  const ref = useRef(null), [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(220, entry.contentRect.width)))
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width, height]
}
const finite = value => typeof value === 'number' && Number.isFinite(value)
function tickText(value, domain, locale, suffix) {
  const step = domain.ticks.length > 1 ? Math.abs(domain.ticks[1] - domain.ticks[0]) : 1
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step))))
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0) }).format(value) + (suffix === '%' ? '%' : '')
}
export function AnalyticsCurve({ series, label, suffix = '', onSelect, selected, negative = false, labels = [], height = 280 }) {
  const { t, fmt, locale } = useTestingLocale(), id = useId()
  const [ref, width] = useSize(height)
  const values = series.flat().map(point => point.value).filter(finite)
  const domain = chartDomain(values, { zero: negative })
  if (!domain) return <div ref={ref} className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div>
  const ticks = chartTicks(domain, 6), axis = ticks.map(value => tickText(value, domain, locale, suffix))
  const left = Math.max(42, Math.min(width * .35, Math.max(...axis.map(value => value.length)) * 7 + 18)), right = width - 20, top = 20, edge = height - 36
  const count = Math.max(...series.map(path => path.length)), x = index => left + index / Math.max(1, count - 1) * (right - left)
  const y = value => domain.high === domain.low ? (top + edge) / 2 : edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const labelAt = index => labels[index] || (index === 0 ? t('Bắt đầu') : `${index}`)
  const detail = index => `${labelAt(index)} · ${fmt(series[0]?.[index]?.value, suffix)}`
  const pathGroups = series.flatMap((points, seriesIndex) => {
    const groups = []
    points.forEach((point, index) => {
      if (!finite(point.value)) return
      if (!index || !finite(points[index - 1]?.value)) groups.push([])
      groups.at(-1).push([x(index), y(point.value)])
    })
    return groups.map(points => ({ points, seriesIndex, d: reportCurvePath(points) }))
  })
  return <div ref={ref} className={`fxa-viz fxa-line-viz ${negative ? 'is-negative' : ''}`} style={{ height }}>
    <svg viewBox={`0 0 ${width} ${height}`} role={series.length === 1 ? 'group' : 'img'} aria-label={label}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2"/><stop offset="1" stopColor="currentColor" stopOpacity=".01"/></linearGradient></defs>
      {ticks.map((value, index) => <g key={value}><line className="fxa-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 10} y={y(value)} dominantBaseline="middle" textAnchor="end">{axis[index]}</text></g>)}
      {pathGroups.map(({ points, d, seriesIndex }, index) => <g key={index} style={{ color: series.length > 1 ? `var(--report-${['blue', 'positive', 'negative'][seriesIndex % 3]})` : undefined }}>{series.length === 1 && <path d={`${d} L${points.at(-1)[0]},${edge} L${points[0][0]},${edge} Z`} fill={`url(#${id})`}/>}<path d={d} fill="none" stroke="currentColor" strokeWidth="2" opacity={series.length > 1 ? .45 : 1}/>{points.length === 1 && <circle cx={points[0][0]} cy={points[0][1]} r="3" fill="currentColor"/>}</g>)}
      {series.length === 1 && series[0].map((point, index) => finite(point.value) && <circle key={index} className="fxa-viz-point" cx={x(index)} cy={y(point.value)} r={point.tradeId === selected ? 5 : 3} tabIndex={onSelect || count <= 50 ? 0 : undefined} role={onSelect ? 'button' : 'img'} aria-label={detail(index)} data-tooltip={detail(index)} onClick={() => point.tradeId && onSelect?.(point.tradeId)} onKeyDown={event => { if (['Enter', ' '].includes(event.key) && point.tradeId && onSelect) { event.preventDefault(); onSelect(point.tradeId) } }}/>) }
      {[...new Set(width < 480 ? [0, count - 1] : [0, Math.floor((count - 1) / 2), count - 1])].map(index => <text key={index} x={x(index)} y={height - 10} textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}>{labelAt(index)}</text>)}
      {series.length === 1 && <rect x={left} y={top} width={Math.max(0, right - left)} height={edge - top} fill="transparent" pointerEvents="none"/>}
    </svg>
  </div>
}

export function AnalyticsBars({ items, metric = 'net', label, suffix = '', maximum, integer, combo = false, height = 260, color = 'signed' }) {
  const { t, fmt, locale } = useTestingLocale(), [ref, width] = useSize(height)
  const values = items.map(item => item[metric]).filter(finite), domain = chartDomain(values, { maximum, integer, symmetric: true })
  if (!domain || !items.length) return <div ref={ref} className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div>
  const ticks = chartTicks(domain, 6), axis = ticks.map(value => tickText(value, domain, locale, suffix))
  const left = Math.max(42, Math.min(width * .35, Math.max(...axis.map(value => value.length)) * 7 + 18)), right = width - (combo ? 42 : 16), top = 20, edge = height - 40
  const y = value => domain.high === domain.low ? (edge + top) / 2 : edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const step = (right - left) / items.length, barWidth = Math.max(1, Math.min(54, step * .64)), center = index => left + (index + .5) * step
  const stride = Math.max(1, Math.ceil(items.length * Math.max(28, ...items.map(item => item.label.length * 6 + 10)) / (right - left)))
  const rate = value => edge - value / 100 * (edge - top)
  return <div ref={ref} className="fxa-viz" style={{ height }}><svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>
    {ticks.map((value, index) => <g key={value}><line className="fxa-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 10} y={y(value)} textAnchor="end" dominantBaseline="middle">{axis[index]}</text></g>)}
    {combo && [0, 50, 100].map(value => <text key={value} x={right + 8} y={rate(value)} dominantBaseline="middle">{value}%</text>)}
    {items.map((item, index) => {
      const value = item[metric], valid = finite(value), detail = `${t(item.label)}: ${valid ? fmt(value, suffix, integer ? 0 : 2) : t('Chưa có dữ liệu')}${combo ? ` · ${t('Tỉ lệ thắng')}: ${fmt(item.winRate, '%')}` : ''}`
      return <g key={`${item.label}:${index}`} tabIndex={0} role="img" aria-label={detail} data-tooltip={detail} data-tooltip-touch=""><rect className={color === 'signed' ? value < 0 ? 'fxa-fill-negative' : 'fxa-fill-positive' : 'fxa-fill-blue'} x={center(index) - barWidth / 2} y={valid ? Math.min(y(0), y(value)) : edge} width={barWidth} height={valid ? Math.abs(y(0) - y(value)) : 0} rx="2"/>{valid && value === 0 && <circle cx={center(index)} cy={y(0)} r="2" className="fxa-fill-blue"/>}<rect x={left + index * step} y={top} width={step} height={edge - top} fill="transparent"/>{(index % stride === 0 || items.length <= 7) && <text x={center(index)} y={height - 14} textAnchor="middle">{t(item.label)}</text>}</g>
    })}
    {combo && items.map((item, index) => finite(item.winRate) && <circle key={index} cx={center(index)} cy={rate(item.winRate)} r="4" fill="var(--report-blue)"><title>{`${t(item.label)} · ${fmt(item.winRate, '%')}`}</title></circle>)}
  </svg></div>
}

export function AnalyticsRing({ values, label, center, sublabel, concentric = false }) {
  const { fmt } = useTestingLocale(), valid = values.some(item => finite(item.value))
  let offset = 0
  const total = values.reduce((sum, item) => sum + (finite(item.value) ? Math.max(0, item.value) : 0), 0)
  return <div className="fxa-ring-layout"><svg className="fxa-ring" viewBox="0 0 200 200" role="img" aria-label={`${label}: ${values.map(item => `${item.label} ${fmt(item.value, concentric ? '%' : '')}`).join('; ')}`}>
    <circle cx="100" cy="100" r="76" fill="none" stroke="var(--wm-border)" strokeWidth="17"/>
    {valid && values.map((item, index) => { const radius = concentric ? 76 - index * 24 : 76, fraction = concentric ? (item.value ?? 0) / 100 : total ? (item.value ?? 0) / total : 0, circumference = Math.PI * 2 * radius; const dashOffset = concentric ? 0 : offset; offset += fraction; return <circle key={item.label} cx="100" cy="100" r={radius} fill="none" stroke={item.color} strokeWidth={concentric ? 14 : 17} strokeDasharray={`${fraction * circumference} ${circumference}`} strokeDashoffset={-dashOffset * circumference} transform="rotate(-90 100 100)"/> })}
    <text x="100" y="100" textAnchor="middle" className="fxa-ring-value">{center}</text><text x="100" y="121" textAnchor="middle">{sublabel}</text>
  </svg><div className="fxa-chart-legend">{values.map(item => <span key={item.label}><i style={{ background: item.color }}/>{item.label}<strong>{fmt(item.value, concentric ? '%' : '')}</strong></span>)}</div></div>
}

export function AnalyticsRadar({ items, metric, label, suffix = '', maximum }) {
  const { t, fmt } = useTestingLocale(), domain = chartDomain(items.map(item => item[metric]).filter(finite), { maximum, symmetric: true })
  const cx = 150, cy = 120, r = 74, p = (index, fraction) => [cx + Math.sin(index * Math.PI / 2) * r * fraction, cy - Math.cos(index * Math.PI / 2) * r * fraction]
  const polygon = fraction => items.map((_, index) => p(index, fraction).join(',')).join(' ')
  const pointValues = items.map(item => finite(item[metric]) ? item[metric] : null), complete = pointValues.every(finite)
  if (!items.length) return <div className="fxa-radar"><h3>{t(label)}</h3><div className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div></div>
  return <div className="fxa-radar"><h3>{t(label)}</h3><svg viewBox="0 0 300 248" role="img" aria-label={`${label}: ${items.map(item => `${item.label}: ${fmt(item[metric], suffix)}`).join('; ')}`}>
    {[.25,.5,.75,1].map(f => <polygon key={f} points={polygon(f)} fill="none" className="fxa-gridline"/>)}
    {items.map((item,index) => { const [x,y] = p(index,1), [tx,ty] = p(index,1.38); return <g key={item.label}><line x1={cx} y1={cy} x2={x} y2={y} className="fxa-gridline"/><text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle">{t(item.label)}</text></g> })}
    {domain && complete && <polygon points={items.map((item,index) => p(index,domain.high === domain.low ? 0 : (item[metric] - domain.low) / (domain.high - domain.low)).join(',')).join(' ')} fill="var(--report-blue)" fillOpacity=".2" stroke="var(--report-blue)" strokeWidth="2"/>}
    {!complete && <text x={cx} y={cy} textAnchor="middle">N/A</text>}
  </svg></div>
}
