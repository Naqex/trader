import {describeLiveGroupTrade} from './tradeGroupsModel.js'
import { useNoteTypes, noteTypeLabel } from './useNoteTypes.js'
import { currencyLabel } from './moneyFormat.js'
import useTableSort from './useTableSort.js'
import DataTable, { SortableColumn, SortResetColumn } from './DataTable.jsx'
import { matchesSearch } from './searchText.js'
import SearchInput from './SearchInput.jsx'
import { useEffect, useRef, useState } from 'react'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { dealNet } from './liveWorkspaceModel.js'
import { downloadLiveCsv } from './liveCsvDownload.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import LegacyModal from './LegacyModal.jsx'
import NoteFilterDrawer from './NoteFilterDrawer.jsx'
import NoteFolderDialog from './NoteFolderDialog.jsx'
import { fetchNoteFolders } from './liveNoteFoldersApi.js'
import { EMPTY_NOTE_FILTERS, filterJournalNotes, groupJournalNotes, NOTE_GROUPS } from './liveNoteModel.js'
import { MANUAL_TRADE_COLUMNS } from './liveTradeColumns.js'
import ChartIcon from './ChartIcon.jsx'
import TradeLedgerGrid from './TradeLedgerGrid.jsx'

function StrategyReference({ payload, strategies, workspace }) {
  const { t,language } = useTestingLocale()
  if (!payload.playbook_id) return '-'
  const current = strategies.find(item => item.record_id === payload.playbook_id && item.revision === payload.playbook_revision)
  return <a href={buildWorkspaceHref('playbook',workspace,new URLSearchParams({lang:language}),{area:'strategies',section:'my-strategies',playbook:payload.playbook_id,playbook_revision:payload.playbook_revision})}>{current?.payload.name || t('Strategy #{id}',{id:payload.playbook_id.slice(0,8)})} · v{payload.playbook_revision}</a>
}

export function ManualTrades({ columns = MANUAL_TRADE_COLUMNS.map(([key]) => key), deals, currency, strategies, workspace, filterKey, writable, onEdit, journalView='active', onJournalView, bulkLabels = [], bulkGroups = [] }) {
  const { t,fmt } = useTestingLocale()
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [size, setSize] = useState(10), sorting = useTableSort(()=>setPage(1))
  const [checked,setChecked]=useState(new Set())
  useEffect(() => { setPage(1); setChecked(new Set()) },[filterKey,journalView])
  const sortValue = (deal,key) => key === 'time' ? deal.time_msc : key === 'asset' ? deal.symbol : key === 'side' ? deal.type : dealNet(deal)
  const rows = sorting.rows(deals.filter(deal => journalView!=='deleted' && matchesSearch(`${deal.symbol} ${deal.record.payload.tags.join(' ')} ${deal.record.payload.note}`, search)),sortValue,[{key:'time',direction:'desc'}])
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
  const pageRows=rows.slice((current-1)*size,current*size), allChecked=pageRows.length>0 && pageRows.every(deal=>checked.has(String(deal.ticket))), mixedChecked=!allChecked && pageRows.some(deal=>checked.has(String(deal.ticket)))
  return <section className="live-broker"><div className="live-deals-toolbar"><h2>{t('Giao dịch đã đóng')} · {rows.length}</h2><label className="live-search"><TestingIcon kind="search" /><SearchInput type="search" placeholder={t('Tìm sản phẩm, nhãn…')} aria-label={t('Tìm giao dịch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label></div>
    <TradeLedgerGrid workspace={workspace} sourceKind="manual" describeTrade={describeLiveGroupTrade}
      rows={pageRows} current={current-1} size={size} shownColumns={shown} rowKey={deal=>String(deal.ticket)} columnHeader={([key,label])=>['time','asset','side','net'].includes(key)?<SortableColumn key={key} className={key==='net'?'is-numeric':undefined} {...sorting.columnProps(key,t(label))}>{t(label)}{key==='net'&&` (${currencyLabel(currency)})`}</SortableColumn>:<th key={key} scope="col">{t(label)}</th>} renderCell={cellValue} cellClass={(key,deal)=>key==='net'?`is-numeric ${dealNet(deal)>0?'is-gain':dealNet(deal)<0?'is-loss':''}`:''}
      selected="" onSelect={writable?key=>{const deal=pageRows.find(row=>String(row.ticket)===key);if(deal)onEdit(deal.record)}:undefined} checked={checked} onToggle={key=>setChecked(current=>{const next=new Set(current);next.has(key)?next.delete(key):next.add(key);return next})} allChecked={allChecked} mixedChecked={mixedChecked} onTogglePage={()=>setChecked(current=>{const next=new Set(current);pageRows.forEach(deal=>allChecked?next.delete(String(deal.ticket)):next.add(String(deal.ticket)));return next})}
      journalView={journalView} onJournalView={onJournalView} showJournalToolbar={false} bulkLabels={bulkLabels} bulkGroups={bulkGroups} totalCount={rows.length} pages={pages} onPageChange={setPage} onPageSizeChange={value=>{setSize(value);setPage(1)}} paginationLabel="Trang giao dịch" dataTestId="manual-trade-grid" pageSizeOptions={[10,20,50,100]} rowNumberOffset={(current-1)*size} paginationMeta={<button type="button" className="fxa-button" disabled={!rows.length} onClick={()=>downloadLiveCsv(rows.map(item=>item.record))}>{t('Xuất CSV')}</button>}/>
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

export function JournalNotes({ workspace, records, strategies, writable, readable = true, onEdit, onCreate }) {
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
  const filtered = Object.entries(filters).some(([key,value]) => !key.endsWith('Mode') && (Array.isArray(value) ? value.length : value))
  const folder = folderState.items.find(item => item.id === folderId)
  const folderNotes = folder ? notes.filter(note => folder.note_ids.includes(note.record_id)) : folderId ? [] : notes
  const rows = filterJournalNotes(folderNotes,filters,search,timezone)
  const groups = groupJournalNotes(rows,group,timezone)
  const noteTypes=useNoteTypes(workspace)
  const groupTitle = key => group === 'type' ? (noteTypeLabel(noteTypes.items.find(item=>item.id===key),t) || t('Unknown')) : key === 'unknown' ? t('Unknown') : group === 'year' ? key : group === 'month' ? new Intl.DateTimeFormat(locale,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${key}-01T00:00:00Z`)) : group === 'week' ? t('Week of {date}',{date:displayDate(key)}) : displayDate(key)
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
    {readable && <div className="live-note-list">{groups.map(({key,rows:groupRows}) => <section className="live-note-section" key={key}>{group !== 'none' && <h3>{groupTitle(key)}<small>{groupRows.length}</small></h3>}{groupRows.map(record => <button type="button" className="live-note-row" key={record.record_id} onClick={() => writable ? onEdit(record) : setReadId(record.record_id)}><strong>{record.payload.title}</strong>{fields.includes('content') && <span>{record.payload.note}</span>}<small>{displayDate(record.updated_at_utc)}{record.payload.playbook_id && ` · ${strategies.find(item => item.record_id === record.payload.playbook_id && item.revision === record.payload.playbook_revision)?.payload.name || t('Strategy #{id}',{id:record.payload.playbook_id.slice(0,8)})} v${record.payload.playbook_revision}`}{record.payload.tags?.length > 0 && ` · ${record.payload.tags.join(', ')}`}</small></button>)}</section>)}{!rows.length && <div className="live-notes-empty"><NotesEmptyArt/><h2>{t(search || filtered ? 'Không tìm thấy ghi chú' : 'No notes yet')}</h2>{search || filtered ? <button type="button" className="fxa-button" onClick={clearFilters}>{t('Clear filters')}</button> : <button type="button" className="fxa-button is-primary" disabled={!writable || Boolean(folderId) && folderState.status !== 'ready'} onClick={create}><TestingIcon kind="zoom-in" size={16}/>{t('Add note')}</button>}</div>}</div>}
    {showFolder && <NoteFolderDialog workspace={workspace} notes={notes} folders={folderState.items} onClose={() => {setShowFolder(false);setFolderReload(value => value+1)}} onCreated={result => { setFolderState({status:'ready',items:result.items,error:''});setFolderId(result.created_id);setShowFolder(false) }}/>}
    {showFilters && <NoteFilterDrawer types={noteTypes.items} filters={filters} notes={notes} onApply={setFilters} onClose={() => setShowFilters(false)} />}
    {reading && <LegacyModal className="live-record-dialog" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={reading.payload.title} onClose={() => setReadId(null)}><div className="live-record-form"><p className="live-muted">{t('Chỉ đọc · tải lại dữ liệu trước khi chỉnh sửa.')}</p><p className="live-note-content">{reading.payload.note}</p><small className="live-muted">{displayDate(reading.updated_at_utc)} · {reading.payload.tags.join(', ') || t('Không có nhãn')}</small></div></LegacyModal>}
  </section>
}

export { default as JournalTags } from './LiveTagAnalytics.jsx'
