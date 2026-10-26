import { useEffect, useMemo, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { zonedDateKey } from './timezone.js'
import { displayDate } from './dateFormat.js'
import { known } from './tradingAnalyticsModel.js'
import { calendarPeriodSummary } from './calendarViewModel.js'
import { CalendarNavigation, CalendarMonth, CalendarDay } from './CalendarView.jsx'
import FxSelect from './FxSelect.jsx'
import ReportInfo from './ReportInfo.jsx'

export const CALENDAR_HELP = 'Lịch ghi nhận giao dịch đã đóng theo thời gian báo cáo và múi giờ đã chọn. Backtest dùng giờ đóng trên biểu đồ; báo cáo hoạt động dùng giờ ghi nhận. Lãi/lỗ ròng đã trừ phí. Màu ô luôn theo lãi/lỗ ròng, kể cả khi xem chỉ số khác.\n\nTỉ lệ thắng = số lệnh thắng ÷ tổng lệnh đã đóng, gồm hòa vốn. R trung bình chỉ tính lệnh có R hoặc rủi ro ban đầu hợp lệ; không thay R thiếu bằng 0. Tổng kỳ tính từ số lệnh và số R có dữ liệu, không lấy trung bình các tỷ lệ ngày.\n\nDấu gạch là chưa có giao dịch trong dữ liệu đã chọn, không chứng minh ngày đó có dữ liệu đầy đủ. N/A là thiếu dữ liệu để tính. Giao dịch thiếu thời gian không thể phân bổ vào ngày; tổng kỳ có thể chưa xác định.'

export default function AnalyticsCalendar({ items, timezone, currency, undatedCount = 0, sourcePartial = false }) {
  const { t, fmt, locale } = useTestingLocale()
  const [chosen,setChosen] = useState(''), [metric,setMetric] = useState('net'), [view,setView] = useState('month'), [selected,setSelected] = useState('')
  const month = chosen || items.at(-1)?.label.slice(0,7) || zonedDateKey(Date.now(), timezone).slice(0,7)
  useEffect(() => { setSelected('') }, [items,timezone])
  const indexed = useMemo(() => new Map(items.map(item => [item.label,item])), [items])
  const changeMonth = next => { setChosen(next); setSelected('') }
  const changeView = next => { setView(next); setSelected('') }
  const suffix = metric === 'net' ? ` ${currency}` : metric === 'winRate' ? '%' : metric === 'averageR' ? ' R' : ''
  const result = item => !item ? '–' : known(item[metric]) ? fmt(item[metric],suffix,metric === 'count' ? 0 : 2) : 'N/A'
  const countLabel = count => t('{count} giao dịch', { count: fmt(count,'',0) })
  const rCoverage = item => t('{known}/{total} lệnh có R', { known: fmt(item.rCount,'',0), total: fmt(item.count ?? item.observedCount,'',0) })
  const label = t('Performance calendar')
  const renderDay = (day,compact) => {
    const item = day.inMonth ? indexed.get(day.key) : null
    const text = `${displayDate(day.key)} · ${result(item)}${item ? ` · ${countLabel(item.count)}${metric === 'averageR' ? ` · ${rCoverage(item)}` : ''}${!item.complete ? ` · ${t('Dữ liệu một phần')}` : ''}` : ''}`
    return <CalendarDay key={day.key} day={day} compact={compact} value={day.inMonth ? result(item) : undefined} count={item ? countLabel(item.count) : null} note={item && !item.complete ? t('Dữ liệu một phần') : null} tone={item?.net > 0 ? 'positive' : item?.net < 0 ? 'negative' : ''} label={text} tooltip={text} selected={selected === day.key} onClick={() => setSelected(current => current === day.key ? '' : day.key)}/>
  }
  const period = view === 'year' ? month.slice(0,4) : month
  const summary = calendarPeriodSummary(items.filter(item => item.label.startsWith(period)), undatedCount, sourcePartial)
  const selectedItem = indexed.get(selected)
  return <div className="wm-analytics-calendar" data-testid="analytics-calendar">
    <CalendarNavigation month={month} onChange={changeMonth} view={view} onViewChange={changeView}>
      <FxSelect label="Chỉ số lịch" value={metric} onChange={setMetric} options={[{value:'net',label:t('Lãi/lỗ ròng ({currency})',{currency})},{value:'winRate',label:'Tỉ lệ thắng'},{value:'count',label:'Số giao dịch'},{value:'averageR',label:'R trung bình'}]}/>
    </CalendarNavigation>
    {view === 'month' ? <CalendarMonth month={month} label={`${label} · ${month} · ${timezone}`} renderDay={renderDay}/> : <div className="wm-calendar-year" aria-label={`${label} · ${period} · ${timezone}`}>{Array.from({length:12},(_,index) => {
      const key = `${period}-${String(index+1).padStart(2,'0')}`
      return <div key={key}><button type="button" className="wm-calendar-mini-heading" onClick={() => { changeMonth(key); changeView('month') }}>{new Date(`${key}-01T00:00:00Z`).toLocaleDateString(locale,{month:'long',timeZone:'UTC'})}</button><CalendarMonth compact month={key} label={`${label} · ${key}`} renderDay={renderDay}/></div>
    })}</div>}
    <div className="wm-calendar-period-total" aria-live="polite"><span>{t(view === 'year' ? 'Tổng năm' : 'Tổng tháng')}</span><strong>{!summary.observedCount && !summary.partial && metric !== 'count' ? '–' : result(summary)}</strong><span>{known(summary.count) ? countLabel(summary.count) : t('{count} giao dịch có ngày', {count:fmt(summary.observedCount,'',0)})}</span>{metric === 'averageR' && <small>{rCoverage(summary)}</small>}{summary.partial && <small>{t('Dữ liệu một phần')}<ReportInfo title="Dữ liệu một phần" text="Nguồn chưa đầy đủ hoặc có giao dịch thiếu lãi/lỗ hay thời gian. Tổng chỉ được xác định khi đủ dữ liệu trong phạm vi; số giao dịch có ngày không bao gồm giao dịch thiếu thời gian."/></small>}</div>
    {selected && <div className="wm-calendar-detail" data-testid="calendar-day-detail"><div className="wm-calendar-detail-heading"><h3>{displayDate(selected)}</h3><button type="button" className="fxa-button" onClick={() => setSelected('')}>{t('Đóng')}</button></div>
      {selectedItem ? <><dl>{[['Lãi/lỗ ròng',known(selectedItem.net) ? fmt(selectedItem.net,` ${currency}`) : 'N/A'],['Số giao dịch',fmt(selectedItem.count,'',0)],['Tỉ lệ thắng',known(selectedItem.winRate) ? fmt(selectedItem.winRate,'%') : 'N/A'],['R trung bình',known(selectedItem.averageR) ? fmt(selectedItem.averageR,' R') : 'N/A']].map(([title,value]) => <div key={title}><dt>{t(title)}</dt><dd>{value}</dd></div>)}</dl><p>{rCoverage(selectedItem)}</p><ul>{selectedItem.rows.map((row,index) => <li key={`${row.session_id || ''}:${row.tradeId || index}`}><span>{row.symbol || row.asset || '–'} · {row.side || '–'} · #{row.tradeId || '–'}</span><strong>{known(row.net_pnl) ? fmt(row.net_pnl,` ${currency}`) : 'N/A'}</strong></li>)}</ul></> : <p>{t('Không có giao dịch trong dữ liệu đã chọn cho ngày này.')}</p>}
    </div>}
  </div>
}
