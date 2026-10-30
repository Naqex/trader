import { useEffect, useState } from 'react'
import { scopedRead } from './scopedRead.js'
import { readJson } from './researchDataApi.js'
import useReadRefresh from './useReadRefresh.js'

export default function useTradeNotePresence(workspace) {
  const [token,setToken]=useState(0),[state,setState]=useState({workspace:null,items:null,error:null,pending:false})
  useReadRefresh(()=>setToken(value=>value+1),Boolean(workspace),{workspace,resources:['journal'],scopeKey:workspace,error:state.error,pending:state.pending})
  useEffect(()=>{
    if(!workspace)return
    const controller=new AbortController()
    setState(current=>({...current,pending:true}))
    scopedRead('/api/v2/journal',workspace,controller.signal).then(readJson).then(data=>{
      if(!Array.isArray(data.items))throw new Error('invalid_note_list')
      if(!controller.signal.aborted)setState({workspace,items:data.items.filter(item=>!item.deleted && item.payload?.source?.kind!=='trade-comment'),error:null,pending:false})
    }).catch(error=>{if(!controller.signal.aborted)setState({workspace,items:null,error,pending:false})})
    return()=>controller.abort()
  },[workspace,token])
  return (session,trade)=>state.workspace!==workspace || !state.items?null:state.items.some(item=>{
    const source=item.payload?.source
    return source && (source.session_id===session || source.replay_session_id===session) && (source.trade_id || source.id)===String(trade) && Boolean((item.payload.note || item.payload.notes)?.trim?.())
  })
}
