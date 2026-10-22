import { useEffect, useRef, useState } from 'react'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import { formatProtectionMoney } from './orderProtection.js'
import { downloadLiveCsv } from './LiveRecordDialog.jsx'
import MetaTraderConnect from './MetaTraderConnect.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import LegacyModal from './LegacyModal.jsx'
import { MT5_STATUS, mt5Error, mt5Request } from './mt5Connections.js'
import { liveAccountRows, accountTransactions, accountCashSummary, duplicateAccountSeed } from './liveAccountModel.js'

function AccountActionDialog({ action, onClose, onConfirm }) {
  const [name,setName]=useState(action.row.name), [pending,setPending]=useState(false), [error,setError]=useState(''), [uncertain,setUncertain]=useState(false)
  const lock=useRef(false), removing=action.kind==='remove'
  return <LegacyModal className="live-record-dialog is-account" label={removing?'Xóa tài khoản':'Sửa tài khoản'} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={()=>{if(!lock.current)onClose()}}>
    <form className="live-record-form" aria-busy={pending} onSubmit={async event=>{
      event.preventDefault();if(lock.current || uncertain)return;lock.current=true;setPending(true);setError('')
      try{await onConfirm(name.trim());onClose()}catch(problem){setError(problem.message);setUncertain(problem.outcomeKnown===false || problem.uncertain===true)}finally{lock.current=false;setPending(false)}
    }}>
      {removing?<p className="live-account-action-copy">{action.row.record ? <>Xóa <strong>{action.row.name}</strong> khỏi sổ đang dùng? Tài khoản và các giao dịch, ghi chú liên quan sẽ được ẩn; lịch sử bản ghi vẫn được giữ.</> : <>Gỡ kết nối <strong>{action.row.name}</strong> cùng mật khẩu và bản dữ liệu đồng bộ khỏi ứng dụng? Tài khoản tại broker không bị thay đổi.</>}</p>:<label>Tên tài khoản<input required maxLength={160} value={name} disabled={pending} onChange={event=>setName(event.target.value)}/></label>}
      {error&&<p role="alert" className="live-record-error">{error}{uncertain?' Tải lại danh sách để kiểm tra kết quả trước khi thao tác tiếp.':''}</p>}
      <footer className="live-dialog-footer"><button type="button" className="fxa-button" disabled={pending} onClick={onClose}>Hủy</button><button className={`fxa-button ${removing?'is-danger':'is-primary'}`} disabled={pending || uncertain || !removing && !name.trim()}>{pending?'Đang xử lý…':removing?'Xóa tài khoản':'Lưu thay đổi'}</button></footer>
    </form>
  </LegacyModal>
}

export default function LiveAccounts({ workspace, accounts, records, broker, chosen, onSelect, transactions, writable, canImport, onCreate, onImport, onEdit, onTrade, onNavigate, onArchive, onRefresh }) {
  const { t, locale } = useTestingLocale()
  const [search,setSearch] = useState(''), [source,setSource] = useState('all'), [showFilter,setShowFilter] = useState(false), [tab,setTab] = useState('all'), [page,setPage] = useState(1), [size,setSize] = useState(10), [sort,setSort] = useState({key:'name',ascending:true}), [provider,setProvider] = useState(false)
  const [connectionError,setConnectionError]=useState(''), [busy,setBusy]=useState('')
  const [menu,setMenu]=useState(null), [action,setAction]=useState(null)
  const actionLock=useRef(false)
  const sidebar=useRef(null)
  useEffect(()=>{sidebar.current?.scrollTo({top:0})},[provider])
  async function connectionAction(row,action) {
    if(action === 'reconnect'){setProvider(row.connection);return}
    if(actionLock.current)return
    actionLock.current=true;setBusy(row.id);setConnectionError('')
    try {await mt5Request(workspace,`/${row.connection.id}/${action}`);onRefresh()} catch(error){setConnectionError(error.message)} finally {setBusy('');actionLock.current=false}
  }
  const rows = liveAccountRows(accounts,records,broker), selected = rows.find(row => row.id === chosen)
  const money = (value,currency) => typeof value === 'number' && Number.isFinite(value) ? `${value < 0 ? '−' : ''}${formatProtectionMoney(value,currency,locale)}` : '—'
  const filtered = rows.filter(row => (source === 'all' || row.status === source || source === 'connected' && row.status === 'synced') && row.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))).sort((a,b) => {
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
  const runMenu = callback => {setMenu(null);callback()}
  const rowActions = row => <button type="button" className="fxa-button fxa-icon-button live-account-menu-trigger" aria-label={`${t('Thao tác tài khoản')} ${row.name}`} aria-expanded={menu?.row.id===row.id} disabled={!writable || Boolean(busy)} onClick={event=>setMenu(menu?.row.id===row.id?null:{row,anchor:event.currentTarget})}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
  const picker = <FxSelect className="is-field" label="Tài khoản giao dịch" value={chosen} triggerContent={selected?.name || t('Chọn tài khoản')} localizeOptions={false} onChange={choose} options={rows.map(row => ({value:row.id,label:row.name}))} />
  const pagination = <PaginationFooter label={transactions ? 'Trang dòng tiền' : 'Trang tài khoản'} page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value => {setSize(value);setPage(1)}} sizes={[10,20,50]} />
  return <div className="live-accounts-layout">
    <section className="live-accounts-main" aria-label={t(transactions ? 'Giao dịch tài khoản' : 'Tài khoản giao dịch')}>
      {connectionError&&<p role="alert" className="live-connection-error">{t(connectionError)}</p>}
      {transactions ? <>
        <div className="live-transaction-tabs" role="group" aria-label={t("Loại dòng tiền")}>{[['all','Tất cả'],['withdrawal','Rút tiền'],['deposit','Nạp tiền'],['fee','Phí']].map(([value,label]) => <button key={value} type="button" className="fxa-button" aria-pressed={tab === value} onClick={() => {setTab(value);setPage(1)}}>{t(label)}</button>)}</div>
        <div className="live-table-scroll" role="region" tabIndex={0} aria-label={t("Dòng tiền tài khoản")}><table><thead><tr><th>{t("Loại giao dịch")}</th><th>{t("Số tiền")}</th><th>{t("Thời gian (UTC)")}</th></tr></thead><tbody>{entries.slice((current-1)*size,current*size).map(item => <tr key={item.id}><td>{t(item.label)}</td><td>{money(item.amount,selected?.snapshot.account.currency)}</td><td>{Number.isFinite(item.time) ? displayDate(item.time,{timeStyle:'short'}) : '—'}</td></tr>)}</tbody></table></div>
        {!entries.length && <div className="live-empty"><h2>{t(!selected ? 'Chọn tài khoản' : allTransactions === null ? 'Chưa có dữ liệu dòng tiền' : 'Chưa có giao dịch trong nhóm này')}</h2>{selected?.record && <p>{t("Tài khoản ghi tay hiện chưa hỗ trợ ghi nhận nạp, rút và phí tài khoản.")}</p>}</div>}
      </> : <>
        <div className="live-accounts-toolbar"><label className="live-search"><TestingIcon kind="search" /><input type="search" placeholder={t("Tìm tài khoản…")} aria-label={t("Tìm tài khoản")} value={search} onChange={event => {setSearch(event.target.value);setPage(1)}} /></label><button type="button" className="fxa-button fxa-icon-button" aria-label={t("Lọc tài khoản")} aria-expanded={showFilter} onClick={() => setShowFilter(!showFilter)}><FilterIcon kind="filter" /></button>{showFilter && <FxSelect label="Nguồn tài khoản" value={source} onChange={value => {setSource(value);setPage(1)}} options={[{value:'all',label:'Tất cả'},{value:'manual',label:'Ghi tay'},{value:'connected',label:'Đã đồng bộ'},{value:'queued',label:'Đang chờ đồng bộ'},{value:'syncing',label:'Đang đồng bộ'},{value:'error',label:'Lỗi kết nối'},{value:'paused',label:'Đã tạm dừng'},{value:'disconnected',label:'Đã ngắt kết nối'},{value:'stale',label:'Dữ liệu cũ'}]} />}</div>
        <div className="live-table-scroll" role="region" tabIndex={0} aria-label={t("Danh sách tài khoản")}><table><thead><tr>{[['name','Tài khoản'],['source','Nguồn'],['status','Trạng thái'],['balance','Số dư'],['updated','Cập nhật gần nhất'],['sync','Đồng bộ'],['edit','']].map(([key,label]) => <th key={key} aria-label={key === 'edit' ? t('Thao tác') : undefined} aria-sort={['name','balance','updated'].includes(key) ? sort.key === key ? sort.ascending ? 'ascending' : 'descending' : 'none' : undefined}>{['name','balance','updated'].includes(key) ? <button type="button" className="live-text-action" onClick={() => sortBy(key)}>{t(label)} ↕</button> : t(label)}</th>)}</tr></thead><tbody>{filtered.slice((current-1)*size,current*size).map(row => <tr key={row.id} aria-selected={chosen === row.id}>
          <td><button className="live-text-action" type="button" onClick={() => choose(row.id)}>{row.name}</button></td>
          <td><span className="live-source-badge">{t(row.source)}</span></td>
          <td><span className={`live-account-status is-${row.status}`}>{t(row.status === 'manual' ? 'Đã lưu' : row.status === 'stale' ? 'Dữ liệu cũ' : MT5_STATUS[row.status] || 'Đã đồng bộ')}</span>{row.connection?.error_code&&<small className="live-connection-error">{t(mt5Error(row.connection.error_code))}</small>}</td>
          <td>{money(row.snapshot.account.balance,row.snapshot.account.currency)}</td><td>{row.updated ? displayDate(row.updated,{timeStyle:'short'}) : '—'}</td>
          <td>{row.connection&&<button type="button" className="fxa-button fxa-icon-button live-sync-action" aria-label={`${t('Đồng bộ')} ${row.name}`} disabled={!writable || Boolean(busy) || ['queued','syncing','disconnected'].includes(row.status)} onClick={()=>connectionAction(row,'sync')}><TestingIcon kind="refresh"/></button>}</td><td>{rowActions(row)}</td>
        </tr>)}</tbody></table></div>
        {!filtered.length && <div className="live-empty"><h2>{t(search || source !== 'all' ? 'Không tìm thấy tài khoản' : 'Chưa có tài khoản')}</h2><p>{t(search || source !== 'all' ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Thêm tài khoản ở bảng bên phải để bắt đầu.')}</p></div>}
      </>}
      {transactions && selected && !selected.record && <details className="live-account-detail live-broker-extra"><summary>{t('Broker snapshot')}</summary><LiveBrokerSnapshot payload={selected.snapshot} section="trading-accounts" /></details>}
      {pagination}
    </section>
    <aside ref={sidebar} className="live-add-account" aria-label={t(transactions ? 'Chi tiết tài khoản' : 'Thêm tài khoản')}>
      <h2>{t(transactions ? 'Chi tiết tài khoản' : 'Thêm tài khoản')}</h2>
      {transactions ? <>{picker}<dl className="live-cash-summary">{[['Số dư',selected?.snapshot.account.balance],['Số dư ban đầu',selected?.snapshot.account.opening_balance],['Nạp tiền',cash.deposit],['Rút tiền',cash.withdrawal],['Phí tài khoản',cash.fees],[selected?.record ? 'PnL ròng đã ghi' : 'PnL deals đã đồng bộ',cash.net]].map(([label,value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value,selected?.snapshot.account.currency)}</dd></div>)}</dl><p className="live-muted">{t(selected?.record ? 'Số dư ghi tay = số dư ban đầu + PnL ròng đã ghi. Chưa gồm nạp/rút.' : 'Dòng tiền và PnL trong phạm vi lịch sử đã đồng bộ. Số dư ban đầu chưa xác định.')}</p></> : provider ? <MetaTraderConnect key={provider.id || 'new'} workspace={workspace} connection={provider===true?null:provider} onBack={()=>setProvider(false)} onSaved={value=>{setProvider(false);onSelect(`broker:${value.id}`);onRefresh()}} /> : <>
        <button type="button" className="live-template-link live-text-action" onClick={() => downloadLiveCsv([], 'wmreplay-trades-template.csv')}>{t("Tải mẫu CSV ")}<TestingIcon kind="download" /></button>
        <button type="button" className="live-upload" disabled={!canImport} onClick={onImport}><TestingIcon kind="upload" size={24} /><strong>{t("Nhập tệp CSV")}</strong><small>{t(accounts.length ? 'Nhập lịch sử giao dịch vào tài khoản ghi tay.' : 'Tạo tài khoản ghi tay trước khi nhập.')}</small></button>
        <span className="live-add-separator">{t("hoặc")}</span><button type="button" className="live-manual-option" disabled={!writable} onClick={()=>onCreate()}><span><strong>{t("Ghi tay")}</strong><small>{t("Tạo tài khoản và ghi giao dịch")}</small></span><TestingIcon kind="plus" /></button>
        <span className="live-add-separator">{t("hoặc")}</span><h3>{t("Đồng bộ với broker")}</h3><button type="button" className="live-metatrader-option" disabled={!writable} onClick={() => setProvider(true)}><span className="live-metatrader-avatar" aria-hidden="true"><img src="/brand/metatrader-5.png" alt="" width="36" height="36" /></span><span>MetaTrader 5</span></button>
      </>}
    </aside>
    {menu&&<LegacyPopover anchor={menu.anchor} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={`${t('Thao tác tài khoản')} ${menu.row.name}`} onClose={()=>setMenu(null)}>
      <button type="button" onClick={()=>runMenu(()=>onNavigate(menu.row,'calendar'))}><TestingIcon kind="journal"/>{t('Xem trong nhật ký')}</button>
      {menu.row.record&&<><button type="button" disabled={!canImport} onClick={()=>runMenu(()=>onTrade(menu.row.record))}><TestingIcon kind="plus"/>{t('Thêm giao dịch ghi tay')}</button><button type="button" disabled={!canImport} onClick={()=>runMenu(()=>onImport(menu.row.record))}><TestingIcon kind="upload"/>{t('Nhập tệp CSV')}</button></>}
      <button type="button" onClick={()=>runMenu(()=>onNavigate(menu.row,'transactions'))}><TestingIcon kind="ledger"/>{t('Quản lý dòng tiền')}</button>
      <button type="button" onClick={()=>runMenu(()=>onCreate(duplicateAccountSeed(menu.row)))}><TestingIcon kind="account"/>{t(menu.row.record?'Nhân bản tài khoản':'Nhân bản thành tài khoản ghi tay')}</button>
      {(menu.row.record||menu.row.connection)&&<button type="button" onClick={()=>runMenu(()=>menu.row.record?onEdit(menu.row.record):setAction({kind:'rename',row:menu.row}))}><TestingIcon kind="settings"/>{t('Sửa tài khoản')}</button>}
      {menu.row.connection&&<><hr/>{menu.row.status!=='disconnected'&&<button type="button" onClick={()=>runMenu(()=>connectionAction(menu.row,menu.row.status==='paused'?'resume':'pause'))}><TestingIcon kind={menu.row.status==='paused'?'play':'pause'}/>{t(menu.row.status==='paused'?'Tiếp tục đồng bộ':'Tạm dừng đồng bộ')}</button>}<button type="button" onClick={()=>runMenu(()=>connectionAction(menu.row,'reconnect'))}><TestingIcon kind="refresh"/>{t('Kết nối lại')}</button>{menu.row.status!=='disconnected'&&<button type="button" onClick={()=>runMenu(()=>connectionAction(menu.row,'disconnect'))}><TestingIcon kind="stop"/>{t('Ngắt kết nối · xóa mật khẩu')}</button>}</>}
      {(menu.row.record||menu.row.connection)&&<><hr/><button type="button" className="live-account-delete" onClick={()=>runMenu(()=>setAction({kind:'remove',row:menu.row}))}><TestingIcon kind="delete"/>{t('Xóa tài khoản')}</button></>}
    </LegacyPopover>}
    {action&&<AccountActionDialog action={action} onClose={()=>setAction(null)} onConfirm={async name=>{
      if(action.row.record)await onArchive(action.row.record)
      else {await mt5Request(workspace,`/${action.row.connection.id}/${action.kind}`,action.kind==='rename'?{name}:undefined);onRefresh();if(action.kind==='remove'&&chosen===action.row.id)onSelect('')}
    }}/>}
  </div>
}
