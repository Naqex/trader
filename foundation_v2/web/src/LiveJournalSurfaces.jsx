import { currencyLabel } from './moneyFormat.js'
import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { matchesSearch } from './searchText.js'
import SearchInput from './SearchInput.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { dealNet } from './liveWorkspaceModel.js'
import { tagResults } from './liveLedgerModel.js'
import { downloadLiveCsv } from './liveCsvDownload.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import LegacyModal from './LegacyModal.jsx'
import NoteFilterDrawer from './NoteFilterDrawer.jsx'
import NoteFolderDialog from './NoteFolderDialog.jsx'
import { fetchNoteFolders } from './liveNoteFoldersApi.js'
import { EMPTY_NOTE_FILTERS, filterJournalNotes, groupJournalNotes, NOTE_GROUPS } from './liveNoteModel.js'
import { MANUAL_TRADE_COLUMNS } from './liveTradeColumns.js'

function StrategyReference({ payload, strategies, workspace }) {
  const { t,language } = useTestingLocale()
  if (!payload.playbook_id) return '-'
  const current = strategies.find(item => item.record_id === payload.playbook_id && item.revision === payload.playbook_revision)
  return <a href={buildWorkspaceHref('playbook',workspace,new URLSearchParams({lang:language}),{area:'strategies',section:'my-strategies',playbook:payload.playbook_id,playbook_revision:payload.playbook_revision})}>{current?.payload.name || t('Strategy #{id}',{id:payload.playbook_id.slice(0,8)})} · v{payload.playbook_revision}</a>
}

export function ManualTrades({ columns = MANUAL_TRADE_COLUMNS.map(([key]) => key), deals, currency, strategies, workspace, filterKey, writable, onEdit }) {
  const { t,fmt } = useTestingLocale()
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [size, setSize] = useState(10), sorting = useTableSort(()=>setPage(1))
  useEffect(() => setPage(1),[filterKey])
  const sortValue = (deal,key) => key === 'time' ? deal.time_msc : key === 'asset' ? deal.symbol : key === 'side' ? deal.type : dealNet(deal)
  const rows = sorting.rows(deals.filter(deal => matchesSearch(`${deal.symbol} ${deal.record.payload.tags.join(' ')} ${deal.record.payload.note}`, search)),sortValue,[{key:'time',direction:'desc'}])
  const pages = Math.max(1,Math.ceil(rows.length/size)), current = Math.min(page,pages)
  const shown = MANUAL_TRADE_COLUMNS.filter(([key]) => columns.includes(key))
  const cellValue = (deal, key) => {
    switch (key) {
      case 'time': return displayDate(deal.time_msc,{timeStyle:'short'})
      case 'asset': return deal.symbol
      case 'side': return `${t(deal.type === 0 ? 'Buy' : 'Sell')} · ${fmt(deal.volume,'',5)}`
      case 'strategy': return <StrategyReference payload={deal.record.payload} strategies={strategies} workspace={workspace} />
      case 'tags': return deal.record.payload.tags.join(', ') || '-'
      case 'net': return fmt(dealNet(deal))
    }
  }
  return <section className="live-broker"><div className="live-deals-toolbar"><h2>{t('Giao dịch đã đóng')} · {rows.length}</h2><label className="live-search"><TestingIcon kind="search" /><SearchInput type="search" placeholder={t('Tìm sản phẩm, nhãn…')} aria-label={t('Tìm giao dịch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label></div>
    <DataTable className="live-table-scroll" label={t('Giao dịch thủ công')}><thead><tr><SortResetColumn active={sorting.sorts.length > 0} onClear={sorting.clear}/>{shown.map(([key,label]) => ['time','asset','side','net'].includes(key) ? <SortableColumn key={key} className={key==='net'?'is-numeric':undefined} {...sorting.columnProps(key,t(label))}>{t(label)}{key === 'net' && ` (${currencyLabel(currency)})`}</SortableColumn> : <th key={key} scope="col">{t(label)}</th>)}<th aria-label={t('Thao tác')} /></tr></thead><tbody>
      {rows.slice((current-1)*size,current*size).map((deal,index) => <tr key={deal.ticket}><td className="wm-table-row-number">{(current-1)*size+index+1}</td>{shown.map(([key]) => <td key={key} className={key === 'net' ? `is-numeric ${dealNet(deal) > 0 ? 'is-gain' : dealNet(deal) < 0 ? 'is-loss' : ''}` : ''}>{cellValue(deal,key)}</td>)}<td><button type="button" className="fxa-button" disabled={!writable} onClick={() => onEdit(deal.record)}>{t('Chi tiết')}</button></td></tr>)}
      {!rows.length && <tr><td colSpan={shown.length + 2}>{t('Chưa có giao dịch trong bộ lọc này.')}</td></tr>}
    </tbody></DataTable><PaginationFooter showCount={false} totalCount={rows.length} label="Trang giao dịch" page={current} pages={pages} onPageChange={setPage} pageSize={size} onPageSizeChange={value => { setSize(value); setPage(1) }} sizes={[10,20,50,100]} meta={<button type="button" className="fxa-button" disabled={!rows.length} onClick={() => downloadLiveCsv(rows.map(item => item.record))}>{t('Xuất CSV')}</button>} />
  </section>
}

function NotesEmptyArt() {
  return <svg className="live-notes-empty-art" viewBox="0 0 360 132" fill="none" aria-hidden="true" focusable="false">
    <g className="live-notes-art-frame"><rect x="1" y="1" width="358" height="35" rx="8"/><rect x="1" y="46" width="116" height="85" rx="8"/><rect x="127" y="46" width="232" height="85" rx="8"/></g>
    <g className="live-notes-art-block"><rect x="12" y="11" width="88" height="15" rx="4"/><rect x="140" y="11" width="42" height="15" rx="4"/><rect x="223" y="11" width="42" height="15" rx="4"/><rect x="306" y="11" width="42" height="15" rx="4"/><rect x="138" y="62" width="55" height="16" rx="4"/><rect x="138" y="98" width="55" height="16" rx="4"/><rect x="207" y="101" width="141" height="10" rx="5"/></g>
    <g className="live-notes-art-detail" strokeLinecap="round" strokeLinejoin="round">{[113,196,279].map(x=><g key={x} transform={`translate(${x} 13)`}><path d="M0 0h6l5 5-5 5L0 4Z"/><circle cx="3" cy="3" r=".5"/></g>)}{[[21,65,78,95],[32,75,88,110],[43,70,84,103],[54,78,95,116],[65,63,84,102],[76,77,91,108],[87,57,79,98],[98,70,80,103]].map(([x,top,body,bottom])=><g key={x}><path d={`M${x} ${top}v${bottom-top}`}/><rect x={x-3} y={body} width="6" height="13"/></g>)}</g>
    <g className="live-notes-art-stars">{[216,246,276,306,336].map((x,i)=><path key={x} d="m0-8 2.5 5.2 5.7.8-4.1 4 .9 5.7-5-2.7-5 2.7.9-5.7-4.1-4 5.7-.8Z" transform={`translate(${x} 70)`} fill={i===4?'none':'currentColor'}/>)}</g>
  </svg>
}

export function JournalNotes({ workspace, records, accounts, strategies, writable, readable = true, onEdit, onCreate }) {
  const { t,timezone,locale } = useTestingLocale()
  const [group,setGroup] = useState('none'), [folderId,setFolderId] = useState(''), [showFolder,setShowFolder] = useState(false)
  const [folderState,setFolderState] = useState({status:'loading',items:[],error:''}), [folderReload,setFolderReload] = useState(0)
  useEffect(() => {
    if (!workspace) { setFolderState({status:'ready',items:[],error:''}); return }
    const controller = new AbortController()
    setFolderState(current => ({...current,status:'loading',error:''}))
    fetchNoteFolders(workspace,controller.signal).then(items => { if (!controller.signal.aborted) setFolderState({status:'ready',items,error:''}) }).catch(error => { if (!controller.signal.aborted) setFolderState(current => ({...current,status:'error',error:error.message})) })
    return () => controller.abort()
  },[workspace,records,folderReload])
  const [search,setSearch] = useState(''), [filters,setFilters] = useState(EMPTY_NOTE_FILTERS), [readId,setReadId] = useState(null)
  const [showFilters,setShowFilters] = useState(false), [fields,setFields] = useState(['content'])
  const [searchOpen,setSearchOpen] = useState(false), searchInput = useRef(null), searchTrigger = useRef(null)
  const closeSearch = () => { setSearchOpen(false); searchTrigger.current?.focus() }
  useEffect(() => { if (searchOpen) searchInput.current?.focus() }, [searchOpen])
  const notes = records.filter(record => record.kind === 'note')
  const tags = [...new Set(notes.flatMap(record => record.payload.tags))]
  const filtered = Object.entries(filters).some(([key,value]) => !key.endsWith('Mode') && (Array.isArray(value) ? value.length : value))
  const folder = folderState.items.find(item => item.id === folderId)
  const folderNotes = folder ? notes.filter(note => folder.note_ids.includes(note.record_id)) : folderId ? [] : notes
  const rows = filterJournalNotes(folderNotes,filters,search,timezone)
  const groups = groupJournalNotes(rows,group,timezone)
  const groupTitle = key => key === 'general' ? t('Ghi chú chung') : key === 'unknown' ? t('Unknown') : group === 'year' ? key : group === 'month' ? new Intl.DateTimeFormat(locale,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${key}-01T00:00:00Z`)) : group === 'week' ? t('Week of {date}',{date:displayDate(key)}) : displayDate(key)
  const create = () => onCreate(folder?.id)
  const reading = notes.find(record => record.record_id === readId)
  const clearFilters = () => { setSearch(''); setFilters(EMPTY_NOTE_FILTERS) }
  return <section className="live-notes"><div className="live-toolbar fxa-filter-toolbar is-ledger live-notes-toolbar">
    <div className="live-notes-start"><button type="button" className="fxa-button live-note-create" disabled={!writable || Boolean(folderId) && folderState.status !== 'ready'} onClick={create}><TestingIcon kind="zoom-in" size={16}/>{t('New note')}</button></div>
    <div className="fxa-filter-actions live-notes-actions">
      <button type="button" className="fxa-button fxa-icon-button" aria-label={t('Clear filters')} data-tooltip={t('Clear filters')} onClick={clearFilters}><TestingIcon kind="history" size={16}/></button>
      <FxSelect className="fxa-columns-control live-note-fields" label="Edit notes" icon="edit" iconOnly multiple multipleStyle="check" showSelectAll={false} value={fields} onChange={setFields} options={[{value:'trades',label:'Trades',disabled:true},{value:'winRate',label:'Win rate',disabled:true},{value:'pnl',label:'PnL',disabled:true},{value:'content',label:'Content'}]} menuHeader={<small className="live-note-fields-hint">{t('Chưa liên kết giao dịch với ghi chú.')}</small>} />
      <span className="fxa-filter-divider" aria-hidden="true"/>
      <div className={`live-account-search${searchOpen || search ? ' is-open' : ''}`}><button ref={searchTrigger} type="button" aria-label={t('Tìm ghi chú')} aria-expanded={Boolean(searchOpen || search)} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}><TestingIcon kind="search" size={16}/></button>{(searchOpen || search) && <SearchInput ref={searchInput} type="search" aria-label={t('Tìm ghi chú')} placeholder={t('Tìm ghi chú…')} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !search) { event.preventDefault(); closeSearch() } }} />}</div>
      <FxSelect className="live-note-group" label="Group by" menuTitle="Group by" triggerContent={t('Group by')} value={group} onChange={setGroup} options={NOTE_GROUPS.map(([value,label]) => ({value,label}))}/>
      <button type="button" className="fxa-button" aria-label={t('Note filters')} aria-haspopup="dialog" aria-expanded={showFilters} onClick={() => setShowFilters(true)}><FilterIcon kind="filter"/>{t('Filters')}{filtered && <span className="sr-only">{t('Đang áp dụng bộ lọc')}</span>}</button>
    </div>
  </div>
    <div className="live-notes-groups" role="group" aria-label={t('Note views')}><button type="button" className={`fxa-button${!folderId ? ' is-active' : ''}`} aria-pressed={!folderId} onClick={() => setFolderId('')}><TestingIcon kind="ledger" size={16}/>{t('All')}</button>{folderState.items.map(item => <button type="button" key={item.id} className={`fxa-button${folderId === item.id ? ' is-active' : ''}`} aria-pressed={folderId === item.id} onClick={() => setFolderId(item.id)}>{item.name}</button>)}<button type="button" className="fxa-button fxa-icon-button" aria-label={t('Add note group')} disabled={!writable || folderState.status !== 'ready'} onClick={() => setShowFolder(true)}><TestingIcon kind="plus" size={18}/></button></div>
    {folderState.error && <div role="alert" className="live-status live-status-error"><span>{t(folderState.error)}</span><button type="button" className="fxa-button" onClick={() => setFolderReload(value => value+1)}>{t('Thử lại')}</button></div>}
    {folder && <div className="live-note-folder-summary"><span>{folder.name}</span><small>{t('{count} notes',{count:folderNotes.length})}</small></div>}
    {readable && <div className="live-note-list">{groups.map(({key,rows:groupRows}) => <section className="live-note-section" key={key}>{group !== 'none' && <h3>{groupTitle(key)}<small>{groupRows.length}</small></h3>}{groupRows.map(record => <button type="button" className="live-note-row" key={record.record_id} onClick={() => writable ? onEdit(record) : setReadId(record.record_id)}><strong>{record.payload.title}</strong>{fields.includes('content') && <span>{record.payload.note}</span>}<small>{displayDate(record.updated_at_utc)}{record.payload.playbook_id && ` · ${strategies.find(item => item.record_id === record.payload.playbook_id && item.revision === record.payload.playbook_revision)?.payload.name || t('Strategy #{id}',{id:record.payload.playbook_id.slice(0,8)})} v${record.payload.playbook_revision}`}{record.payload.tags.length > 0 && ` · ${record.payload.tags.join(', ')}`}</small></button>)}</section>)}{!rows.length && <div className="live-notes-empty"><NotesEmptyArt/><h2>{t(search || filtered ? 'Không tìm thấy ghi chú' : 'No notes yet')}</h2>{search || filtered ? <button type="button" className="fxa-button" onClick={clearFilters}>{t('Clear filters')}</button> : <button type="button" className="fxa-button is-primary" disabled={!writable || Boolean(folderId) && folderState.status !== 'ready'} onClick={create}><TestingIcon kind="zoom-in" size={16}/>{t('Add note')}</button>}</div>}</div>}
    {showFolder && <NoteFolderDialog workspace={workspace} notes={notes} folders={folderState.items} onClose={() => {setShowFolder(false);setFolderReload(value => value+1)}} onCreated={result => { setFolderState({status:'ready',items:result.items,error:''});setFolderId(result.created_id);setShowFolder(false) }}/>}
    {showFilters && <NoteFilterDrawer filters={filters} accounts={accounts} tags={tags} onApply={setFilters} onClose={() => setShowFilters(false)} />}
    {reading && <LegacyModal className="live-record-dialog" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={reading.payload.title} onClose={() => setReadId(null)}><div className="live-record-form"><p className="live-muted">{t('Chỉ đọc · tải lại dữ liệu trước khi chỉnh sửa.')}</p><p className="live-note-content">{reading.payload.note}</p><small className="live-muted">{displayDate(reading.updated_at_utc)} · {reading.payload.tags.join(', ') || t('Không có nhãn')}</small></div></LegacyModal>}
  </section>
}

export function JournalTags({ deals, currency, filterKey, readable = true }) {
  const { t,fmt } = useTestingLocale(), [search,setSearch] = useState('')
  const [page,setPage] = useState(1), [size,setSize] = useState(20)
  useEffect(()=>setPage(1),[search,filterKey])
  const results = useMemo(()=>tagResults(deals),[deals])
  const rows = results.filter(row => matchesSearch(row.tag, search))
  const pages = Math.max(1,Math.ceil(rows.length/size)), current = Math.min(page,pages), visible = rows.slice((current-1)*size,current*size)
  const maximum = rows.reduce((max,item) => Math.max(max,Math.abs(item.net || 0)),1)
  return <section className="live-journal-tags"><div className="live-section-heading"><h2 data-tooltip={t('Một giao dịch có thể có nhiều nhãn; không cộng các nhóm thành tổng PnL.')}>{t('PnL theo nhãn')}</h2><label className="live-search"><TestingIcon kind="search" /><SearchInput type="search" aria-label={t('Tìm nhãn')} placeholder={t('Tìm nhãn…')} value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    {readable && (rows.length ? <><div className="live-tag-bars">{visible.map(row => <div key={row.tag}><span>{row.tag}</span><div><i className={row.net < 0 ? 'is-loss' : row.net > 0 ? 'is-gain' : ''} style={{width:`${row.net === null ? 0 : Math.abs(row.net)/maximum*100}%`}} /></div><strong className={row.net < 0 ? 'is-loss' : row.net > 0 ? 'is-gain' : ''}>{fmt(row.net)}</strong></div>)}</div><DataTable className="live-table-scroll" label={t('Thống kê nhãn')}><thead><tr><th>{t('Nhãn')}</th><th className="is-numeric">{t('Giao dịch')}</th><th className="is-numeric">{t('Tỷ lệ thắng')}</th><th className="is-numeric">{t('PnL ròng')} ({currencyLabel(currency)})</th></tr></thead><tbody>{visible.map(row => <tr key={row.tag}><td>{row.tag}</td><td className="is-numeric">{row.count}</td><td className="is-numeric">{fmt(row.winRate,'%')}</td><td className="is-numeric">{fmt(row.net)}</td></tr>)}</tbody></DataTable><PaginationFooter showCount={false} totalCount={rows.length} label="Trang phân tích nhãn" page={current} pages={pages} pageSize={size} onPageChange={setPage} onPageSizeChange={value=>{setSize(value);setPage(1)}} sizes={[10,20,50,100]} /></> : <div className="live-empty"><h2>{t(search ? 'Không tìm thấy nhãn' : 'Chưa có phân tích nhãn')}</h2><p>{t(search ? 'Thử từ khóa khác hoặc xóa tìm kiếm.' : 'Thêm nhãn vào giao dịch để so sánh kết quả.')}</p></div>)}
  </section>
}
