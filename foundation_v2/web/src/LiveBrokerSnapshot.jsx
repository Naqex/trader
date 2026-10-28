import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { formatUtc } from './researchDataApi.js'
import PaginationFooter from './PaginationFooter.jsx'
import TestingIcon from './TestingIcon.jsx'
import { dealNet } from './liveWorkspaceModel.js'
import { BROKER_DEAL_COLUMNS } from './liveTradeColumns.js'

export default function LiveBrokerSnapshot({ payload, section, deals: filteredDeals, filterKey = '', columns = BROKER_DEAL_COLUMNS.map(([key]) => key) }) {
  const { t, fmt, locale } = useTestingLocale()
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), sorting = useTableSort(()=>setPage(1))
  useEffect(() => setPage(1), [pageSize, filterKey, payload.connection_id, payload.account?.account_ref])
  const account = payload.account
  if (!account) return null
  const currency = account.currency || '', money = value => fmt(value, currency ? ` ${currency}` : '')
  const capital = Number.isFinite(payload.balance_baseline?.amount) ? payload.balance_baseline.amount : Number.isFinite(account.opening_balance) ? account.opening_balance : null
  const fees = deal => [deal.commission, deal.swap, deal.fee].every(Number.isFinite) ? deal.commission + deal.swap + deal.fee : null
  const time = value => typeof value === 'number' && Number.isFinite(value) ? formatUtc(value / 1000, locale) : '-'
  const side = value => value === 0 ? t('Buy') : value === 1 ? t('Sell') : '-'
  const direction = value => value === 0 ? t('Long') : value === 1 ? t('Short') : '-'
  const entries = ['Entry', 'Exit', 'Reversal', 'Close by']
  const sortValue = (deal,key) => key === 'account' ? account.account_ref : key === 'type' ? side(deal.type) : key === 'source' ? payload.source : key === 'time' ? deal.time_msc : key === 'asset' ? deal.symbol : key === 'side' ? direction(deal.type) : key === 'entry' ? entries[deal.entry] || '' : key === 'net' ? dealNet(deal) : key === 'return_pct' ? capital && Number.isFinite(dealNet(deal)) ? dealNet(deal) / capital * 100 : null : key === 'exit_time' ? deal.entry === 1 ? deal.time_msc : null : key === 'fees' ? fees(deal) : deal[key]
  const deals = sorting.rows(section === 'transactions' ? payload.cashflows || [] : filteredDeals || payload.deals || [], sortValue, [{ key: 'time', direction: 'desc' }])
  const pages = Math.max(1, Math.ceil(deals.length / pageSize)), current = Math.min(page, pages), visible = deals.slice((current - 1) * pageSize, current * pageSize)
  const shown = BROKER_DEAL_COLUMNS.filter(([key]) => columns.includes(key))
  const percentage = value => {
    if (!capital || !Number.isFinite(value)) return null
    const result = value / capital * 100
    return Math.abs(result) < 0.005 ? 0 : result
  }
  const cellValue = (deal, key) => {
    switch (key) {
      case 'account': return account.account_ref || '-'
      case 'type': return side(deal.type)
      case 'source': return payload.source || t('MT5')
      case 'time': return <>{time(deal.time_msc)}<small>#{deal.ticket} · {t('Order')} {deal.order ?? '-'}</small></>
      case 'asset': return deal.symbol
      case 'side': return direction(deal.type)
      case 'entry': return entries[deal.entry] ? t(entries[deal.entry]) : '-'
      case 'return_pct': { const value = percentage(dealNet(deal)); return value === null ? '-' : fmt(value, '%') }
      case 'price': return deal.entry === 1 ? '-' : fmt(deal.price, '', 5)
      case 'volume': return fmt(deal.volume, '', 5)
      case 'exit_time': return deal.entry === 1 ? time(deal.time_msc) : '-'
      case 'exit_price': return deal.entry === 1 ? fmt(deal.price, '', 5) : '-'
      case 'net': return fmt(dealNet(deal))
      case 'fees': return fmt(fees(deal))
      case 'profit': return fmt(deal.profit)
      default: return fmt(deal[key])
    }
  }
  const columnLabel = key => key === 'net' ? `${t('Return')} (${currency || '$'})` : BROKER_DEAL_COLUMNS.find(([name]) => name === key)?.[1] || key
  const table = (label, headers, rows) => <DataTable className="live-table-scroll" label={t(label)}><thead><tr>{headers.some(header=>typeof header !== 'string') && <SortResetColumn active={sorting.sorts.length > 0} onClear={sorting.clear}/ >}{headers.map(header => typeof header === 'string' ? <th key={header} scope="col">{t(header)}</th> : <SortableColumn key={header.key} className={['account','type','source','time','asset','side','entry','exit_time'].includes(header.key)?undefined:'is-numeric'} {...sorting.columnProps(header.key,t(columnLabel(header.key)))}>{t(columnLabel(header.key))}</SortableColumn>)}</tr></thead><tbody>{rows}</tbody></DataTable>
  return <section className="live-broker" aria-label={t('Broker snapshot')} data-testid="live-broker-snapshot">
    {section === 'trading-accounts' ? <>
      <div className="live-section-heading"><h2>{payload.source} · {account.account_ref}</h2></div>
      <dl className="live-account-values">{[['Balance', account.balance], ['Equity', account.equity], ['Floating PnL', account.profit], ['Margin', account.margin], ['Free margin', account.margin_free]].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value)}</dd></div>)}</dl>
      <details className="live-account-detail"><summary>{t('Open positions')} ({Array.isArray(payload.positions) ? payload.positions.length : '-'})</summary>{payload.positions?.length ? table('Open positions', ['Ticket', 'Asset', 'Side', 'Lot', 'Entry price', 'SL / TP', 'PnL'], payload.positions.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{side(item.type)}</td><td>{fmt(item.volume, '', 5)}</td><td>{fmt(item.price_open, '', 5)}</td><td>{fmt(item.sl, '', 5)} / {fmt(item.tp, '', 5)}</td><td>{money(item.profit)}</td></tr>)) : <p>{t(Array.isArray(payload.positions) ? 'No open positions in this snapshot.' : 'Position data is unavailable.')}</p>}</details>
      <details className="live-account-detail"><summary>{t('Pending orders')} ({Array.isArray(payload.orders) ? payload.orders.length : '-'})</summary>{payload.orders?.length ? table('Pending orders', ['Ticket', 'Asset', 'MT5 type', 'Lot', 'Price'], payload.orders.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{item.type}</td><td>{fmt(item.volume_current, '', 5)}</td><td>{fmt(item.price_open, '', 5)}</td></tr>)) : <p>{t(Array.isArray(payload.orders) ? 'No pending orders in this snapshot.' : 'Order data is unavailable.')}</p>}</details>
      <details className="live-account-detail"><summary>{t('Latest broker quotes')}</summary>{payload.quotes?.length ? table('Latest broker quotes', ['Asset', 'Bid', 'Ask', 'Tick time'], payload.quotes.map(quote => <tr key={quote.symbol}><td>{quote.symbol}</td><td>{fmt(quote.bid, '', 5)}</td><td>{fmt(quote.ask, '', 5)}</td><td>{time(quote.time_msc)}{Date.now() - quote.time_msc > 120000 && ` · ${t('Stale quote')}`}</td></tr>)) : <p>{t('No quotes in this snapshot.')}</p>}</details>
    </> : <>
      {!deals.length ? <div className="live-empty" data-testid="live-deals-empty"><TestingIcon kind={section === 'transactions' ? 'account' : 'journal'} size={48} /><h3>{t(section === 'transactions' ? 'No transactions yet' : 'No deals in this selection.')}</h3></div> : section === 'transactions' ? table('Transactions', ['Time', 'Ticket', 'MT5 type', 'Amount', 'Comment'], visible.map(deal => <tr key={deal.ticket}><td>{time(deal.time_msc)}</td><td>{deal.ticket}</td><td>{deal.type}</td><td>{money(deal.profit)}</td><td>{deal.comment || '-'}</td></tr>)) : !shown.length ? <div className="live-empty"><h3>{t('Chọn cột hiển thị để xem giao dịch.')}</h3></div> : table('Broker deals', shown.map(([key,label]) => ({key,label})), visible.map((deal,index) => <tr key={deal.ticket}><td className="wm-table-row-number">{(current-1)*pageSize+index+1}</td>{shown.map(([key]) => <td key={key} className={`${['time','asset','side'].includes(key)?'':'is-numeric'} ${key === 'net' ? dealNet(deal) > 0 ? 'is-gain' : dealNet(deal) < 0 ? 'is-loss' : '' : ''}`}>{cellValue(deal,key)}</td>)}</tr>))}

      {deals.length > 0 && <PaginationFooter showCount={false} totalCount={deals.length} label="Live data pagination" page={current} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} sizes={[10,20,50,100]} />}
    </>}
  </section>
}
