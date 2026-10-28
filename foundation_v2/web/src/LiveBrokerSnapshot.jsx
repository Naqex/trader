import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import TestingIcon from './TestingIcon.jsx'
import { dealNet } from './liveWorkspaceModel.js'
import { LIVE_TRADE_COLUMNS } from './liveTradeColumns.js'
import TradeLedgerGrid from './TradeLedgerGrid.jsx'

export default function LiveBrokerSnapshot({ payload, section, deals: filteredDeals, filterKey = '', columns = LIVE_TRADE_COLUMNS.map(([key]) => key) }) {
  const { t, fmt, timezone } = useTestingLocale()
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), sorting = useTableSort(()=>setPage(1))
  const [selected, setSelected] = useState(''), [checked, setChecked] = useState(new Set())
  const selectPage = useRef(null)
  useEffect(() => setPage(1), [pageSize, filterKey, payload.connection_id, payload.account?.account_ref])
  const account = payload.account
  if (!account) return null
  const currency = account.currency || '', money = value => fmt(value, currency ? ` ${currency}` : '')
  const capital = Number.isFinite(payload.balance_baseline?.amount) ? payload.balance_baseline.amount : Number.isFinite(account.opening_balance) ? account.opening_balance : null
  const fees = deal => [deal.commission, deal.swap, deal.fee].every(Number.isFinite) ? deal.commission + deal.swap + deal.fee : null
  const time = value => typeof value === 'number' && Number.isFinite(value) ? displayDate(new Date(value), { timeStyle: 'medium', timeZone: timezone }) : '-'
  const side = value => value === 0 ? t('Buy') : value === 1 ? t('Sell') : '-'
  const entries = ['Entry', 'Exit', 'Reversal', 'Close by']
  const sortValue = (deal,key) => key === 'account' ? account.account_ref : key === 'status' ? deal.entry === 1 ? 'closed' : 'open' : key === 'source' ? payload.source : ['recorded_at_utc','open_time_utc','report_time_utc','close_time_utc'].includes(key) ? deal.time_msc : key === 'symbol' ? deal.symbol : key === 'side' ? side(deal.type) : key === 'entry_type' ? entries[deal.entry] || '' : key === 'net_pnl' ? dealNet(deal) : key === 'return_pct' ? capital && Number.isFinite(dealNet(deal)) ? dealNet(deal) / capital * 100 : null : key === 'fees' ? fees(deal) : key === 'gross_pnl' ? deal.profit : key === 'quantity' ? deal.volume : key === 'price_open' || key === 'price_close' ? deal.price : deal[key]
  const deals = sorting.rows(section === 'transactions' ? payload.cashflows || [] : filteredDeals || payload.deals || [], sortValue, [{ key: 'recorded_at_utc', direction: 'desc' }])
  const pages = Math.max(1, Math.ceil(deals.length / pageSize)), current = Math.min(page, pages), visible = deals.slice((current - 1) * pageSize, current * pageSize)
  const shown = LIVE_TRADE_COLUMNS.filter(([key]) => columns.includes(key))
  const numericColumns = new Set(['net_pnl', 'return_pct', 'realized_r', 'quantity', 'price_open', 'stop_loss', 'take_profit', 'price_close', 'gross_pnl', 'fees'])
  const centerColumns = new Set(['status', 'side', 'entry_type'])
  const columnClass = key => numericColumns.has(key) ? 'is-numeric' : centerColumns.has(key) ? 'is-center' : ''
  const percentage = value => {
    if (!capital || !Number.isFinite(value)) return null
    const result = value / capital * 100
    return Math.abs(result) < 0.005 ? 0 : result
  }
  const cellValue = (deal, key) => {
    switch (key) {
      case 'account': return account.account_ref || '-'
      case 'status': return <span className={`fxa-badge is-${deal.entry === 1 ? 'closed' : 'open'}`}>{t(deal.entry === 1 ? 'Closed' : 'Open')}</span>
      case 'source': return payload.source || t('MT5')
      case 'recorded_at_utc': return time(deal.time_msc)
      case 'open_time_utc': return deal.entry === 1 ? '-' : time(deal.time_msc)
      case 'symbol': return deal.symbol
      case 'side': return <span className={`fxa-badge is-${deal.type === 0 ? 'buy' : 'sell'}`}>{side(deal.type)}</span>
      case 'entry_type': return <span className="fxa-badge is-order-type">{entries[deal.entry] ? t(entries[deal.entry]) : '-'}</span>
      case 'net_pnl': { const value = dealNet(deal); return Number.isFinite(value) ? <span tabIndex={0} className={`wm-return-badge ${value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-flat'}`}><span aria-hidden="true">{value > 0 ? '↗' : value < 0 ? '↙' : '-'}</span>{fmt(value)}</span> : '-' }
      case 'return_pct': { const value = percentage(dealNet(deal)); return value === null ? '-' : fmt(value, '%') }
      case 'realized_r': return '-'
      case 'tags': return '-'
      case 'price_open': return deal.entry === 1 ? '-' : fmt(deal.price, '', 5)
      case 'quantity': return fmt(deal.volume, '', 5)
      case 'stop_loss': return '-'
      case 'take_profit': return '-'
      case 'report_time_utc': return deal.entry === 1 ? time(deal.time_msc) : '-'
      case 'close_time_utc': return deal.entry === 1 ? time(deal.time_msc) : '-'
      case 'price_close': return deal.entry === 1 ? fmt(deal.price, '', 5) : '-'
      case 'gross_pnl': return fmt(deal.profit)
      case 'fees': return fmt(fees(deal))
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
