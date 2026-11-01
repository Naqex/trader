import { useEffect, useMemo, useState } from 'react'
import { scopedRead } from './scopedRead.js'
import { readJson } from './researchDataApi.js'
import useReadRefresh from './useReadRefresh.js'

const unknownPresence = () => null

export function tradeNotePresenceReader(items) {
  const sessions = new Map()
  for (const item of items) {
    const source = item.payload?.source
    if (item.deleted || !source || source.kind === 'trade-comment' || !(item.payload.note || item.payload.notes)?.trim?.()) continue
    for (const session of new Set([source.session_id, source.replay_session_id])) {
      if (!sessions.has(session)) sessions.set(session, new Set())
      sessions.get(session).add(source.trade_id || source.id)
    }
  }
  return (session, trade) => sessions.get(session)?.has(String(trade)) || false
}

export default function useTradeNotePresence(workspace) {
  const [token,setToken]=useState(0),[state,setState]=useState({workspace:null,items:null,error:null,pending:false})
  useReadRefresh(()=>setToken(value=>value+1),Boolean(workspace),{workspace,resources:['journal'],scopeKey:workspace,error:state.error,pending:state.pending})
  useEffect(()=>{
    if(!workspace)return
    const controller=new AbortController()
    setState(current=>({...current,pending:true}))
    scopedRead('/api/v2/journal',workspace,controller.signal).then(readJson).then(data=>{
      if(!Array.isArray(data.items))throw new Error('invalid_note_list')
      if(!controller.signal.aborted)setState({workspace,items:data.items,error:null,pending:false})
    }).catch(error=>{if(!controller.signal.aborted)setState({workspace,items:null,error,pending:false})})
    return()=>controller.abort()
  },[workspace,token])
  return useMemo(() => state.workspace === workspace && state.items ? tradeNotePresenceReader(state.items) : unknownPresence, [workspace, state.workspace, state.items])
}
