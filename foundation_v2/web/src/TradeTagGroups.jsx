import { useRef, useState } from 'react'
import TradeLabelCell, {labelError} from './TradeLabelCell.jsx'
import ChartIcon from './ChartIcon.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import SearchInput from './SearchInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { matchesSearch } from './searchText.js'

export default function TradeTagGroups({workspace,session,row,catalog,onChanged}) {
  const {t}=useTestingLocale(),[search,setSearch]=useState(null),[anchor,setAnchor]=useState(null),[name,setName]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),lock=useRef(false)
  const groups=(catalog.groups || []).filter(group=>!group.archived || catalog.items.some(item=>item.group_id===group.id && row.tags?.includes(item.name)))
  if(catalog.items.some(item=>!item.group_id) || row.tags?.some(tag=>!catalog.items.some(item=>item.name===tag)))groups.push({id:'',name:t('Chưa phân nhóm')})
  const create=async event=>{
    event.preventDefault();if(lock.current || uncertain)return
    lock.current=true;setPending(true);setError('')
    try {
      const result=await readJson(await scopedMutation('/api/v2/trade-labels',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create_group',name:name.trim()})}))
      if(result.schema_version!=='trade-labels-v1' || !Array.isArray(result.groups))throw Object.assign(new Error('invalid_label_catalog'),{uncertain:true})
      catalog.accept(result);setAnchor(null);setName('')
    }catch(problem){setError(labelError(problem,t));setUncertain(problem.outcomeKnown===false || problem.uncertain || problem.status===409)}
    finally{lock.current=false;setPending(false)}
  }
  return <div className="wm-trade-tag-groups">
    <header><button type="button" className="fxa-button" disabled={catalog.status!=='ready' || pending} onClick={event=>{setAnchor(event.currentTarget);setError('')}}><ChartIcon name="order"/>{t('Nhóm nhãn')}</button><button type="button" className="fxa-button fxa-icon-button" aria-label={t('Tìm nhóm hoặc nhãn')} aria-expanded={search!==null} onClick={()=>setSearch(search===null?'':null)}><ChartIcon name="search"/></button></header>
    {search!==null && <SearchInput autoFocus type="search" aria-label={t('Tìm nhóm hoặc nhãn')} value={search} onChange={event=>setSearch(event.target.value)}/>}
    {catalog.status==='loading' && <p role="status">{t('Đang đọc nhãn…')}</p>}
    {catalog.status==='error'?<><p role="alert">{t('Không tải được nhãn.')}</p><button className="fxa-button" onClick={catalog.refresh}>{t('Thử lại')}</button></>:groups.filter(group=>matchesSearch(group.name,search || '') || catalog.items.some(item=>(item.group_id || '')===group.id && matchesSearch(item.name,search || ''))).map(group=><div className="wm-trade-tag-group" key={group.id}><span><ChartIcon name="tag"/>{group.name}</span><TradeLabelCell workspace={workspace} session={session} row={row} catalog={catalog} groupId={group.id} placeholder={t('Thêm nhãn vào {name}',{name:group.name})} className="wm-trade-group-choice" onChanged={onChanged}/></div>)}
    {catalog.status==='ready' && !groups.length && <p>{t('Chưa có nhóm nhãn')}</p>}
    {anchor && <LegacyPopover anchor={anchor} label={t('Thêm nhóm nhãn')} role="dialog" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={()=>{if(!pending)setAnchor(null)}}><form className="wm-trade-group-create" onSubmit={create}><label>{t('Tên nhóm')}<input autoFocus value={name} maxLength={64} disabled={pending || uncertain} onChange={event=>setName(event.target.value)}/></label><button className="fxa-button" type="submit" disabled={pending || uncertain || !name.trim()}>{t(pending?'Đang lưu…':'Thêm nhóm')}</button>{error && <p role="alert">{error}</p>}{uncertain && <button type="button" className="fxa-button" onClick={()=>{catalog.refresh();setUncertain(false);setAnchor(null)}}>{t('Đọc lại dữ liệu')}</button>}</form></LegacyPopover>}
  </div>
}
