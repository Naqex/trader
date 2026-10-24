import { matchesSearch } from './searchText.js'
import SearchInput from './SearchInput.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { CATEGORIES, categoryLabel } from './dataLibraryModel.js'
import { mt5SymbolOptions } from './mt5SymbolCategory.js'
import './mt5-symbol-picker.css'
const EMPTY_METADATA=[]

export default function Mt5SymbolPicker({anchor,theme,symbols,symbol,status,onSelect,onClose,workspace,connectionId}) {
  const {t}=useTestingLocale(), [search,setSearch]=useState(''), [category,setCategory]=useState('all'), [focused,setFocused]=useState(symbol)
  const input=useRef(null)
  const [catalog,setCatalog]=useState({scope:'',items:[]})
  const catalogScope=`${workspace}:${connectionId}`
  useEffect(()=>{
    if(!workspace||!connectionId)return
    const abort=new AbortController()
    fetch(`/api/v2/ai/assistant/mt5/${encodeURIComponent(connectionId)}/symbols`,{headers:{'X-Workspace-Id':workspace},signal:abort.signal})
      .then(async response=>{if(!response.ok)return;const body=await response.json();if(!abort.signal.aborted&&Array.isArray(body.data?.items))setCatalog({scope:catalogScope,items:body.data.items})})
      .catch(()=>{})
    return ()=>abort.abort()
  },[workspace,connectionId,catalogScope])
  useEffect(()=>{
    const focus=requestAnimationFrame(()=>input.current?.focus({preventScroll:true}))
    return ()=>{
      cancelAnimationFrame(focus)
      // The chart trigger can live inside an iframe; the shared modal only sees its frame.
      queueMicrotask(()=>{if(anchor?.isConnected&&!anchor.closest('[inert]')&&!anchor.ownerDocument.defaultView?.frameElement?.closest('[inert]'))anchor.focus({preventScroll:true})})
    }
  },[anchor])
  const metadata=catalog.scope===catalogScope?catalog.items:EMPTY_METADATA
  const options=useMemo(()=>mt5SymbolOptions(symbols,metadata),[symbols,metadata])
  useEffect(()=>{if(category!=='all'&&!options.some(item=>item.category===category))setCategory('all')},[options,category])
  const groups=[['all','Tất cả'],...CATEGORIES.filter(([key])=>options.some(item=>item.category===key)),...(options.some(item=>!item.category)?[['','Chưa phân loại']]:[])]
  const matches=options.filter(item=>(category==='all'||item.category===category)&&matchesSearch(item.search, search))
  const tabSymbol=matches.some(item=>item.symbol===focused)?focused:matches[0]?.symbol
  const select=value=>{if(status==='ready' && value!==symbol)onSelect({mt5_symbol:value});onClose()}
  return <LegacyModal theme={theme} label={t('Chọn mã giao dịch MT5')} className="mt5-symbol-picker" onClose={onClose}>
      <div className="mt5-symbol-search"><ChartIcon name="search"/><SearchInput ref={input} type="search" aria-label={t('Tìm mã giao dịch MT5')} placeholder={t('Tìm mã giao dịch MT5')} value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{
        if(['ArrowDown','ArrowUp'].includes(event.key)) {
          event.preventDefault();event.stopPropagation()
          const entries=event.currentTarget.closest('.mt5-symbol-picker').querySelectorAll('[role="option"]:not(:disabled)')
          entries[event.key==='ArrowDown'?0:entries.length-1]?.focus()
        } else if(event.key==='Enter'&&matches.length&&status==='ready'){event.preventDefault();select(matches[0].symbol)}
      }}/></div>
      <div className="mt5-symbol-categories" role="group" aria-label={t('Nhóm tài sản')}>{groups.map(([key,label])=><button type="button" key={key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{t(label)}</button>)}</div>
      <div className="mt5-symbol-options" role="listbox" aria-label={t('Mã giao dịch MT5')} onKeyDown={event=>{
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
        event.preventDefault();event.stopPropagation()
        const entries=[...event.currentTarget.querySelectorAll('[role="option"]:not(:disabled)')], index=entries.indexOf(event.target)
        entries[event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowDown'?1:entries.length-1))%entries.length]?.focus()
      }}>{matches.map(item=><button type="button" role="option" aria-selected={item.symbol===symbol} tabIndex={item.symbol===tabSymbol?0:-1} onFocus={()=>setFocused(item.symbol)} key={item.symbol} title={item.metadata?.description||undefined} disabled={status!=='ready'} onClick={()=>select(item.symbol)}><strong>{item.symbol}</strong><span>{t(categoryLabel(item.category))}</span><span className="mt5-symbol-check" aria-hidden="true">{item.symbol===symbol?'✓':''}</span></button>)}</div>
      {!matches.length&&<p className="mt5-symbol-empty" role="status">{t(symbols.length?'Không tìm thấy mã phù hợp.':'Chưa có danh sách mã từ MT5.')}</p>}
      <footer><span>{t('{count} mã',{count:matches.length})}</span></footer>
      {status!=='ready'&&symbols.length>0&&<p role="status">{t('Đang kết nối lại MT5…')}</p>}
    </LegacyModal>
}
