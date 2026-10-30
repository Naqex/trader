import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import TestingIcon from './TestingIcon.jsx'
import { filterBrokerTrades } from './liveBrokerTrades.js'
import { liveAccountCapital, mt5AccountName } from './liveAccountModel.js'
import TradeLabelCell, { TradeLabelDisplay } from './TradeLabelCell.jsx'
import { LIVE_TRADE_COLUMNS } from './liveTradeColumns.js'
import TradeLedgerGrid from './TradeLedgerGrid.jsx'
import { TradeJournalToolbar } from './TradeJournalPreview.jsx'
import { TradeInspector } from './FxTradeLedger.jsx'
import TradeDetailContent, { TradeDetailHeading } from './TradeDetailContent.jsx'
import TradeTagGroups from './TradeTagGroups.jsx'
import TradeFacts from './TradeFacts.jsx'
import { currencyLabel } from './moneyFormat.js'
import { formatReturnPercent } from './tradeReturnFormat.js'
import ChartIcon from './ChartIcon.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import TradeComments from './TradeComments.jsx'
import TradeFillsPreview from './TradeFillsPreview.jsx'

function LiveTradeDialog({kind,deal,time,onClose}) {
  const {t}=useTestingLocale(),dialog=useRef(null)
  useEffect(()=>{const node=dialog.current,opener=document.activeElement;node.showModal();return()=>{node.close();if(opener?.isConnected)opener.focus({preventScroll:true})}},[])
  return <dialog ref={dialog} className="wm-trade-action-dialog" aria-label={t(kind==='fills'?'Nhiều lần vào/thoát lệnh':'Xóa giao dịch')} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose()}} onKeyDown={event=>event.stopPropagation()}>
    <header><h2>{t(kind==='fills'?'Nhiều lần vào/thoát lệnh':'Xóa giao dịch')}</h2><button type="button" className="wm-button is-icon" aria-label={t('Đóng')} onClick={onClose}><ChartIcon name="close"/></button></header>
    {kind==='fills'?<TradeFillsPreview deal={deal} time={time} onClose={onClose}/>:<><p>{t('Giao dịch này được đồng bộ từ MT5. Chưa hỗ trợ xóa khỏi nhật ký; dữ liệu và lệnh tại broker vẫn được giữ.')}</p><footer><button type="button" className="fxa-button" onClick={onClose}>{t('Cancel')}</button><button type="button" className="fxa-button is-danger" disabled>{t('Xóa giao dịch')}</button></footer></>}
  </dialog>
}

function LiveTradeInspector({ deal, payload, accountName, time, money, side, workspace, catalog, onLabelsChanged, onClose, onPrevious, onNext }) {
  const { t, fmt, locale } = useTestingLocale()
  const [comments,setComments]=useState(false),[menu,setMenu]=useState(null),[action,setAction]=useState(null)
  const value = (item, digits = 6) => Number.isFinite(item) ? fmt(item, '', digits) : '-'
  const realizedMoney = item => deal.status === 'Closed' ? fmt(item) : deal.status === 'Open' ? 'N/A' : '-'
  const closed=deal.status==='Closed',capital=liveAccountCapital(payload)
  const minutes=closed && Number.isFinite(deal.open_time_utc) && Number.isFinite(deal.close_time_utc) && deal.close_time_utc>=deal.open_time_utc?Math.floor((deal.close_time_utc-deal.open_time_utc)/60000):null
  const percent=closed && capital>0 && Number.isFinite(deal.net_pnl)?deal.net_pnl/capital*100:null
  const returns=<span className="wm-trade-return-parts"><span>{realizedMoney(deal.net_pnl)}</span><span>{percent===null?'N/A':formatReturnPercent(percent,{fmt,locale})}</span><span title={t('Biến động giá khớp thực tế / khoảng cách đến SL ban đầu, theo chiều lệnh. Không gồm phí; phí đã tính vào PnL ròng.')}>{closed && Number.isFinite(deal.realized_r)?fmt(deal.realized_r,' R'):'N/A'}</span></span>
  return <TradeInspector onClose={onClose} onPrevious={onPrevious} onNext={onNext} liveActions={{commentButton:<button type="button" className="wm-button is-icon" aria-label={t('Bình luận')} disabled={!workspace || !payload.connection_id} aria-pressed={comments} onClick={()=>setComments(value=>!value)}><ChartIcon name="comment"/></button>,menu:<button type="button" className="wm-button is-icon" aria-label={t('Thêm thao tác giao dịch')} aria-expanded={Boolean(menu)} aria-haspopup="menu" onClick={event=>setMenu(menu?null:event.currentTarget)}><ChartIcon name="more-vertical"/></button>}} heading={<TradeDetailHeading title={`${deal.symbol}, ${side(deal.type)}`} net={closed ? deal.net_pnl : null} currency={payload.account?.currency} entryAt={deal.open_time_utc} exitAt={deal.close_time_utc} timeBasis="Realtime" subtitle={accountName} />}>
    <TradeDetailContent key={JSON.stringify([workspace,payload.connection_id,deal.ticket])} noteScope={{workspace,session:payload.connection_id ? `live:${payload.connection_id}` : null,trade:String(deal.ticket),accountLabel:accountName}} tags={workspace && payload.connection_id && catalog ? <TradeTagGroups workspace={workspace} session={`live:${payload.connection_id}`} row={{...deal,trade_id:deal.ticket}} catalog={catalog} onChanged={onLabelsChanged} /> : <TradeLabelDisplay tags={deal.tags || []} options={catalog?.items || []} />}>
      <TradeFacts variant="live" account={accountName} asset={deal.symbol} side={side(deal.type)} entryType={deal.entry_type} timeBasis="Realtime"
        entryAt={time(deal.open_time_utc)} exitAt={time(deal.close_time_utc)} entryPrice={value(deal.price_open)} exitPrice={value(deal.price_close)}
        size={value(deal.quantity,4)} stop={value(deal.stop_loss)} target={value(deal.take_profit)}
        duration={minutes===null?'N/A':`${Math.floor(minutes/60)}h ${minutes%60}m`} fills={<button type="button" className="wm-trade-fills-button" disabled={!deal.fills?.length} onClick={()=>setAction('fills')}><ChartIcon name="order"/>{t('Nhiều lần vào/thoát lệnh')}</button>}
        currency={payload.account?.currency} gross={realizedMoney(deal.gross_pnl)} fees={realizedMoney(deal.fees)} net={returns}/>
    </TradeDetailContent>
    {comments && <TradeComments key={JSON.stringify([workspace,payload.connection_id,deal.ticket])} workspace={workspace} session={`live:${payload.connection_id}`} trade={String(deal.ticket)} onClose={()=>setComments(false)}/>}
    {menu && <LegacyPopover anchor={menu} role="menu" label={t('Thêm thao tác giao dịch')} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={()=>setMenu(null)}><button type="button" role="menuitem" className="wm-trade-delete-menu" onClick={()=>{setMenu(null);setAction('delete')}}><ChartIcon name="trash"/>{t('Xóa giao dịch')}</button></LegacyPopover>}
    {action && <LiveTradeDialog kind={action} deal={deal} time={time} side={side} onClose={()=>setAction(null)}/>}
  </TradeInspector>
}

export default function LiveBrokerSnapshot({ workspace, catalog, onLabelsChanged, payload, section, trades, filters, filterKey = '', columns = LIVE_TRADE_COLUMNS.map(([key]) => key), journalView='active', onJournalView }) {
  const { t, fmt, timezone, locale } = useTestingLocale()
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), sorting = useTableSort(()=>setPage(1))
  const [selected, setSelected] = useState(''), [checked, setChecked] = useState(new Set())
  const selectPage = useRef(null)
  const allChecked = visibleRows => visibleRows.length > 0 && visibleRows.every(deal => checked.has(String(deal.ticket)))
  useEffect(() => setPage(1), [pageSize, filterKey, payload.connection_id, payload.account?.account_ref])
  useEffect(() => { setSelected(''); setChecked(new Set()) }, [filterKey, journalView, payload.connection_id, payload.account?.account_ref])
  useEffect(() => {
    if (sorting.sorts.some(sort => !columns.includes(sort.key))) sorting.setSorts(sorting.sorts.filter(sort => columns.includes(sort.key)))
  }, [columns, sorting.sorts])
  const account = payload.account
  if (!account) return null
  const currency = account.currency || '', money = value => fmt(value, currency ? ` ${currency}` : '')
  const capital = liveAccountCapital(payload)
  const accountLogin = payload.account_login || payload.account_binding?.login || account.account_ref
  const accountName = mt5AccountName({ ...payload.connections?.find(item=>item.id===payload.connection_id), account_login: accountLogin, account_environment: payload.account_environment || payload.account_binding?.account_environment })
  const time = value => typeof value === 'number' && Number.isFinite(value) ? displayDate(new Date(value), { timeStyle: 'medium', timeZone: timezone }) : '-'
  const side = value => value === 0 ? t('Buy') : value === 1 ? t('Sell') : '-'
  const realizedColumns = ['net_pnl', 'gross_pnl', 'fees', 'return_pct', 'realized_r']
  const sortValue = (deal,key) => realizedColumns.includes(key) && deal.status !== 'Closed' ? null : key === 'account' ? accountLogin : key === 'source' ? 'Sync' : key === 'side' ? deal.type === 0 ? 'BUY' : deal.type === 1 ? 'SELL' : null : key === 'return_pct' ? capital > 0 && Number.isFinite(deal.net_pnl) ? deal.net_pnl / capital * 100 : null : deal[key]
  const deals = sorting.rows(section === 'transactions' ? payload.cashflows || [] : (trades || filterBrokerTrades(payload, filters)), sortValue, [{ key: 'recorded_at_utc', direction: 'desc' }])
  const pages = Math.max(1, Math.ceil(deals.length / pageSize)), current = Math.min(page, pages), visible = deals.slice((current - 1) * pageSize, current * pageSize)
  const mixedChecked = !allChecked(visible) && visible.some(deal => checked.has(String(deal.ticket)))
  const selectedDeal = deals.find(deal => String(deal.ticket) === String(selected))
  const selectedIndex=deals.indexOf(selectedDeal)
  const moveTrade=offset=>{const index=selectedIndex+offset;setSelected(String(deals[index].ticket));setPage(Math.floor(index/pageSize)+1)}
  const shown = LIVE_TRADE_COLUMNS.filter(([key]) => columns.includes(key))
  const numericColumns = new Set(['net_pnl', 'return_pct', 'realized_r', 'quantity', 'price_open', 'stop_loss', 'take_profit', 'price_close', 'gross_pnl', 'fees'])
  const centerColumns = new Set(['status', 'side', 'entry_type'])
  const columnClass = key => numericColumns.has(key) ? 'is-numeric' : centerColumns.has(key) ? 'is-center' : ''
  const percentage = value => {
    if (!(capital > 0) || !Number.isFinite(value)) return null
    return value / capital * 100
  }
  const cellValue = (deal, key) => {
    if (realizedColumns.includes(key) && (deal.status !== 'Closed' || key === 'return_pct' && !(capital > 0) || key === 'realized_r' && !Number.isFinite(deal.realized_r))) {
      const incomplete = deal.status === 'Incomplete'
      const reason = incomplete ? 'Chưa có đầy đủ lịch sử giao dịch' : deal.status === 'Open' ? 'Chưa áp dụng khi lệnh đang mở' : 'Không có cơ sở để tính'
      return <span className="wm-missing-value" aria-label={t(reason)} data-tooltip={t(reason)}>{incomplete ? '-' : 'N/A'}</span>
    }
    switch (key) {
      case 'account': return accountName
      case 'status': return <span className={`fxa-badge is-${deal.status.toLowerCase()}`}>{t(deal.status)}</span>
      case 'source': return <span className="fxa-badge is-sync" title={payload.source}>Sync</span>
      case 'recorded_at_utc': return time(deal.recorded_at_utc)
      case 'open_time_utc': return time(deal.open_time_utc)
      case 'symbol': return deal.symbol
      case 'side': return deal.type === null ? '-' : <span className={`fxa-badge is-${deal.type === 0 ? 'buy' : 'sell'}`}>{side(deal.type)}</span>
      case 'entry_type': return deal.entry_type ? <span className="fxa-badge is-order-type">{deal.entry_type.toLowerCase()}</span> : '-'
      case 'net_pnl':
      case 'gross_pnl': { const value = deal[key]; return Number.isFinite(value) ? <span tabIndex={0} aria-label={`${fmt(value)} ${currencyLabel(currency) || t('Đơn vị tài khoản')}`} data-tooltip={currencyLabel(currency)} className={`wm-return-badge ${value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-flat'}`}><span aria-hidden="true">{value > 0 ? '↗' : value < 0 ? '↙' : '-'}</span>{fmt(value)}</span> : '-' }
      case 'return_pct': { const value = percentage(deal.net_pnl); return value === null ? '-' : formatReturnPercent(value, { fmt, locale }) }
      case 'realized_r': return <span tabIndex={0} data-tooltip={t('Biến động giá khớp thực tế / khoảng cách đến SL ban đầu, theo chiều lệnh. Không gồm phí; phí đã tính vào PnL ròng.')}>{fmt(deal.realized_r, ' R')}</span>
      case 'tags': return workspace && payload.connection_id && catalog ? <TradeLabelCell workspace={workspace} session={`live:${payload.connection_id}`} row={{...deal,trade_id:deal.ticket}} catalog={catalog} onChanged={onLabelsChanged} /> : <TradeLabelDisplay tags={deal.tags || []} options={catalog?.items} />
      case 'price_open': return fmt(deal.price_open, '', 6)
      case 'quantity': return fmt(deal.quantity, '', 4)
      case 'stop_loss': return fmt(deal.stop_loss, '', 6)
      case 'take_profit': return fmt(deal.take_profit, '', 6)
      case 'report_time_utc': return time(deal.report_time_utc)
      case 'close_time_utc': return time(deal.close_time_utc)
      case 'price_close': return fmt(deal.price_close, '', 6)
      case 'fees': return money(deal.fees)
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
      {!deals.length ? <div className="live-empty" data-testid="live-deals-empty"><TestingIcon kind={section === 'transactions' ? 'account' : 'journal'} size={48} /><h3>{t(section === 'transactions' ? 'No transactions yet' : 'No deals in this selection.')}</h3></div> : section === 'transactions' ? table('Transactions', ['Time', 'Ticket', 'MT5 type', 'Amount', 'Comment'], visible.map(deal => <tr key={deal.ticket}><td>{time(deal.time_msc)}</td><td>{deal.ticket}</td><td>{deal.type}</td><td>{money(deal.profit)}</td><td>{deal.comment || '-'}</td></tr>)) : !shown.length ? <div className="live-empty"><h3>{t('Chọn cột hiển thị để xem giao dịch.')}</h3></div> : <TradeLedgerGrid workspace={workspace} sourceKind="broker" bulkGroups={catalog?.groups || []} bulkLabels={catalog?.items || []} journalView={journalView} onJournalView={onJournalView} showJournalToolbar={false} rows={visible} current={current - 1} size={pageSize} shownColumns={shown} columnHeader={columnHeader} renderCell={cellValue} cellClass={columnClass} rowKey={deal => String(deal.ticket)} sortResetActive={sorting.sorts.length > 0} onClearSort={sorting.clear} selected={selected} onSelect={setSelected} checked={checked} onToggle={id => setChecked(values => { const next = new Set(values); next.has(id) ? next.delete(id) : next.add(id); return next })} allChecked={allChecked(visible)} mixedChecked={mixedChecked} selectPage={selectPage} onTogglePage={() => setChecked(values => { const next = new Set(values); const all = visible.length > 0 && visible.every(deal => values.has(String(deal.ticket))); visible.forEach(deal => all ? next.delete(String(deal.ticket)) : next.add(String(deal.ticket))); return next })} totalCount={deals.length} pages={pages} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1) }} paginationLabel="Live data pagination" dataTestId="live-trade-grid" pageSizeOptions={[10,20,50,100]} rowNumberOffset={(current - 1) * pageSize} />}
    </>}
    {selectedDeal && section !== 'transactions' && <LiveTradeInspector deal={selectedDeal} payload={payload} accountName={accountName} time={time} money={money} side={side} workspace={workspace} catalog={catalog} onLabelsChanged={onLabelsChanged} onClose={() => setSelected('')} onPrevious={selectedIndex>0?()=>moveTrade(-1):undefined} onNext={selectedIndex<deals.length-1?()=>moveTrade(1):undefined} />}
  </section>
}
