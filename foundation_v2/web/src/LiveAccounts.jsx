import DataTable, { SortableColumn } from './DataTable.jsx'
import { compareTableValues } from './tableModel.js'
import AccountActionDialog from './AccountActionDialog.jsx'
import { matchesSearch } from './searchText.js'
import SearchInput from './SearchInput.jsx'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { displayDate } from './dateFormat.js'
import { formatProtectionMoney } from './orderProtection.js'
import { downloadLiveCsv } from './liveCsvDownload.js'
import { TestingSkeleton } from './TestingReadState.jsx'
import MetaTraderMark from './MetaTraderMark.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import LegacyModal from './LegacyModal.jsx'
import { MT5_STATUS, mt5Error, mt5Request, canSyncMt5Connection, syncMt5Connections } from './mt5Connections.js'
import { liveAccountRows, accountTransactions, accountCashSummary, accountInitialBalance, duplicateAccountSeed } from './liveAccountModel.js'
import { removeLiveAccounts } from './liveAccountActions.js'

const MetaTraderConnect = lazy(() => import('./MetaTraderConnect.jsx'))


export default function LiveAccounts({ workspace, accounts, records, broker, chosen, onSelect, transactions, writable, canImport, onCreate, onImport, onEdit, onTrade, onNavigate, onArchive, onRefresh }) {
  const { t, locale } = useTestingLocale()
  const [search,setSearch] = useState(''), [sources,setSources] = useState([]), [searchOpen,setSearchOpen] = useState(false), [tab,setTab] = useState('all'), [page,setPage] = useState(1), [size,setSize] = useState(10), [sort,setSort] = useState({key:'name',ascending:true}), [provider,setProvider] = useState(false)
  const [connectionError,setConnectionError]=useState(''), [busy,setBusy]=useState('')
  const [menu,setMenu]=useState(null), [action,setAction]=useState(null)
  const [checked,setChecked]=useState(new Set()), [mutationUncertain,setMutationUncertain]=useState(false)
  const actionLock=useRef(false)
  const sidebar=useRef(null), searchInput=useRef(null), searchTrigger=useRef(null), selectPage=useRef(null), searchId=useId()
  const [transactionSort,setTransactionSort]=useState({key:'time',ascending:false})
  useEffect(()=>{if(searchOpen)searchInput.current?.focus()},[searchOpen])
  const closeSearch=()=>{setSearch('');setPage(1);setSearchOpen(false);searchTrigger.current?.focus()}
  useEffect(()=>{sidebar.current?.scrollTo({top:0})},[provider])
  useEffect(()=>setPage(1),[chosen,transactions])
  async function connectionAction(row,action) {
    if(action === 'reconnect'){setProvider(row.connection);return}
    if(actionLock.current)return
    actionLock.current=true;setBusy(row.id);setConnectionError('')
    try {await mt5Request(workspace,`/${row.connection.id}/${action}`);onRefresh()} catch(error){setConnectionError(error.message)} finally {setBusy('');actionLock.current=false}
  }
  const rows = useMemo(()=>liveAccountRows(accounts,records,broker),[accounts,records,broker]), selected = rows.find(row => row.id === chosen)
  useEffect(()=>{setChecked(new Set())},[search,sources,transactions])
  useEffect(()=>{setChecked(current=>{const ids=new Set(rows.map(row=>row.id)), next=new Set([...current].filter(id=>ids.has(id)));return next.size===current.size?current:next})},[rows])
  const syncable = (broker?.connections || []).filter(canSyncMt5Connection)
  async function syncConnections(connections) {
    if (!writable || mutationUncertain || actionLock.current || !connections.length) return
    actionLock.current=true;setBusy('all');setConnectionError('')
    try {
      const failures = await syncMt5Connections(workspace,connections)
      if (failures.length) setConnectionError(failures.map(({connection,error}) => `${rows.find(row=>row.connection?.id===connection.id)?.name || connection.name}: ${t(error.message)}`).join(' · '))
    } finally {onRefresh();setBusy('');actionLock.current=false}
  }
  const money = (value,currency) => typeof value === 'number' && Number.isFinite(value) ? `${value < 0 ? '−' : ''}${formatProtectionMoney(value,currency,locale)}` : '-'
  const filtered = rows.filter(row => (!sources.length || sources.includes(row.record ? 'manual' : 'sync')) && matchesSearch(row.name, search)).sort((a,b) => {
    const value = row => sort.key === 'balance' ? row.snapshot.account.balance : sort.key === 'updated' ? Date.parse(row.updated) : row.name
    const left = value(a), right = value(b)
    return compareTableValues(left,right,sort.ascending ? 'asc' : 'desc',locale) || a.id.localeCompare(b.id)
  })
  const allTransactions = accountTransactions(selected,transactionSort), cash = accountCashSummary(selected), opening = accountInitialBalance(selected)
  const entries = (allTransactions || []).filter(item => tab === 'all' || item.kind === tab)
  const listing = transactions ? entries : filtered, pages = Math.max(1,Math.ceil(listing.length/size)), current = Math.min(page,pages)
  const visible = filtered.slice((current-1)*size,current*size), checkedRows=filtered.filter(row=>checked.has(row.id))
  const allChecked=visible.length>0 && visible.every(row=>checked.has(row.id)), mixedChecked=!allChecked && visible.some(row=>checked.has(row.id))
  const allFilteredChecked=filtered.length>0 && checkedRows.length===filtered.length
  const checkedConnections=checkedRows.flatMap(row=>row.connection && canSyncMt5Connection(row.connection)?[row.connection]:[])
  useEffect(()=>{if(selectPage.current)selectPage.current.indeterminate=mixedChecked},[mixedChecked,transactions])
  const toggleChecked = id => setChecked(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})
  const sortBy = key => { setSort(current => ({key,ascending:current.key === key ? !current.ascending : true}));setPage(1) }
  const choose = value => { onSelect(value);setPage(1) }
  const runMenu = callback => {setMenu(null);callback()}
  const rowActions = row => <button type="button" className="fxa-button fxa-icon-button live-account-menu-trigger wm-table-row-action" aria-label={`${t('Thao tác tài khoản')} ${row.name}`} aria-expanded={menu?.row.id===row.id} disabled={!writable || mutationUncertain || Boolean(busy)} onClick={event=>setMenu(menu?.row.id===row.id?null:{row,anchor:event.currentTarget})}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
  const picker = <FxSelect className="is-field" label="Tài khoản giao dịch" value={chosen} triggerContent={selected?.name || t('Chọn tài khoản')} localizeOptions={false} onChange={choose} options={rows.map(row => ({value:row.id,label:row.name}))} />
  const pagination = <PaginationFooter totalCount={listing.length} label={transactions ? 'Trang dòng tiền' : 'Trang tài khoản'} page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value => {setSize(value);setPage(1)}} sizes={[10,25,50,100]} />
  return <div className={`live-accounts-layout${transactions ? ' is-transactions' : ''}`}>
    <section className="live-accounts-main" aria-label={t(transactions ? 'Giao dịch tài khoản' : 'Tài khoản giao dịch')}>
      {connectionError&&<p role="alert" className="live-connection-error">{t(connectionError)}</p>}
      {transactions ? <>
        <div className="live-transaction-tabs" role="group" aria-label={t("Loại dòng tiền")}>{[['all','Tất cả'],['withdrawal','Rút tiền'],['deposit','Nạp tiền'],['fee','Phí']].map(([value,label]) => <button key={value} type="button" className="fxa-button" aria-pressed={tab === value} onClick={() => {setTab(value);setPage(1)}}>{t(label)}</button>)}</div>
        <DataTable className="live-table-scroll" label={t("Dòng tiền tài khoản")}><thead><tr><th>{t("Loại giao dịch")}</th>{[['amount','Số tiền'],['time','Thời gian']].map(([key,label])=><SortableColumn key={key} className={key === 'amount' ? 'is-numeric' : undefined} active={transactionSort.key===key} direction={transactionSort.ascending?'asc':'desc'} onSort={()=>{setTransactionSort(current=>({key,ascending:current.key===key?!current.ascending:true}));setPage(1)}}>{t(label)}</SortableColumn>)}</tr></thead><tbody>{entries.slice((current-1)*size,current*size).map(item => <tr key={item.id}><td><span className="live-source-badge" data-tooltip={item.kind==='opening' && !selected?.record?t('Số dư ghi nhận khi đồng bộ thành công lần đầu; không phải vốn gốc tại broker.'):undefined}>{t(item.label)}</span></td><td className="is-numeric">{money(item.amount,item.currency || selected?.snapshot.account.currency)}</td><td>{Number.isFinite(item.time) ? displayDate(new Date(item.time),{timeStyle:'short'}) : '-'}</td></tr>)}</tbody></DataTable>
        {!entries.length && <div className="live-empty"><h2>{t(!selected ? 'Chọn tài khoản' : allTransactions === null ? 'Chưa có dữ liệu dòng tiền' : 'Chưa có giao dịch trong nhóm này')}</h2>{selected?.record && <p>{t("Tài khoản thủ công hiện chưa hỗ trợ ghi nhận nạp, rút và phí tài khoản.")}</p>}</div>}
      </> : <>
        <div className="live-accounts-toolbar">
          <div className={`live-account-search${searchOpen?' is-open':''}`} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeSearch()}}}>
            <button ref={searchTrigger} type="button" className="live-search-trigger" aria-label={t('Tìm tài khoản')} aria-expanded={searchOpen} aria-controls={searchOpen?searchId:undefined} data-tooltip={searchOpen?undefined:t('Tìm tài khoản')} onClick={()=>searchOpen?searchInput.current?.focus():setSearchOpen(true)}><TestingIcon kind="search" size={16}/></button>
            {searchOpen&&<><SearchInput ref={searchInput} id={searchId} type="search" placeholder={t('Tìm tài khoản…')} aria-label={t('Tìm tài khoản')} value={search} onChange={event=>{setSearch(event.target.value);setPage(1)}}/><button type="button" className="live-search-close" aria-label={t('Đóng tìm kiếm')} data-tooltip={t('Đóng tìm kiếm')} onClick={closeSearch}><TestingIcon kind="close" size={16}/></button></>}
          </div>
          <FxSelect className={`live-source-filter${sources.length?' has-selection':''}`} label="Lọc tài khoản" icon="filter" iconOnly multiple showSelectAll={false} menuTitle="Filter by" value={sources} onChange={value=>{setSources(value);setPage(1)}} options={[{value:'manual',label:'Thủ công'},{value:'sync',label:'Đồng bộ'}]}/>
        </div>
        <DataTable className="live-table-scroll" label={t("Danh sách tài khoản")}><thead><tr><th className="live-account-check is-center"><input ref={selectPage} type="checkbox" aria-label={t('Chọn tài khoản trên trang')} aria-checked={mixedChecked?'mixed':allChecked} checked={allChecked} disabled={!writable || Boolean(busy) || !visible.length} onChange={()=>setChecked(current=>{const next=new Set(current);visible.forEach(row=>allChecked?next.delete(row.id):next.add(row.id));return next})}/></th>{[['name','Tài khoản'],['source','Nguồn'],['status','Trạng thái'],['balance','Số dư'],['updated','Dữ liệu cập nhật'],['sync','Đồng bộ'],['edit','']].map(([key,label]) => ['name','balance','updated'].includes(key) ? <SortableColumn key={key} className={key==='balance'?'is-numeric':undefined} active={sort.key===key} direction={sort.ascending?'asc':'desc'} onSort={()=>sortBy(key)}>{t(label)}</SortableColumn> : <th key={key} scope="col" className="is-center" aria-label={key === 'edit' ? t('Thao tác') : undefined}>{key === 'sync' ? <span className="live-sync-heading"><span>{t(label)}</span><button type="button" className="live-sync-all" aria-label={t('Đồng bộ tất cả tài khoản')} data-tooltip={t('Đồng bộ tất cả tài khoản')} disabled={!writable || mutationUncertain || Boolean(busy) || !syncable.length} aria-busy={busy==='all'} onClick={()=>syncConnections(syncable)}><TestingIcon kind="sync" size={16}/></button></span> : t(label)}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.id} aria-selected={checked.has(row.id)}>
          <td className="live-account-check is-center"><input type="checkbox" aria-label={t('Chọn tài khoản {name}',{name:row.name})} checked={checked.has(row.id)} disabled={!writable || Boolean(busy)} onChange={()=>toggleChecked(row.id)}/></td>
          <td>{row.name}{row.connection?.requested_mode==='read_only' ? ` - ${t('Chỉ xem')}` : ''}</td>
          <td className="is-center"><span className="live-source-badge">{t(row.source)}</span></td>
          <td className="is-center"><span className={`live-account-status is-${row.status}`} data-tooltip={['error','disconnected'].includes(row.status) && row.connection?.error_code ? t(mt5Error(row.connection.error_code)) : undefined}>{t(row.status === 'manual' ? 'Đã lưu' : row.status === 'stale' ? 'Dữ liệu cũ' : MT5_STATUS[row.status] || 'Đã đồng bộ')}</span></td>
          <td className="is-numeric">{money(row.snapshot.account.balance,row.snapshot.account.currency)}</td><td>{row.updated ? displayDate(row.updated,{timeStyle:'short'}) : '-'}</td>
          <td className="is-center">{row.connection&&<button type="button" className="fxa-button fxa-icon-button live-sync-action wm-table-row-action" aria-label={`${t('Đồng bộ')} ${row.name}`} data-tooltip={t('Đồng bộ tài khoản')} disabled={!writable || mutationUncertain || Boolean(busy) || !canSyncMt5Connection(row.connection)} aria-busy={busy===row.id} onClick={()=>connectionAction(row,'sync')}><TestingIcon kind="sync"/></button>}</td><td className="is-center">{rowActions(row)}</td>
        </tr>)}</tbody></DataTable>
        {!filtered.length && <div className="live-empty"><h2>{t(search || sources.length ? 'Không tìm thấy tài khoản' : 'Chưa có tài khoản')}</h2><p>{t(search || sources.length ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Thêm tài khoản ở bảng bên phải để bắt đầu.')}</p></div>}
      </>}
      {!transactions && checkedRows.length>0 && <div className="live-account-selection" role="region" aria-label={t('Thao tác tài khoản đã chọn')} aria-busy={Boolean(busy)}>
        <button type="button" className="live-selection-close" aria-label={t('Bỏ chọn tất cả')} data-tooltip={t('Bỏ chọn tất cả')} disabled={Boolean(busy)} onClick={()=>setChecked(new Set())}><TestingIcon kind="close" size={16}/></button>
        <span role="status">{t('Đã chọn {count} tài khoản',{count:checkedRows.length})}</span>
        <button type="button" className="live-text-action" disabled={Boolean(busy)} onClick={()=>setChecked(allFilteredChecked?new Set():new Set(filtered.map(row=>row.id)))}>{t(allFilteredChecked?'Bỏ chọn tất cả':'Chọn tất cả')}</button>
        <div className="live-selection-actions">
          <button type="button" className="fxa-button live-selection-sync" disabled={!writable || mutationUncertain || Boolean(busy) || !checkedConnections.length} data-tooltip={t('Đồng bộ các kết nối MT5 đã chọn')} onClick={()=>syncConnections(checkedConnections)}><TestingIcon kind="sync" size={16}/>{t('Đồng bộ')}</button>
          <button type="button" className="fxa-button is-danger" disabled={!writable || mutationUncertain || Boolean(busy)} onClick={()=>setAction({kind:'remove',rows:checkedRows})}><TestingIcon kind="delete" size={16}/>{t('Xoá')}</button>
        </div>
      </div>}
      {pagination}
    </section>
    <aside ref={sidebar} className="live-add-account" aria-label={t(transactions ? 'Chi tiết tài khoản' : 'Thêm tài khoản')}>
      <div className="live-account-sidebar-heading"><h2>{t(transactions ? 'Chi tiết tài khoản' : 'Thêm tài khoản')}</h2>{transactions&&selected&&rowActions(selected)}</div>
      {transactions ? <>{picker}<dl className="live-cash-summary">
        {[
          ['Số dư',selected?.snapshot.account.balance,'chart',selected?.record?'Số dư thủ công = số dư ban đầu + PnL ròng đã ghi. Chưa gồm nạp/rút.':'Số dư do MT5 cung cấp tại lần cập nhật gần nhất.'],
          ['Số dư ban đầu',opening?.amount,'chart',selected?.record?'Vốn ban đầu đã lưu của tài khoản thủ công.':'Số dư ghi nhận khi đồng bộ thành công lần đầu; không phải vốn gốc tại broker.'],
          ['Nạp tiền',cash.deposit,'deposit','Tổng tiền nạp trong phạm vi lịch sử đã đồng bộ.'],
          ['Rút tiền',cash.withdrawal,'withdrawal','Tổng tiền rút trong phạm vi lịch sử đã đồng bộ.'],
          ['Phí tài khoản',cash.fees,'ledger','Các khoản phí tài khoản; phí giao dịch được tính trong PnL ròng.'],
          ['PnL ròng',cash.net,'chart','Lãi/lỗ giao dịch đã đóng sau hoa hồng, swap và phí, trong phạm vi lịch sử đã đồng bộ.'],
        ].map(([label,value,icon,help],index)=><div className={index===0?'live-cash-balance':undefined} key={label}><dt><TestingIcon kind={icon} size={14}/><span>{t(label)}</span><button type="button" className="live-cash-info" aria-label={t('Về {label}',{label:t(label)})} data-tooltip={t(help)} data-tooltip-touch><TestingIcon kind="info" size={14}/></button></dt><dd>{money(value,label==='Số dư ban đầu'?opening?.currency:selected?.snapshot.account.currency)}</dd></div>)}
      </dl></> : provider ? <Suspense fallback={<TestingSkeleton />}><MetaTraderConnect key={provider.id || 'new'} workspace={workspace} connection={provider===true?null:provider} onBack={()=>setProvider(false)} onSaved={value=>{setProvider(false);onSelect(`broker:${value.id}`);onRefresh()}} /></Suspense> : <>
        <p className="live-template-hint"><button type="button" className="live-template-link live-text-action" onClick={() => downloadLiveCsv([], 'wmreplay-trades-template.csv')}>{t('Tải mẫu CSV')}<TestingIcon kind="download" size={12} /></button></p>
        <button type="button" className="live-upload" disabled={!canImport} onClick={onImport}><span className="live-upload-icon"><TestingIcon kind="upload" size={16} /></span><span className="live-upload-copy"><strong>{t("Nhập tệp CSV")}</strong><small>{t(accounts.length ? 'Nhập lịch sử giao dịch vào tài khoản thủ công.' : 'Tạo tài khoản thủ công trước khi nhập.')}</small></span></button>
        <span className="live-add-separator">{t("hoặc")}</span><button type="button" className="live-manual-option" disabled={!writable} onClick={()=>onCreate()}><span><strong>{t("Thủ công")}</strong><small>{t("Tạo tài khoản và ghi giao dịch")}</small></span><TestingIcon kind="plus" /></button>
        <span className="live-add-separator">{t("hoặc")}</span><h3>{t("Đồng bộ với broker")}</h3><button type="button" className="live-metatrader-option" disabled={!writable} onClick={() => setProvider(true)}><MetaTraderMark /><span>MetaTrader</span></button>
      </>}
    </aside>
    {menu&&<LegacyPopover anchor={menu.anchor} theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={`${t('Thao tác tài khoản')} ${menu.row.name}`} onClose={()=>setMenu(null)}>
      <button type="button" onClick={()=>runMenu(()=>onNavigate(menu.row,'calendar'))}><TestingIcon kind="journal"/>{t('Xem trong nhật ký')}</button>
      {menu.row.record&&<><button type="button" disabled={!canImport} onClick={()=>runMenu(()=>onTrade(menu.row.record))}><TestingIcon kind="plus"/>{t('Thêm giao dịch thủ công')}</button><button type="button" disabled={!canImport} onClick={()=>runMenu(()=>onImport(menu.row.record))}><TestingIcon kind="upload"/>{t('Nhập tệp CSV')}</button></>}
      <button type="button" onClick={()=>runMenu(()=>onNavigate(menu.row,'transactions'))}><TestingIcon kind="ledger"/>{t('Quản lý dòng tiền')}</button>
      <button type="button" onClick={()=>runMenu(()=>onCreate(duplicateAccountSeed(menu.row)))}><TestingIcon kind="account"/>{t(menu.row.record?'Nhân bản tài khoản':'Nhân bản thành tài khoản thủ công')}</button>
      {(menu.row.record||menu.row.connection)&&<button type="button" onClick={()=>runMenu(()=>menu.row.record?onEdit(menu.row.record):setAction({kind:'rename',row:menu.row}))}><TestingIcon kind="settings"/>{t('Sửa tài khoản')}</button>}
      {menu.row.connection&&<><hr/>{menu.row.status!=='disconnected'&&<button type="button" onClick={()=>runMenu(()=>connectionAction(menu.row,menu.row.status==='paused'?'resume':'pause'))}><TestingIcon kind={menu.row.status==='paused'?'play':'pause'}/>{t(menu.row.status==='paused'?'Tiếp tục đồng bộ':'Tạm dừng đồng bộ')}</button>}<button type="button" onClick={()=>runMenu(()=>connectionAction(menu.row,'reconnect'))}><TestingIcon kind="refresh"/>{t('Kết nối lại')}</button>{menu.row.status!=='disconnected'&&<button type="button" onClick={()=>runMenu(()=>connectionAction(menu.row,'disconnect'))}><TestingIcon kind="stop"/>{t('Ngắt kết nối · xóa mật khẩu')}</button>}</>}
      {(menu.row.record||menu.row.connection)&&<><hr/><button type="button" className="live-account-delete" onClick={()=>runMenu(()=>setAction({kind:'remove',row:menu.row}))}><TestingIcon kind="delete"/>{t('Xóa tài khoản')}</button></>}
    </LegacyPopover>}
    {action&&<AccountActionDialog action={action} onClose={()=>setAction(null)} onConfirm={async name=>{
      if(actionLock.current || mutationUncertain)return
      actionLock.current=true;setBusy('mutation')
      try {
        if(action.kind==='rename'){await mt5Request(workspace,`/${action.row.connection.id}/rename`,{name});return}
        const {failures,remaining,uncertain}=await removeLiveAccounts(action.rows || [action.row],
          row=>row.record?onArchive(row.record):mt5Request(workspace,`/${row.connection.id}/remove`),
          row=>{setChecked(current=>{const next=new Set(current);next.delete(row.id);return next});if(!row.record && chosen===row.id)onSelect('')})
        if(failures.length) {
          if(action.rows)setAction(current=>({...current,rows:remaining}))
          const message=failures.map(({row,error})=>`${row.name}: ${t(error.message)}`).join(' · '), problem=new Error(message)
          if(uncertain){setMutationUncertain(true);setConnectionError(`${message} ${t('Tải lại danh sách để kiểm tra kết quả trước khi thao tác tiếp.')}`);problem.uncertain=true}
          throw problem
        }
      } finally {onRefresh();setBusy('');actionLock.current=false}
    }}/>}
  </div>
}
