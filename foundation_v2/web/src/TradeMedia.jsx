import { useEffect, useId, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { useTestingLocale } from './testingLocale.jsx'

function MediaPreview({item,url,onClose}) {
  const {t}=useTestingLocale(),dialog=useRef(null),id=useId()
  useEffect(()=>{
    const node=dialog.current,opener=document.activeElement
    node.showModal()
    return ()=>{node.close();if(opener?.isConnected)opener.focus({preventScroll:true})}
  },[])
  return <dialog ref={dialog} className="wm-trade-media-preview" aria-labelledby={id} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose()}} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();onClose()}}}>
    <header><h2 id={id}>{item.name}</h2><button type="button" className="wm-dialog-close" aria-label={t('Đóng')} onClick={onClose}><ChartIcon name="close"/></button></header><img src={url} alt={item.name}/>
  </dialog>
}

function MediaImage({workspace,item}) {
  const {t}=useTestingLocale(),[state,setState]=useState({}),[open,setOpen]=useState(false)
  useEffect(()=>{
    const abort=new AbortController();let url
    scopedRead(`/api/v2/trade-media/${encodeURIComponent(item.id)}`,workspace,abort.signal).then(async response=>{
      if(!response.ok || response.headers.get('content-type')!==item.mime_type)throw new Error('invalid_media')
      const blob=await response.blob()
      if(!abort.signal.aborted){url=URL.createObjectURL(blob);setState({url})}
    }).catch(()=>{if(!abort.signal.aborted)setState({error:true})})
    return ()=>{abort.abort();if(url)URL.revokeObjectURL(url)}
  },[workspace,item.id,item.mime_type])
  return <>{state.url?<button type="button" className="wm-trade-media-image" aria-label={t('Xem ảnh {name}',{name:item.name})} onClick={()=>setOpen(true)}><img src={state.url} alt={item.name}/></button>:<p role={state.error?'alert':'status'}>{t(state.error?'Không tải được ảnh.':'Đang tải ảnh…')}</p>}{open && <MediaPreview item={item} url={state.url} onClose={()=>setOpen(false)}/>}</>
}
export default function TradeMedia({workspace,session,trade}) {
  const {t}=useTestingLocale(),input=useRef(null),lock=useRef(false),[version,setVersion]=useState(0),[state,setState]=useState({status:'loading',items:[]}),[hover,setHover]=useState(false)
  const path=`/api/v2/trade-media?${new URLSearchParams({session_id:session,trade_id:trade})}`
  useEffect(()=>{
    const abort=new AbortController()
    setState(s=>({...s,status:'loading',error:null,pending:false,uncertain:false}))
    scopedRead(path,workspace,abort.signal).then(readJson).then(result=>{if(!Array.isArray(result.items))throw new Error('invalid_media');if(!abort.signal.aborted)setState({status:'ready',items:result.items})}).catch(()=>{if(!abort.signal.aborted)setState({status:'error',items:[],error:'Không đọc được tệp đính kèm.'})})
    return ()=>abort.abort()
  },[workspace,path,version])
  const upload=async files=>{
    if(lock.current || state.status!=='ready' || state.uncertain)return
    lock.current=true;setState(s=>({...s,pending:true,error:null}))
    try{
      if(files.some(file=>!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || !file.size || file.size>5*1024*1024))throw new Error('Chọn ảnh PNG, JPEG, WebP hoặc GIF tối đa 5 MB.')
      for(const file of files) {
        const bytes=new Uint8Array(await file.arrayBuffer());let binary=''
        for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768))
        const result=await readJson(await scopedMutation('/api/v2/trade-media',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upload',session_id:session,trade_id:trade,name:file.name,mime_type:file.type,data:btoa(binary)})}))
        if(!result.id)throw Object.assign(new Error('Chưa xác nhận được ảnh đã tải lên.'),{outcomeKnown:false})
      }
      setVersion(v=>v+1)
    }catch(error){setState(s=>({...s,pending:false,error:error.outcomeKnown===false?'Chưa xác nhận được kết quả. Đọc lại dữ liệu trước khi thao tác tiếp.':error.status?'Không tải được ảnh lên.':error.message,uncertain:error.outcomeKnown===false}))}
    finally{lock.current=false;if(input.current)input.current.value=''}
  }
  const remove=async item=>{
    if(lock.current || state.uncertain || !window.confirm(t('Xóa ảnh đính kèm này?')))return
    lock.current=true;setState(s=>({...s,pending:true,error:null}))
    try{await readJson(await scopedMutation('/api/v2/trade-media',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove_media',id:item.id})}));setVersion(v=>v+1)}
    catch(error){setState(s=>({...s,pending:false,error:'Không xóa được ảnh. Đọc lại dữ liệu trước khi thử lại.',uncertain:error.outcomeKnown===false}))}
    finally{lock.current=false}
  }
  return <div className="wm-trade-media" data-dragging={hover || undefined} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();setHover(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setHover(false)}} onDrop={event=>{event.preventDefault();setHover(false);void upload([...event.dataTransfer.files])}}>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event=>void upload([...event.target.files])}/>
    {state.items.length>0 && <div className="wm-trade-media-list">{state.items.map(item=><figure key={item.id}><MediaImage workspace={workspace} item={item}/><figcaption><span>{item.name}</span><button type="button" className="fxa-button fxa-icon-button" aria-label={t('Xóa ảnh {name}',{name:item.name})} disabled={state.pending || state.uncertain} onClick={()=>void remove(item)}><ChartIcon name="trash"/></button></figcaption></figure>)}</div>}
    <div className="wm-trade-media-drop">
      {state.status==='ready' && !state.items.length && <h3>{t('Chưa có ảnh đính kèm')}</h3>}
      {state.status==='loading' && <p role="status">{t('Đang đọc tệp đính kèm…')}</p>}
      {state.status==='ready' && <><p>{t('Kéo thả ảnh vào đây')}</p><button type="button" className="fxa-button" disabled={state.pending || state.uncertain} onClick={()=>input.current.click()}><ChartIcon name="upload"/>{t(state.pending?'Đang tải…':'Tải ảnh lên')}</button></>}
      {state.error && <p role="alert">{t(state.error)}</p>}
      {(state.status==='error' || state.error) && <button className="fxa-button" type="button" disabled={state.pending} onClick={()=>setVersion(v=>v+1)}>{t('Đọc lại dữ liệu')}</button>}
    </div>
  </div>
}
