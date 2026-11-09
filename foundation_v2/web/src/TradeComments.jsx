import { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'

// Comments are separate journal records, never the autosaved trade-note resource.
export default function TradeComments({workspace,session,trade,onClose}) {
  const {t,timezone}=useTestingLocale(),key=JSON.stringify(['trade-comment',workspace,session,trade])
  const readDraft=()=>{try{return JSON.parse(sessionStorage.getItem(key) || '{}')}catch{return {}}}
  const [draft,setDraft]=useState(()=>readDraft().text || ''),[attempt,setAttempt]=useState(()=>readDraft().attempt || null)
  const [state,setState]=useState({phase:'loading',items:[]}),[pending,setPending]=useState(false),[error,setError]=useState('')
  const lock=useRef(false),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const read=async signal=>{
    const data=await readJson(await scopedRead('/api/v2/journal',workspace,signal))
    if(!Array.isArray(data.items))throw new Error('invalid_comment_list')
    return data.items.filter(item=>!item.deleted && item.payload?.source?.kind==='trade-comment' && item.payload.source.parent_session_id===session && item.payload.source.parent_trade_id===trade).sort((a,b)=>Date.parse(a.created_at_utc)-Date.parse(b.created_at_utc))
  }
  const refresh=async signal=>{
    try{const items=await read(signal);if(!signal?.aborted && mounted.current){setState({phase:'ready',items});setError('');return items}}
    catch{if(!signal?.aborted && mounted.current){setState({phase:'error',items:[]});setError(t('Không đọc được bình luận.'))}}
  }
  useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort()},[workspace,session,trade])
  const remember=(text,request)=>{try{sessionStorage.setItem(key,JSON.stringify({text,attempt:request}))}catch{setError(t('Không giữ được bản nháp bình luận trong trình duyệt.'))}}
  const send=async event=>{
    event.preventDefault();if(lock.current || state.phase!=='ready' || !draft.trim())return
    lock.current=true;setPending(true);setError('')
    const body=attempt || {entry_type:'observation',note:draft.trim(),tags:[],source:{kind:'trade-comment',id:crypto.randomUUID(),parent_session_id:session,parent_trade_id:trade}}
    setAttempt(body);remember(draft,body)
    try{
      const existing=attempt?(await read()).find(item=>item.payload.source.id===body.source.id):null
      const item=existing || await readJson(await scopedMutation('/api/v2/journal',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))
      if(!item.record_id || item.deleted || item.payload?.source?.id!==body.source.id || item.payload?.note!==body.note)throw new Error('invalid_comment_receipt')
      if(mounted.current){setState(current=>({...current,items:[...current.items.filter(value=>value.record_id!==item.record_id),item]}));setDraft('');setAttempt(null)}
      try{sessionStorage.removeItem(key)}catch{}
    }catch{if(mounted.current)setError(t('Chưa xác nhận bình luận đã lưu. Thử lại để kiểm tra cùng yêu cầu.'))}
    finally{lock.current=false;if(mounted.current)setPending(false)}
  }
  return <aside className="wm-trade-comments" aria-label={t('Bình luận')}>
    <header><h3>{t('Bình luận')} <small>{state.phase==='ready'?state.items.length:'-'}</small></h3><button type="button" className="wm-button is-icon" aria-label={t('Đóng bình luận')} onClick={onClose}><ChartIcon name="close"/></button></header>
    <form onSubmit={send}><textarea aria-label={t('Viết bình luận…')} placeholder={t('Viết bình luận…')} maxLength={10000} value={draft} readOnly={pending || Boolean(attempt)} onChange={event=>{setDraft(event.target.value);remember(event.target.value,null)}}/><button type="submit" className="fxa-button is-primary" disabled={pending || state.phase!=='ready' || !draft.trim()}>{t(pending?'Đang lưu…':attempt?'Thử lại':'Bình luận')}</button></form>
    {error && <p role="alert">{error}</p>}
    {state.phase==='loading'?<p role="status">{t('Đang đọc bình luận…')}</p>:state.phase==='error'?<button type="button" className="fxa-button" onClick={()=>void refresh()}>{t('Thử lại')}</button>:state.items.length?state.items.map(item=><article key={item.record_id}><p>{item.payload.note}</p><time dateTime={item.created_at_utc}>{displayDate(item.created_at_utc,{timeStyle:'short',timeZone:timezone})}</time></article>):<p className="wm-comments-empty">{t('Chưa có bình luận.')}</p>}
  </aside>
}
