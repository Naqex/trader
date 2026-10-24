import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import LegacyPopover from './LegacyPopover.jsx'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { DEMO_TIMEFRAMES } from './liveTradingModel.js'
import styles from './mt5-symbol-picker.css?inline'
import './mt5-symbol-picker.css'

export default function Mt5SymbolPicker({anchor,theme,symbols,symbol,timeframe,status,onSelect,onClose}) {
  const {t}=useTestingLocale(), [search,setSearch]=useState('')
  const input=useRef(null)
  useEffect(()=>{input.current?.focus({preventScroll:true})},[])
  const matches=symbols.filter(value=>value.toLowerCase().includes(search.trim().toLowerCase()))
  const select=value=>{if(status==='ready' && value!==symbol)onSelect({mt5_symbol:value});onClose()}
  return <>
    {anchor.ownerDocument!==document && createPortal(<style>{styles}</style>,anchor.ownerDocument.head)}
    <LegacyPopover anchor={anchor} theme={theme} label={t('Chọn mã giao dịch MT5')} role="dialog" className="mt5-symbol-picker" onClose={onClose}>
      <div className="mt5-symbol-search"><ChartIcon name="search"/><input ref={input} type="search" aria-label={t('Tìm mã giao dịch MT5')} placeholder={t('Tìm mã giao dịch MT5')} value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{
        if(['ArrowDown','ArrowUp'].includes(event.key)) {
          event.preventDefault();event.stopPropagation()
          const entries=event.currentTarget.closest('.mt5-symbol-picker').querySelectorAll('[role="option"]:not(:disabled)')
          entries[event.key==='ArrowDown'?0:entries.length-1]?.focus()
        } else if(event.key==='Enter'&&matches.length&&status==='ready'){event.preventDefault();select(matches[0])}
      }}/></div>
      <div className="mt5-symbol-timeframes" role="group" aria-label={t('Khung thời gian MT5')}>{Object.keys(DEMO_TIMEFRAMES).map(value=><button type="button" key={value} aria-pressed={timeframe===value} onClick={()=>{if(value!==timeframe)onSelect({mt5_timeframe:value});onClose()}}>{value}</button>)}</div>
      <div className="mt5-symbol-options" role="listbox" aria-label={t('Mã giao dịch MT5')} onKeyDown={event=>{
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
        event.preventDefault();event.stopPropagation()
        const entries=[...event.currentTarget.querySelectorAll('[role="option"]:not(:disabled)')], index=entries.indexOf(event.target)
        entries[event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowDown'?1:entries.length-1))%entries.length]?.focus()
      }}>{matches.map(value=><button type="button" role="option" aria-selected={value===symbol} tabIndex={-1} key={value} disabled={status!=='ready'} onClick={()=>select(value)}><span>{value}</span>{value===symbol&&<span aria-hidden="true">✓</span>}</button>)}</div>
      {!matches.length&&<p role="status">{t(symbols.length?'Không tìm thấy mã phù hợp.':'Chưa có danh sách mã từ MT5.')}</p>}
      {status!=='ready'&&symbols.length>0&&<p role="status">{t('Đang kết nối lại MT5…')}</p>}
    </LegacyPopover>
  </>
}
