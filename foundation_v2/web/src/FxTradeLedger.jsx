import { SortableColumn } from './DataTable.jsx'
import { nextTableSorts, sortTableRows } from './tableModel.js'
import useTableColumns from './useTableColumns.js'
import TradeLabelCell, { useTradeLabels } from './TradeLabelCell.jsx'
import { currencyLabel } from './moneyFormat.js'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { filterAnalyticsRows, known, outcomeOf } from './tradingAnalyticsModel.js'
import { closeTime } from './sessionPerformanceModel.js'
import TableColumnControl from './TableColumnControl.jsx'
import { TestingTradesEmpty } from './TestingPageState.jsx'
import TradeLedgerGrid from './TradeLedgerGrid.jsx'
import { formatReturnPercent } from './tradeReturnFormat.js'
import ChartIcon from './ChartIcon.jsx'
import { AutosaveBoundaryContext, AutosaveBoundaryStatus, useAutosaveBoundary } from './useAutosave.jsx'
import { TradeJournalToolbar } from './TradeJournalPreview.jsx'

const COLUMNS = [
  ['session_id', 'Session'], ['status', 'Type'], ['source', 'Source'], ['recorded_at_utc', 'Entry Date (Realtime)'], ['open_time_utc', 'Entry Date (Chart UTC)'],
  ['symbol', 'Asset'], ['side', 'Side'], ['entry_type', 'Entry type'], ['net_pnl', 'Return'], ['return_pct', 'Return (%)'], ['realized_r', 'Return (R)'],
  ['tags', 'Tags'], ['price_open', 'Entry price'], ['quantity', 'Size'], ['stop_loss', 'Stop loss'], ['take_profit', 'Take profit'],
  ['report_time_utc', 'Exit Date (Realtime)'], ['close_time_utc', 'Exit Date (Chart UTC)'], ['price_close', 'Exit price'], ['gross_pnl', 'Gross PnL'], ['fees', 'Fees'],
]
const DEFAULT_COLUMNS = COLUMNS.map(([key]) => key)
const CENTER_COLUMNS = new Set(['status', 'side', 'entry_type'])
const columnClass = key => NUMERIC_COLUMNS.has(key) ? 'is-numeric' : CENTER_COLUMNS.has(key) ? 'is-center' : ''
const NUMERIC_COLUMNS = new Set(['net_pnl', 'return_pct', 'realized_r', 'rating', 'price_open', 'quantity', 'stop_loss', 'take_profit', 'price_close', 'gross_pnl', 'fees'])
export function TradeInspector({ children, heading, onClose, onPrevious, onNext, navigationError, liveActions, className = '', ...props }) {
  const { t } = useTestingLocale()
  const {boundary,requestClose,requestTransition,closing,active} = useAutosaveBoundary(onClose)
  const [expanded, setExpanded] = useState(false), [detailsVisible, setDetailsVisible] = useState(true)
  const dialog = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    dialog.current.showModal()
    return () => { dialog.current?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <AutosaveBoundaryContext.Provider value={boundary}><dialog {...props} className={`fxa-trade-inspector is-drawer${expanded ? ' is-expanded' : ''}${detailsVisible ? '' : ' is-details-hidden'} ${className}`} aria-label={props['aria-label'] || t("Chi tiết giao dịch")} aria-busy={closing} ref={dialog} onCancel={event => { event.preventDefault(); void requestClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) void requestClose() } }}>
    <header className="fx-trade-workspace-header"><div className="fx-trade-window-controls">
      <button type="button" className="wm-button is-icon" disabled={closing} onClick={()=>void requestClose()} aria-label={t('Đóng chi tiết')}><ChartIcon name="close"/></button>
      <button type="button" className="wm-button is-icon" onClick={() => setDetailsVisible(value => !value)} aria-label={t('Hiện thông tin giao dịch')} aria-pressed={detailsVisible}><ChartIcon name="layout"/></button>
      <button type="button" className="wm-button is-icon" onClick={() => setExpanded(value => !value)} aria-label={t('Mở rộng chi tiết giao dịch')} aria-pressed={expanded}><ChartIcon name={expanded ? 'contract-corners' : 'expand-corners'}/></button>
    </div><div className="fx-trade-workspace-heading">{heading || <h2>{t('Trade detail')}</h2>}{active && <AutosaveBoundaryStatus controller={active} forceClose={boundary.forceClose}/>}{navigationError && <p className="wm-trade-navigation-error" role="alert">{navigationError}</p>}</div><div className="fx-trade-navigation" inert={closing}>
      {liveActions?.commentButton}
      <button type="button" className="wm-button is-icon" disabled={closing || !onPrevious} aria-label={t('Giao dịch trước')} onClick={()=>void requestTransition(onPrevious)}><ChartIcon name="expand"/></button>
      <button type="button" className="wm-button is-icon" disabled={closing || !onNext} aria-label={t('Giao dịch tiếp theo')} onClick={()=>void requestTransition(onNext)}><ChartIcon name="collapse"/></button>
      {liveActions?.menu || <button type="button" className="wm-button is-icon" aria-label={t('Thêm thao tác giao dịch')} disabled><ChartIcon name="more-vertical"/></button>}
    </div></header>
    <div className="fx-trade-workspace-body" inert={closing}>{children}</div>
  </dialog></AutosaveBoundaryContext.Provider>
}
function valueOf(row, key, model, sessionName) {
  if (key === 'session_id') return sessionName || row.session_name || row.session_id || row.source?.session_id || model.result?.session_id || '-'
  if (key === 'status') return row.status === 'open' ? 'Open' : 'Closed'
  if (key === 'source') return model.result?.preview ? 'UI demo' : row.session_id || row.source_provenance?.session_id || model.result?.session_id ? 'Naqex Trader' : row.source === 'research ledger' ? 'Research' : '-'
  // The return denominator is explicit; missing capital never becomes a 0% return.
  if (key === 'return_pct') { const capital = model.result?.multi_session ? row.starting_balance : model.startBalance; return known(capital) && capital > 0 && known(row.net_pnl) ? row.net_pnl / capital * 100 : null }
  return row[key]
}
function display(row, key, model, sessionName, { fmt, locale, t, timezone }) {
  const value = valueOf(row, key, model, sessionName)
  const inapplicable = row.status === 'open' && ['net_pnl', 'return_pct', 'realized_r', 'gross_pnl', 'fees'].includes(key)
    || key === 'realized_r' && !known(value) || key === 'return_pct' && !known(value)
  if (inapplicable) return <span className="wm-missing-value" aria-label={t(row.status === 'open' ? 'Chưa áp dụng khi lệnh đang mở' : 'Không có cơ sở để tính')} data-tooltip={t(row.status === 'open' ? 'Chưa áp dụng khi lệnh đang mở' : 'Không có cơ sở để tính')}>N/A</span>
  if (value === null || value === undefined || value === '' || value === '-' || value === '—') return <span className="wm-missing-value" aria-label={t('Chưa có dữ liệu')} data-tooltip={t('Chưa có dữ liệu')}>-</span>
  if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return closeTime(value) ? displayDate(closeTime(value), { timeStyle: 'medium', timeZone: timezone }) : '-'
  if (['net_pnl', 'gross_pnl'].includes(key)) return fmt(value)
  if (key === 'fees') return fmt(value, model.result?.multi_session ? ` ${row.account_currency || t('Đơn vị tài khoản')}` : '')
  if (key === 'return_pct') return formatReturnPercent(value, { fmt, locale })
  if (key === 'realized_r') return fmt(value, ' R')
  if (['price_open', 'price_close', 'stop_loss', 'take_profit'].includes(key)) return fmt(value, '', 6)
  if (key === 'quantity') return fmt(value, '', 4)
  if (key === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : '-'
  return key === 'side' ? t(String(value).toLowerCase() === 'buy' ? 'Buy' : String(value).toLowerCase() === 'sell' ? 'Sell' : 'Chưa rõ') : ['status', 'source'].includes(key) ? t(value ?? '-') : value ?? '-'
}
export default function FxTradeLedger({ model, extra, selected, onSelect, onRowsChange, sessionName, renderFilters, hidden = false, remotePage, emptyScopeKnown = false, readNotice, workspace, preferenceWorkspace = workspace, onLabelsChanged }) {
  const { t, locale, fmt, timezone } = useTestingLocale()

  const labelCatalog = useTradeLabels(workspace)
  const data = useMemo(() => ({ rows: remotePage ? model.ledger : filterAnalyticsRows(model.ledger, extra) }), [model, extra, Boolean(remotePage)])
  const [localPage, setLocalPage] = useState(0), [localSize, setLocalSize] = useState(10), [localSorts, setLocalSorts] = useState([])
  const page = remotePage ? remotePage.page - 1 : localPage, size = remotePage?.pageSize || localSize, sorts = remotePage?.sorts || localSorts
  const setPage = value => { if (remotePage) { if (!remotePage.pending && remotePage.totalCount !== null) remotePage.onChange({ page: value + 1 }) } else setLocalPage(value) }
  const setSize = value => { if (remotePage) remotePage.onChange({ pageSize: value, page: 1 }); else { setLocalSize(value); setLocalPage(0) } }
  const setSorts = value => { if (remotePage) remotePage.onChange({ sorts: value, page: 1 }); else { setLocalSorts(value); setLocalPage(0) } }
  const [columns, setColumns, columnStorageError] = useTableColumns(preferenceWorkspace, 'trades', DEFAULT_COLUMNS)
  const [checked, setChecked] = useState(new Set())
  const [journalView,setJournalView] = useState('active')
  const rows = useMemo(() => remotePage ? data.rows : sortTableRows(data.rows, sorts, (row, key) => {
    const value = valueOf(row, key, model, sessionName)
    if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return closeTime(value)?.getTime()
    return value
  }, locale), [data.rows, model, sorts, sessionName, locale, Boolean(remotePage)])
  const total = remotePage ? remotePage.totalCount : rows.length
  const navigationKey=JSON.stringify(rows.map(row=>row.tradeId))
  const rowsChanged=useRef(onRowsChange);rowsChanged.current=onRowsChange
  useEffect(()=>{rowsChanged.current?.(JSON.parse(navigationKey))},[navigationKey])
  const pages = Math.max(1, Math.ceil((total || 0) / size)), current = Math.min(page, pages - 1), visible = remotePage ? rows : rows.slice(current * size, (current + 1) * size)
  useEffect(() => { if (!remotePage) setLocalPage(0) }, [extra, model.result])
  useEffect(() => { setChecked(new Set()) }, [extra, journalView, remotePage?.selectionKey, remotePage ? undefined : model.result])
  const toggle = id => setChecked(values => { const next = new Set(values); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const shownColumns = COLUMNS.filter(([key]) => columns.includes(key))
  const allChecked = visible.length > 0 && visible.every(row => checked.has(row.tradeId))
  const mixedChecked = !allChecked && visible.some(row => checked.has(row.tradeId))
  const selectPage = useRef(null)
  const empty = !remotePage?.pending && (total === 0 || total === null) && !rows.length
  const incomplete = Boolean(model.result?.partial || model.result?.status === 'partial')
  const noTrades = !incomplete && (emptyScopeKnown || model.result?.scope?.total_trade_count === 0)
  const timeColumns = {
    recorded_at_utc: ['Vào lệnh', 'Realtime'], open_time_utc: ['Vào lệnh', 'Chart'],
    report_time_utc: ['Thoát lệnh', 'Realtime'], close_time_utc: ['Thoát lệnh', 'Chart'],
  }
  const columnLabel = (key, label) => timeColumns[key] ? `${t(timeColumns[key][0])} (${timeColumns[key][1]})` : key === 'net_pnl' ? `${t('Return')}${model.result?.multi_session ? '' : ` (${currencyLabel(model.result?.account_currency) || t('Đơn vị tài khoản')})`}` : t(label)
  const columnControl = <TableColumnControl columns={columns} onChange={values => { setColumns(values); if (sorts.some(sort => !values.includes(sort.key))) setSorts(sorts.filter(sort => values.includes(sort.key))) }} options={COLUMNS.map(([key, label]) => [key, columnLabel(key, label)])} />
  const columnHeader = ([key, label]) => {
    const index = sorts.findIndex(sort => sort.key === key), sort = sorts[index]
    const heading = columnLabel(key, label)
    return <SortableColumn key={key} data-column={key} className={columnClass(key)} active={Boolean(sort)}
      priority={index + 1} direction={sort?.direction} disabled={remotePage?.pending}
      onSort={() => setSorts(nextTableSorts(sorts, key))} onClear={() => setSorts(sorts.filter(sort => sort.key !== key))}
      clearLabel={t('Bỏ sắp xếp: {column}', { column: heading })}
      sortLabel={sort ? t('{column}, ưu tiên {priority}, {direction}. Nhấn để đổi chiều.', { column: heading, priority: index + 1, direction: t(sort.direction === 'asc' ? 'tăng dần' : 'giảm dần') }) : t('Thêm sắp xếp: {column}', { column: heading })}>
      {heading}
    </SortableColumn>
  }
  const renderCell = (row, key) => key === 'tags' ? <TradeLabelCell workspace={workspace} session={row.session_id || model.result?.session_id || model.result?.provenance?.session_id} row={row} catalog={labelCatalog} onChanged={onLabelsChanged}/> : ['net_pnl','gross_pnl'].includes(key) && known(row[key]) ? <span tabIndex={0} aria-label={`${display(row,key,model,sessionName,{fmt,locale,t,timezone})} ${currencyLabel(row.account_currency || model.result?.account_currency) || t('Đơn vị tài khoản')}`} data-tooltip={currencyLabel(row.account_currency || model.result?.account_currency)} className={`wm-return-badge ${row[key] > 0 ? 'is-positive' : row[key] < 0 ? 'is-negative' : 'is-flat'}`}><span aria-hidden="true">{row[key] > 0 ? '↗' : row[key] < 0 ? '↙' : '-'}</span>{display(row,key,model,sessionName,{fmt,locale,t,timezone})}</span> : ['status', 'side', 'entry_type'].includes(key) && (key !== 'entry_type' || row.entry_type && !['-', '—'].includes(row.entry_type)) ? <span className={`fxa-badge is-${key === 'status' ? row.status === 'open' ? 'open' : 'closed' : key === 'entry_type' ? 'order-type' : String(row.side).toLowerCase()}`}>{display(row, key, model, sessionName, { fmt, locale, t, timezone })}</span> : key === 'session_id' ? <span data-tooltip={row.trade_id || row.tradeId}>{display(row, key, model, sessionName, { fmt, locale, t, timezone })}</span> : display(row, key, model, sessionName, { fmt, locale, t, timezone })
  return <>
    {renderFilters?.(columnControl,<TradeJournalToolbar inline sourceKind="practice" view={journalView} onView={setJournalView}/>)}
    {columnStorageError && <span role="status">{t('Không lưu được cột hiển thị trong trình duyệt này.')}</span>}
    {readNotice}
    <section aria-busy={remotePage?.pending || undefined} hidden={hidden} className="fxa-trades" aria-label={t("Trade ledger")} data-testid="fx-trade-ledger">
    {!renderFilters && <div className="fxa-ledger-tools"><TradeJournalToolbar inline sourceKind="practice" view={journalView} onView={setJournalView}/>{columnControl}</div>}
    {checked.size > 0 && <span className="sr-only" role="status">{checked.size} {t("đã chọn")}</span>}
    {empty ? <TestingTradesEmpty filtered={!noTrades} incomplete={incomplete} /> : <TradeLedgerGrid describeTrade={row=>({member:{kind:'testing',source_id:row.session_id || row.source_provenance?.session_id || model.result?.session_id,trade_id:row.trade_id},symbol:row.symbol,side:String(row.side).toUpperCase(),closedAt:row.close_time_utc,quantity:row.quantity,closed:row.status==='closed' || row.status!=='open' && Boolean(row.close_time_utc)})} workspace={workspace} bulkGroups={labelCatalog.groups} bulkLabels={labelCatalog.items} journalView={journalView} onJournalView={setJournalView} showJournalToolbar={false} rows={visible} current={current} size={size} shownColumns={shownColumns} columnHeader={columnHeader} renderCell={renderCell} cellClass={columnClass} rowKey={row => row.tradeId} sortResetActive={sorts.length > 0} onClearSort={() => setSorts([])} disabled={Boolean(remotePage?.pending)} pending={Boolean(remotePage?.pending)} selected={selected} onSelect={value => onSelect(value)} checked={checked} onToggle={toggle} allChecked={allChecked} mixedChecked={mixedChecked} selectPage={selectPage} onTogglePage={() => setChecked(values => { const next = new Set(values); visible.forEach(row => allChecked ? next.delete(row.tradeId) : next.add(row.tradeId)); return next })} totalCount={total} pages={pages} onPageChange={value => setPage(value - 1)} onPageSizeChange={setSize} paginationLabel="Trade ledger pagination" dataTestId="analytics-ledger" rowNumberOffset={current * size} />}
  </section></>
}
