import { useEffect, useRef, useState } from 'react'
import same from 'fast-deep-equal'
import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { documentError } from './noteDocument.js'

export async function readNoteTemplates(workspace,signal) {
  return checked(await readJson(await scopedRead('/api/v2/note-templates',workspace,signal)))
}
function checked(result) {
  if(result?.version!=='note-templates-v1' || !Array.isArray(result.items) || !Number.isSafeInteger(result.preferences?.revision) || !Array.isArray(result.preferences.favorites) || !result.preferences.defaults || result.items.some(item=>!item.id || !item.name || !Number.isSafeInteger(item.revision) || !item.document || documentError(item.document) || !Number.isFinite(Date.parse(item.updated_at_utc)))) throw new Error('Không đọc được thư viện mẫu.')
  return result
}
export async function writeNoteTemplates(workspace,body) {
  const response=await scopedMutation('/api/v2/note-templates',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  const result=await readJson(response)
  try{return checked(result)}catch(cause){throw Object.assign(new Error('Chưa xác nhận được mẫu đã lưu.',{cause}),{outcomeKnown:false})}
}

export function useNoteTemplateLibrary(workspace,enabled=true) {
  const [state,setState]=useState({workspace,status:'loading',items:[],preferences:null}), [version,setVersion]=useState(0)
  const current=useRef(workspace),lock=useRef(false),sequence=useRef(0);current.current=workspace
  const accept=result=>{if(current.current===workspace){sequence.current++;setState({...result,workspace,status:'ready'})}}
  useEffect(()=>{
    const controller=new AbortController(),request=++sequence.current
    setState({workspace,status:'loading',items:[],preferences:null})
    if(!enabled)return ()=>controller.abort()
    if(workspace)readNoteTemplates(workspace,controller.signal).then(result=>{if(!controller.signal.aborted && request===sequence.current)setState({...result,workspace,status:'ready'})}).catch(error=>{if(!controller.signal.aborted && request===sequence.current)setState({workspace,status:'error',items:[],preferences:null,error})})
    else setState({workspace,status:'error',items:[],preferences:null,error:new Error('Chưa chọn workspace.')})
    return ()=>controller.abort()
  },[workspace,version,enabled])
  const mutate=async body=>{
    if(lock.current || state.status!=='ready' || state.uncertain)return null
    lock.current=true;setState(s=>({...s,pending:true,error:null}))
    try{const result=await writeNoteTemplates(workspace,body);accept(result);return result}
    catch(error){if(current.current===workspace)setState(s=>({...s,pending:false,error,uncertain:error.outcomeKnown===false || error.status===409}));return null}
    finally{lock.current=false}
  }
  return {...(state.workspace===workspace?state:{status:'loading',items:[],preferences:null}),accept,mutate,refresh:()=>setVersion(v=>v+1)}
}

export function templateAdapter(workspace,id,onSaved) {
  const pick=result=>{
    const record=result.items.find(item=>item.id===id)
    if(!record)throw new Error('Không tìm thấy mẫu ghi chú.')
    return {value:{name:record.name,document:record.document},record,savedAt:record.updated_at_utc}
  }
  return {
    validate:value=>!value.name.trim()?'Điền tên mẫu để tự động lưu.':documentError(value.document),
    load:async()=>pick(await readNoteTemplates(workspace)),
    save:async(value,record)=>{
      const result=await writeNoteTemplates(workspace,{action:'update',id,expected_revision:record.revision,name:value.name.trim(),document:value.document})
      const saved=pick(result)
      if(saved.record.revision<=record.revision || !same(saved.value.document,value.document))throw Object.assign(new Error('Chưa xác nhận được mẫu đã lưu.'),{outcomeKnown:false})
      onSaved(result);return saved
    },
    reconcile:async attempt=>{
      const result=await readNoteTemplates(workspace),saved=pick(result)
      if(same(saved.value,{...attempt.value,name:attempt.value.name.trim()}) && saved.record.revision>attempt.record.revision){onSaved(result);return saved}
      return null
    },
  }
}
