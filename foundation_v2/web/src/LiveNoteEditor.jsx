import { useEffect, useMemo, useRef, useState } from 'react'
import same from 'fast-deep-equal'
import LegacyModal from './LegacyModal.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import FxSelect from './FxSelect.jsx'
import { DateFilter } from './AnalyticsFilterControls.jsx'
import NoteTypeSelect from './NoteTypeSelect.jsx'
import SearchInput from './SearchInput.jsx'
import ChartIcon from './ChartIcon.jsx'
import NoteBlockEditor from './NoteBlockEditor.jsx'
import { AnalyticsCurve } from './AnalyticsCharts.jsx'
import { fetchLiveRecords, saveLiveRecord } from './liveLedgerApi.js'
import useAutosave, { AutosaveBoundaryContext, AutosaveStatus, useAutosaveBoundary } from './useAutosave.jsx'
import useLiveCalendarAccounts from './useLiveCalendarAccounts.js'
import { useTestingLocale } from './testingLocale.jsx'
import { mt5AccountName } from './liveAccountModel.js'
import { documentError, documentText, readNoteValue } from './noteDocument.js'
import { dayKey } from './liveWorkspaceModel.js'
import { displayDate } from './dateFormat.js'
import { inReviewRange, migrateReviewRecovery, noteTradeKey, noteTradeLink, reviewSummary, reviewTradeRows } from './liveReviewNoteModel.js'
import './live-note-editor.css'

const theme = () => document.querySelector('.fx-app')?.dataset.theme || 'dark'

function TradeRow({ row, unavailable, action, compact=false }) {
  const {t,fmt,timezone}=useTestingLocale()
  const pnl=row?.net!=null ? fmt(row.net,` ${row.currency}`) : 'N/A'
  const tone=row?.net>0?'is-positive':row?.net<0?'is-negative':''
  return <div className={`wm-review-trade-row${compact?' is-compact':''}${row?.net>0?' is-positive':row?.net<0?' is-negative':''}`}>
    {compact ? <div className="wm-review-trade-inline"><strong>{row?.symbol || t('Giao dịch không còn trong dữ liệu hiện tại')}</strong>{row && <><span>· {t(row.type===0?'Mua':'Bán')}</span><span className={tone}>· {pnl}</span><time dateTime={new Date(row.time_msc).toISOString()}>· {displayDate(row.time_msc,{timeStyle:'medium',timeZone:timezone})}</time></>}{!row && <small>{unavailable}</small>}</div> : <><div><strong>{row?.symbol || t('Giao dịch không còn trong dữ liệu hiện tại')}</strong><small>{row ? `${t(row.type===0?'Mua':'Bán')} · ${row.account_name}` : unavailable}</small></div><span className={tone}>{pnl}</span>{row && <time dateTime={new Date(row.time_msc).toISOString()}>{displayDate(row.time_msc,{timeZone:timezone})}</time>}</>}{action}
  </div>
}

function TradePicker({ rows, links, from, to, zone, onApply, onClose, issue }) {
  const {t}=useTestingLocale(),[selected,setSelected]=useState(()=>new Map(links.map(link=>[noteTradeKey(link),link]))),[search,setSearch]=useState(''),[account,setAccount]=useState('all'),[dates,setDates]=useState({from,to}),[validDates,setValidDates]=useState(true)
  const options=[{value:'all',label:t('Tất cả tài khoản'),localize:false},...new Map(rows.map(row=>[row.account_id,{value:row.account_id,label:row.account_name,localize:false}])).values()]
  const visible=rows.filter(row=>inReviewRange(row,dates.from,dates.to,zone) && (account==='all'||row.account_id===account) && `${row.symbol} ${row.account_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const toggle=row=>setSelected(current=>{const next=new Map(current),key=noteTradeKey(row);if(next.has(key))next.delete(key);else if(next.size<500)next.set(key,noteTradeLink(row));return next})
  const all=visible.length>0 && visible.every(row=>selected.has(noteTradeKey(row)))
  const some=visible.some(row=>selected.has(noteTradeKey(row)))
  const selectedVisible=visible.filter(row=>selected.has(noteTradeKey(row))).length
  return <LegacyModal theme={theme()} className="wm-review-trade-picker" label={t('Liên kết giao dịch')} onClose={onClose}>
    <div className="wm-review-picker-search"><SearchInput type="search" aria-label={t('Tìm giao dịch')} value={search} onChange={event=>setSearch(event.target.value)} placeholder={t('Tìm giao dịch')}/></div>
    <div className="wm-review-picker-filters"><FxSelect label="Account" value={account} options={options} onChange={setAccount}/><DateFilter inline value={dates} timezone={zone} onChange={setDates} onValidityChange={setValidDates} label="Khoảng ngày giao dịch"/></div>
    {issue && <p role="status" className="wm-review-issue">{t(issue)}</p>}
    <div className="wm-review-picker-count"><label><input type="checkbox" checked={all} ref={node=>{if(node)node.indeterminate=some&&!all}} onChange={()=>setSelected(current=>{const next=new Map(current);for(const row of visible){const key=noteTradeKey(row);if(some)next.delete(key);else if(next.size<500)next.set(key,noteTradeLink(row))}return next})}/>{t(some?'Bỏ chọn tất cả':'Chọn tất cả')}</label><span>{t('Đã chọn {selected}/{total} giao dịch',{selected:selectedVisible,total:visible.length})}</span></div>
    {selected.size>selectedVisible && <p className="wm-review-issue" role="status">{t('{count} giao dịch đã chọn ngoài bộ lọc.',{count:selected.size-selectedVisible})}</p>}
    {selected.size>=500 && <p className="wm-review-issue" role="status">{t('Tối đa 500 giao dịch.')}</p>}
    <div className="wm-review-picker-list">{visible.map(row=><label key={noteTradeKey(row)} className="wm-review-picker-row"><TradeRow row={row}/><input type="checkbox" checked={selected.has(noteTradeKey(row))} disabled={!selected.has(noteTradeKey(row)) && selected.size>=500} onChange={()=>toggle(row)}/></label>)}{!visible.length && <p className="wm-review-empty">{t('Không có giao dịch đã đóng trong khoảng ngày này.')}</p>}</div>
    <footer><button type="button" className="wm-button" onClick={onClose}>{t('Cancel')}</button><button type="button" className="wm-button is-primary" disabled={!validDates} onClick={()=>onApply([...selected.values()])}>{t('Áp dụng')}</button></footer>
  </LegacyModal>
}

function NoteFields({ workspace, record, seed, folderId, accountId, accounts, connections, records, broker, onSaved, picker, setPicker, titleInput }) {
  const { t,timezone,fmt } = useTestingLocale()
  const key = useRef(record?.record_id || `new:${folderId || 'all'}`).current
  const notified = useRef(onSaved); notified.current = onSaved
  const defaults = useRef({ title:'', note:'', note_type:'general', note_document:null, linked_trades:[],
    review_from:dayKey(Date.parse(record?.created_at_utc) || Date.now(),timezone),review_to:dayKey(Date.parse(record?.created_at_utc) || Date.now(),timezone),review_timezone:timezone,
    tags:[],account_id:accountId?.startsWith('broker:') ? null : accountId || null, connection_id:accountId?.startsWith('broker:') ? accountId.slice(7) : null,
    playbook_id:null,playbook_revision:null,
  }).current
  const initial=useRef({...defaults,...(record?.payload || seed || {})}).current
  const explicitLinks=useRef(Boolean(record || Object.hasOwn(seed || {},'linked_trades')))
  const save = useAutosave({ identity:JSON.stringify(['live-note',workspace,key]), initialValue:initial, adapter:{
    migrateRecovery: recovery=>{explicitLinks.current=true;return migrateReviewRecovery(recovery,defaults)},
    validate: value => documentError(value.note_document) || (value.note_document && documentText(value.note_document.blocks)!==value.note ? 'Nội dung chữ và định dạng ghi chú không khớp.' : null)
      || (!value.title.trim() || !value.note.trim() ? 'Điền tiêu đề và nội dung để tự động lưu ghi chú.' : null)
      || (value.note.length>20000 ? 'Ghi chú tối đa 20.000 ký tự.' : null)
      || (!value.review_from || !value.review_to || value.review_from>value.review_to ? 'Khoảng ngày không hợp lệ.' : null),
    async load(recoveryRecord) {
      const target = record || recoveryRecord
      if (!target) return {value:initial,record:null,savedAt:null}
      const latest = (await fetchLiveRecords(workspace)).find(item=>item.record_id === target.record_id && item.kind === 'note')
      if (!latest) throw new Error('Không tìm thấy ghi chú đã lưu.')
      readNoteValue(latest.payload)
      return {value:{...defaults,...latest.payload},record:latest,savedAt:latest.updated_at_utc}
    },
    async save(value,current,submitted) {
      const wireValue=submitted?.legacyPayload || value
      const result = await saveLiveRecord(workspace,'note',wireValue,current,folderId)
      const expected={...wireValue,title:wireValue.title.trim()}
      // Acknowledge the whole revision, including linked trades and rich content.
      if (!Number.isFinite(Date.parse(result.updated_at_utc)) || current && (result.record_id !== current.record_id || result.revision <= current.revision) || Object.keys(expected).some(key=>!same(expected[key],result.payload[key] ?? (key==='linked_trades'?[]:null)))) throw Object.assign(new Error('Chưa xác nhận nội dung đã lưu.'),{outcomeKnown:false})
      notified.current(result,false)
      return {value:{...value,...result.payload},record:result,savedAt:result.updated_at_utc}
    },
  } })
  const items=useMemo(()=>[...accounts.map(item=>({record_id:item.record_id,name:item.payload.name})),...connections.map(item=>({record_id:`broker:${item.id}`,name:mt5AccountName(item)}))],[accounts,connections])
  const sources=useLiveCalendarAccounts({workspace,enabled:save.ready,selection:null,items,broker,accounts,records,preview:false})
  const rows=reviewTradeRows(sources.sources || [],new Map(items.map(item=>[item.record_id,item.name])))
  const automaticLinks=!record && !save.record && !explicitLinks.current
  const disabled=!save.ready || save.phase === 'conflict' || automaticLinks && sources.loading
  const withDefaultLinks=value=>automaticLinks ? {...value,linked_trades:rows.filter(row=>inReviewRange(row,value.review_from,value.review_to,value.review_timezone)).slice(0,500).map(noteTradeLink)} : value
  const draft=withDefaultLinks(save.value)
  // Display defaults without dirtying a pristine note. Actual edits persist the
  // selection; late source reads may fill it until the first save is acknowledged.
  useEffect(()=>{
    if(automaticLinks && save.ready && !same(save.value,initial) && !same(save.value.linked_trades,draft.linked_trades)) save.change(draft)
  },[automaticLinks,save.ready,save.value,JSON.stringify(draft.linked_trades)])
  const summary=reviewSummary(draft.linked_trades,rows)
  const change=(field,value)=>{
    if(field==='linked_trades')explicitLinks.current=true
    save.change(field==='linked_trades' ? {...draft,[field]:value} : withDefaultLinks({...draft,[field]:value}))
  }
  const selected=summary.rows.map((row,index)=>({row,link:draft.linked_trades[index]}))
  let accumulated=0
  const curve=summary.net!==null ? [{value:0},...summary.rows.slice().sort((a,b)=>a.time_msc-b.time_msc).map(row=>({value:accumulated+=row.net}))] : []
  return <div className="wm-live-review-workspace">
    <div className="wm-live-note-title"><input ref={titleInput} aria-label={t('Tiêu đề')} placeholder={t('Đặt tên ghi chú')} value={draft.title} maxLength={160} disabled={disabled} onChange={event=>change('title',event.target.value)} onBlur={()=>void save.flush()}/><AutosaveStatus save={save} timestampOnly/></div>
    <div className="wm-live-note-editor-layout">
      <aside className="wm-live-note-context" aria-label={t('Ngữ cảnh ghi chú')}>
        <div className="wm-review-fields"><div><div className="wm-review-field-label"><ChartIcon name="calendar"/><span>{t('Khoảng ngày')}</span></div><DateFilter compact inline disabled={disabled} clearable={false} timezone={draft.review_timezone} label="Khoảng ngày" title="Khoảng ngày" calendarLabel="Chọn khoảng ngày ghi chú" value={{from:draft.review_from,to:draft.review_to}} onChange={patch=>save.change(withDefaultLinks({...draft,review_from:patch.from ?? draft.review_from,review_to:patch.to ?? draft.review_to}))}/></div>
        <div><div className="wm-review-field-label"><ChartIcon name="tag"/><span>{t('Loại ghi chú')}</span></div><NoteTypeSelect workspace={workspace} label="Loại ghi chú" disabled={disabled} value={draft.note_type} onChange={value=>change('note_type',value)}/></div></div>
        <section className="wm-review-summary" aria-label={t('Tổng hợp giao dịch liên kết')}><dl><div className="wm-review-kpi-primary"><dt>{t('PnL ròng')}</dt><dd className={summary.net>0?'is-positive':summary.net<0?'is-negative':''}>{summary.net===null?'N/A':fmt(summary.net,` ${summary.currency}`)}</dd></div><div className="wm-review-kpi"><dt>{t('Tỉ lệ thắng')}</dt><dd>{summary.winRate===null?'N/A':fmt(summary.winRate,'%',1)}</dd></div><div className="wm-review-kpi"><dt>{t('Tổng giao dịch')}</dt><dd>{summary.count}</dd></div></dl>
          {curve.length>1 && <AnalyticsCurve series={[curve]} seriesMeta={[{label:t('PnL ròng'),color:summary.net>=0?'var(--project-positive)':'var(--project-negative)'}]} height={120} sparkline showPoints={false} negative label={t('PnL lũy kế của giao dịch liên kết')}/>}
          {(summary.missing>0 || summary.stale) && <p className="wm-review-issue" role="status">{t(summary.missing ? 'Chưa đọc được một số giao dịch liên kết.' : 'Dữ liệu tài khoản đã cũ. Đồng bộ tài khoản để cập nhật.')}</p>}
        </section>
        <section className="wm-review-linked" aria-label={t('Giao dịch liên kết')}><header><button type="button" className="wm-review-add-trades" aria-label={t('Thêm giao dịch')} disabled={disabled} onClick={()=>setPicker(true)}><ChartIcon name="order"/>{t('Trades')}</button><span>{t('Hiển thị {count}/{total}',{count:selected.length,total:summary.count})}</span><button type="button" className="wm-review-icon" aria-label={t('Tìm giao dịch liên kết')} disabled={disabled} onClick={()=>setPicker(true)}><ChartIcon name="search"/></button></header>
          {sources.issue && <p className="wm-review-issue" role="status">{t(sources.issue)}</p>}
          <div>{selected.map(({row,link})=><TradeRow compact key={noteTradeKey(link)} row={row} unavailable={link.trade_id} action={<button type="button" className="wm-review-icon" disabled={disabled} aria-label={t('Bỏ liên kết giao dịch {id}',{id:link.trade_id})} onClick={()=>change('linked_trades',draft.linked_trades.filter(item=>noteTradeKey(item)!==noteTradeKey(link)))}><ChartIcon name="close"/></button>}/>)}{!selected.length && <p className="wm-review-empty">{t('Chưa có giao dịch liên kết.')}</p>}</div>
        </section>
      </aside>
      <main className="wm-live-note-editor-main"><NoteBlockEditor value={{text:draft.note,document:draft.note_document}} onChange={value=>save.change({...draft,note:value.text,note_document:value.document})} onBlur={()=>void save.flush()} disabled={disabled} label={t('Ghi chú')} workspace={workspace} context="live-notes" allowDefault={!record}/></main>
    </div>
    {picker && !disabled && <TradePicker rows={rows} links={draft.linked_trades} from={draft.review_from} to={draft.review_to} zone={draft.review_timezone} issue={sources.issue} onClose={()=>setPicker(false)} onApply={links=>{change('linked_trades',links);setPicker(false)}}/>}
  </div>
}

export default function LiveNoteEditor({ onClose, onNavigate, records=[], ...props }) {
  const {t}=useTestingLocale(), {boundary,requestClose,requestTransition,closing}=useAutosaveBoundary(onClose),[expanded,setExpanded]=useState(false),[menu,setMenu]=useState(null),[picker,setPicker]=useState(false),[savedId,setSavedId]=useState(null),titleInput=useRef(null)
  const notes=records.filter(item=>item.kind==='note'), index=notes.findIndex(item=>item.record_id===(props.record?.record_id || savedId))
  const navigation=<div className="wm-review-navigation" role="group" aria-label={t('Thao tác ghi chú')}>{[[-1,'Ghi chú trước','chevron-left'],[1,'Ghi chú tiếp theo','chevron-right']].map(([offset,label,icon])=><button key={offset} type="button" className="wm-review-icon" aria-label={t(label)} disabled={closing || !onNavigate || index<0 || !notes[index+offset]} onClick={()=>void requestTransition(()=>onNavigate(notes[index+offset]))}><ChartIcon name={icon}/></button>)}<button type="button" className="wm-review-icon" aria-label={t('Thêm thao tác ghi chú')} aria-haspopup="menu" aria-expanded={Boolean(menu)} disabled={closing} onClick={event=>setMenu(event.currentTarget)}><ChartIcon name="more-vertical"/></button>{menu && <LegacyPopover anchor={menu} theme={theme()} role="menu" label={t('Thêm thao tác ghi chú')} className="wm-review-note-menu" onClose={()=>setMenu(null)}><button type="button" role="menuitem" disabled={titleInput.current?.disabled} onClick={()=>{setMenu(null);titleInput.current?.focus();titleInput.current?.select()}}><ChartIcon name="edit"/>{t('Đổi tên ghi chú')}</button><button type="button" role="menuitem" disabled={titleInput.current?.disabled} onClick={()=>{setMenu(null);setPicker(true)}}><ChartIcon name="trades"/>{t('Liên kết giao dịch')}</button></LegacyPopover>}</div>
  return <AutosaveBoundaryContext.Provider value={boundary}><LegacyModal overlayClassName="is-drawer-overlay" className={`live-record-dialog is-drawer is-note-editor${expanded?' is-expanded':''}`} theme={theme()} label={t('Ghi chú')} headerLeading={<button type="button" className="wm-review-icon" aria-label={t(expanded?'Thu nhỏ ghi chú':'Mở rộng ghi chú')} onClick={()=>setExpanded(value=>!value)}><ChartIcon name={expanded?'contract-corners':'expand-corners'}/></button>} headerActions={navigation} onClose={()=>void requestClose()}>
    <NoteFields {...props} records={records} picker={picker} setPicker={setPicker} titleInput={titleInput} onSaved={(record,close)=>{setSavedId(record.record_id);props.onSaved(record,close)}}/>
  </LegacyModal></AutosaveBoundaryContext.Provider>
}
