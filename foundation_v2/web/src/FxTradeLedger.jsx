import DataTable, { SortableColumn } from './DataTable.jsx'
import { nextTableSorts, sortTableRows } from './tableModel.js'
import useTableColumns from './useTableColumns.js'
import TradeLabelCell, { useTradeLabels } from './TradeLabelCell.jsx'
import { currencyLabel } from './moneyFormat.js'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { filterAnalyticsRows, known, outcomeOf } from './tradingAnalyticsModel.js'
import { closeTime } from './sessionPerformanceModel.js'
import TableColumnControl from './TableColumnControl.jsx'
import TestingIcon from './TestingIcon.jsx'
import { TestingTradesEmpty } from './TestingPageState.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import ReportInfo from './ReportInfo.jsx'

const RETURN_HELP = {
  net_pnl: 'PnL ròng của giao dịch đã đóng, sau phí, theo đơn vị tài khoản của phiên nguồn. Không gồm lãi/lỗ đang mở. Đưa chuột hoặc focus vào số tiền để xem đơn vị.',
  return_pct: 'PnL ròng sau phí chia vốn ban đầu của phiên nguồn, nhân 100. Không dùng số dư hiện tại. Lệnh đang mở hoặc thiếu vốn hợp lệ hiển thị N/A.',
  realized_r: 'R thực hiện theo mẫu số rủi ro gốc đã được lưu cùng giao dịch nguồn. Không suy từ SL hiện tại hoặc tỷ số lãi/lỗ trung bình. Lệnh đang mở hoặc chưa có mẫu số hiển thị N/A.',
}

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
export function TradeInspector({ children, onClose }) {
  const { t } = useTestingLocale()

  const dialog = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    dialog.current.showModal()
    return () => { dialog.current?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="fxa-trade-inspector" aria-label={t("Chi tiết giao dịch")} ref={dialog} onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose() } }}>{children}</dialog>
}
function valueOf(row, key, model, sessionName) {
  if (key === 'session_id') return sessionName || row.session_name || row.session_id || row.source?.session_id || model.result?.session_id || '-'
  if (key === 'status') return row.status === 'open' ? 'Open' : 'Closed'
  if (key === 'source') return model.result?.preview ? 'UI demo' : row.session_id || row.source_provenance?.session_id || model.result?.session_id ? 'WMReplay' : row.source === 'research ledger' ? 'Research' : '-'
  // The return denominator is explicit; missing capital never becomes a 0% return.
  if (key === 'return_pct') { const capital = model.result?.multi_session ? row.starting_balance : model.startBalance; return known(capital) && capital > 0 && known(row.net_pnl) ? row.net_pnl / capital * 100 : null }
  return row[key]
}
function display(row, key, model, sessionName, { fmt, locale, t, timezone }) {
  const value = valueOf(row, key, model, sessionName)
  const inapplicable = row.status === 'open' && ['net_pnl', 'return_pct', 'realized_r', 'gross_pnl', 'fees'].includes(key)
    || key === 'realized_r' && !known(value) || key === 'return_pct' && !known(value)
  if (inapplicable) return <span className="wm-missing-value" aria-label={t(row.status === 'open' ? 'Chưa áp dụng khi lệnh đang mở' : 'Không có cơ sở để tính')} title={t(row.status === 'open' ? 'Chưa áp dụng khi lệnh đang mở' : 'Không có cơ sở để tính')}>N/A</span>
  if (value === null || value === undefined || value === '' || value === '-' || value === '—') return <span className="wm-missing-value" aria-label={t('Chưa có dữ liệu')} title={t('Chưa có dữ liệu')}>-</span>
  if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return closeTime(value) ? displayDate(closeTime(value), { timeStyle: 'medium', timeZone: timezone }) : '-'
  if (['net_pnl', 'gross_pnl'].includes(key)) return fmt(value)
  if (key === 'fees') return fmt(value, model.result?.multi_session ? ` ${row.account_currency || t('Đơn vị tài khoản')}` : '')
  if (key === 'return_pct') return known(value) && value !== 0 && Math.abs(value) < .01 ? `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 2 }).format(value)}%` : fmt(value, '%')
  if (key === 'realized_r') return fmt(value, ' R')
  if (['price_open', 'price_close', 'stop_loss', 'take_profit'].includes(key)) return fmt(value, '', 6)
  if (key === 'quantity') return fmt(value, '', 4)
  if (key === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : '-'
  return key === 'side' ? t(String(value).toLowerCase() === 'buy' ? 'Buy' : String(value).toLowerCase() === 'sell' ? 'Sell' : 'Chưa rõ') : ['status', 'source'].includes(key) ? t(value ?? '-') : value ?? '-'
}
export default function FxTradeLedger({ model, extra, selected, onSelect, sessionName, renderFilters, hidden = false, remotePage, emptyScopeKnown = false, readNotice, workspace, preferenceWorkspace = workspace, onLabelsChanged }) {
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
  const tableScroll = useRef(null)
  const rows = useMemo(() => remotePage ? data.rows : sortTableRows(data.rows, sorts, (row, key) => {
    const value = valueOf(row, key, model, sessionName)
    if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return closeTime(value)?.getTime()
    return value
  }, locale), [data.rows, model, sorts, sessionName, locale, Boolean(remotePage)])
  const total = remotePage ? remotePage.totalCount : rows.length
  const pages = Math.max(1, Math.ceil((total || 0) / size)), current = Math.min(page, pages - 1), visible = remotePage ? rows : rows.slice(current * size, (current + 1) * size)
  useEffect(() => { if (tableScroll.current) tableScroll.current.scrollTop = 0 }, [current, size, sorts, extra, model.result])
  useEffect(() => { if (!remotePage) setLocalPage(0) }, [extra, model.result])
  useEffect(() => { setChecked(new Set()) }, [extra, remotePage?.selectionKey, remotePage ? undefined : model.result])
  const toggle = id => setChecked(values => { const next = new Set(values); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const shownColumns = COLUMNS.filter(([key]) => columns.includes(key))
  const allChecked = visible.length > 0 && visible.every(row => checked.has(row.tradeId))
  const mixedChecked = !allChecked && visible.some(row => checked.has(row.tradeId))
  const selectPage = useRef(null)
  useEffect(() => { if (selectPage.current) selectPage.current.indeterminate = mixedChecked }, [mixedChecked])
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
      help={RETURN_HELP[key] && <ReportInfo title={heading} text={RETURN_HELP[key]} />}
      priority={index + 1} direction={sort?.direction} disabled={remotePage?.pending}
      onSort={() => setSorts(nextTableSorts(sorts, key))} onClear={() => setSorts(sorts.filter(sort => sort.key !== key))}
      clearLabel={t('Bỏ sắp xếp: {column}', { column: heading })}
      sortLabel={sort ? t('{column}, ưu tiên {priority}, {direction}. Nhấn để đổi chiều.', { column: heading, priority: index + 1, direction: t(sort.direction === 'asc' ? 'tăng dần' : 'giảm dần') }) : t('Thêm sắp xếp: {column}', { column: heading })}>
      {heading}
    </SortableColumn>
  }
  return <>
    {renderFilters?.(columnControl)}
    {columnStorageError && <span role="status">{t('Không lưu được cột hiển thị trong trình duyệt này.')}</span>}
    {readNotice}
    <section aria-busy={remotePage?.pending || undefined} hidden={hidden} className="fxa-trades" aria-label={t("Trade ledger")} data-testid="fx-trade-ledger">
    {!renderFilters && <div className="fxa-ledger-tools">{columnControl}</div>}
    {checked.size > 0 && <span className="sr-only" role="status">{checked.size} {t("đã chọn")}</span>}
    {empty ? <TestingTradesEmpty filtered={!noTrades} incomplete={incomplete} /> : <><DataTable className="fxa-table-scroll" viewportRef={tableScroll} label={t("Giao dịch, cuộn ngang để xem các cột")}><thead><tr><th scope="col" className="wm-table-row-number" aria-label={t("Số thứ tự")}>{sorts.length > 0 ? <button type="button" className="wm-table-sort-clear-all" disabled={remotePage?.pending} aria-label={t("Xóa tất cả sắp xếp")} title={t("Xóa tất cả sắp xếp")} onClick={() => setSorts([])}>×</button> : <span aria-hidden="true">#</span>}</th><th className="is-center"><input ref={selectPage} disabled={remotePage?.pending} aria-checked={mixedChecked ? "mixed" : allChecked} aria-label={t("Chọn các lệnh trên trang")} type="checkbox" checked={allChecked} onChange={() => setChecked(values => { const next = new Set(values); visible.forEach(row => allChecked ? next.delete(row.tradeId) : next.add(row.tradeId)); return next })} /></th><th className="is-center">{t("Actions")}</th>{shownColumns.map(columnHeader)}</tr></thead><tbody>{remotePage?.pending ? <tr><td colSpan={shownColumns.length + 3}><TestingSkeleton rows={3} /></td></tr> : visible.map((row, index) => <tr key={row.tradeId} data-checked={checked.has(row.tradeId) || undefined} className={selected === row.tradeId ? 'is-selected' : ''}><td className="wm-table-row-number" data-column="row_number">{current * size + index + 1}</td><td className="is-center"><input type="checkbox" aria-label={t("Chọn lệnh {id}", { id: row.tradeId })} checked={checked.has(row.tradeId)} onChange={() => toggle(row.tradeId)} /></td><td className="is-center"><button className="fxa-detail-button wm-table-row-action" type="button" aria-label={t("Chi tiết {id}", { id: row.tradeId })} aria-pressed={selected === row.tradeId} onClick={() => onSelect(selected === row.tradeId ? '' : row.tradeId)}><TestingIcon kind="journal" size={16} /></button></td>{shownColumns.map(([key]) => <td key={key} data-column={key} className={(columnClass(key) + ' ') + (['net_pnl', 'gross_pnl'].includes(key) ? outcomeOf(row[key]) === 'win' ? 'is-positive' : outcomeOf(row[key]) === 'loss' ? 'is-negative' : '' : '')}>{key === 'tags' ? <TradeLabelCell workspace={workspace} session={row.session_id || model.result?.session_id || model.result?.provenance?.session_id} row={row} catalog={labelCatalog} onChanged={onLabelsChanged}/> : ['net_pnl','gross_pnl'].includes(key) && known(row[key]) ? <span tabIndex={0} aria-label={`${display(row,key,model,sessionName,{fmt,locale,t,timezone})} ${row.account_currency || model.result?.account_currency || t('Đơn vị tài khoản')}`} data-tooltip={row.account_currency || model.result?.account_currency} className={`wm-return-badge ${row[key] > 0 ? 'is-positive' : row[key] < 0 ? 'is-negative' : 'is-flat'}`}><span aria-hidden="true">{row[key] > 0 ? '↗' : row[key] < 0 ? '↙' : '-'}</span>{display(row,key,model,sessionName,{fmt,locale,t,timezone})}</span> : ['status', 'side', 'entry_type'].includes(key) && (key !== 'entry_type' || row.entry_type && !['-', '—'].includes(row.entry_type)) ? <span className={`fxa-badge is-${key === 'status' ? row.status === 'open' ? 'open' : 'closed' : key === 'entry_type' ? 'order-type' : String(row.side).toLowerCase()}`}>{display(row, key, model, sessionName, { fmt, locale, t, timezone })}</span> : key === 'session_id' ? <span data-tooltip={row.trade_id || row.tradeId}>{display(row, key, model, sessionName, { fmt, locale, t, timezone })}</span> : display(row, key, model, sessionName, { fmt, locale, t, timezone })}</td>)}</tr>)}</tbody></DataTable>
    <PaginationFooter showCount={false} totalCount={total} label="Trade ledger pagination" data-testid="analytics-ledger-pagination" page={current + 1} pages={pages} onPageChange={value => setPage(value - 1)} pageSize={size} onPageSizeChange={setSize} pending={Boolean(remotePage?.pending)} unknown={total === null} /></>}
  </section></>
}
