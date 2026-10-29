import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import TestingIcon from './TestingIcon.jsx'
import { filterBrokerTrades } from './liveBrokerTrades.js'
import { liveAccountCapital, mt5AccountName } from './liveAccountModel.js'
import { TradeLabelDisplay } from './TradeLabelCell.jsx'
import { LIVE_TRADE_COLUMNS } from './liveTradeColumns.js'
import TradeLedgerGrid from './TradeLedgerGrid.jsx'

export default function LiveBrokerSnapshot({ payload, section, trades, filters, filterKey = '', columns = LIVE_TRADE_COLUMNS.map(([key]) => key) }) {
  const { t, fmt, timezone } = useTestingLocale()
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), sorting = useTableSort(()=>setPage(1))
  const [selected, setSelected] = useState(''), [checked, setChecked] = useState(new Set())
  const selectPage = useRef(null)
  useEffect(() => setPage(1), [pageSize, filterKey, payload.connection_id, payload.account?.account_ref])
  const account = payload.account
  if (!account) return null
  const currency = account.currency || '', money = value => fmt(value, currency ? ` ${currency}` : '')
  const capital = liveAccountCapital(payload)
  const accountLogin = payload.account_login || payload.account_binding?.login || account.account_ref
  const accountName = mt5AccountName({ account_login: accountLogin, account_environment: payload.account_environment || payload.account_binding?.account_environment })
  const time = value => typeof value === 'number' && Number.isFinite(value) ? displayDate(new Date(value), { timeStyle: 'medium', timeZone: timezone }) : '-'
  const side = value => value === 0 ? t('Buy') : value === 1 ? t('Sell') : '-'
  const sortValue = (deal,key) => key === 'account' ? accountLogin : key === 'source' ? 'Sync' : key === 'side' ? side(deal.type) : key === 'return_pct' ? capital > 0 && Number.isFinite(deal.net_pnl) ? deal.net_pnl / capital * 100 : null : deal[key]
  const deals = sorting.rows(section === 'transactions' ? payload.cashflows || [] : trades || filterBrokerTrades(payload, filters), sortValue, [{ key: 'recorded_at_utc', direction: 'desc' }])
  const pages = Math.max(1, Math.ceil(deals.length / pageSize)), current = Math.min(page, pages), visible = deals.slice((current - 1) * pageSize, current * pageSize)
  const shown = LIVE_TRADE_COLUMNS.filter(([key]) => columns.includes(key))
  const numericColumns = new Set(['net_pnl', 'return_pct', 'realized_r', 'quantity', 'price_open', 'stop_loss', 'take_profit', 'price_close', 'gross_pnl', 'fees'])
  const centerColumns = new Set(['status', 'side', 'entry_type'])
  const columnClass = key => numericColumns.has(key) ? 'is-numeric' : centerColumns.has(key) ? 'is-center' : ''
  const percentage = value => {
    if (!(capital > 0) || !Number.isFinite(value)) return null
    const result = value / capital * 100
    return Math.abs(result) < 0.005 ? 0 : result
  }
  const cellValue = (deal, key) => {
    switch (key) {
      case 'account': return accountName
      case 'status': return <span className={`fxa-badge is-${deal.status.toLowerCase()}`}>{t(deal.status)}</span>
      case 'source': return <span className="fxa-badge is-sync" title={payload.source}>Sync</span>
      case 'recorded_at_utc': return time(deal.recorded_at_utc)
      case 'open_time_utc': return time(deal.open_time_utc)
      case 'symbol': return deal.symbol
      case 'side': return deal.type === null ? '-' : <span className={`fxa-badge is-${deal.type === 0 ? 'buy' : 'sell'}`}>{side(deal.type)}</span>
      case 'entry_type': return deal.entry_type ? <span className="fxa-badge is-order-type">{deal.entry_type.toLowerCase()}</span> : '-'
      case 'net_pnl': { const value = deal.net_pnl; return Number.isFinite(value) ? <span tabIndex={0} className={`wm-return-badge ${value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-flat'}`}><span aria-hidden="true">{value > 0 ? '↗' : value < 0 ? '↙' : '-'}</span>{fmt(value)}</span> : '-' }
      case 'return_pct': { const value = percentage(deal.net_pnl); return value === null ? '-' : fmt(value, '%') }
      case 'realized_r': return Number.isFinite(deal.realized_r) ? <span tabIndex={0} data-tooltip={t('Biến động giá khớp thực tế / khoảng cách đến SL ban đầu, theo chiều lệnh. Không gồm phí; phí đã tính vào PnL ròng.')}>{fmt(deal.realized_r)}</span> : '-'
      case 'tags': return <TradeLabelDisplay tags={deal.tags || []} />
      case 'price_open': return fmt(deal.price_open, '', 5)
      case 'quantity': return fmt(deal.quantity, '', 5)
      case 'stop_loss': return fmt(deal.stop_loss, '', 5)
      case 'take_profit': return fmt(deal.take_profit, '', 5)
      case 'report_time_utc': return time(deal.report_time_utc)
      case 'close_time_utc': return time(deal.close_time_utc)
      case 'price_close': return fmt(deal.price_close, '', 5)
      case 'gross_pnl': return fmt(deal.gross_pnl)
      case 'fees': return fmt(deal.fees)
      default: return fmt(deal[key])
    }
  }
  const timeColumns = {
    recorded_at_utc: ['Vào lệnh', 'Realtime'], open_time_utc: ['Vào lệnh', 'Chart'],
    report_time_utc: ['Thoát lệnh', 'Realtime'], close_time_utc: ['Thoát lệnh', 'Chart'],
  }
  const columnLabel = key => timeColumns[key] ? `${t(timeColumns[key][0])} (${timeColumns[key][1]})` : t(LIVE_TRADE_COLUMNS.find(([name]) => name === key)?.[1] || key)
  const columnHeader = ([key, label]) => <SortableColumn key={key} className={columnClass(key)} {...sorting.columnProps(key, t(columnLabel(key)))}>{t(columnLabel(key))}</SortableColumn>
  const table = (label, headers, rows) => <DataTable className="live-table-scroll" label={t(label)}><thead><tr>{headers.some(header=>typeof header !== 'string') && <SortResetColumn active={sorting.sorts.length > 0} onClear={sorting.clear}/ >}{headers.map(header => typeof header === 'string' ? <th key={header} scope="col">{t(header)}</th> : <SortableColumn key={header.key} className={['account','type','source','time','asset','side','entry','exit_time'].includes(header.key)?undefined:'is-numeric'} {...sorting.columnProps(header.key,t(columnLabel(header.key)))}>{t(columnLabel(header.key))}</SortableColumn>)}</tr></thead><tbody>{rows}</tbody></DataTable>
  return <section className="live-broker" aria-label={t('Broker snapshot')} data-testid="live-broker-snapshot">
    {section === 'trading-accounts' ? <>
      <div className="live-section-heading"><h2>{payload.source} · {account.account_ref}</h2></div>
      <dl className="live-account-values">{[['Balance', account.balance], ['Equity', account.equity], ['Floating PnL', account.profit], ['Margin', account.margin], ['Free margin', account.margin_free]].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value)}</dd></div>)}</dl>
      <details className="live-account-detail"><summary>{t('Open positions')} ({Array.isArray(payload.positions) ? payload.positions.length : '-'})</summary>{payload.positions?.length ? table('Open positions', ['Ticket', 'Asset', 'Side', 'Lot', 'Entry price', 'SL / TP', 'PnL'], payload.positions.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{side(item.type)}</td><td>{fmt(item.volume, '', 5)}</td><td>{fmt(item.price_open, '', 5)}</td><td>{fmt(item.sl, '', 5)} / {fmt(item.tp, '', 5)}</td><td>{money(item.profit)}</td></tr>)) : <p>{t(Array.isArray(payload.positions) ? 'No open positions in this snapshot.' : 'Position data is unavailable.')}</p>}</details>
      <details className="live-account-detail"><summary>{t('Pending orders')} ({Array.isArray(payload.orders) ? payload.orders.length : '-'})</summary>{payload.orders?.length ? table('Pending orders', ['Ticket', 'Asset', 'MT5 type', 'Lot', 'Price'], payload.orders.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{item.type}</td><td>{fmt(item.volume_current, '', 5)}</td><td>{fmt(item.price_open, '', 5)}</td></tr>)) : <p>{t(Array.isArray(payload.orders) ? 'No pending orders in this snapshot.' : 'Order data is unavailable.')}</p>}</details>
      <details className="live-account-detail"><summary>{t('Latest broker quotes')}</summary>{payload.quotes?.length ? table('Latest broker quotes', ['Asset', 'Bid', 'Ask', 'Tick time'], payload.quotes.map(quote => <tr key={quote.symbol}><td>{quote.symbol}</td><td>{fmt(quote.bid, '', 5)}</td><td>{fmt(quote.ask, '', 5)}</td><td>{time(quote.time_msc)}{Date.now() - quote.time_msc > 120000 && ` · ${t('Stale quote')}`}</td></tr>)) : <p>{t('No quotes in this snapshot.')}</p>}</details>
    </> : <>
      {!deals.length ? <div className="live-empty" data-testid="live-deals-empty"><TestingIcon kind={section === 'transactions' ? 'account' : 'journal'} size={48} /><h3>{t(section === 'transactions' ? 'No transactions yet' : 'No deals in this selection.')}</h3></div> : section === 'transactions' ? table('Transactions', ['Time', 'Ticket', 'MT5 type', 'Amount', 'Comment'], visible.map(deal => <tr key={deal.ticket}><td>{time(deal.time_msc)}</td><td>{deal.ticket}</td><td>{deal.type}</td><td>{money(deal.profit)}</td><td>{deal.comment || '-'}</td></tr>)) : !shown.length ? <div className="live-empty"><h3>{t('Chọn cột hiển thị để xem giao dịch.')}</h3></div> : <TradeLedgerGrid rows={visible} current={current - 1} size={pageSize} shownColumns={shown} columnHeader={columnHeader} renderCell={cellValue} cellClass={columnClass} rowKey={deal => String(deal.ticket)} sortResetActive={sorting.sorts.length > 0} onClearSort={sorting.clear} selected={selected} onSelect={setSelected} checked={checked} onToggle={id => setChecked(values => { const next = new Set(values); next.has(id) ? next.delete(id) : next.add(id); return next })} allChecked={visible.length > 0 && visible.every(deal => checked.has(String(deal.ticket)))} mixedChecked={visible.some(deal => checked.has(String(deal.ticket)))} selectPage={selectPage} onTogglePage={() => setChecked(values => { const next = new Set(values); const all = visible.length > 0 && visible.every(deal => values.has(String(deal.ticket))); visible.forEach(deal => all ? next.delete(String(deal.ticket)) : next.add(String(deal.ticket))); return next })} totalCount={deals.length} pages={pages} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1) }} paginationLabel="Live data pagination" dataTestId="live-trade-grid" pageSizeOptions={[10,20,50,100]} rowNumberOffset={(current - 1) * pageSize} />}
    </>}
  </section>
}
