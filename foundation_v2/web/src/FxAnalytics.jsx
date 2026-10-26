import DataTable from './DataTable.jsx'
import { navigate, navigationSnapshot, subscribeNavigation } from './clientNavigation.js'
import { TestingTradesEmpty } from './TestingPageState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import { advancedAnalytics, known, number } from './tradingAnalyticsModel.js'
import './fx-analytics.css'
import { AnalyticsCurve, AnalyticsBars, AnalyticsRing, AnalyticsRadar } from './AnalyticsCharts.jsx'
export { AnalyticsCurve } from './AnalyticsCharts.jsx'
import { profitFactorGauge, bucketCurve, excursionSummary, scenarioComparison, realizedRiskSeries, idealRiskSummary } from './analyticsPresentation.js'
import { displayDate } from './dateFormat.js'
import AnalyticsFilterBar from './AnalyticsFilterBar.jsx'
import LedgerFilterDrawer from './LedgerFilterDrawer.jsx'
import FxSelect from './FxSelect.jsx'
import LedgerFilterActions from './LedgerFilterActions.jsx'
import TestingIcon from './TestingIcon.jsx'

export const fmt = (value, suffix = '', digits = 2) => known(value) ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}` : '-'
export function SelectField({ label, value, onChange, options, disabled }) {
  const { t } = useTestingLocale()

  return <label className="fxa-field"><span>{t(label)}</span><FxSelect label={label} value={value} onChange={onChange} disabled={disabled} options={options.map(([value, label]) => ({ value, label }))} /></label>
}
export function FxAnalyticsFilters({ filters, onChange, extra, onExtra, rows, labels, onExport, pending, ledgerOnly, sessionControl, onClearSessions, columnControl, facets, persistInUrl, sourceType, statusControl, disabled = false }) {
  if (!ledgerOnly) return <AnalyticsFilterBar {...{ filters, onChange, extra, onExtra, rows, labels, onExport, pending, sessionControl, persistInUrl, sourceType, statusControl, disabled }} />
  return <LedgerFilters {...{ filters, onChange, extra, onExtra, rows, onExport, pending, sessionControl, onClearSessions, columnControl, facets, statusControl, disabled }} />
}
function LedgerFilters({ filters, onChange, extra, onExtra, rows, sessionControl, columnControl, facets, statusControl, disabled }) {
  const { t } = useTestingLocale()

  const [drawer, setDrawer] = useState('')
  return <section className="fxa-filters" inert={disabled || undefined} aria-disabled={disabled || undefined} aria-label={t("Bộ lọc giao dịch")} data-testid="analytics-filters">
    <div className="fxa-filter-toolbar is-ledger"><div className="fxl-session-scope">{sessionControl}{statusControl}</div><LedgerFilterActions columnControl={columnControl} activeTab={drawer} onOpen={setDrawer} /></div>
    {drawer && <LedgerFilterDrawer initialTab={drawer} {...{ filters, extra, rows, facets }} onApply={(next, nextExtra) => { onChange(next); onExtra(nextExtra) }} onClose={() => setDrawer('')} />}
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
function ReportSection({ title, subtitle, help, actions, children, className = '', label }) {
  const { t } = useTestingLocale()
  return <section className={`fxa-section fxa-panel ${className}`} aria-label={label ? t(label) : undefined}>{(title || actions) && <div className="fxa-section-heading"><div><div className="fxa-panel-title"><h2>{t(title)}</h2>{help && <Info text={help}/>}</div>{subtitle && <p className="fxa-panel-subtitle">{t(subtitle)}</p>}</div>{actions && <div className="fxa-panel-actions">{actions}</div>}</div>}{children}</section>
}
function BreakevenThreshold({ threshold, onThreshold }) {
  const { t } = useTestingLocale(), [draft, setDraft] = useState(String(threshold)), id = useId()
  return <form className="fxa-threshold" onSubmit={event => { event.preventDefault(); onThreshold(Number(draft)) }}><div className="fxa-threshold-label"><label htmlFor={id}>{t('Ngưỡng hòa vốn')}</label><Info text="Ngưỡng phân loại hòa vốn. Hiện tính theo độ lớn lãi/lỗ ròng trong tiền tài khoản; không thay đổi lợi nhuận hay giao dịch đã lưu."/></div><input id={id} type="number" min="0" step="any" required value={draft} onChange={event => setDraft(event.target.value)}/><button className="fxa-button" type="submit" disabled={Number(draft) === threshold}>{t('Áp dụng')}</button></form>
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
const COUNT_WIN = "Số giao dịch đã đóng có lãi/lỗ ròng cao hơn ngưỡng hòa vốn đang áp dụng."
const COUNT_LOSS = "Số giao dịch đã đóng có lãi/lỗ ròng thấp hơn ngưỡng hòa vốn âm đang áp dụng."
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
    <div className="fxa-average-bar" aria-hidden="true">{total > 0 && <><i style={{ flex: Math.abs(data.averageWin ?? 0) }}/><i style={{ flex: Math.abs(data.averageLoss ?? 0) }}/></>}</div>
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

function MonthMatrix({ items, currency, startBalance }) {
  const { t, fmt } = useTestingLocale(), [basis,setBasis] = useState('money')
  const years = [...new Set(items.map(item => item.label.slice(0,4)))].sort()
  const amount = value => !known(value) ? '-' : basis === 'percent' ? number(startBalance) > 0 ? fmt(value / Number(startBalance) * 100,'%') : 'N/A' : fmt(value)
  return <><div className="fxa-inline-actions"><UnitTabs label="Đơn vị hiệu suất tháng" value={basis} onChange={setBasis} options={[["money",currency],["percent",'% vốn ban đầu']]}/></div>{years.length ? <div className="fxa-month-scroll" tabIndex={0} role="region" aria-label={t('Performance by month')}><table className="fxa-month-matrix"><thead><tr><th>{t('Năm')}</th>{Array.from({length:12},(_,index) => <th key={index}>{String(index+1).padStart(2,'0')}</th>)}<th>{t('Cả năm')}</th></tr></thead><tbody>{years.map(year => <tr key={year}><th scope="row">{year}</th>{Array.from({length:12},(_,index) => { const item = items.find(item => item.label === `${year}-${String(index+1).padStart(2,'0')}`); return <td key={index} className={item?.net > 0 ? 'is-positive' : item?.net < 0 ? 'is-negative' : ''}>{amount(item?.net)}</td> })}<td className="fxa-year-total">{amount(items.filter(item => item.label.startsWith(year)).reduce((sum,item) => sum+item.net,0))}</td></tr>)}</tbody></table></div> : <p className="fxa-empty">{t('Chưa có dữ liệu')}</p>}</>
}
function PerformanceCalendar({ items, timezone, currency }) {
  const { t, fmt } = useTestingLocale(), [chosen,setChosen] = useState(''), [metric,setMetric] = useState('net')
  const available = [...new Set(items.map(item => item.label.slice(0,7)))].sort(), month = available.includes(chosen) ? chosen : available.at(-1)
  if (!month) return <p className="fxa-empty">{t('Chưa có dữ liệu')}</p>
  const [year,m] = month.split('-').map(Number), days = new Date(Date.UTC(year,m,0)).getUTCDate(), offset = (new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7
  return <><div className="fxa-inline-actions"><FxSelect label="Tháng trên lịch" value={month} onChange={setChosen} options={available.map(value=>({value,label:`${value.slice(5)}/${value.slice(0,4)}`}))}/><FxSelect label="Chỉ số lịch" value={metric} onChange={setMetric} options={[{value:'net',label:`Lợi nhuận (${currency})`},{value:'winRate',label:'Tỉ lệ thắng'},{value:'count',label:'Số giao dịch'},{value:'averageR',label:'R trung bình'}]}/></div><div className="fxa-calendar" role="group" aria-label={`${t('Performance calendar')} ${month} · ${timezone}`}>
    {['T2','T3','T4','T5','T6','T7','CN'].map(day=><span className="fxa-calendar-weekday" key={day}>{t(day)}</span>)}{Array.from({length:offset},(_,index)=><span key={`empty-${index}`} aria-hidden="true"/>)}
    {Array.from({length:days},(_,index)=>{const day=index+1,item=items.find(item=>item.label===`${month}-${String(day).padStart(2,'0')}`),value=item?.[metric],suffix=metric==='winRate'?'%':metric==='averageR'?' R':'';return <div className={`fxa-calendar-day ${item?.net>0?'is-positive':item?.net<0?'is-negative':''}`} key={day} tabIndex={item?0:undefined} data-tooltip={item?`${day}/${m}/${year} · ${fmt(value,suffix)} · ${item.count} ${t('lệnh')}`:undefined}><span>{day}</span><strong>{item?known(value)?fmt(value,suffix,metric==='count'?0:2):'N/A':'-'}</strong>{item&&<small>{item.count} {t('lệnh')}</small>}</div>})}
  </div></>
}

export function AnalyticsPerformance({ model, data, extra, onSelect, selected, threshold, onThreshold, experiments }) {
  const { t, fmt } = useTestingLocale(), [metric,setMetric] = useState('net'), [interval,setInterval] = useState('all')
  const currency=model.result?.account_currency||t('Đơn vị tài khoản'), suffix=metric==='winRate'?'%':metric==='averageR'?' R':metric==='net'?` ${currency}`:''
  const actualCurve=data.curve.map(point=>({...point,value:known(point.value)&&known(model.startBalance)?point.value-Number(model.startBalance):null})), bucket=bucketCurve(actualCurve,data.rows,interval,extra.timezone)
  const curveLabels=bucket.labels.map((value,index)=>value?displayDate(value,{timeStyle:interval==='day'?undefined:'short',timeZone:extra.timezone}):index?`#${index}`:t('Bắt đầu'))
  const curveDates=bucket.labels.map(value=>value?displayDate(value,{timeStyle:'short',timeZone:extra.timezone,fallback:''}):'')
  const sameDay=new Set(curveDates.filter(Boolean).map(value=>value.slice(0,10))).size===1, sameYear=new Set(curveDates.filter(Boolean).map(value=>value.slice(6,10))).size===1
  const curveAxisLabels=curveDates.map(value=>!value?'':sameDay?value.slice(11):value.slice(0,sameYear?5:10))
  const riskSeries=realizedRiskSeries(experiments,data.rows),rValues=riskSeries.map(point=>point.value),averageR=rValues.length?rValues.reduce((a,b)=>a+b,0)/rValues.length:null,maxR=rValues.length?Math.max(...rValues):null
  const ideal=idealRiskSummary(experiments,data.rows)
  const averageHelp='RR trung bình là tỷ lệ lợi nhuận/rủi ro bình quân mỗi giao dịch. Ví dụ RR bằng 2 tương ứng lợi nhuận bằng 2 lần mức rủi ro.\n\nHiện dùng lãi/lỗ ròng chia rủi ro ban đầu của các lệnh có dữ liệu.'
  const maxHelp='RR lớn nhất đã thực hiện trong các giao dịch có dữ liệu rủi ro ban đầu.\n\nBiểu đồ nhỏ phía dưới cho biết RR của từng giao dịch.'
  const idealHelp='RR lý tưởng là tỷ lệ lợi nhuận/rủi ro tối đa có thể đạt nếu giữ lệnh tới một tuần sau khi mở.\n\nGiá trị trung bình dùng các cửa sổ đủ dữ liệu trong phạm vi báo cáo; đỉnh trên biểu đồ giúp nhìn lại cơ hội có thể đã chốt quá sớm.'
  const maxIdealHelp='RR lý tưởng lớn nhất trong toàn bộ giao dịch đủ dữ liệu của bộ lọc, gồm cả lệnh thắng và thua.\n\nMỗi lệnh được quan sát tới một tuần sau khi mở để tìm mức lãi/lỗ ròng cao nhất so với rủi ro ban đầu. Giá quan sát không bảo đảm khớp lệnh thực tế.'
  const totalPercent=number(model.startBalance)>0&&known(data.net)?data.net/Number(model.startBalance)*100:null
  const performanceControls=<FxSelect label="Chỉ số hiệu suất" value={metric} onChange={setMetric} options={[{value:'net',label:`Lợi nhuận (${currency})`},{value:'averageR',label:'R trung bình'},{value:'winRate',label:'Tỉ lệ thắng'},{value:'count',label:'Số giao dịch'}]}/>
  return <div className="fxa-report fxa-visual-report" data-testid="analytics-performance">
    <ReportSection title="Profit and loss" className="fxa-profit-panel" actions={<UnitTabs label="Độ chi tiết biểu đồ" value={interval} onChange={setInterval} options={[["all",'Tất cả'],['day','Ngày'],['hour','1 giờ'],['quarter','15 phút']]}/>}>
      <div className="fxa-metrics fxa-profit-metrics">
        <Stat label="Total PnL" value={<>{fmt(data.net,` ${currency}`)}<PercentChange value={totalPercent}/></>} help="Lãi/lỗ cho biết số tiền bạn kiếm được hoặc mất đi. Giá trị hiện tại là lãi/lỗ ròng sau phí trong bộ lọc."/>
        <Stat label="Số dư tài khoản" value={<>{fmt(data.endingBalance,` ${currency}`)}<PercentChange value={totalPercent}/></>} help={data.localFiltered||model.result?.scope?.active_filters?'Số dư dựng lại từ vốn ban đầu và các giao dịch đã lọc.':'Số dư tài khoản sau các giao dịch đã đóng trong phạm vi đang chọn; không bao gồm lãi/lỗ thả nổi.'}/>
        <Stat label="Win rate" value={fmt(data.winRate,'%')} help="Tỷ lệ giao dịch kết thúc có lãi trên tổng giao dịch đã đóng."/>
        <Stat label="Total trades" value={<>{fmt(data.count,'',0)}<sup className="fxa-trade-split"><span aria-label={t('Thắng / thua')}>{fmt(data.wins,'',0)}/{fmt(data.losses,'',0)}</span><Info mini text="Số bên trái là giao dịch thắng; số bên phải là giao dịch thua. Không bao gồm giao dịch hòa vốn."/></sup></>} help="Tổng số giao dịch đã đóng, bao gồm lệnh thắng, thua và hòa vốn."/>
        <Stat label="Giao dịch hòa vốn" value={fmt(data.breakeven,'',0)} help="Tổng số giao dịch hòa vốn theo ngưỡng đang áp dụng."/>
        <BreakevenThreshold threshold={threshold} onThreshold={onThreshold}/>
      </div>
      <AnalyticsCurve key={interval} series={[bucket.points]} label={t('Lãi/lỗ ròng tích lũy')} labels={curveLabels} axisLabels={curveAxisLabels} suffix={` ${currency}`} onSelect={onSelect} selected={selected} height={200} stretch controls/>
    </ReportSection>
    <div className="fxa-three-columns fxa-risk-panels">
      <ReportSection label="RR thực hiện"><div className="fxa-metrics"><Stat label="RR trung bình" value={known(averageR)?fmt(averageR):'N/A'} help={averageHelp}/><Stat label="RR lớn nhất" value={known(maxR)?fmt(maxR):'N/A'} help={maxHelp}/></div><AnalyticsCurve series={[riskSeries]} labels={riskSeries.map((_,index)=>`#${index+1}`)} label={t('RR thực hiện theo giao dịch')} suffix=" R" height={48} sparkline/></ReportSection>
      <ReportSection label="RR lý tưởng"><div className="fxa-metrics"><Stat label="RR lý tưởng trung bình" value={known(ideal.average)?fmt(ideal.average):'N/A'} help={idealHelp}/><Stat label="RR lý tưởng lớn nhất" value={known(ideal.max)?fmt(ideal.max):'N/A'} help={maxIdealHelp}/></div><AnalyticsCurve series={[ideal.series]} labels={ideal.series.map((_,index)=>`#${index+1}`)} label={t('RR lý tưởng')} suffix=" R" height={48} sparkline/></ReportSection>
      <ReportSection label="Có thể có lãi / hòa vốn"><div className="fxa-metrics"><Stat label="Có thể có lãi / hòa vốn" value={known(ideal.recoveryCount)?fmt(ideal.recoveryCount,'',0):'N/A'} help="Số giao dịch thua từng có cơ hội đóng với lãi/lỗ ròng không âm trong cửa sổ một tuần đã có đủ dữ liệu.&#10;&#10;Đã tính phí; giá quan sát không bảo đảm khớp lệnh thực tế."/><Stat label="RR lý tưởng lớn nhất" value={known(ideal.max)?fmt(ideal.max):'N/A'} help={maxIdealHelp}/></div></ReportSection>
    </div>
    <ReportSection className="fxa-expectancy-panel" label="Expectancy & Profit factor"><div className="fxa-two-columns"><div><Stat label="Expectancy" value={fmt(data.expectancy, ` ${currency}`)} help={"Kỳ vọng là số tiền lãi/lỗ ròng trung bình mỗi giao dịch đã đóng trong bộ lọc, gồm cả hòa vốn.\n\nCách tính: tổng lãi/lỗ ròng sau phí ÷ tổng số giao dịch. Đây là trung bình của dữ liệu đã có, không bảo đảm kết quả lệnh tiếp theo."}/><ExpectancyComparison data={data} currency={currency}/></div><div><ProfitFactor rows={data.rows}/></div></div></ReportSection>
    <ReportSection className="fxa-outcome-panel" label="Winners and losers"><OutcomeStats data={data}/></ReportSection>
    <ReportSection className="fxa-side-panel" title="Performance by side"><div className="fxa-two-columns"><AnalyticsRing label={t('Số giao dịch theo hướng')} center={fmt(data.count,'',0)} sublabel={t('giao dịch')} values={[...data.side.map((item,index)=>({label:item.label==='BUY'?'Buy':'Sell',value:item.count,color:index?'var(--report-negative)':'var(--report-positive)'})),...(data.unknownSide?[{label:t('Chưa rõ'),value:data.unknownSide,color:'var(--wm-content-muted)'}]:[])]}/><AnalyticsRing label={t('Tỉ lệ thắng theo hướng')} center="" concentric values={data.side.map((item,index)=>({label:item.label==='BUY'?'Buy':'Sell',value:item.winRate,color:index?'var(--report-negative)':'var(--report-positive)'}))}/></div></ReportSection>
    <ReportSection className="fxa-hours-panel" title="Hiệu suất theo khung giờ" help="Phân nhóm theo giờ đóng lệnh trong múi giờ đã chọn. Các khung giờ không đại diện cho phiên thị trường London hay New York."><div className="fxa-radar-grid">{[['winRate','Tỉ lệ thắng','%',100],['count','Số giao dịch',''],['averageR','R trung bình',' R'],['net','Lợi nhuận',` ${currency}`]].map(([key,label,unit,max])=><AnalyticsRadar key={key} items={data.sessions.map(item=>({...item,label:item.label.replace(' UTC','')}))} metric={key} label={label} suffix={unit} maximum={max}/>)}</div></ReportSection>
    <ReportSection className="fxa-half-panel" title="Performance by time" actions={performanceControls}><AnalyticsBars items={data.hours.map(item=>({...item,label:`${item.label}:00`}))} metric={metric} label={t('Performance by time')} suffix={suffix} maximum={metric==='winRate'?100:undefined} integer={metric==='count'}/></ReportSection>
    <ReportSection className="fxa-half-panel" title="Performance by day" actions={performanceControls}><AnalyticsBars items={data.weekdays} metric={metric} label={t('Performance by day')} suffix={suffix} combo={metric!=='winRate'} maximum={metric==='winRate'?100:undefined} integer={metric==='count'}/></ReportSection>
    <ReportSection className="fxa-month-panel" title="Performance by month" help="Tổng lãi/lỗ ròng từng tháng. Phần trăm sử dụng vốn ban đầu; tháng không có giao dịch hiển thị dấu gạch ngắn."><MonthMatrix items={data.months} currency={currency} startBalance={model.startBalance}/></ReportSection>
    <ReportSection className="fxa-calendar-panel" title="Performance calendar"><PerformanceCalendar items={data.calendar} timezone={extra.timezone} currency={currency}/></ReportSection>
    <ReportSection className="fxa-frequency-panel" title="Average trade frequency" help="Số lệnh trung bình tính cả kỳ không có giao dịch giữa ngày đầu và ngày cuối trong bộ lọc."><div className="fxa-three-columns">{[['day','Ngày'],['week','Tuần'],['month','Tháng']].map(([key,label],index)=><div key={key}><Stat label={label} value={fmt(data.frequency[index]?.count,` ${t('lệnh')}`)}/><AnalyticsBars items={(data.frequencySeries?.[key]||[]).map(item=>({...item,value:item.count,label:item.label.length>7?item.label.slice(5):item.label}))} metric="value" label={`${t('Tần suất giao dịch')} / ${t(label)}`} integer height={100} color="blue"/></div>)}</div></ReportSection>
  </div>
}

export function AnalyticsDrawdown({ model, data, experiments, experimentStatus, experimentError }) {
  const { t,fmt }=useTestingLocale(),[unit,setUnit]=useState('money'),[basis,setBasis]=useState('equity')
  const currency=model.result?.account_currency||t('Đơn vị tài khoản'),excursion=excursionSummary(experiments,data.rows),percent=unit==='percent',equity=basis==='equity'&&data.equityDrawdown?.available,source=equity?data.equityDrawdown:data
  const raw=equity?source.points:data.drawdown,dd=raw.map((point,index)=>({label:equity?displayDate(point.timeUtc,{timeStyle:'short'}):`#${point.index??index}`,value:known(percent?point.drawdownPct:point.drawdown)?Number(percent?point.drawdownPct:point.drawdown)*(equity?1:-1):null}))
  const positivePct=raw.map(point=>point.drawdownPct).filter(value=>known(value)&&value>1e-12),averagePct=equity?source.averageDrawdownPct:positivePct.length?positivePct.reduce((a,b)=>a+b,0)/positivePct.length:raw.length?0:null
  return <div className="fxa-report fxa-visual-report" data-testid="analytics-drawdown"><ReportSection className="fxa-drawdown-main" title={equity?'Sụt giảm equity':'Drawdown on closed balance'} help={equity?'Khoảng giảm từ đỉnh equity, bao gồm lãi/lỗ thả nổi được nguồn ghi nhận. Các đoạn vốn được tách riêng; không nối qua dữ liệu thiếu.':'Khoảng giảm từ đỉnh số dư tới điểm thấp hơn sau khi đóng lệnh. Không bao gồm biến động equity trong lúc đang giữ lệnh.'} actions={<div className="fxa-inline-actions">{data.equityDrawdown?.available&&<UnitTabs label="Cơ sở sụt giảm" value={equity?'equity':'balance'} onChange={setBasis} options={[["equity",'Equity'],['balance','Số dư']]}/>}<UnitTabs label="Đơn vị sụt giảm" value={unit} onChange={setUnit} options={[["money",currency],['percent','%']]}/></div>}>{equity&&source.partial&&<p role="status" className="fxa-observation-state">{t('Mẫu quan sát')} · {raw.length}/{source.totalPoints}</p>}<AnalyticsBars items={dd} metric="value" label={t(equity?'Sụt giảm equity':'Drawdown on closed balance')} suffix={percent?'%':` ${currency}`} height={160}/></ReportSection>
    <div className="fxa-drawdown-stats"><Stat label="Max drawdown" value={fmt(known(percent?source.maxDrawdownPct:source.maxDrawdown)?-Number(percent?source.maxDrawdownPct:source.maxDrawdown):null,percent?'%':` ${currency}`)} help="Khoảng giảm lớn nhất từ đỉnh trước đó trong cơ sở đã chọn."/><Stat label="Average drawdown" value={fmt(percent?known(averagePct)?-averagePct:null:known(source.averageDrawdown)?-source.averageDrawdown:null,percent?'%':` ${currency}`)} help="Trung bình các điểm quan sát nằm dưới đỉnh trước đó."/><Stat label="Thời gian phục hồi" value={fmt(source.recoveryDays,` ${t('ngày')}`)} help="Thời gian trung bình từ đỉnh trước sụt giảm đến khi trở lại đỉnh, tính trên các chu kỳ đã phục hồi. Chu kỳ thiếu timestamp không được suy đoán."/><Stat label="Drawdown frequency" value={fmt(source.episodes,` ${t('đợt')}`,0)} help="Số lần giá trị bắt đầu giảm xuống dưới đỉnh trước đó."/></div>
    <ReportSection className="fxa-mae-panel" title="Maximum Adverse Excursion" help="Biên giá bất lợi quan sát trong thời gian giữ lệnh, chia khoảng cách từ giá vào tới SL gốc. Nến thoát không rõ intrabar không được dùng; kết quả có thể là cận dưới.">{experimentStatus==='loading'?<p role="status">{t('Đang đọc đường giá…')}</p>:experimentError?<p role="alert" className="fxa-error">{t(experimentError)}</p>:<AnalyticsBars items={excursion.bins.map(bin=>({label:`${fmt(bin.start)}–${fmt(bin.end)} R`,count:bin.count}))} metric="count" label={t('Phân phối MAE theo R')} integer color="blue" height={160}/>}</ReportSection>
    <ReportSection className="fxa-winning-mae-panel" title="Drawdown on winning trades" help="MAE của các giao dịch đóng có lãi, theo rủi ro ban đầu. Chỉ dùng SL được xác minh lúc vào lệnh." actions={<a className="fxa-help-link" href="https://support.fxreplay.com/articles/how-to-use-drawdown-analytics" target="_blank" rel="noreferrer">{t('Cách tính')} ↗</a>}><div className="fxa-metrics">{[['Sụt giảm trung bình',excursion.average],['Sụt giảm nhỏ nhất',excursion.min],['Sụt giảm lớn nhất',excursion.max]].map(([label,value])=><Stat key={label} label={label} value={known(value)?fmt(value,' R'):'N/A'}/>)}</div></ReportSection></div>
}

export function AnalyticsSimulation({ model,data,experiments,experimentStatus,experimentError,config,onConfig }) {
  const {t,fmt}=useTestingLocale(),currency=model.result?.account_currency||t('Đơn vị tài khoản')
  const initialConfig=()=>({method:'ledger',simulations:200,trades:Math.max(1,Math.min(200,data.count)),capital:number(model.startBalance)??100000,averageWin:data.averageWin??100,averageLoss:Math.abs(data.averageLoss??100),winRate:data.winRate??50,seed:42})
  const [mc,setMc]=useState(initialConfig),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[draft,setDraft]=useState(config)
  useEffect(()=>{setDraft(config)},[config])
  const rows=(experiments?.rows||[]).filter(row=>data.rows.some(trade=>trade.tradeId===row.trade_id))
  const run=async event=>{event.preventDefault();setError('');setBusy(true);try{const {monteCarlo}=await import('./analyticsSimulation.js');setResult(monteCarlo(mc,data.rows))}catch(err){setError(err.message);setResult(null)}finally{setBusy(false)}}
  const dirty=result&&JSON.stringify(result.config)!==JSON.stringify(mc)
  const scenario=(key,title)=>{const result=scenarioComparison(rows,data.rows,key,model.startBalance),rr=key==='risk_reward',changed=rr?String(draft.target_r)!==String(config.target_r):String(draft.stop_distance_ticks)!==String(config.stop_distance_ticks)||String(draft.stop_multiplier)!==String(config.stop_multiplier)
    return <ReportSection className="fxa-scenario-panel" title={title} help={rr?'Giữ SL gốc được xác minh lúc vào lệnh, thay TP theo R. Chỉ mô phỏng trong thời gian giữ lệnh gốc tới cutoff; không giả lập đường giá sau khi thoát.':'Thử khoảng dừng lỗ cấu hình trong thời gian giữ lệnh gốc. Giữ phí và quy tắc intrabar; không sửa giao dịch đã lưu.'} actions={rr?<a className="fxa-help-link" href="https://support.fxreplay.com/articles/how-to-use-the-rr-simulator" target="_blank" rel="noreferrer">{t('Cách tính')} ↗</a>:null}>
      <form className="fxa-simulator-config" onSubmit={event=>{event.preventDefault();onConfig({...config,...(rr?{target_r:draft.target_r}:{stop_distance_ticks:draft.stop_distance_ticks,stop_multiplier:draft.stop_multiplier})})}}>{(rr?[['target_r','Mục tiêu R',.1,100,.1]]:[['stop_distance_ticks','Khoảng dừng lỗ (tick)',1,100000,1],['stop_multiplier','Hệ số dừng lỗ',.1,10,.1]]).map(([key,label,min,max,step])=><label className="fxa-field" key={key}><span>{t(label)}</span><input aria-label={t(label)} type="number" min={min} max={max} step={step} required value={draft[key]} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></label>)}<button type="submit" className="fxa-button is-primary" disabled={Boolean(model.result?.preview)}>{t('Mô phỏng')}</button>{changed&&<span className="fxa-pending-state" role="status">{t('Chưa áp dụng')}</span>}</form>
      {experimentStatus==='loading'?<p role="status">{t('Đang mô phỏng từ đường giá…')}</p>:experimentError?<p role="alert" className="fxa-error">{t(experimentError)}</p>:<><div className="fxa-metrics"><Stat label="Mẫu tính được" value={`${result.eligible.length}/${data.count}`}/><Stat label="Lãi/lỗ mô phỏng" value={fmt(result.net,` ${currency}`)}/><Stat label="Win rate" value={fmt(result.winRate,'%')} help={rr?'Số lệnh thắng chia tổng lệnh thắng và thua; bỏ qua hòa vốn.':'Số lệnh thắng chia tổng lệnh tính được.'}/><Stat label="Profit factor" value={known(result.profitFactor)?fmt(result.profitFactor):'N/A'}/><Stat label="Average drawdown" value={fmt(result.averageDrawdown,` ${currency}`)}/></div>{result.eligible.length?<><AnalyticsCurve series={[result.baseline,result.scenario]} label={t(title)} suffix={` ${currency}`} height={160}/><div className="fxa-inline-legend"><span><i/>{t('Gốc')}</span><span><i/>{t('Mô phỏng')}</span></div></>:<div className="fxa-chart-empty">{t('Chưa đủ dữ liệu mô phỏng')}</div>}<details className="fxa-scenario-details"><summary>{t('Kết quả từng giao dịch')}</summary><DataTable className="fxa-table-scroll" label={t(title)}><thead><tr><th>#</th><th>{t('Trạng thái')}</th><th>{t('Giá thoát')}</th><th>{t('Lợi nhuận')}</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.trade_id}><td data-tooltip={row.trade_id}>{index+1}</td><td>{t(({ready:'Đã tính',ambiguous:'Không rõ thứ tự intrabar',unsupported:'Không đủ dữ liệu',unavailable:'Không đủ dữ liệu'})[row[key]?.status]||'Không đủ dữ liệu')}<small>{row[key]?.reason==='original_stop_unavailable'?t('Chưa xác minh được SL gốc'):row[key]?.status==='ambiguous'?t('SL và TP cùng nến'):null}</small></td><td>{fmt(row[key]?.exit_price,'',6)}</td><td>{fmt(row[key]?.net_pnl)}</td></tr>)}</tbody></DataTable></details></>}
    </ReportSection>}
  return <div className="fxa-report fxa-visual-report" data-testid="analytics-simulation">{scenario('stop_loss','Stop Loss Simulator')}{scenario('risk_reward','RR Simulator')}<ReportSection className="fxa-monte-panel" title="Monte Carlo Simulation" help="Lấy mẫu lãi/lỗ ròng hoặc xác suất cấu hình để tạo các chuỗi giao dịch ngẫu nhiên. Vốn về 0 thì dừng; đây không phải dự báo lợi nhuận."><div className="fxa-monte-body"><form onSubmit={run} className="fxa-monte-form"><SelectField label="Phương pháp" value={mc.method} onChange={value=>setMc({...mc,method:value})} options={[["ledger",'Lấy mẫu giao dịch'],['configured','Xác suất cấu hình']]}/>{[['simulations','Số lượt mô phỏng',1,1000,1],['trades','Lệnh mỗi lượt',1,1000,1],['capital',`Vốn ban đầu (${currency})`,.01,undefined,.01],...(mc.method==='configured'?[['averageWin','Lãi trung bình',0,undefined,.01],['averageLoss','Độ lớn lỗ trung bình',0,undefined,.01],['winRate','Win rate (%)',0,100,.01]]:[])].map(([key,label,min,max,step])=><label className="fxa-field" key={key}><span>{t(label)}</span><input aria-label={t(label)} type="number" min={min} max={max} step={step} required value={mc[key]} onChange={event=>setMc({...mc,[key]:event.target.value})}/></label>)}<button type="submit" className="fxa-button is-primary" disabled={busy}>{t(busy?'Đang tính…':'Chạy mô phỏng')}</button><button type="button" className="fxa-button" onClick={()=>{setMc(initialConfig());setResult(null);setError('')}}>{t('Đặt lại')}</button><details className="fxa-seed-control"><summary>{t('Nâng cao')}</summary><label className="fxa-field"><span>Seed</span><input aria-label="Seed" type="number" min="0" max="4294967295" step="1" value={mc.seed} onChange={event=>setMc({...mc,seed:event.target.value})}/></label></details></form><div className="fxa-monte-results">{error&&<p role="alert" className="fxa-error">{t(error)}</p>}{dirty&&<p role="status">{t('Cấu hình đã đổi; chạy lại để cập nhật kết quả.')}</p>}{result?<><AnalyticsCurve series={result.paths.map(path=>path.map(value=>({value})))} label={t('Monte Carlo Simulation')} suffix={` ${currency}`} height={180}/><div className="fxa-metrics"><Stat label="Average balance" value={fmt(result.average,` ${currency}`)}/><Stat label="Trung vị" value={fmt(result.median,` ${currency}`)}/><Stat label="P05 / P95" value={`${fmt(result.p05)} / ${fmt(result.p95)}`} help="Phân vị 5% và 95% của số dư cuối trên tất cả lượt mô phỏng."/><Stat label="Worst drawdown" value={fmt(result.maxDD,` ${currency}`)}/><Stat label="Xác suất kết thúc có lãi" value={fmt(result.probabilityProfit,'%')}/><Stat label="Tỷ lệ cạn vốn" value={fmt(result.ruinRate,'%')}/></div></>:<div className="fxa-chart-empty">{t('Chạy mô phỏng để xem kết quả')}</div>}</div></div></ReportSection></div>
}


export function FxAnalyticsReport({ model, extra, experiments, experimentStatus, experimentError, config, onConfig, selected, onSelect, onTabChange }) {
  const { t } = useTestingLocale()

  const [threshold, setThreshold] = useState(0)
  const data = useMemo(() => advancedAnalytics(model, extra, { breakevenThreshold: threshold }), [model, extra, threshold])
  useSyncExternalStore(subscribeNavigation, navigationSnapshot)
  const requestedTab = new URLSearchParams(window.location.search).get('analytics_tab')
  const [previewTab, setPreviewTab] = useState('performance')
  const tab = model.result?.preview ? previewTab : ['performance', 'drawdown', 'simulation'].includes(requestedTab) ? requestedTab : 'performance'
  useEffect(() => { onTabChange?.(tab) }, [tab, onTabChange])
  const choose = value => { setPreviewTab(value); onTabChange?.(value); if (model.result?.preview) return; const url = new URL(window.location.href); url.searchParams.set('analytics_tab', value); navigate(url, { replace: true }) }
  if (!data.count && (model.result?.partial || model.result?.status === 'partial')) return <TestingTradesEmpty incomplete />
  if (!data.count && model.result?.scope?.total_trade_count === 0) return <TestingTradesEmpty />
  if (!data.count && (model.ledger.length || model.result?.scope?.total_trade_count > 0)) return <TestingTradesEmpty filtered />
  return <><div className="fxa-report-tabs" role="tablist" aria-label={t("Phân tích")}><>{[['performance', 'Performance'], ['drawdown', 'Drawdown'], ['simulation', 'Simulation']].map(([value, label]) => <button className="fxa-tab" id={`fxa-tab-${value}`} role="tab" key={value} aria-selected={tab === value} aria-controls="fxa-report-panel" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { const tabs = ['performance', 'drawdown', 'simulation']; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3; choose(tabs[index]); document.getElementById(`fxa-tab-${tabs[index]}`)?.focus() } }} onClick={() => choose(value)}>{t(label)}</button>)}</></div><div id="fxa-report-panel" role="tabpanel" aria-labelledby={`fxa-tab-${tab}`} tabIndex={0}>{tab === 'performance' ? <AnalyticsPerformance model={model} data={data} extra={extra} onSelect={onSelect} selected={selected} threshold={threshold} onThreshold={setThreshold} experiments={experiments} /> : tab === 'drawdown' ? <AnalyticsDrawdown model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} experimentError={experimentError} /> : <AnalyticsSimulation key={JSON.stringify([model.result?.session_id, model.result?.revision, model.result?.cursor_index, model.result?.execution_event_sequence, model.result?.filters, extra])} model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} experimentError={experimentError} config={config} onConfig={onConfig} />}</div></>
}
