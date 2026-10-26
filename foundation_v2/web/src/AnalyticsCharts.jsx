import { useId, useLayoutEffect, useRef , useState } from 'react'
import { chartDomain, chartTicks, reportCurvePath } from './reportChartModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import TestingIcon from './TestingIcon.jsx'

function useSize(height, stretch = false) {
  const ref = useRef(null), [width, setWidth] = useState(640), [expandedHeight, setExpandedHeight] = useState(null)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => { setWidth(Math.max(220, entry.contentRect.width)); setExpandedHeight(stretch || ref.current?.closest(':fullscreen') ? entry.contentRect.height : null) })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [stretch])
  return [ref, width, expandedHeight ?? height]
}
const finite = value => typeof value === 'number' && Number.isFinite(value)
function tickText(value, domain, locale, suffix) {
  const step = domain.ticks.length > 1 ? Math.abs(domain.ticks[1] - domain.ticks[0]) : 1
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step))))
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0) }).format(value) + (suffix === '%' ? '%' : '')
}
export function AnalyticsCurve({ series, label, suffix = '', onSelect, selected, negative = false, labels = [], axisLabels, height = 200, stretch = false, sparkline = false, controls = false }) {
  const { t, fmt, locale } = useTestingLocale(), id = useId()
  const [ref, width, measuredHeight] = useSize(height, stretch)
  const [range, setRange] = useState([0, 1]), [tool, setTool] = useState('pan'), [brush, setBrush] = useState(null)
  const gesture = useRef(null), suppressClick = useRef(false)
  height = measuredHeight
  const compact = sparkline && height <= 120
  const total = Math.max(...series.map(path => path.length)), minimumSpan = Math.min(1, 2 / Math.max(2, total - 1))
  const start = controls ? Math.floor(range[0] * Math.max(0, total - 1)) : 0
  const end = controls ? Math.ceil(range[1] * Math.max(0, total - 1)) + 1 : total
  const paths = controls ? series.map(path => path.slice(start, end)) : series
  const values = paths.flat().map(point => point.value).filter(finite)
  const domain = chartDomain(values, { zero: negative, symmetric: height <= 120 })
  if (!domain && !controls) return <div ref={ref} className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div>
  const ticks = domain ? chartTicks(domain, height <= 120 ? 3 : 6) : [], axis = ticks.map(value => tickText(value, domain, locale, suffix))
  const left = compact ? 4 : Math.max(42, Math.min(width * .35, Math.max(...axis.map(value => value.length)) * 7 + 18)), right = width - (compact ? 4 : controls ? 8 : 20), top = compact ? 6 : controls ? 56 : 20, edge = height - (compact ? 6 : 36)
  const count = Math.max(...paths.map(path => path.length)), x = index => left + index / Math.max(1, count - 1) * (right - left)
  const y = value => domain.high === domain.low ? (top + edge) / 2 : edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const labelAt = index => labels[index + start] || (index + start === 0 ? t('Bắt đầu') : `${index + start}`)
  const detail = index => `${labelAt(index)} · ${fmt(paths[0]?.[index]?.value, suffix)}`
  const visibleTicks = []
  if (axisLabels) {
    const candidates = Array.from({length:count},(_,index)=>index).filter(index=>axisLabels[index+start] && (index===0 || axisLabels[index+start]!==axisLabels[index+start-1]))
    const gap = Math.max(56,...candidates.map(index=>axisLabels[index+start].length*7+20))
    for (const index of candidates) if (!visibleTicks.length || x(index)-x(visibleTicks.at(-1))>=gap) visibleTicks.push(index)
    const last=candidates.at(-1)
    if (last!==undefined && visibleTicks.at(-1)!==last) {
      if (visibleTicks.length>1 && x(last)-x(visibleTicks.at(-1))<gap) visibleTicks.pop()
      if (!visibleTicks.length || x(last)-x(visibleTicks.at(-1))>=gap) visibleTicks.push(last)
    }
  } else if (count > 0) visibleTicks.push(...new Set(width < 480 ? [0, count - 1] : [0, Math.floor((count - 1) / 2), count - 1]))
  const clampRange = (from, span) => { const size = Math.min(1, Math.max(minimumSpan, span)), left = Math.max(0, Math.min(1 - size, from)); return [left, left + size] }
  const zoom = factor => setRange(current => { const span = Math.min(1, Math.max(minimumSpan, (current[1] - current[0]) * factor)); return clampRange((current[0] + current[1] - span) / 2, span) })
  const pointX = event => { const rect = event.currentTarget.getBoundingClientRect(); return Math.max(left, Math.min(right, (event.clientX - rect.left) * width / rect.width)) }
  const pointerDown = event => {
    if (!controls || total < 3 || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect(), py = (event.clientY - rect.top) * height / rect.height
    if (py < top || py > edge) return
    suppressClick.current = false
    gesture.current = { x: pointX(event), range: [...range] }
    if (tool === 'zoom') setBrush([gesture.current.x, gesture.current.x])
  }
  const pointerMove = event => {
    const drag = gesture.current
    if (!drag) return
    if (!(event.buttons & 1)) { gesture.current = null; setBrush(null); suppressClick.current = false; return }
    const px = pointX(event), distance = px - drag.x
    if (Math.abs(distance) > 4) {
      suppressClick.current = true
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (tool === 'zoom') setBrush([drag.x, px])
    else if (suppressClick.current) setRange(clampRange(drag.range[0] - distance / (right - left) * (drag.range[1] - drag.range[0]), drag.range[1] - drag.range[0]))
  }
  const pointerUp = event => {
    const drag = gesture.current
    if (drag && tool === 'zoom' && suppressClick.current) {
      const px = pointX(event), span = drag.range[1] - drag.range[0]
      setRange(clampRange(drag.range[0] + (Math.min(drag.x, px) - left) / (right - left) * span, Math.abs(px - drag.x) / (right - left) * span))
    }
    gesture.current = null; setBrush(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const selectPoint = async point => {
    if (!point.tradeId || !onSelect) return
    if (document.fullscreenElement) await document.exitFullscreen()
    onSelect(point.tradeId)
  }
  const pathGroups = paths.flatMap((points, seriesIndex) => {
    const groups = []
    points.forEach((point, index) => {
      if (!finite(point.value)) return
      if (!index || !finite(points[index - 1]?.value)) groups.push([])
      groups.at(-1).push([x(index), y(point.value)])
    })
    return groups.map(points => ({ points, seriesIndex, d: reportCurvePath(points) }))
  })
  return <div ref={ref} className={`fxa-viz fxa-line-viz ${negative ? 'is-negative' : ''}`} data-chart-tool={controls ? tool : undefined} data-chart-range={controls ? `${start}:${end}` : undefined} style={{ height: stretch ? undefined : height }}>
    {controls && <div className="fxa-chart-tools" role="group" aria-label={t('Công cụ biểu đồ')}>
      {[["zoom-in",'Phóng to biểu đồ',()=>zoom(.5),range[1]-range[0]<=minimumSpan],['zoom-out','Thu nhỏ biểu đồ',()=>zoom(2),range[1]-range[0]>=1],['zoom-area','Chọn vùng phóng to',()=>setTool('zoom'),total<3],['hand','Kéo biểu đồ',()=>setTool('pan'),total<3],['home','Đặt lại biểu đồ',()=>setRange([0,1]),range[0]===0&&range[1]===1]].map(([icon,text,action,disabled])=><button key={icon} type="button" aria-label={t(text)} data-tooltip={t(text)} disabled={disabled} aria-pressed={icon==='zoom-area'?tool==='zoom':icon==='hand'?tool==='pan':undefined} onClick={action}><TestingIcon kind={icon} size={16}/></button>)}
    </div>}
    <svg viewBox={`0 0 ${width} ${height}`} role={series.length === 1 ? 'group' : 'img'} aria-label={label} tabIndex={controls ? 0 : undefined}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{gesture.current=null;setBrush(null);suppressClick.current=false}}
      onPointerLeave={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId)){gesture.current=null;setBrush(null)}}}
      onLostPointerCapture={()=>{gesture.current=null;setBrush(null)}}
      onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false}}}
      onKeyDown={event=>{if(!controls||event.target!==event.currentTarget)return;if(['+','=','-','0','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();if(event.key==='0')setRange([0,1]);else if(event.key==='ArrowLeft'||event.key==='ArrowRight')setRange(clampRange(range[0]+(event.key==='ArrowLeft'?-.2:.2)*(range[1]-range[0]),range[1]-range[0]));else zoom(event.key==='-'?2:.5)}}}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2"/><stop offset="1" stopColor="currentColor" stopOpacity=".01"/></linearGradient></defs>
      {!compact && ticks.map((value, index) => <g key={value}><line className="fxa-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 10} y={y(value)} dominantBaseline="middle" textAnchor="end">{axis[index]}</text></g>)}
      {!domain && <text x={(left+right)/2} y={(top+edge)/2} textAnchor="middle">{t('Chưa có dữ liệu')}</text>}
      {pathGroups.map(({ points, d, seriesIndex }, index) => <g key={index} style={{ color: series.length > 1 ? `var(--report-${['blue', 'positive', 'negative'][seriesIndex % 3]})` : undefined }}>{series.length === 1 && <path d={`${d} L${points.at(-1)[0]},${edge} L${points[0][0]},${edge} Z`} fill={`url(#${id})`}/>}<path d={d} fill="none" stroke="currentColor" strokeWidth="2" opacity={series.length > 1 ? .45 : 1}/>{points.length === 1 && <circle cx={points[0][0]} cy={points[0][1]} r="3" fill="currentColor"/>}</g>)}
      {series.length === 1 && paths[0].map((point, index) => finite(point.value) && <circle key={index} className="fxa-viz-point" cx={x(index)} cy={y(point.value)} r={point.tradeId === selected ? 5 : 3} tabIndex={onSelect || count <= 50 ? 0 : undefined} role={onSelect ? 'button' : 'img'} aria-label={detail(index)} data-tooltip={detail(index)} onClick={() => selectPoint(point)} onKeyDown={event => { if (['Enter', ' '].includes(event.key) && point.tradeId && onSelect) { event.preventDefault(); selectPoint(point) } }}/>) }
      {!compact && visibleTicks.map(index => <g className="fxa-x-tick" key={index}>{axisLabels && <line className="fxa-gridline" x1={x(index)} x2={x(index)} y1={edge} y2={edge+5}/>}<text x={x(index)} y={height - 10} textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}>{axisLabels ? axisLabels[index+start] : labelAt(index)}</text></g>)}
      {series.length === 1 && <rect x={left} y={top} width={Math.max(0, right - left)} height={edge - top} fill="transparent" pointerEvents="none"/>}
      {brush && <rect x={Math.min(...brush)} y={top} width={Math.abs(brush[1]-brush[0])} height={edge-top} className="fxa-chart-brush" pointerEvents="none"/>}
    </svg>
  </div>
}

export function AnalyticsBars({ items, metric = 'net', label, suffix = '', maximum, integer, combo = false, height = 180, color = 'signed' }) {
  const { t, fmt, locale } = useTestingLocale(), [ref, width, measuredHeight] = useSize(height)
  height = measuredHeight
  const values = items.map(item => item[metric]).filter(finite), domain = chartDomain(values, { maximum, integer, symmetric: true })
  if (!domain || !items.length) return <div ref={ref} className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div>
  const ticks = chartTicks(domain, height <= 120 ? 3 : 6), axis = ticks.map(value => tickText(value, domain, locale, suffix))
  const left = Math.max(42, Math.min(width * .35, Math.max(...axis.map(value => value.length)) * 7 + 18)), right = width - (combo ? 42 : 16), top = 20, edge = height - 40
  const y = value => domain.high === domain.low ? (edge + top) / 2 : edge - (value - domain.low) / (domain.high - domain.low) * (edge - top)
  const step = (right - left) / items.length, barWidth = Math.max(1, Math.min(54, step * .64)), center = index => left + (index + .5) * step
  const stride = Math.max(1, Math.ceil(items.length * Math.max(28, ...items.map(item => item.label.length * 6 + 10)) / (right - left)))
  const rate = value => edge - value / 100 * (edge - top)
  return <div ref={ref} className="fxa-viz" style={{ height }}><svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>
    {ticks.map((value, index) => <g key={value}><line className="fxa-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left - 10} y={y(value)} textAnchor="end" dominantBaseline="middle">{axis[index]}</text></g>)}
    {combo && [0, 50, 100].map(value => <text key={value} x={right + 8} y={rate(value)} dominantBaseline="middle">{value}%</text>)}
    {items.map((item, index) => {
      const value = item[metric], valid = finite(value), detail = `${item.tooltipLabel || t(item.label)}: ${valid ? fmt(value, suffix, integer ? 0 : 2) : t('Chưa có dữ liệu')}${combo ? ` · ${t('Tỉ lệ thắng')}: ${fmt(item.winRate, '%')}` : ''}`
      return <g key={`${item.label}:${index}`} tabIndex={0} role="img" aria-label={detail} data-tooltip={detail} data-tooltip-touch=""><rect className={color === 'signed' ? value < 0 ? 'fxa-fill-negative' : 'fxa-fill-positive' : 'fxa-fill-blue'} x={center(index) - barWidth / 2} y={valid ? Math.min(y(0), y(value)) : edge} width={barWidth} height={valid ? Math.abs(y(0) - y(value)) : 0} rx="2"/>{valid && value === 0 && <circle cx={center(index)} cy={y(0)} r="2" className="fxa-fill-blue"/>}<rect x={left + index * step} y={top} width={step} height={edge - top} fill="transparent"/>{(index % stride === 0 || items.length <= 7) && <text x={center(index)} y={height - 14} textAnchor="middle">{t(item.label)}</text>}</g>
    })}
    {combo && items.map((item, index) => finite(item.winRate) && <circle key={index} cx={center(index)} cy={rate(item.winRate)} r="4" fill="var(--report-blue)"><title>{`${t(item.label)} · ${fmt(item.winRate, '%')}`}</title></circle>)}
  </svg></div>
}

export function AnalyticsDailyBars({ items, currency }) {
  const { t, fmt, locale } = useTestingLocale(), height = 300, [ref, width] = useSize(height)
  const domain = chartDomain(items.map(item => item.net).filter(finite), { symmetric: true })
  if (!domain || !items.length) return <div ref={ref} className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div>
  const left = 32, right = width - 86, top = 42, step = 31, bottom = top + items.length * step
  const x = value => domain.high === domain.low ? (left + right) / 2 : left + (value - domain.low) / (domain.high - domain.low) * (right - left)
  return <div ref={ref} className="fxa-viz fxa-daily-bars" style={{height}}><svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={t('Performance by day')}>
    <text x={left} y="16">{currency}</text><text x={width-4} y="16" textAnchor="end">{t('Win rate')}</text>
    {chartTicks(domain, width < 400 ? 3 : 5).map(value=><g key={value}><line className="fxa-gridline" x1={x(value)} x2={x(value)} y1={top-14} y2={bottom}/><text x={x(value)} y={bottom+20} textAnchor="middle">{tickText(value,domain,locale,'')}</text></g>)}
    {items.map((item,index)=>{
      const y=top+index*step, valid=finite(item.net), detail=`${t(item.label)}: ${item.count && valid?fmt(item.net,` ${currency}`):'N/A'} · ${t('Win rate')}: ${finite(item.winRate)?fmt(item.winRate,'%'):'N/A'}`
      return <g key={item.label} tabIndex={0} role="img" aria-label={detail} data-tooltip={detail} data-tooltip-touch=""><rect x="0" y={y-14} width={width} height={step} fill="transparent"/><text x="0" y={y+3}>{t(item.label)}</text>{valid&&<rect x={Math.min(x(0),x(item.net))} y={y-8} width={Math.abs(x(item.net)-x(0))} height="18" rx="2" className={item.net<0?'fxa-fill-negative':'fxa-fill-positive'}/>}<text x={width-4} y={y+4} textAnchor="end">{finite(item.winRate)?fmt(item.winRate,'%'):'N/A'}</text></g>
    })}
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
  if (!items.length) return <div className="fxa-radar"><div className="fxa-chart-empty">{t('Chưa có dữ liệu')}</div></div>
  return <div className="fxa-radar"><svg viewBox="0 0 300 248" role="img" aria-label={`${label}: ${items.map(item => `${t(item.label)}: ${finite(item[metric])?fmt(item[metric], suffix):'N/A'}`).join('; ')}`}>
    {[.25,.5,.75,1].map(f => <polygon key={f} points={polygon(f)} fill="none" className="fxa-gridline"/>)}
    {items.map((item,index) => { const [x,y] = p(index,1), [tx,ty] = p(index,1.38), valid=finite(item[metric]), fraction=valid&&domain&&domain.high!==domain.low?(item[metric]-domain.low)/(domain.high-domain.low):0, [px,py]=p(index,fraction), detail=`${t(item.label)}: ${valid?fmt(item[metric],suffix):'N/A'}`; return <g key={item.label} tabIndex={0} role="img" aria-label={detail} data-tooltip={detail} data-tooltip-touch=""><line x1={cx} y1={cy} x2={x} y2={y} className="fxa-gridline"/><text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle">{t(item.label)}<tspan x={tx} dy="16">{valid?fmt(item[metric],suffix):'N/A'}</tspan></text><circle cx={x} cy={y} r="12" fill="transparent"/>{valid&&<circle cx={px} cy={py} r="3" fill="var(--report-blue)"/>}</g> })}
    {domain && complete && <polygon points={items.map((item,index) => p(index,domain.high === domain.low ? 0 : (item[metric] - domain.low) / (domain.high - domain.low)).join(',')).join(' ')} fill="var(--report-blue)" fillOpacity=".2" stroke="var(--report-blue)" strokeWidth="2"/>}
    {domain && !complete && items.map((item,index)=>{
      const next=(index+1)%items.length
      if(!finite(item[metric])||!finite(items[next][metric]))return null
      const fraction=value=>domain.high===domain.low?0:(value-domain.low)/(domain.high-domain.low)
      const [x1,y1]=p(index,fraction(item[metric])),[x2,y2]=p(next,fraction(items[next][metric]))
      return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--report-blue)" strokeWidth="2"/>
    })}
    {!pointValues.some(finite) && <text x={cx} y={cy} textAnchor="middle">N/A</text>}
  </svg></div>
}
