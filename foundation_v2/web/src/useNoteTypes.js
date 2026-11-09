import { useEffect, useRef, useState } from 'react'
import same from 'fast-deep-equal'
import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { NOTE_TYPE_DEFINITIONS } from './liveNoteModel.js'

const eventName = 'tw:note-types-changed'
export const defaultNoteTypes = NOTE_TYPE_DEFINITIONS.map(item=>({id:item.value,name:item.label,color:item.color,archived:false}))
export function noteTypeLabel(item, t) {
  const builtin = NOTE_TYPE_DEFINITIONS.find(entry => entry.value === item?.id)
  return builtin && builtin.label === item.name ? t(item.name) : item?.name || ''
}
export function useNoteTypes(workspace) {
  const [state,setState]=useState({workspace,items:defaultNoteTypes,revision:0,status:'loading'})
  const [reload,setReload]=useState(0), lock=useRef(null), current=useRef(workspace)
  current.current=workspace
  useEffect(()=>{
    const controller=new AbortController()
    setState({workspace,items:defaultNoteTypes,revision:0,status:'loading'})
    scopedRead('/api/v2/note-types',workspace,controller.signal).then(readJson).then(data=>{
      if(data.version!=='note-types-v1'||!Array.isArray(data.items)) throw new Error('invalid_note_types')
      if(!controller.signal.aborted && current.current===workspace)setState(previous=>previous.workspace===workspace && previous.revision>data.revision ? previous : {...data,workspace,status:'ready'})
    }).catch(error=>{if(!controller.signal.aborted)setState(previous=>previous.workspace===workspace&&previous.status==='ready'?previous:{workspace,items:defaultNoteTypes,revision:0,status:'error',error})})
    return ()=>controller.abort()
  },[workspace,reload])
  useEffect(()=>{
    const receive=event=>{if(event.detail.workspace===workspace)setState(previous=>previous.workspace===workspace && previous.revision>event.detail.data.revision ? previous : {...event.detail.data,workspace,status:'ready'})}
    window.addEventListener(eventName,receive);return ()=>window.removeEventListener(eventName,receive)
  },[workspace])
  const save=async items=>{
    if(lock.current?.workspace===workspace||state.workspace!==workspace||state.status!=='ready'||state.pending||state.error||state.uncertain)return false
    const attempt={workspace};lock.current=attempt;setState(s=>({...s,pending:true,error:null}))
    try {
      const data=await readJson(await scopedMutation('/api/v2/note-types',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:state.revision,items})}))
      if(data.version!=='note-types-v1'||data.revision!==state.revision+1||!same(data.items,items))throw Object.assign(new Error('unconfirmed_note_types'),{outcomeKnown:false})
      if(current.current!==workspace)return false
      setState(previous=>previous.workspace===workspace&&previous.revision>data.revision?previous:{...data,workspace,status:'ready'});window.dispatchEvent(new CustomEvent(eventName,{detail:{workspace,data}}));return true
    } catch(error) {if(current.current===workspace)setState(s=>({...s,pending:false,error,uncertain:error.outcomeKnown===false||!error.status||error.status>=500}));return false}
    finally {if(lock.current===attempt)lock.current=null}
  }
  return {...(state.workspace===workspace?state:{workspace,items:defaultNoteTypes,revision:0,status:'loading'}),save,refresh:()=>setReload(n=>n+1)}
}
