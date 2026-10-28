import DataTable from './DataTable.jsx'
import { navigate, navigationSnapshot, subscribeNavigation } from './clientNavigation.js'
import { TestingTradesEmpty } from './TestingPageState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { advancedAnalytics, known, number, periodReturn } from './tradingAnalyticsModel.js'
import './fx-analytics.css'
import { AnalyticsCurve, AnalyticsBars, AnalyticsDailyBars, AnalyticsRing, AnalyticsRadar } from './AnalyticsCharts.jsx'
export { AnalyticsCurve } from './AnalyticsCharts.jsx'
import { profitFactorGauge, bucketCurve, excursionSummary, scenarioRiskCurve, scenarioChartSeries, scenarioResults, realizedRiskSeries, idealRiskSummary } from './analyticsPresentation.js'
import { displayDate } from './dateFormat.js'
import { currencyLabel } from './moneyFormat.js'
import { monteCarlo, monteCarloDefaults, monteCarloInputErrors } from './analyticsSimulation.js'
import AnalyticsFilterBar from './AnalyticsFilterBar.jsx'
import LedgerFilterDrawer from './LedgerFilterDrawer.jsx'
import FxSelect from './FxSelect.jsx'
import LedgerFilterActions from './LedgerFilterActions.jsx'
import TestingIcon from './TestingIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import { FieldError, fieldValidationProps, focusFirstInvalid } from './FormValidation.jsx'
import AnalyticsCalendar, { CALENDAR_HELP } from './AnalyticsCalendar.jsx'
import PropChallengeObjectives from './PropChallengeObjectives.jsx'
import { propChartReferences } from './propAnalyticsModel.js'
import { DEFAULT_EXTRA_FILTERS } from './tradingAnalyticsModel.js'
import { LEDGER_BASE_FILTERS, ledgerFilterChips, removeLedgerFilter } from './ledgerFilterModel.js'

export const fmt = (value, suffix = '', digits = 2) => known(value) ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}` : '-'
export function SelectField({ label, value, onChange, options, disabled }) {
  const { t } = useTestingLocale()

  return <label className="fxa-field"><span>{t(label)}</span><FxSelect label={label} value={value} onChange={onChange} disabled={disabled} options={options.map(([value, label]) => ({ value, label }))} /></label>
}
export function FxAnalyticsFilters({ filters, onChange, extra, onExtra, onApply, timeBasis, readTimeFacets, rows, labels, onExport, pending, ledgerOnly, sessionControl, onClearSessions, columnControl, facets, persistInUrl, sourceType, statusControl, disabled = false }) {
  if (!ledgerOnly) return <AnalyticsFilterBar {...{ filters, onChange, extra, onExtra, rows, labels, onExport, pending, sessionControl, persistInUrl, sourceType, statusControl, disabled }} />
  return <LedgerFilters {...{ filters, onChange, extra, onExtra, onApply, timeBasis, readTimeFacets, rows, onExport, pending, sessionControl, onClearSessions, columnControl, facets, statusControl, disabled }} />
}
function LedgerFilters({ filters, onChange, extra, onExtra, onApply, timeBasis, readTimeFacets, rows, sessionControl, columnControl, facets, statusControl, disabled }) {
  const { t } = useTestingLocale()

  const [drawer, setDrawer] = useState('')
  const apply = onApply || ((next, nextExtra) => { onChange(next); onExtra(nextExtra) })
  const chips = ledgerFilterChips(filters, extra)
  const names = { buy: 'Buy', sell: 'Sell', win: 'Win', loss: 'Loss', breakeven: 'Breakeven', unknown: 'Unknown', open: 'Open', closed: 'Closed', with: 'Có ghi chú', without: 'Không có ghi chú', app: 'Backtesting', prop: 'Prop Firm', research: 'Research' }
  const describe = chip => chip.key === 'dates' ? chip.values.map(value => value ? displayDate(value) : '…').join(' → ')
    : chip.key === 'time' ? `${chip.values[0] || '00:00'}–${chip.values[1] || '23:59'}`
    : chip.values.map(value => ['sides', 'side', 'outcomes', 'outcome', 'statuses', 'notesPresence', 'reportKinds'].includes(chip.key) ? t(names[value] || value)
      : ['hours', 'hour'].includes(chip.key) ? `${String(value).padStart(2, '0')}:00` : value).join(['tagInclude', 'tagExclude'].includes(chip.key) ? ` ${extra[`${chip.key}Mode`]} ` : ', ')
  return <section className="fxa-filters" inert={disabled || undefined} aria-disabled={disabled || undefined} aria-label={t("Bộ lọc giao dịch")} data-testid="analytics-filters">
    <div className="fxa-filter-toolbar is-ledger"><div className="fxl-session-scope">{sessionControl}{statusControl}</div><LedgerFilterActions columnControl={columnControl} activeTab={drawer} onOpen={setDrawer} /></div>
    {chips.length > 0 && <div className="fxa-filter-chips fxl-applied-filters" aria-label={t('Bộ lọc đã áp dụng')}>{chips.map(chip => <button type="button" key={chip.key} className="fxa-filter-chip" aria-label={t('Bỏ lọc {label}', { label: t(chip.label) })} onClick={() => apply(...removeLedgerFilter(filters, extra, chip))}><span>{t(chip.label)} · {describe(chip)}</span><span aria-hidden="true">×</span></button>)}<button type="button" className="fxa-clear-filters" onClick={() => apply({ ...LEDGER_BASE_FILTERS }, { ...DEFAULT_EXTRA_FILTERS, timezone: extra.timezone }, 'market')}>{t('Clear filters')}</button></div>}
    {drawer && <LedgerFilterDrawer initialTab={drawer} {...{ filters, extra, rows, facets, timeBasis, readTimeFacets }} onApply={apply} onClose={() => setDrawer('')} />}
  </section>
}

export function Metric({ label, value, note, tone = '' }) {
  const { t } = useTestingLocale()

  return <div className={`fxa-metric ${tone}`}><span>{t(label)}</span><strong>{value}</strong>{note && <small>{t(note)}</small>}</div>
}
function Info({ text, mini = false }) {
  const { t } = useTestingLocale()
  return <button type="button" className={`fxa-info${mini ? ' is-mini' : ''}`} aria-label={t(text)} data-tooltip={t(text)} data-tooltip-touch=""><TestingIcon kind="info" size={mini ? 12 : 16}/></button>
}
function TimeCoverage({ data }) {
  const { t } = useTestingLocale()
  if (!data?.incomplete) return null
  return <span className="fxa-time-incomplete" role="status">{t('Dữ liệu một phần')}<Info text={t('{known}/{total} giao dịch có thời gian để phân bổ. Số giao dịch và tần suất vẫn tính lệnh thiếu lãi/lỗ; chỉ số tài chính của nhóm đó hiển thị N/A. Lệnh thiếu thời gian không được phân bổ; tổng tháng/năm hiển thị N/A khi chưa đủ dữ liệu.', { known: data.datedCount, total: data.count })}/></span>
}
function ReportSection({ title, subtitle, help, actions, children, className = '', label, timeCoverage, headingOutside = false, surface = true, sectionRef }) {
  const { t } = useTestingLocale()
  const heading = (title || actions) && <div className="fxa-section-heading"><div><div className="fxa-panel-title">{title && <h2>{t(title)}</h2>}{help && <Info text={help}/>}<TimeCoverage data={timeCoverage}/></div>{subtitle && <p className="fxa-panel-subtitle">{t(subtitle)}</p>}</div>{actions && <div className="fxa-panel-actions">{actions}</div>}</div>
  return <section ref={sectionRef} className={`fxa-section ${headingOutside ? 'fxa-report-group' : 'fxa-panel'} ${className}`} aria-label={label ? t(label) : headingOutside && title ? t(title) : undefined}>{heading}{headingOutside && surface ? <div className="fxa-panel fxa-section-body">{children}</div> : children}</section>
}
function useVisibleExperiments(active, scope, request) {
  const ref = useRef(null)
  useEffect(() => {
    if (!active || !request || !ref.current) return
    if (!window.IntersectionObserver) { request(); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { request(); observer.disconnect() }
    }, { rootMargin: '160px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [active, scope, request])
  return ref
}
function BreakevenThreshold({ threshold, onThreshold, data }) {
  const { t } = useTestingLocale(), [draft, setDraft] = useState(String(threshold)), id = useId()
  return <form className="fxa-threshold" onSubmit={event => { event.preventDefault(); onThreshold(Number(draft)) }}><div className="fxa-threshold-label"><label htmlFor={id}>{t('Ngưỡng hòa vốn (R)')}</label><Info text="Phân loại hòa vốn khi độ lớn R thực hiện không vượt ngưỡng. R dùng rủi ro ban đầu hợp lệ, không dùng SL mô phỏng. Thiếu R thì phân loại chưa xác định; PnL và tổng giao dịch không đổi. Ngưỡng 0 chỉ xét lãi/lỗ ròng bằng 0."/></div><input id={id} type="number" min="0" step="any" required value={draft} onChange={event => setDraft(event.target.value)}/><button className="fxa-button" type="submit" disabled={Number(draft) === threshold}>{t('Áp dụng')}</button>{threshold > 0 && !data.classificationComplete && <span className="fxa-threshold-coverage" role="status">{t('{known}/{total} giao dịch phân loại được', {known:data.classifiedCount,total:data.count})}</span>}</form>
}
function PercentChange({ value }) {
  const { fmt } = useTestingLocale()
  return known(value) ? <span className={`fxa-percent-change ${value < 0 ? 'is-negative' : 'is-positive'}`}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d={value < 0 ? 'M8 4v8m-3-3 3 3 3-3' : 'M8 12V4m-3 3 3-3 3 3'} fill="none" stroke="var(--wm-canvas)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>{fmt(value,'%',Math.abs(value)<.01?6:2)}</span> : null
}
function Stat({ label, value, help, tone = '', note }) {
  const { t } = useTestingLocale()
  return <div className={`fxa-metric ${tone}`}><span>{t(label)}{help && <Info text={help}/>}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
}
function UnitTabs({ value, onChange, options, label }) {
  const { t } = useTestingLocale()
  return <div className="fxa-segmented" role="group" aria-label={t(label)}>{options.map(([key,text]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{t(text)}</button>)}</div>
}
function durationLabel(value, t) {
  if (!known(value)) return '-'
  const minutes = Math.round(Number(value))
  return `${Math.floor(minutes / 60)} ${t('duration.hour')} ${minutes % 60} ${t('duration.minute')}`
}
const COUNT_WIN = "Số giao dịch đã đóng có lãi và nằm ngoài ngưỡng hòa vốn theo R. Thiếu R khi áp dụng ngưỡng thì chưa xác định được tổng."
const COUNT_LOSS = "Số giao dịch đã đóng bị lỗ và nằm ngoài ngưỡng hòa vốn theo R. Thiếu R khi áp dụng ngưỡng thì chưa xác định được tổng."
const BEST_WIN = "Lãi lớn nhất theo % vốn ban đầu của phiên nguồn, sau phí.\n\nMỗi lệnh: lãi/lỗ ròng ÷ vốn ban đầu × 100. Thiếu vốn hợp lệ ở bất kỳ lệnh thắng nào thì hiển thị N/A."
const WORST_LOSS = "Lỗ lớn nhất theo % vốn ban đầu của phiên nguồn, sau phí; giữ dấu âm.\n\nMỗi lệnh: lãi/lỗ ròng ÷ vốn ban đầu × 100. Thiếu vốn hợp lệ ở bất kỳ lệnh thua nào thì hiển thị N/A."
const AVERAGE_WIN = "Trung bình % lãi của các giao dịch thắng, sau phí.\n\nTính % từng lệnh trên vốn ban đầu của phiên nguồn, rồi lấy trung bình cộng. Thiếu vốn hợp lệ ở bất kỳ lệnh nào trong nhóm thì hiển thị N/A."
const AVERAGE_LOSS = "Trung bình % lỗ của các giao dịch thua, sau phí; giữ dấu âm.\n\nTính % từng lệnh trên vốn ban đầu của phiên nguồn, rồi lấy trung bình cộng. Thiếu vốn hợp lệ ở bất kỳ lệnh nào trong nhóm thì hiển thị N/A."
const DURATION_WIN = "Thời gian trung bình từ lúc mở đến lúc đóng của các lệnh thắng.\n\nDùng thời gian thị trường; hiển thị N/A nếu có lệnh thiếu hoặc sai thời gian."
const DURATION_LOSS = "Thời gian trung bình từ lúc mở đến lúc đóng của các lệnh thua.\n\nDùng thời gian thị trường; hiển thị N/A nếu có lệnh thiếu hoặc sai thời gian."
const STREAK_WIN = "Số lệnh thắng liên tiếp dài nhất theo thứ tự giao dịch trong bộ lọc. Lệnh thua hoặc hòa vốn kết thúc chuỗi."
const STREAK_LOSS = "Số lệnh thua liên tiếp dài nhất theo thứ tự giao dịch trong bộ lọc. Lệnh thắng hoặc hòa vốn kết thúc chuỗi."
const AVERAGE_STREAK_WIN = "Trung bình độ dài các chuỗi thắng liên tiếp, mỗi chuỗi được tính một lần; bao gồm chuỗi cuối báo cáo. Lệnh thua hoặc hòa vốn kết thúc chuỗi."
const AVERAGE_STREAK_LOSS = "Trung bình độ dài các chuỗi thua liên tiếp, mỗi chuỗi được tính một lần; bao gồm chuỗi cuối báo cáo. Lệnh thắng hoặc hòa vốn kết thúc chuỗi."
function OutcomeStats({ data }) {
  const { t, fmt, locale } = useTestingLocale()
  const groups = [
    ['Winners', 'win', data.wins, data.bestWinPct, data.averageWinPct, data.winDuration, data.maxWinStreak, data.averageWinStreak],
    ['Losers', 'loss', data.losses, data.worstLossPct, data.averageLossPct, data.lossDuration, data.maxLossStreak, data.averageLossStreak],
  ]
  const percent = value => !known(value) ? 'N/A' : value !== 0 && Math.abs(value) < .01 ? `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 2 }).format(value)}%` : fmt(value, '%')
  return <div className="fxa-two-columns">{groups.map(([label, type, count, best, average, duration, streak, averageStreak]) => {
    const win = type === 'win'
    const rows = [
      [win ? 'Tổng giao dịch thắng' : 'Tổng giao dịch thua', fmt(count, '', 0), win ? COUNT_WIN : COUNT_LOSS],
      [win ? 'Lãi lớn nhất' : 'Lỗ lớn nhất', percent(best), win ? BEST_WIN : WORST_LOSS],
      [win ? 'Lãi trung bình' : 'Lỗ trung bình', percent(average), win ? AVERAGE_WIN : AVERAGE_LOSS],
      ['Thời gian giữ trung bình', known(duration) ? durationLabel(duration, t) : 'N/A', win ? DURATION_WIN : DURATION_LOSS],
      ['Chuỗi dài nhất', fmt(streak, ` ${t('lệnh')}`, 0), win ? STREAK_WIN : STREAK_LOSS],
      ['Chuỗi trung bình', known(averageStreak) ? fmt(averageStreak, ` ${t('lệnh')}`) : 'N/A', win ? AVERAGE_STREAK_WIN : AVERAGE_STREAK_LOSS],
    ]
    return <article className={`fxa-outcomes is-${type}`} key={type}><h3>{t(label)}</h3><dl>{rows.map(([name, value, help]) => <div key={name}><dt>{t(name)}<Info text={help}/></dt><dd>{value}</dd></div>)}</dl></article>
  })}</div>
}
function ExpectancyComparison({ data, currency }) {
  const { t, fmt } = useTestingLocale()
  const total = Math.abs(data.averageWin ?? 0) + Math.abs(data.averageLoss ?? 0)
  return <div className="fxa-expectancy-comparison" role="img" aria-label={`${t('Lãi trung bình')}: ${fmt(data.averageWin, ` ${currency}`)}; ${t('Lỗ trung bình')}: ${fmt(data.averageLoss, ` ${currency}`)}`}>
    <div className="fxa-average-bar" aria-hidden="true">{total > 0 && <>
      {Math.abs(data.averageWin ?? 0) > 0 && <i className="is-win" style={{ flex: Math.abs(data.averageWin) }}/>}
      {Math.abs(data.averageLoss ?? 0) > 0 && <i className="is-loss" style={{ flex: Math.abs(data.averageLoss) }}/>}
    </>}</div>
    <div className="fxa-average-labels"><span><strong>{fmt(data.averageWin, ` ${currency}`)}</strong></span><span><strong>{fmt(data.averageLoss, ` ${currency}`)}</strong></span></div>
  </div>
}

function ProfitFactor({ rows }) {
  const { t, fmt } = useTestingLocale(), gauge = profitFactorGauge(rows)
  const value = gauge.status === 'unbounded' ? '∞' : gauge.status === 'unavailable' ? 'N/A' : fmt(gauge.value)
  const label = gauge.status === 'unavailable' ? t('Chưa có dữ liệu') : t('Độ đầy vòng PF: {percent}%', { percent: fmt(gauge.fraction * 100) })
  return <><Stat label="Profit factor" value={value} help="Hệ số lợi nhuận = tổng lãi của các lệnh có lãi ÷ độ lớn tổng lỗ của các lệnh thua, sau phí trong bộ lọc. Không dùng ngưỡng hòa vốn để loại số tiền nhỏ.&#10;&#10;Chưa có lệnh hoặc tất cả hòa vốn: 0. Chỉ có lãi: ∞ và vòng đầy. Chỉ có lỗ: 0. Thiếu lãi/lỗ: N/A.&#10;&#10;Vòng xanh = min(PF ÷ 4, 1). Mốc 4 chỉ là trần hiển thị; số PF không bị chặn và không phải mức đánh giá chất lượng giao dịch."/><svg className="fxa-pf-gauge" viewBox="0 0 100 100" role="img" aria-label={`${t('Profit factor')}: ${value}. ${label}`}>
    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--wm-border)" strokeWidth="6"/>
    {gauge.fraction !== null && <circle className="fxa-pf-progress" cx="50" cy="50" r="42" fill="none" stroke="var(--report-blue)" strokeWidth="6" pathLength="100" strokeDasharray={`${gauge.fraction * 100} 100`} transform="rotate(-90 50 50)"/>}
  </svg></>
}

function MonthMatrix({ items, capitalBases, incomplete }) {
  const { t, locale } = useTestingLocale(), [aggregation,setAggregation] = useState('sessions'), [basis,setBasis] = useState('initial'), id = useId()
  const years = [...new Set(items.map(item => item.label.slice(0,4)))].sort()
  const currentAvailable = capitalBases.current.length > 0 && capitalBases.current.every(item => item.capital > 0)
  const selectedBasis = basis === 'current' && currentAvailable ? 'current' : 'initial'
  const percent = value => `${value > 0 ? '+' : ''}${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`
  const cell = (group, total = false, key) => {
    const value = group.length && !(incomplete && total) ? periodReturn(group, capitalBases[selectedBasis], aggregation) : null
    const text = !group.length ? '–' : known(value) ? percent(value) : 'N/A'
    return <td key={key} className={total ? 'fxa-year-total' : ''}><span className={`fxa-month-tile${value > 0 ? ' is-positive' : value < 0 ? ' is-negative' : ''}`} tabIndex={group.length ? 0 : undefined} data-tooltip={group.length ? `${group.map(item => item.label).join(', ')} · ${t(aggregation === 'sessions' ? 'Tổng % lợi nhuận các phiên' : 'Lợi nhuận tổng thể (%)')} · ${t(selectedBasis === 'initial' ? 'Vốn ban đầu' : 'Số dư hiện tại')}: ${text}` : undefined}>{text}</span></td>
  }
  return <><div className="fxa-month-controls">
    <fieldset><legend className="sr-only">{t('Cách gộp lợi nhuận')}</legend>{[['sessions','Cộng % phiên','Tổng các phần trăm lợi nhuận của từng phiên.'],['overall','Tổng thể (%)','Tổng lãi/lỗ ròng chia tổng vốn của các phiên nguồn.']].map(([value,label,help])=><div key={value}><label><input type="radio" name={`${id}-aggregation`} checked={aggregation===value} onChange={()=>setAggregation(value)}/>{t(label)}</label><Info text={help}/></div>)}</fieldset>
    <fieldset><legend className="sr-only">{t('Cơ sở vốn')}</legend>{[['initial','Vốn ban đầu','Vốn ban đầu của từng phiên nguồn. Cùng một tập vốn được dùng cho mọi tháng và tổng.'],['current','Số dư hiện tại','Số dư tài khoản từ snapshot tại thời điểm báo cáo, không gồm lãi/lỗ thả nổi. Chỉ khả dụng khi có snapshot hợp lệ cho mọi phiên nguồn; không suy ra từ giao dịch đã lọc.']].map(([value,label,help])=><div key={value}><label><input type="radio" name={`${id}-basis`} checked={selectedBasis===value} disabled={value==='current'&&!currentAvailable} onChange={()=>setBasis(value)}/>{t(label)}</label><Info text={help}/></div>)}</fieldset>
  </div>{years.length ? <div className="fxa-month-scroll" tabIndex={0} role="region" aria-label={t('Performance by month')}><table className="fxa-month-matrix">
    <thead><tr><th scope="col"><span className="sr-only">{t('Năm')}</span></th>{Array.from({length:12},(_,index)=><th scope="col" key={index}><span className="fxa-month-tile">{new Intl.DateTimeFormat(locale,{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2000,index,1)))}</span></th>)}<th scope="col"><span className="fxa-month-tile">{t('YTD')}</span></th></tr></thead>
    <tbody>{years.map(year=><tr key={year}><th scope="row"><span className="fxa-month-tile">{year}</span></th>{Array.from({length:12},(_,index)=>cell(items.filter(item=>item.label===`${year}-${String(index+1).padStart(2,'0')}`),false,index))}{cell(items.filter(item=>item.label.startsWith(year)),true)}</tr>)}</tbody>
    <tfoot><tr className="fxa-month-total"><td colSpan="11"/><th scope="row" colSpan="2"><span className="fxa-month-tile">{t('Tổng')}</span></th>{cell(items,true)}</tr></tfoot>
  </table></div>:<p className="fxa-empty">{t('Chưa có dữ liệu')}</p>}</>
}

function ChartHeading({ title, help, note }) {
  const { t } = useTestingLocale()
  return <div className="fxa-chart-heading"><h3>{t(title)}{help && <Info text={help}/>}</h3>{note && <span>{note}</span>}</div>
}
export function AnalyticsPerformance({ model, data, extra, onSelect, selected, threshold, onThreshold, experiments, propReport, active = true, experimentScope, onNeedExperiments }) {
  const riskRef = useVisibleExperiments(active, experimentScope, onNeedExperiments)
  const { t, fmt, locale } = useTestingLocale(), [metric,setMetric] = useState('net'), [interval,setInterval] = useState('all')
  const currency=model.result?.account_currency||t('Đơn vị tài khoản'), suffix=metric==='winRate'||metric==='profitPct'?'%':metric==='averageR'?' R':metric==='net'?` ${currency}`:''
  const actualCurve=data.curve.map(point=>({...point,value:known(point.value)&&known(model.startBalance)?point.value-Number(model.startBalance):null})), bucket=bucketCurve(actualCurve,data.rows,interval,extra.timezone)
  const challengeLines=propReport?.phase?.currency && propReport.phase.currency===model.result?.account_currency && number(propReport.phase.initial_balance)===number(model.startBalance) ? propChartReferences(propReport) : []
  const curveLabels=bucket.labels.map((value,index)=>value?displayDate(value,{timeStyle:interval==='day'?undefined:'short',timeZone:extra.timezone}):index?`#${index}`:t('Bắt đầu'))
  const curveDates=bucket.labels.map(value=>value?displayDate(value,{timeStyle:'short',timeZone:extra.timezone,fallback:''}):'')
  const sameDay=new Set(curveDates.filter(Boolean).map(value=>value.slice(0,10))).size===1, sameYear=new Set(curveDates.filter(Boolean).map(value=>value.slice(6,10))).size===1
  const curveAxisLabels=curveDates.map(value=>!value?'':sameDay?value.slice(11):value.slice(0,sameYear?5:10))
  const riskSeries=realizedRiskSeries(experiments,data.rows),rValues=riskSeries.map(point=>point.value).filter(known),averageR=rValues.length?rValues.reduce((a,b)=>a+b,0)/rValues.length:null,maxR=rValues.length?Math.max(...rValues):null
  const ideal=idealRiskSummary(experiments,data.rows)
  const averageHelp='RR trung bình là tỷ lệ lợi nhuận/rủi ro bình quân mỗi giao dịch. Ví dụ RR bằng 2 tương ứng lợi nhuận bằng 2 lần mức rủi ro.\n\nHiện dùng lãi/lỗ ròng chia rủi ro ban đầu của các lệnh có dữ liệu.'
  const maxHelp='RR lớn nhất đã thực hiện trong các giao dịch có dữ liệu rủi ro ban đầu.\n\nBiểu đồ nhỏ phía dưới cho biết RR của từng giao dịch.'
  const idealHelp='RR lý tưởng là tỷ lệ lợi nhuận/rủi ro tối đa có thể đạt nếu giữ lệnh tới một tuần sau khi mở.\n\nGiá trị trung bình dùng các cửa sổ đủ dữ liệu trong phạm vi báo cáo; đỉnh trên biểu đồ giúp nhìn lại cơ hội có thể đã chốt quá sớm.'
  const maxIdealHelp='RR lý tưởng lớn nhất trong toàn bộ giao dịch đủ dữ liệu của bộ lọc, gồm cả lệnh thắng và thua.\n\nMỗi lệnh được quan sát tới một tuần sau khi mở để tìm mức lãi/lỗ ròng cao nhất so với rủi ro ban đầu. Giá quan sát không bảo đảm khớp lệnh thực tế.'
  const totalPercent=number(model.startBalance)>0&&known(data.net)?data.net/Number(model.startBalance)*100:null
  const performanceControls=<FxSelect label="Chỉ số hiệu suất" value={metric} onChange={setMetric} options={[{value:'net',label:`Lãi/lỗ ròng (${currency})`},{value:'averageR',label:'RR trung bình'},{value:'profitPct',label:'Lợi nhuận (%)'},{value:'winRate',label:'Tỉ lệ thắng'}]}/>
  return <div className="fxa-report fxa-visual-report" data-testid="analytics-performance">
    <ReportSection title="Profit and loss" className="fxa-profit-panel" actions={<UnitTabs label="Độ chi tiết biểu đồ" value={interval} onChange={setInterval} options={[["all",'Tất cả'],['day','Ngày'],['hour','1 giờ'],['quarter','15 phút']]}/>}>
      <div className="fxa-metrics fxa-profit-metrics">
        <Stat label="Total PnL" value={<>{fmt(data.net,` ${currency}`)}<PercentChange value={totalPercent}/></>} help="Lãi/lỗ cho biết số tiền bạn kiếm được hoặc mất đi. Giá trị hiện tại là lãi/lỗ ròng sau phí trong bộ lọc."/>
        <Stat label="Số dư tài khoản" value={<>{fmt(data.endingBalance,` ${currency}`)}<PercentChange value={totalPercent}/></>} help={data.localFiltered||model.result?.scope?.active_filters?'Số dư dựng lại từ vốn ban đầu và các giao dịch đã lọc.':'Số dư tài khoản sau các giao dịch đã đóng trong phạm vi đang chọn; không bao gồm lãi/lỗ thả nổi.'}/>
        <Stat label="Win rate" value={fmt(data.winRate,'%')} help="Tỷ lệ giao dịch kết thúc có lãi trên tổng giao dịch đã đóng."/>
        <Stat label="Total trades" value={<>{fmt(data.count,'',0)}<sup className="fxa-trade-split"><span aria-label={t('Thắng / thua')}>{fmt(data.wins,'',0)}/{fmt(data.losses,'',0)}</span><Info mini text="Số bên trái là giao dịch thắng; số bên phải là giao dịch thua. Không bao gồm giao dịch hòa vốn."/></sup></>} help="Tổng số giao dịch đã đóng, bao gồm lệnh thắng, thua và hòa vốn."/>
        <Stat label="Giao dịch hòa vốn" value={fmt(data.breakeven,'',0)} help="Tổng số giao dịch hòa vốn theo ngưỡng đang áp dụng."/>
        <BreakevenThreshold threshold={threshold} onThreshold={onThreshold} data={data}/>
      </div>
      <AnalyticsCurve key={JSON.stringify([interval,data.rows.map(row=>row.tradeId)])} series={[bucket.points]} referenceLines={challengeLines} timeZone={extra.timezone} label={t('Lãi/lỗ ròng tích lũy')} labels={curveLabels} axisLabels={curveAxisLabels} timestamps={bucket.timestamps} suffix={` ${currency}`} onSelect={onSelect} selected={selected} height={200} stretch controls/>
    </ReportSection>
    <div ref={riskRef} className="fxa-three-columns fxa-risk-panels">
      <ReportSection label="RR thực hiện"><div className="fxa-metrics"><Stat label="RR trung bình" value={known(averageR)?fmt(averageR):'N/A'} help={averageHelp}/><Stat label="RR lớn nhất" value={known(maxR)?fmt(maxR):'N/A'} help={maxHelp}/></div><AnalyticsCurve series={[riskSeries]} labels={riskSeries.map((_,index)=>`#${index+1}`)} label={t('RR thực hiện theo giao dịch')} suffix=" R" height={48} sparkline/></ReportSection>
      <ReportSection label="RR lý tưởng"><div className="fxa-metrics"><Stat label="RR lý tưởng trung bình" value={known(ideal.average)?fmt(ideal.average):'N/A'} help={idealHelp}/><Stat label="RR lý tưởng lớn nhất" value={known(ideal.max)?fmt(ideal.max):'N/A'} help={maxIdealHelp}/></div><AnalyticsCurve series={[ideal.series]} labels={ideal.series.map((_,index)=>`#${index+1}`)} label={t('RR lý tưởng')} suffix=" R" height={48} sparkline/></ReportSection>
      <ReportSection label="Có thể có lãi / hòa vốn"><div className="fxa-metrics"><Stat label="Có thể có lãi / hòa vốn" value={known(ideal.recoveryCount)?fmt(ideal.recoveryCount,'',0):'N/A'} help="Số giao dịch thua từng có cơ hội đóng với lãi/lỗ ròng không âm trong cửa sổ một tuần đã có đủ dữ liệu.&#10;&#10;Đã tính phí; giá quan sát không bảo đảm khớp lệnh thực tế."/><Stat label="RR lý tưởng lớn nhất" value={known(ideal.max)?fmt(ideal.max):'N/A'} help={maxIdealHelp}/></div></ReportSection>
    </div>
    {propReport && <PropChallengeObjectives report={propReport}/>}
    <ReportSection headingOutside surface={false} className="fxa-expectancy-panel" title="Expectancy & Profit factor" help="Kỳ vọng cho biết lãi/lỗ ròng trung bình mỗi giao dịch; hệ số lợi nhuận so sánh tổng lãi với độ lớn tổng lỗ. Cả hai được tính sau phí trên các giao dịch trong bộ lọc."><div className="fxa-expectancy-cards"><div className="fxa-panel fxa-expectancy-card"><Stat label="Expectancy" value={fmt(data.expectancy, ` ${currency}`)} help={"Kỳ vọng là số tiền lãi/lỗ ròng trung bình mỗi giao dịch đã đóng trong bộ lọc, gồm cả hòa vốn.\n\nCách tính: tổng lãi/lỗ ròng sau phí ÷ tổng số giao dịch. Đây là trung bình của dữ liệu đã có, không bảo đảm kết quả lệnh tiếp theo."}/><ExpectancyComparison data={data} currency={currency}/></div><div className="fxa-panel fxa-expectancy-card fxa-factor-card"><ProfitFactor rows={data.rows}/></div></div></ReportSection>
    <ReportSection headingOutside surface={false} className="fxa-outcome-panel" title="Winners and losers"><OutcomeStats data={data}/></ReportSection>
    <ReportSection headingOutside surface={false} className="fxa-side-panel" title="Performance by side" help="So sánh số giao dịch và tỉ lệ thắng giữa hướng Buy và Sell trong bộ lọc."><div className="fxa-side-cards"><div className="fxa-side-card"><ChartHeading title="Total trades" help="Số giao dịch Buy và Sell trong bộ lọc, gồm cả hòa vốn. Vòng tròn cho biết tỉ trọng mỗi hướng trong tổng giao dịch; hướng chưa rõ được giữ riêng."/><AnalyticsRing label={t('Số giao dịch theo hướng')} values={[...data.side.map((item,index)=>({label:item.label==='BUY'?'Buy':'Sell',value:item.count,color:index?'var(--report-blue)':'var(--report-positive)'})),...(data.unknownSide?[{label:t('Chưa rõ'),value:data.unknownSide,color:'var(--wm-content-muted)'}]:[])]}/></div><div className="fxa-side-card"><ChartHeading title="Win rate" help="Tỉ lệ thắng riêng cho Buy và Sell: số lệnh thắng ÷ tổng lệnh đã đóng của cùng hướng × 100, gồm cả hòa vốn. Hai tỉ lệ độc lập, không cần cộng thành 100%."/><AnalyticsRing label={t('Tỉ lệ thắng theo hướng')} concentric values={data.side.map((item,index)=>({label:item.label==='BUY'?'Buy':'Sell',value:item.winRate,color:index?'var(--report-blue)':'var(--report-positive)'}))}/></div></div></ReportSection>
    <ReportSection headingOutside surface={false} timeCoverage={data} className="fxa-hours-panel" title="Hiệu suất theo phiên" help={"Giờ phiên cố định theo UTC: Asia 00:00–09:00, London 07:00–16:00, New York 13:00–22:00; ngoài phiên 22:00–24:00. Giờ kết thúc không được tính.\n\nDùng thời điểm của báo cáo: giờ thị trường cho phiên backtest, giờ hoạt động cho báo cáo hoạt động. Các phiên có chồng lấn; một lệnh có thể thuộc hai phiên. Không cộng các nhóm để suy ra tổng giao dịch. Không tự điều chỉnh DST hay lịch nghỉ."}><div className="fxa-radar-grid">{[['winRate','Tỉ lệ thắng','%',100,'Tỉ lệ lệnh thắng trong từng phiên, chia tổng lệnh đã đóng của phiên đó, gồm cả hòa vốn. Phiên chưa có giao dịch hiển thị N/A.'],['count','Total trades','',undefined,'Số giao dịch trong từng phiên. Một giao dịch ở giờ chồng lấn được tính vào cả hai phiên.'],['averageR','RR trung bình',' R',undefined,'Trung bình lãi/lỗ ròng chia rủi ro ban đầu của các giao dịch có dữ liệu rủi ro trong từng phiên. Thiếu dữ liệu thì hiển thị N/A.'],['profitPct','Lợi nhuận (%)','%',undefined,'Tổng lãi/lỗ ròng của phiên ÷ tổng vốn ban đầu của các phiên nguồn trong báo cáo × 100. Các nhóm dùng cùng cơ sở vốn; thiếu vốn thì hiển thị N/A.']].map(([key,label,unit,max,help])=><div className="fxa-radar-card" key={key}><ChartHeading title={label} help={help}/><AnalyticsRadar items={data.sessions} metric={key} label={t(label)} suffix={unit} maximum={max}/></div>)}</div></ReportSection>
    <ReportSection headingOutside timeCoverage={data} className="fxa-half-panel fxa-hour-panel" title="Performance by time" help={"Phân nhóm theo giờ của báo cáo trong múi giờ đã chọn: giờ thị trường cho backtest, giờ ghi nhận cho báo cáo hoạt động. Dùng dropdown để xem lãi/lỗ ròng, RR trung bình, lợi nhuận theo % vốn ban đầu hoặc tỉ lệ thắng.\n\nRR chỉ tính lệnh có dữ liệu rủi ro ban đầu. Lợi nhuận (%) dùng cùng tổng vốn nguồn cho mọi giờ; không phải tỉ trọng lãi của giờ trong tổng lãi."} actions={performanceControls}><AnalyticsBars zeroMarker items={data.hours.map(item=>({...item,label:`${item.label}:00`}))} metric={metric} label={t('Performance by time')} suffix={suffix} height={300} maximum={metric==='winRate'?100:undefined}/></ReportSection>
    <ReportSection headingOutside timeCoverage={data} className="fxa-half-panel fxa-day-panel" title="Performance by day" help={"Lãi/lỗ ròng sau phí theo ngày trong tuần, dựa trên thời điểm của báo cáo trong múi giờ đã chọn: giờ thị trường cho backtest, giờ ghi nhận cho báo cáo hoạt động. Thanh xanh là lãi, thanh đỏ là lỗ.\n\nCột tỉ lệ thắng = số lệnh thắng ÷ tổng lệnh đã đóng trong ngày đó, gồm cả hòa vốn. Ngày không có giao dịch hiển thị N/A."}><AnalyticsDailyBars items={data.weekdays} currency={currency}/></ReportSection>
    <ReportSection headingOutside timeCoverage={data} className="fxa-month-panel" title="Performance by month" help={"Biểu đồ thể hiện lợi nhuận và thua lỗ của bạn theo từng tháng."}><MonthMatrix items={data.months} capitalBases={data.capitalBases} incomplete={data.incomplete || model.result?.partial || model.result?.status === 'partial'}/></ReportSection>
    <ReportSection headingOutside className="fxa-calendar-panel" title="Performance calendar" help={CALENDAR_HELP}><AnalyticsCalendar items={data.calendar} timezone={extra.timezone} currency={currency} undatedCount={data.calendarUndatedCount} sourcePartial={model.result?.partial || model.result?.status === 'partial'} selectionScope={JSON.stringify([experimentScope,model.result?.session_id,model.result?.filters,extra,threshold])}/></ReportSection>
    <ReportSection headingOutside surface={false} timeCoverage={data} className="fxa-frequency-panel" title="Average trade frequency" help="Trung bình trên các ngày, tuần hoặc tháng có giao dịch trong bộ lọc; không tính kỳ trống. Mỗi cột là trung bình của nhóm trên trục, số ở tiêu đề là tổng lệnh chia số kỳ có giao dịch, không phải trung bình cộng các cột."><div className="fxa-three-columns">{[
      ['day','Giao dịch mỗi ngày','Mỗi cột: số lệnh của một thứ chia số ngày có giao dịch thuộc thứ đó. Trung bình chung: tổng lệnh chia số ngày có giao dịch.'],
      ['week','Giao dịch mỗi tuần','Mỗi cột: số lệnh của cùng số tuần ISO chia số tuần có giao dịch thuộc nhóm đó qua các năm. Tuần bắt đầu thứ Hai; tuần 1 là tuần chứa ngày 4 tháng 1. Trung bình chung: tổng lệnh chia số tuần có giao dịch.'],
      ['month','Giao dịch mỗi tháng','Mỗi cột: số lệnh của cùng tháng chia số tháng có giao dịch thuộc nhóm đó qua các năm. Trung bình chung: tổng lệnh chia số tháng có giao dịch.'],
    ].map(([key,label,help],index)=>{
      const items=(data.frequencySeries?.[key]||[]).map(item=>{
        const category=key==='day'?t(item.label):key==='week'?t('Tuần {week}',{week:item.label}):new Intl.DateTimeFormat(locale,{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2000,Number(item.label)-1,1)))
        const axisLabel=key==='week'?item.label:key==='month'&&locale==='vi-VN'?`T${Number(item.label)}`:category
        return {...item,axisLabel,tooltipText:t('{label}: trung bình {average} · {trades} giao dịch / {periods} kỳ có giao dịch',{label:category,average:known(item.average)?fmt(item.average):'N/A',trades:fmt(item.tradeCount),periods:fmt(item.periodCount)})}
      })
      return <div className="fxa-frequency-card" key={key}><ChartHeading title={label} help={help} note={<>{t('Trung bình tần suất')} <strong>{fmt(data.frequency[index]?.average)}</strong></>}/><div className="fxa-frequency-plot"><AnalyticsBars items={items} metric="average" label={t(label)} height={124} stretch color="blue"/></div></div>
    })}</div></ReportSection>
  </div>
}

export function AnalyticsDrawdown({ model, data, extra, experiments, experimentStatus, experimentError, active = true, experimentScope, onNeedExperiments }) {
  const maeRef = useVisibleExperiments(active, experimentScope, onNeedExperiments)
  const { t,fmt }=useTestingLocale(),[unit,setUnit]=useState('percent')
  const currency=model.result?.account_currency||t('Đơn vị tài khoản'),excursion=excursionSummary(experiments,data.rows),percent=unit==='percent',equity=data.equityDrawdown?.available,source=equity?data.equityDrawdown:data
  const precision=percent&&source.maxDrawdownPct>0&&source.maxDrawdownPct<.01?Math.min(8,1-Math.floor(Math.log10(source.maxDrawdownPct))):2
  const raw=equity?source.points:data.drawdown,byId=new Map(data.rows.map(row=>[row.tradeId,row]))
  const observations=raw.map((point,index)=>{
    const row=point.tradeId?byId.get(point.tradeId):data.rows[(point.index??index)-1]
    const time=equity?point.timeUtc:row?.analytics_time_utc
    const label=displayDate(time,{timeStyle:'short',timeZone:extra?.timezone,fallback:t('Không rõ thời gian')}),value=known(percent?point.drawdownPct:point.drawdown)?Number(percent?point.drawdownPct:point.drawdown)*(equity?1:-1)||0:null
    return {label,value,tooltipText:`${label}: ${known(value)?fmt(value,percent?'%':` ${currency}`,precision):'N/A'}`}
  })
  const underwater=observations.filter(point=>point.value!==0),dd=underwater.length?underwater:observations.slice(-1)
  const positivePct=raw.map(point=>point.drawdownPct).filter(value=>known(value)&&value>1e-12),averagePct=equity?source.averageDrawdownPct:!raw.length||raw.some(point=>!known(point.drawdownPct))?null:positivePct.length?positivePct.reduce((a,b)=>a+b,0)/positivePct.length:0
  const drawdownText=value=>known(value)?fmt(-Number(value)||0,percent?'%':` ${currency}`,precision):'N/A'
  return <div className="fxa-report fxa-visual-report fxa-drawdown-report" data-testid="analytics-drawdown"><ReportSection headingOutside className="fxa-drawdown-main" title={equity?'Sụt giảm equity':'Drawdown on closed balance'} help={equity?'Khoảng giảm từ đỉnh equity, bao gồm lãi/lỗ thả nổi được nguồn ghi nhận. Các đoạn vốn được tách riêng; không nối qua dữ liệu thiếu.':'Khoảng giảm từ đỉnh số dư tới điểm thấp hơn sau khi đóng lệnh. Không bao gồm biến động equity trong lúc đang giữ lệnh.'} actions={<div className="fxa-inline-actions"><a className="fxa-help-link" href="https://releases.fxreplay.com/drawdown" target="_blank" rel="noreferrer">{t('Cách tính')} ↗</a><UnitTabs label="Đơn vị sụt giảm" value={unit} onChange={setUnit} options={[["money",currencyLabel(currency)],['percent','%']]}/></div>}>{equity&&source.partial&&<p role="status" className="fxa-observation-state">{t('Mẫu quan sát')} · {raw.length}/{source.totalPoints}</p>}<AnalyticsBars gradient xTitle="Ngày giao dịch" yTitle={percent?'Sụt giảm (% đỉnh)':t('Sụt giảm ({unit})',{unit:currencyLabel(currency)})} items={dd} metric="value" label={t(equity?'Sụt giảm equity':'Drawdown on closed balance')} suffix={percent?'%':` ${currency}`} height={320}/></ReportSection>
    <div className="fxa-drawdown-stats"><Stat label="Max drawdown" value={drawdownText(percent?source.maxDrawdownPct:source.maxDrawdown)} help="Khoảng giảm lớn nhất từ đỉnh trước đó trong cơ sở đã chọn."/><Stat label="Average drawdown" value={drawdownText(percent?averagePct:source.averageDrawdown)} help="Trung bình các điểm quan sát nằm dưới đỉnh trước đó."/><Stat label="Thời gian phục hồi (ngày)" value={fmt(source.recoveryDays,'',1)} help="Thời gian trung bình từ đỉnh trước sụt giảm đến khi trở lại đỉnh, tính trên các chu kỳ đã phục hồi. Chu kỳ thiếu timestamp không được suy đoán."/><Stat label="Số lần sụt giảm" value={fmt(source.episodes,'',0)} help="Số lần giá trị bắt đầu giảm xuống dưới đỉnh trước đó."/></div>
    <ReportSection sectionRef={maeRef} headingOutside className="fxa-mae-panel" title="Maximum Adverse Excursion" help="Biên giá bất lợi quan sát trong thời gian giữ lệnh, chia khoảng cách từ giá vào tới SL gốc. Nến thoát không rõ intrabar không được dùng; kết quả có thể là cận dưới.">{experimentStatus==='loading'?<p role="status">{t('Đang đọc đường giá…')}</p>:experimentError?<p role="alert" className="fxa-error">{t(experimentError)}</p>:<><AnalyticsBars gradient zeroMarker xTitle="MAE (R)" yTitle="Số giao dịch" items={excursion.bins.map(bin=>({label:bin.end===null?`≥${fmt(bin.start,'',1)}`:fmt(bin.start,'',1),tooltipText:bin.end===null?`MAE ≥ ${fmt(bin.start)} R: ${fmt(bin.count)} ${t('giao dịch')}`:`MAE [${fmt(bin.start)}; ${fmt(bin.end)}) R: ${fmt(bin.count)} ${t('giao dịch')}`,count:bin.count,observed:true}))} metric="count" label={t('Phân phối MAE theo R')} integer height={320}/>{excursion.values.length>0&&excursion.values.length<data.rows.length&&<p role="status" className="fxa-observation-state">{t('Đã đo MAE: {known}/{total} giao dịch',{known:excursion.values.length,total:data.rows.length})}</p>}</>}</ReportSection>
    <ReportSection headingOutside surface={false} className="fxa-winning-mae-panel" title="Drawdown on winning trades"><div className="fxa-metrics">{[['Sụt giảm TB (R)',excursion.average,'MAE trung bình của các lệnh thắng. MAE là độ lớn biến động bất lợi chia rủi ro giá ban đầu, luôn không âm.'],['Sụt giảm nhỏ nhất (R)',excursion.min,'MAE nhỏ nhất trong các lệnh thắng, không phải giá trị nhỏ nhất của đường số dư.'],['Sụt giảm lớn nhất (R)',excursion.max,'MAE lớn nhất trong các lệnh thắng. Có thể vượt 1R khi giá đi quá SL; đường giá lấy mẫu có thể bỏ sót đáy.']].map(([label,value,help])=><Stat key={label} label={label} value={known(value)?fmt(value):'N/A'} help={`${t(help)}\n\n${t('Đã đo MAE cho {known}/{total} lệnh thắng. Chỉ tính khi toàn bộ nhóm có rủi ro ban đầu hợp lệ; thiếu dữ liệu hiển thị N/A.',{known:excursion.winners.length,total:excursion.winnerCount})}`}/>)}</div></ReportSection></div>
}

function useSimulationRun() {
  const [state, setState] = useState({ phase: 'idle', result: null, error: '' }), active = useRef(null)
  useEffect(() => () => active.current?.abort(), [])
  const reset = () => { active.current?.abort(); setState({ phase: 'idle', result: null, error: '' }) }
  const run = async operation => {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setState({ phase: 'loading', result: null, error: '' })
    try {
      // Let the loading state paint even when the module or read result is cached.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (controller.signal.aborted) return
      const result = await operation(controller.signal)
      if (!controller.signal.aborted) setState({ phase: 'ready', result, error: '' })
    } catch (error) {
      if (!controller.signal.aborted) setState({ phase: 'error', result: null, error: error.message })
    }
  }
  return { ...state, run, reset }
}

function SimulationIntro({ description, onRun }) {
  const { t } = useTestingLocale()
  return <div className="fxa-simulation-intro"><p>{t(description)}</p><button type="button" className="fxa-button is-primary" onClick={onRun}>{t('Chạy mô phỏng')}</button></div>
}

const STOP_LOSS_SCENARIOS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
const RR_SCENARIOS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
const SCENARIO_TONES = ['blue', 'violet', 'yellow', 'red', 'teal', 'blue', 'orange', 'purple', 'lime', 'orange', 'cyan', 'green', 'teal']
const SCENARIO_COLORS = { blue:'#258bff', violet:'#9a7cff', yellow:'#e5bd00', red:'#ef5350', teal:'#13c9a5', orange:'#ff8b20', purple:'#a536ff', lime:'#8bcf00', cyan:'#00b8e6', green:'#00b85a' }

function AddScenarioDialog({ rr, scenarios, onClose, onAdd }) {
  const { t } = useTestingLocale(), id = useId(), nextId = useRef(1)
  const [rows, setRows] = useState([{ id: 0, value: '' }]), [error, setError] = useState(null)
  const addRow = () => setRows(current => {
    if (!current.at(-1)?.value.trim()) return current
    const rowId = nextId.current++
    return [...current, { id: rowId, value: '' }]
  })
  const submit = event => {
    event.preventDefault()
    const values = [], seen = new Set(scenarios)
    for (const row of rows) {
      const value = Number(row.value)
      const message = !row.value.trim() || !Number.isFinite(value) || (rr ? value <= 0 || value > 100 : !Number.isInteger(value) || value < 0 || value > 99)
        ? t(rr ? 'Nhập R lớn hơn 0 và không quá 100.' : 'Nhập mức giảm SL nguyên từ 0 đến 99%.')
        : seen.has(value) ? t('Kịch bản này đã có.') : null
      if (message) {
        setError({ id: row.id, message })
        event.currentTarget.elements.namedItem(`scenario-${row.id}`)?.focus()
        return
      }
      seen.add(value)
      values.push(value)
    }
    onAdd(values)
  }
  return <LegacyModal className="fxa-scenario-dialog" label={t(rr ? 'Kịch bản RR mới' : 'Kịch bản SL mới')} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={onClose}>
    <form onSubmit={submit} noValidate>
      {!rr && <p className="fxa-scenario-warning" id={`${id}-warning`}><TestingIcon/>{t('Kết quả kém tin cậy hơn khi giảm SL trên 60%.')}</p>}
      <div className="fxa-scenario-inputs">
        {rows.map((row, index) => <div className="fxa-scenario-input-row" key={row.id}>
          <input name={`scenario-${row.id}`} type="number" inputMode={rr ? 'decimal' : 'numeric'} min="0" max={rr ? 100 : 99} step={rr ? 'any' : 1} required placeholder={rr ? '0–100 R' : '0–99%'} aria-label={t(rr ? 'Mục tiêu R {index}' : 'Mức giảm SL {index}', { index: index + 1 })} aria-invalid={error?.id === row.id || undefined} aria-describedby={error?.id === row.id ? `${id}-error` : !rr ? `${id}-warning` : undefined} value={row.value} onChange={event => { setRows(current => current.map(item => item.id === row.id ? { ...item, value: event.target.value } : item)); setError(null) }}/>
          {(rows.length > 1 || row.value !== '') && <button type="button" className="fxa-scenario-input-remove" aria-label={t('Xóa dòng {index}', { index: index + 1 })} onClick={() => { setRows(current => current.length === 1 ? [{ ...row, value: '' }] : current.filter(item => item.id !== row.id)); setError(null) }}><TestingIcon kind="delete"/></button>}
        </div>)}
      </div>
      {error && <p role="alert" className="fxa-error" id={`${id}-error`}>{error.message}</p>}
      <button type="button" className="fxa-scenario-add-row" onClick={addRow}><TestingIcon kind="plus"/>{t(rr ? 'Thêm RR' : 'Thêm SL')}</button>
      <footer><button type="button" className="fxa-scenario-cancel" onClick={onClose}>{t('Hủy')}</button><button type="submit" className="fxa-scenario-confirm">{t('Confirm')}</button></footer>
    </form>
  </LegacyModal>
}

function ScenarioSimulator({ kind, model, data, config, loadExperiment, timezone }) {
  const { t, fmt } = useTestingLocale(), job = useSimulationRun(), rr = kind === 'risk_reward'
  const currentRR = rr && known(data.riskReward?.average) ? Math.round(Number(data.riskReward.average) * 100) / 100 : rr ? Number(config.target_r) : null
  const initialRR = rr ? (Number.isFinite(currentRR) && currentRR > 0 ? currentRR : Number(config.target_r)) : null
  const initialScenarios = () => rr ? [initialRR, ...RR_SCENARIOS.filter(value => Math.abs(value - initialRR) > 1e-12)] : STOP_LOSS_SCENARIOS
  const [draft, setDraft] = useState(() => rr ? { ...config, target_r: initialRR } : config), [scenarios, setScenarios] = useState(initialScenarios)
  const [adding, setAdding] = useState(false)
  const [runs, setRuns] = useState({})
  const [failed, setFailed] = useState([])
  const resultsRef = useRef(null)
  const busy = job.phase === 'loading'
  const title = rr ? 'RR Simulator' : 'Stop Loss Simulator'
  const scenarioOptions = rr ? scenarios : STOP_LOSS_SCENARIOS
  const selectedScenario = rr ? Number(draft.target_r) : Math.round((1 - Number(draft.stop_multiplier)) * 100)
  const riskCurve = scenarios.includes(selectedScenario) ? runs[selectedScenario] : null
  const chart = useMemo(() => scenarioChartSeries(runs, scenarios), [runs, scenarios])
  const chartDates = chart.timestamps.map(time => displayDate(time, {timeZone:timezone || 'UTC'}))
  const formatRR = value => Number.isInteger(value) ? `${value.toFixed(1)}` : `${Number(value).toFixed(2).replace(/0$/, '')}`
  const scenarioText = value => rr ? `${formatRR(value)}${Math.abs(value - currentRR) <= 1e-12 ? ` (${t('RR hiện tại')})` : ''}` : `${value}%`
  const scenarioLabel = value => rr ? <>{formatRR(value)}{Math.abs(value - currentRR) <= 1e-12 && <small> ({t('RR hiện tại')})</small>}</> : `${value}%`
  const scenarioColor = value => {
    const index = rr ? (Math.abs(value - currentRR) <= 1e-12 ? 0 : RR_SCENARIOS.includes(value) ? RR_SCENARIOS.indexOf(value) + 1 : Math.round(value) + 1) : STOP_LOSS_SCENARIOS.includes(value) ? STOP_LOSS_SCENARIOS.indexOf(value) : Math.round(value)
    return SCENARIO_COLORS[SCENARIO_TONES[index % SCENARIO_TONES.length]]
  }
  const renderBestSummary = (text, value) => {
    const marker = String(value), index = text.indexOf(marker)
    if (!marker || index < 0) return text
    return <>{text.slice(0, index)}<span className="fxa-scenario-best-value">{marker}</span>{text.slice(index + marker.length)}</>
  }
  const comparison = useMemo(() => scenarioResults(runs, scenarios, data.rows, kind), [runs, scenarios, data.rows, kind])
  const smallSample = comparison.sourceWins < 5 || comparison.sourceLosses < 5
  const excludedCount = Math.max(0, data.count - comparison.commonCount)
  const columns = [
    [null, rr ? 'Mục tiêu R' : 'Mức giảm SL', rr ? 'Thử mục tiêu chốt lời khác nhau, giữ nguyên SL gốc và so sánh với giao dịch đã đóng.' : 'Thử khoảng dừng lỗ cấu hình trong thời gian giữ lệnh gốc. Giữ phí và quy tắc intrabar; không sửa giao dịch đã lưu.'],
    ['winRate', 'Tỉ lệ thắng', 'Số lệnh thắng chia cho tổng lệnh thắng và thua; loại lệnh hòa vốn. Chỉ dùng tập giao dịch chung đủ dữ liệu.'],
    ['totalR', 'Tổng R', 'Tổng kết quả theo R của từng giao dịch. 1R là rủi ro gốc của chính lệnh đó, không phải phần trăm vốn.'],
    ['profit', 'Lợi nhuận', 'Tổng lãi/lỗ mô phỏng trên cùng tập giao dịch của biểu đồ. Dùng khối lượng và phí từ bộ mô phỏng hiện tại; không tự đổi khối lượng để giữ rủi ro tiền cố định. Không cộng các đồng tiền khác nhau.'],
    ['profitFactor', 'Hệ số lợi nhuận', 'Tổng R của lệnh thắng chia cho độ lớn tổng R của lệnh thua. Không dùng tiền để tránh thiên lệch do khối lượng. Không có lệnh thua và có lãi: ∞.'],
    ['averageDrawdown', 'Sụt giảm TB', 'Trung bình độ sâu từ đỉnh đến đáy của từng đợt sụt giảm trên đường R lũy kế; tính cả đợt chưa phục hồi. Hiển thị bằng R âm.'],
  ]
  const metricText = (entry, metric) => entry[metric] === null ? 'N/A' : entry[metric] === Infinity ? '∞' : fmt(metric === 'averageDrawdown' ? -entry[metric] : entry[metric], metric === 'winRate' ? '%' : metric === 'totalR' || metric === 'averageDrawdown' ? ' R' : metric === 'profit' ? ` ${comparison.currency}` : '')
  const selectScenario = (value, values = [value]) => {
    const next = { ...draft, ...(rr ? { target_r: value } : { stop_multiplier: (100 - value) / 100 }) }
    setDraft(next)
    run(next, values)
  }
  const removeScenario = value => {
    if (rr && Math.abs(value - currentRR) <= 1e-12) return
    const remaining = scenarios.filter(item => item !== value)
    setScenarios(remaining)
    setFailed(current => current.filter(item => item !== value))
    if (selectedScenario === value) {
      if (remaining.length) selectScenario(remaining[0])
      else job.reset()
    }
  }
  const addScenarios = values => {
    setScenarios(current => rr ? [currentRR, ...[...new Set([...current, ...values])].filter(value => Math.abs(value - currentRR) > 1e-12).sort((a, b) => a - b)] : [...current, ...values].sort((a, b) => a - b))
    setAdding(false)
    selectScenario(values.at(-1), values)
    requestAnimationFrame(() => resultsRef.current?.focus({ preventScroll: true }))
  }
  const run = (configuration = draft, values = scenarios) => {
    const selected = rr ? Number(configuration.target_r) : Math.round((1 - Number(configuration.stop_multiplier)) * 100)
    const pending = [...new Set([selected, ...values])].filter(value => !runs[value])
    if (!pending.length) return
    job.run(async signal => {
      if (!loadExperiment) throw new Error('Nguồn này chưa hỗ trợ mô phỏng từ đường giá.')
      const failures = []
      for (const value of pending) {
        if (signal.aborted) return
        const request = Object.fromEntries(Object.entries({ ...configuration, ...(rr ? {target_r:value} : {stop_multiplier:(100-value)/100}) }).map(([key, value]) => [key, Number(value)]))
        try {
          const payload = await loadExperiment(request, signal)
          if (signal.aborted) return
          const {eligible} = scenarioRiskCurve(payload.rows, data.rows, kind)
          const rows = payload.rows.map(row => ({trade_id:row.trade_id,[kind]:row[kind]}))
          setRuns(current => ({ ...current, [value]: {eligible, rows} }))
        } catch (error) {
          if (signal.aborted) return
          failures.push(value)
        }
      }
      if (!signal.aborted) setFailed(current => [...current.filter(value => !pending.includes(value)), ...failures])
      return true
    })
  }
  return <ReportSection headingOutside className="fxa-scenario-panel" title={title}
    help={rr ? 'Thử các thiết lập tỷ lệ lợi nhuận/rủi ro khác nhau để xem giao dịch của bạn sẽ hoạt động thế nào trong điều kiện mới — không cần backtest lại.' : 'Thử khoảng dừng lỗ cấu hình trong thời gian giữ lệnh gốc. Giữ phí và quy tắc intrabar; không sửa giao dịch đã lưu.'}
    actions={rr ? <a className="fxa-help-link" href="https://fx-replay.notion.site/What-is-the-RR-Simulator-2479db20207480bb883bd263526d24de" target="_blank" rel="noreferrer">{t('Cách tính')} ↗</a> : null}>
    {job.phase === 'idle' && scenarios.length > 0 && !scenarios.some(value => runs[value]) ? <SimulationIntro description={rr ? 'Thử mục tiêu chốt lời khác nhau, giữ nguyên SL gốc và so sánh với giao dịch đã đóng.' : 'Thử khoảng dừng lỗ khác nhau và so sánh với giao dịch đã đóng.'} onRun={() => run()}/> : <>
      <div className="fxa-simulation-scenarios" role="group" aria-label={t(rr ? 'Mục tiêu R' : 'Mức giảm SL')}>
        <div className="fxa-scenario-chips">{scenarios.map(value => <span className="fxa-scenario-chip" style={{'--fxa-chip-color':scenarioColor(value)}} key={value}><button type="button" aria-pressed={selectedScenario === value} disabled={busy} onClick={() => selectScenario(value)}>{rr ? scenarioLabel(value) : <>{value}%{value === 0 && <small> ({t('SL hiện tại')})</small>}</>}</button>{(rr ? Math.abs(value - currentRR) > 1e-12 : value !== 0) && <button type="button" className="fxa-scenario-chip-remove" aria-label={t('Xóa kịch bản {value}', { value: rr ? `${formatRR(value)}R` : `${value}%` })} disabled={busy} onClick={() => removeScenario(value)}>×</button>}</span>)}</div>
        <button type="button" className="fxa-add-scenario" disabled={busy} onClick={() => setAdding(true)}><TestingIcon kind="plus"/>{t(rr ? 'Add new' : 'Thêm kịch bản')}</button>
      </div>
      {adding && <AddScenarioDialog rr={rr} scenarios={scenarios} onClose={() => setAdding(false)} onAdd={addScenarios}/>}
      <div ref={resultsRef} tabIndex={-1} role="region" aria-label={t(title)} aria-busy={busy} className="fxa-simulation-results">
        {busy && <p role="status" className="fxa-simulation-progress">{t('Đang mô phỏng từ đường giá…')}</p>}
        {(job.phase === 'error' || failed.length > 0) && <div role="alert" className="fxa-error">{failed.length ? t('Chưa tính được kịch bản {values}.', {values:failed.map(scenarioText).join(', ')}) : t(job.error)} <button type="button" className="fxa-button" disabled={busy} onClick={() => run()}>{t('Thử lại')}</button></div>}
        {chart.timestamps.length ? <AnalyticsCurve series={chart.series} seriesMeta={chart.values.map(value => ({label:scenarioText(value),color:scenarioColor(value),selected:value===selectedScenario}))} label={t('R lũy kế theo ngày đóng lệnh trên chart')} labels={chartDates} axisLabels={chartDates} timestamps={chart.timestamps} yTitle={t('R lũy kế')} suffix=" R" height={420} controls/> : !busy && <div className="fxa-chart-empty">{t('Chưa có tập giao dịch chung đủ dữ liệu cho biểu đồ R.')}</div>}
        {riskCurve && <>
          <section className="fxa-scenario-summary" aria-label={t('Kết quả mô phỏng')}>
            <div className="fxa-scenario-summary-heading"><h3>{t('Kết quả')}</h3><p>
              {comparison.bestValue !== null ? renderBestSummary(t(rr ? 'Dựa trên phân tích của bạn, RR {value} cho kết quả tổng thể tốt nhất.' : comparison.bestValue === 0 ? 'Dựa trên {known}/{total} giao dịch, SL hiện tại cho kết quả tổng thể tốt nhất.' : 'Dựa trên {known}/{total} giao dịch, giảm SL {value}% cho kết quả tổng thể tốt nhất.', rr ? {value:formatRR(comparison.bestValue)} : {known:comparison.commonCount,total:data.count,value:fmt(comparison.bestValue)}), rr ? formatRR(comparison.bestValue) : comparison.bestValue === 0 ? '' : `${fmt(comparison.bestValue)}%`)
                : t('Có {known}/{total} giao dịch chung đủ dữ liệu; chưa đủ kịch bản để chọn kết quả tốt nhất.', {known:comparison.commonCount,total:data.count})}

            </p></div>
            {!rr && <><p className="fxa-scenario-result-notice"><TestingIcon/>{t(smallSample ? 'Mẫu có dưới 5 lệnh thắng hoặc dưới 5 lệnh thua; kết quả kém tin cậy hơn.' : 'Độ tin cậy giảm nếu mẫu có dưới 5 lệnh thắng hoặc dưới 5 lệnh thua.')}</p>
            <p className="fxa-scenario-result-notice"><TestingIcon/>{excludedCount ? t('Có {count} giao dịch không nằm trong tập so sánh chung vì thiếu đường giá, kết quả mô phỏng, rủi ro gốc hoặc ngày đóng lệnh.', {count:excludedCount}) : t('Đã dùng đủ {count}/{count} giao dịch. Chỉ các lệnh đủ đường giá, kết quả mô phỏng, rủi ro gốc và ngày đóng lệnh mới được đưa vào so sánh.', {count:data.count})}</p></>}

          </section>
          <div className="fxa-scenario-details">
            <DataTable className="fxa-scenario-table" label={t(title)} contained scrollAxis="x">
              <thead><tr>{columns.map(([metric,label,help]) => <th scope="col" className={metric ? 'is-numeric' : undefined} key={label}><span className="fxa-scenario-column-heading">{t(label)}<Info text={help} mini/></span></th>)}</tr></thead>
              <tbody>{comparison.entries.map(entry => <tr key={entry.value}>
                <td><span className="fxa-scenario-row-label" style={{'--fxa-chip-color':scenarioColor(entry.value)}}>{scenarioLabel(entry.value)}{entry.value === 0 && <small> ({t('SL hiện tại')})</small>}</span></td>
                {columns.slice(1).map(([metric]) => <td className={`is-numeric${entry[metric] !== null && entry[metric] === comparison.bestCells[metric] ? ' is-best-cell' : ''}`} key={metric}>{metricText(entry,metric)}</td>)}
              </tr>)}</tbody>

            </DataTable>
          </div>
        </>}
      </div>
    </>}
  </ReportSection>
}

function MonteCarloSimulator({ model, data }) {
  const { t, fmt, locale } = useTestingLocale(), job = useSimulationRun(), formId = useId()
  const currency = model.result?.account_currency
  const currencies = new Set(data.rows.map(row => row.account_currency).filter(Boolean))
  const compatible = Boolean(currency) && !model.result?.multi_currency && (currencies.size === 0 || currencies.size === 1 && currencies.has(currency))
  const initialConfig = () => monteCarloDefaults(compatible ? data.rows : [], compatible ? data.endingBalance : null)
  const [mc,setMc] = useState(initialConfig), [applied,setApplied] = useState(null), [touched,setTouched] = useState({})
  const busy = job.phase === 'loading', result = job.result
  const run = () => { const next = {...mc}, seed = crypto.getRandomValues(new Uint32Array(1))[0]; setApplied(next); job.run(() => monteCarlo({...next,seed},data.rows)) }
  const reset = () => { job.reset(); setMc(initialConfig()); setApplied(null); setTouched({}) }
  const fields = [['simulations','Số lượt mô phỏng',1,1000,1],['trades','Lệnh mỗi lượt',1,1000,1],['capital',`Vốn bắt đầu (${currencyLabel(currency) || t('Đơn vị tài khoản')})`,.01,undefined,'any'],['averageWin','Lãi trung bình',0,undefined,'any'],['averageLoss','Độ lớn lỗ trung bình',0,undefined,'any'],['winRate','Win rate (%)',0,100,'any']]
  const errors = monteCarloInputErrors(mc)
  const input = ([key,label,min,max,step]) => {
    const error = touched[key] && errors[key], errorId = `${formId}-${key}-error`
    return <label className="fxa-field" key={key}><span>{t(label)}</span><input name={key} aria-label={t(label)} {...fieldValidationProps(error,errorId)} type="number" min={min} max={max} step={step} required disabled={busy || !compatible} value={mc[key] ?? ''} onChange={event=>setMc(current=>({...current,[key]:event.target.value}))}/><FieldError id={errorId} error={error}/></label>
  }
  const moneyAxis = value => currency === 'USD' ? `$${new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)}` : /^[A-Z]{3}$/i.test(currency || '') ? new Intl.NumberFormat(locale,{style:'currency',currency,currencyDisplay:'narrowSymbol',minimumFractionDigits:2,maximumFractionDigits:2}).format(value) : fmt(value,currency ? ` ${currency}` : '')
  const colors = ['blue','positive','negative','peach','violet','gold']
  const displayResult = result || { average: 0, max: 0, min: 0, averageProfitFactor: 0, maxWinStreak: 0, maxLossStreak: 0, totalWins: 0, totalLosses: 0 }
  const displayLabels = result ? Array.from({length:Number(applied.trades)+1}, (_, index) => String(index)) : []
  return <ReportSection headingOutside className="fxa-monte-panel" title="Monte Carlo Simulation" help={t('Monte Carlo calculation help',{winStd:fmt(mc.winStd,` ${currencyLabel(currency) || currency || ''}`),lossStd:fmt(mc.lossStd,` ${currencyLabel(currency) || currency || ''}`)})}>
    <div data-testid="monte-carlo-simulator">
      {!compatible && <p role="status">{t('Chọn phạm vi giao dịch cùng một đơn vị tiền để mô phỏng.')}</p>}
      <form className="fxa-monte-controls" noValidate onSubmit={event=>{event.preventDefault();if(Object.keys(errors).length){setTouched(Object.fromEntries(fields.map(([key])=>[key,true])));focusFirstInvalid(event.currentTarget);return}run()}}>
        {fields.map(input)}
        <button type="button" className="fxa-button" onClick={reset}>{t(busy ? 'Hủy' : 'Đặt lại')}</button>
        <button type="submit" className="fxa-button is-primary" disabled={busy || !compatible}>{t(busy ? 'Đang tính…' : result ? 'Chạy lại' : 'Chạy mô phỏng')}</button>
      </form>
      {busy && <p role="status">{t('Đang tính…')}</p>}
      {job.phase === 'error' && <p role="alert" className="fxa-error">{t(job.error)}</p>}
      <div className="fxa-monte-output" aria-busy={busy}>
        {result && JSON.stringify(applied) !== JSON.stringify(mc) && <p role="status">{t('Cấu hình đã đổi; chạy lại để cập nhật kết quả.')}</p>}
        <AnalyticsCurve series={result ? result.paths.map(path=>path.map(value=>({value}))) : []} seriesMeta={result ? result.paths.map((_,index)=>({label:t('Lượt {count}',{count:index+1}),color:`var(--report-${colors[index % colors.length]})`})) : []} labels={displayLabels} interpolation="linear" label={t('Số dư mô phỏng Monte Carlo')} formatYTick={moneyAxis} emptyAxes={!result} suffix={` ${currencyLabel(currency) || currency || ''}`} height={380}/>
        <div className="fxa-monte-metrics fxa-metrics" role="group" aria-label={t('Kết quả mô phỏng')}>
          <Stat label="Average balance" value={fmt(displayResult.average,` ${currencyLabel(currency) || currency}`)} help="Trung bình số dư cuối của tất cả lượt mô phỏng."/>
          <Stat label="Max balance" value={fmt(displayResult.max,` ${currencyLabel(currency) || currency}`)} help="Số dư cuối lớn nhất trong các lượt đã chạy."/>
          <Stat label="Min balance" value={fmt(displayResult.min,` ${currencyLabel(currency) || currency}`)} help="Số dư cuối nhỏ nhất trong các lượt đã chạy."/>
          <Stat label="Hệ số lợi nhuận TB" value={displayResult.averageProfitFactor === Infinity ? '∞' : known(displayResult.averageProfitFactor) ? fmt(displayResult.averageProfitFactor) : 'N/A'} help="Trung bình Profit Factor từng lượt. Tất cả lượt có lãi và không lỗ: ∞. Nếu trộn lượt hữu hạn, vô hạn hoặc không xác định: N/A; không thay mẫu số lỗ bằng 1."/>
          <Stat label="Chuỗi thắng dài nhất" value={fmt(displayResult.maxWinStreak,'',0)} help="Chuỗi thắng liên tiếp dài nhất trong một lượt; không nối giữa các lượt."/>
          <Stat label="Chuỗi thua dài nhất" value={fmt(displayResult.maxLossStreak,'',0)} help="Chuỗi thua liên tiếp dài nhất trong một lượt; không nối giữa các lượt."/>
          <Stat label="Tổng lệnh thắng" value={fmt(displayResult.totalWins,'',0)} help="Tổng lệnh có lãi đã thực hiện trên tất cả lượt."/>
          <Stat label="Tổng lệnh thua" value={fmt(displayResult.totalLosses,'',0)} help="Tổng lệnh lỗ đã thực hiện trên tất cả lượt; không đếm bước sau khi cạn vốn."/>
        </div>
      </div>
    </div>
  </ReportSection>
}

export function AnalyticsSimulation({ model, data, config, loadExperiment, timezone }) {
  return <div className="fxa-report fxa-visual-report fxa-simulation-report" data-testid="analytics-simulation">
    <ScenarioSimulator kind="stop_loss" {...{model,data,config,loadExperiment,timezone}}/>
    <ScenarioSimulator kind="risk_reward" {...{model,data,config,loadExperiment,timezone}}/>
    <MonteCarloSimulator {...{model,data}}/>
  </div>
}


export function FxAnalyticsReport({ model, extra, experiments, experimentStatus, experimentError, config, selected, onSelect, onTabChange, loadExperiment, propReport, experimentScope, onNeedExperiments }) {
  const { t } = useTestingLocale()

  const [threshold, setThreshold] = useState(0)
  // R-based classification can filter every row before the risk panel is visible.
  useEffect(() => { if (threshold > 0) onNeedExperiments?.() }, [threshold, experimentScope, onNeedExperiments])
  const data = useMemo(() => advancedAnalytics(model, extra, { breakevenThreshold: threshold, experiments }), [model, extra, threshold, experiments])
  useSyncExternalStore(subscribeNavigation, navigationSnapshot)
  const requestedTab = new URLSearchParams(window.location.search).get('analytics_tab')
  const [previewTab, setPreviewTab] = useState(() => ['performance', 'drawdown', 'simulation'].includes(requestedTab) ? requestedTab : 'performance')
  const tab = model.result?.preview ? previewTab : ['performance', 'drawdown', 'simulation'].includes(requestedTab) ? requestedTab : 'performance'
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([tab]))
  useEffect(() => {
    setVisitedTabs(current => current.has(tab) ? current : new Set([...current, tab]))
    onTabChange?.(tab)
  }, [tab, onTabChange])
  const choose = value => { setPreviewTab(value); setVisitedTabs(current => current.has(value) ? current : new Set([...current, value])); onTabChange?.(value); const url = new URL(window.location.href); url.searchParams.set('analytics_tab', value); navigate(url, { replace: true }) }
  const empty = !data.count ? model.result?.partial || model.result?.status === 'partial' ? <TestingTradesEmpty incomplete /> : model.result?.scope?.total_trade_count === 0 ? <TestingTradesEmpty /> : model.ledger.length || model.result?.scope?.total_trade_count > 0 ? <TestingTradesEmpty filtered /> : null : null
  if (empty && !propReport) return empty
  return <><div className="fxa-report-tabs" role="tablist" aria-label={t("Phân tích")}><>{[['performance', 'Performance'], ['drawdown', 'Drawdown'], ['simulation', 'Simulation']].map(([value, label]) => <button className="fxa-tab" id={`fxa-tab-${value}`} role="tab" key={value} aria-selected={tab === value} aria-controls="fxa-report-panel" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { const tabs = ['performance', 'drawdown', 'simulation']; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3; choose(tabs[index]); document.getElementById(`fxa-tab-${tabs[index]}`)?.focus() } }} onClick={() => choose(value)}>{t(label)}</button>)}</></div><div id="fxa-report-panel" role="tabpanel" aria-labelledby={`fxa-tab-${tab}`} tabIndex={0}>
    {(tab === 'performance' || visitedTabs.has('performance')) && <div hidden={tab !== 'performance'}>{empty ? <>{propReport && <PropChallengeObjectives report={propReport}/>} {empty}</> : <AnalyticsPerformance model={model} data={data} extra={extra} onSelect={onSelect} selected={selected} threshold={threshold} onThreshold={setThreshold} experiments={experiments} propReport={propReport} active={tab === 'performance'} experimentScope={experimentScope} onNeedExperiments={onNeedExperiments}/>}</div>}
    {(tab === 'drawdown' || visitedTabs.has('drawdown')) && <div hidden={tab !== 'drawdown'}>{empty || <AnalyticsDrawdown model={model} data={data} extra={extra} experiments={experiments} experimentStatus={experimentStatus} experimentError={experimentError} active={tab === 'drawdown'} experimentScope={experimentScope} onNeedExperiments={onNeedExperiments} />}</div>}
    {(tab === 'simulation' || visitedTabs.has('simulation')) && <div hidden={tab !== 'simulation'}>{empty || <AnalyticsSimulation key={JSON.stringify([model.result?.session_id, model.result?.revision, model.result?.cursor_index, model.result?.execution_event_sequence, model.result?.filters, extra])} model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} experimentError={experimentError} config={config} loadExperiment={loadExperiment} timezone={extra?.timezone} />}</div>}
  </div></>
}
