import { useEffect, useId, useMemo, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { zonedDateKey } from './timezone.js'
import { displayDate } from './dateFormat.js'
import { known, periodReturn } from './tradingAnalyticsModel.js'
import { CalendarNavigation, CalendarMonth, CalendarDay } from './CalendarView.jsx'
import FxSelect from './FxSelect.jsx'
import ReportInfo from './ReportInfo.jsx'
import TestingIcon from './TestingIcon.jsx'

export const CALENDAR_HELP = 'Lịch ghi nhận giao dịch đã đóng theo thời gian báo cáo và múi giờ đã chọn. Backtest dùng giờ đóng trên biểu đồ; báo cáo hoạt động dùng giờ ghi nhận. Lãi/lỗ ròng đã trừ phí. Màu ô luôn theo lãi/lỗ ròng, kể cả khi xem chỉ số khác.\n\nLợi nhuận (%) = lãi/lỗ ròng trong ngày ÷ vốn đã chọn × 100. Vốn ban đầu tính mỗi phiên nguồn một lần. Số dư hiện tại lấy từ snapshot tài khoản tại thời điểm báo cáo, giống bảng tháng; không gồm lãi/lỗ thả nổi và không dựng từ giao dịch đã lọc. Cơ sở vốn không thay đổi số tiền hoặc R. Thiếu snapshot, khác tiền tệ hoặc vốn không dương: N/A.\n\nLợi nhuận (R) là tổng R thực hiện của các lệnh trong ngày, mỗi lệnh dùng rủi ro ban đầu của chính nó. Thiếu R của bất kỳ lệnh nào: N/A, không thay bằng 0. Đây không phải R trung bình.\n\nÔ trống là chưa có giao dịch trong dữ liệu đã chọn, không chứng minh ngày đó có dữ liệu đầy đủ. N/A là thiếu dữ liệu để tính. Giao dịch thiếu thời gian không thể phân bổ vào ngày.'

export default function AnalyticsCalendar({ items, capitalBases, timezone, currency, undatedCount = 0, sourcePartial = false, selectionScope }) {
  const { t, fmt, locale } = useTestingLocale(), id = useId()
  const [chosen,setChosen] = useState(''), [metric,setMetric] = useState('net'), [basis,setBasis] = useState('initial'), [view,setView] = useState('month'), [selected,setSelected] = useState('')
  const month = chosen || items.at(-1)?.label.slice(0,7) || zonedDateKey(Date.now(), timezone).slice(0,7)
  // Price-path enrichment recreates items without changing the report selection.
  useEffect(() => { setSelected('') }, [selectionScope,timezone])
  const indexed = useMemo(() => new Map(items.map(item => [item.label,item])), [items])
  const changeMonth = next => { setChosen(next); setSelected('') }
  const changeView = next => { setView(next); setSelected('') }
  const suffix = metric === 'net' ? ` ${currency}` : metric === 'profitPct' ? '%' : ' R'
  const currentAvailable = capitalBases.current.length > 0 && capitalBases.current.every(item => item.capital > 0)
  const result = item => {
    if (!item) return ''
    const value = metric === 'profitPct' && basis === 'current' ? periodReturn([item], capitalBases.current) : item[metric]
    return known(value) ? fmt(value,suffix,2) : 'N/A'
  }
  const countLabel = count => t('{count} giao dịch', { count: fmt(count,'',0) })
  const rCoverage = item => t('{known}/{total} lệnh có R', { known: fmt(item.rCount,'',0), total: fmt(item.count ?? item.observedCount,'',0) })
  const label = t('Performance calendar')
  const renderDay = (day,compact) => {
    const item = day.inMonth ? indexed.get(day.key) : null
    const text = `${displayDate(day.key)}${item ? ` · ${result(item)}` : ''}${item ? ` · ${countLabel(item.count)}${metric === 'totalR' ? ` · ${rCoverage(item)}` : ''}${!item.complete ? ` · ${t('Dữ liệu một phần')}` : ''}` : ''}`
    return <CalendarDay key={day.key} day={day} compact={compact} value={day.inMonth ? result(item) : undefined} count={item ? countLabel(item.count) : null} note={item && !item.complete ? t('Dữ liệu một phần') : null} tone={item?.net > 0 ? 'positive' : item?.net < 0 ? 'negative' : ''} label={text} tooltip={text} selected={selected === day.key} onClick={() => setSelected(current => current === day.key ? '' : day.key)}/>
  }
  const period = view === 'year' ? month.slice(0,4) : month

  const selectedItem = indexed.get(selected)
  return <div className={`wm-analytics-calendar is-${view}${selected ? ' has-detail' : ''}`} data-testid="analytics-calendar">
    <div className="wm-calendar-metric-toolbar">
      <FxSelect label="Chỉ số lịch" value={metric} onChange={setMetric} options={[{value:'net',label:t('Lãi/lỗ ròng ({currency})',{currency})},{value:'profitPct',label:'Lợi nhuận (%)'},{value:'totalR',label:'Lợi nhuận (R)',detail:t('Calendar R calculation help')}]} renderOption={option => <span className="wm-calendar-metric-option">{option.label}{option.value === 'totalR' && <TestingIcon kind="info" size={14}/>}</span>}/>
      <fieldset className="wm-calendar-capital" data-tooltip={t('Calendar capital basis help')}><legend className="sr-only">{t('Cơ sở vốn')}</legend>{[['initial','Vốn ban đầu'],['current','Số dư hiện tại']].map(([value,label]) => <label key={value}><input type="radio" name={`${id}-calendar-capital`} value={value} checked={basis === value} disabled={value === 'current' && !currentAvailable} onChange={() => setBasis(value)}/>{t(label)}</label>)}</fieldset>
      {(undatedCount > 0 || sourcePartial || items.some(item => !item.complete)) && <span className="fxa-time-incomplete" role="status">{t('Dữ liệu một phần')}<ReportInfo title="Dữ liệu một phần" text="Nguồn chưa đầy đủ hoặc có giao dịch thiếu lãi/lỗ hay thời gian. Lịch chỉ hiển thị các giao dịch có ngày đã nhận."/></span>}
    </div>
    <CalendarNavigation month={month} onChange={changeMonth} view={view} onViewChange={changeView}/>
    {view === 'month' ? <CalendarMonth month={month} label={`${label} · ${month} · ${timezone}`} renderDay={renderDay}/> : <div className="wm-calendar-year" aria-label={`${label} · ${period} · ${timezone}`}>{Array.from({length:12},(_,index) => {
      const key = `${period}-${String(index+1).padStart(2,'0')}`
      return <div key={key}><button type="button" className="wm-calendar-mini-heading" onClick={() => { changeMonth(key); changeView('month') }}>{new Date(`${key}-01T00:00:00Z`).toLocaleDateString(locale,{month:'long',timeZone:'UTC'})}</button><CalendarMonth compact month={key} label={`${label} · ${key}`} renderDay={renderDay}/></div>
    })}</div>}

    {selected && <div className="wm-calendar-detail" data-testid="calendar-day-detail"><div className="wm-calendar-detail-heading"><h3>{displayDate(selected)}</h3><button type="button" className="fxa-button" onClick={() => setSelected('')}>{t('Đóng')}</button></div>
      {selectedItem ? <><dl>{[['Lãi/lỗ ròng',known(selectedItem.net) ? fmt(selectedItem.net,` ${currency}`) : 'N/A'],['Số giao dịch',fmt(selectedItem.count,'',0)],['Tỉ lệ thắng',known(selectedItem.winRate) ? fmt(selectedItem.winRate,'%') : 'N/A'],['R trung bình',known(selectedItem.averageR) ? fmt(selectedItem.averageR,' R') : 'N/A']].map(([title,value]) => <div key={title}><dt>{t(title)}</dt><dd>{value}</dd></div>)}</dl><p>{rCoverage(selectedItem)}</p><ul>{selectedItem.rows.map((row,index) => <li key={`${row.session_id || ''}:${row.tradeId || index}`}><span>{row.symbol || row.asset || '–'} · {row.side || '–'} · #{row.tradeId || '–'}</span><strong>{known(row.net_pnl) ? fmt(row.net_pnl,` ${currency}`) : 'N/A'}</strong></li>)}</ul></> : <p>{t('Không có giao dịch trong dữ liệu đã chọn cho ngày này.')}</p>}
    </div>}
  </div>
}
