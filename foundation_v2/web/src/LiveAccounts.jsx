import { useState } from 'react'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import { formatProtectionMoney } from './orderProtection.js'
import { downloadLiveCsv } from './LiveRecordDialog.jsx'
import { liveAccountRows, accountTransactions, accountCashSummary } from './liveAccountModel.js'

export default function LiveAccounts({ accounts, records, broker, chosen, onSelect, transactions, writable, canImport, onCreate, onImport, onEdit, onRefresh }) {
  const { t, locale } = useTestingLocale()
  const [search,setSearch] = useState(''), [source,setSource] = useState('all'), [showFilter,setShowFilter] = useState(false), [tab,setTab] = useState('all'), [page,setPage] = useState(1), [size,setSize] = useState(10), [sort,setSort] = useState({key:'name',ascending:true}), [provider,setProvider] = useState(false)
  const rows = liveAccountRows(accounts,records,broker), selected = rows.find(row => row.id === chosen)
  const money = (value,currency) => typeof value === 'number' && Number.isFinite(value) ? `${value < 0 ? '−' : ''}${formatProtectionMoney(value,currency,locale)}` : '—'
  const filtered = rows.filter(row => (source === 'all' || row.status === source) && row.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))).sort((a,b) => {
    const value = row => sort.key === 'balance' ? row.snapshot.account.balance : sort.key === 'updated' ? Date.parse(row.updated) : row.name
    const left = value(a), right = value(b)
    if (left == null || Number.isNaN(left)) return 1
    if (right == null || Number.isNaN(right)) return -1
    return (typeof left === 'string' ? left.localeCompare(right,locale) : left-right)*(sort.ascending ? 1 : -1)
  })
  const allTransactions = accountTransactions(selected), cash = accountCashSummary(selected)
  const entries = (allTransactions || []).filter(item => tab === 'all' || item.kind === tab)
  const listing = transactions ? entries : filtered, pages = Math.max(1,Math.ceil(listing.length/size)), current = Math.min(page,pages)
  const sortBy = key => { setSort(current => ({key,ascending:current.key === key ? !current.ascending : true}));setPage(1) }
  const choose = value => { onSelect(value);setPage(1) }
  const picker = <FxSelect className="is-field" label="Tài khoản giao dịch" value={chosen} triggerContent={selected?.name || t('Chọn tài khoản')} localizeOptions={false} onChange={choose} options={rows.map(row => ({value:row.id,label:row.name}))} />
  const pagination = <PaginationFooter label={transactions ? 'Trang dòng tiền' : 'Trang tài khoản'} page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value => {setSize(value);setPage(1)}} sizes={[10,20,50]} />
  return <div className="live-accounts-layout">
    <section className="live-accounts-main" aria-label={t(transactions ? 'Giao dịch tài khoản' : 'Tài khoản giao dịch')}>
      {transactions ? <>
        <div className="live-transaction-tabs" role="group" aria-label={t("Loại dòng tiền")}>{[['all','Tất cả'],['withdrawal','Rút tiền'],['deposit','Nạp tiền'],['fee','Phí']].map(([value,label]) => <button key={value} type="button" className="fxa-button" aria-pressed={tab === value} onClick={() => {setTab(value);setPage(1)}}>{t(label)}</button>)}</div>
        <div className="live-table-scroll" role="region" tabIndex={0} aria-label={t("Dòng tiền tài khoản")}><table><thead><tr><th>{t("Loại giao dịch")}</th><th>{t("Số tiền")}</th><th>{t("Thời gian (UTC)")}</th></tr></thead><tbody>{entries.slice((current-1)*size,current*size).map(item => <tr key={item.id}><td>{t(item.label)}</td><td>{money(item.amount,selected?.snapshot.account.currency)}</td><td>{Number.isFinite(item.time) ? displayDate(item.time,{timeStyle:'short'}) : '—'}</td></tr>)}</tbody></table></div>
        {!entries.length && <div className="live-empty"><h2>{t(!selected ? 'Chọn tài khoản' : allTransactions === null ? 'Chưa có dữ liệu dòng tiền' : 'Chưa có giao dịch trong nhóm này')}</h2>{selected?.record && <p>{t("Tài khoản ghi tay hiện chưa hỗ trợ ghi nhận nạp, rút và phí tài khoản.")}</p>}</div>}
      </> : <>
        <div className="live-accounts-toolbar"><label className="live-search"><TestingIcon kind="search" /><input type="search" placeholder={t("Tìm tài khoản…")} aria-label={t("Tìm tài khoản")} value={search} onChange={event => {setSearch(event.target.value);setPage(1)}} /></label><button type="button" className="fxa-button fxa-icon-button" aria-label={t("Lọc tài khoản")} aria-expanded={showFilter} onClick={() => setShowFilter(!showFilter)}><FilterIcon kind="filter" /></button>{showFilter && <FxSelect label="Nguồn tài khoản" value={source} onChange={value => {setSource(value);setPage(1)}} options={[{value:'all',label:'Tất cả'},{value:'manual',label:'Ghi tay'},{value:'synced',label:'Đã đồng bộ'},{value:'stale',label:'Mất kết nối'}]} />}</div>
        <div className="live-table-scroll" role="region" tabIndex={0} aria-label={t("Danh sách tài khoản")}><table><thead><tr>{[['name','Tài khoản'],['source','Nguồn'],['status','Trạng thái'],['balance','Số dư'],['updated','Cập nhật gần nhất'],['sync','Đồng bộ'],['edit','']].map(([key,label]) => <th key={key} aria-sort={['name','balance','updated'].includes(key) ? sort.key === key ? sort.ascending ? 'ascending' : 'descending' : 'none' : undefined}>{['name','balance','updated'].includes(key) ? <button type="button" className="live-text-action" onClick={() => sortBy(key)}>{t(label)} ↕</button> : t(label)}</th>)}</tr></thead><tbody>{filtered.slice((current-1)*size,current*size).map(row => <tr key={row.id} aria-selected={chosen === row.id}><td><button className="live-text-action" type="button" onClick={() => choose(row.id)}>{row.name}</button></td><td>{t(row.source)}</td><td><span className={`live-account-status is-${row.status}`}>{t(row.status === 'manual' ? 'Ghi tay' : row.status === 'stale' ? 'Dữ liệu cũ' : 'Đã đồng bộ · chỉ đọc')}</span></td><td>{money(row.snapshot.account.balance,row.snapshot.account.currency)}</td><td>{row.updated ? displayDate(row.updated,{timeStyle:'short'}) : '—'}</td><td>{row.record ? '—' : <button type="button" className="fxa-button fxa-icon-button" aria-label={t("Đọc lại dữ liệu MT5")} onClick={onRefresh}><TestingIcon kind="refresh" /></button>}</td><td>{row.record && <button type="button" className="fxa-button" disabled={!writable} onClick={() => onEdit(row.record)}>{t("Sửa")}</button>}</td></tr>)}</tbody></table></div>
        {!filtered.length && <div className="live-empty"><h2>{t(search || source !== 'all' ? 'Không tìm thấy tài khoản' : 'Chưa có tài khoản')}</h2><p>{t(search || source !== 'all' ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Thêm tài khoản ở bảng bên phải để bắt đầu.')}</p></div>}
      </>}
      {pagination}
      {transactions && selected && !selected.record && <details className="live-account-detail live-broker-extra"><summary>{t('Broker snapshot')}</summary><LiveBrokerSnapshot payload={selected.snapshot} section="trading-accounts" /></details>}
    </section>
    <aside className="live-add-account" aria-label={t(transactions ? 'Chi tiết tài khoản' : 'Thêm tài khoản')}>
      <h2>{t(transactions ? 'Chi tiết tài khoản' : 'Thêm tài khoản')}</h2>
      {transactions ? <>{picker}<dl className="live-cash-summary">{[['Số dư',selected?.snapshot.account.balance],['Số dư ban đầu',selected?.snapshot.account.opening_balance],['Nạp tiền',cash.deposit],['Rút tiền',cash.withdrawal],['Phí tài khoản',cash.fees],[selected?.record ? 'PnL ròng đã ghi' : 'PnL deals đã đồng bộ',cash.net]].map(([label,value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value,selected?.snapshot.account.currency)}</dd></div>)}</dl><p className="live-muted">{t(selected?.record ? 'Số dư ghi tay = số dư ban đầu + PnL ròng đã ghi. Chưa gồm nạp/rút.' : 'Dòng tiền và PnL trong phạm vi lịch sử đã đồng bộ. Số dư ban đầu chưa xác định.')}</p></> : provider ? <div className="live-connect-instructions"><button type="button" className="live-text-action" onClick={() => setProvider(false)}>{t("← Tất cả lựa chọn")}</button><h3>MetaTrader 5</h3><p>{t("Đăng nhập tài khoản trong terminal MT5, sau đó cấu hình kết nối chỉ đọc cho workspace.")}</p><ol><li>{t("Kiểm tra đúng server và tài khoản trong MT5.")}</li><li>{t("Dùng kết nối terminal được cấu hình cho workspace.")}</li><li>{t("Đọc lại để kiểm tra trạng thái đồng bộ.")}</li></ol><p className="live-muted">{t("Bản hiện tại chỉ hỗ trợ adapter demo được cấu hình sẵn; chưa hỗ trợ đăng nhập broker hoặc nhận mật khẩu từ web.")}</p><button type="button" className="fxa-button" onClick={onRefresh}>{t("Kiểm tra kết nối")}</button><span role="status" className="live-muted">{t(broker?.account ? broker.stale ? 'Đang hiển thị dữ liệu cũ; kết nối bị gián đoạn.' : 'Đã có dữ liệu đồng bộ chỉ đọc.' : 'Chưa có tài khoản MT5 được kết nối.')}</span></div> : <>
        <button type="button" className="live-template-link live-text-action" onClick={() => downloadLiveCsv([], 'wmreplay-trades-template.csv')}>{t("Tải mẫu CSV ")}<TestingIcon kind="download" /></button>
        <button type="button" className="live-upload" disabled={!canImport} onClick={onImport}><TestingIcon kind="upload" size={24} /><strong>{t("Nhập tệp CSV")}</strong><small>{t(accounts.length ? 'Nhập lịch sử giao dịch vào tài khoản ghi tay.' : 'Tạo tài khoản ghi tay trước khi nhập.')}</small></button>
        <span className="live-add-separator">{t("hoặc")}</span><button type="button" className="live-manual-option" disabled={!writable} onClick={onCreate}><span><strong>{t("Ghi tay")}</strong><small>{t("Tạo tài khoản và ghi giao dịch")}</small></span><TestingIcon kind="plus" /></button>
        <span className="live-add-separator">{t("hoặc")}</span><h3>{t("Đồng bộ với broker")}</h3><button type="button" className="live-metatrader-option fxa-button" onClick={() => setProvider(true)}><TestingIcon kind="account" />MetaTrader 5</button><p className="live-muted">{t("Qua terminal MT5 · chỉ đọc")}</p>
      </>}
    </aside>
  </div>
}
