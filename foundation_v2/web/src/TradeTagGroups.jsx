import { useRef, useState } from 'react'
import TradeLabelCell, {labelError} from './TradeLabelCell.jsx'
import ChartIcon from './ChartIcon.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import SearchInput from './SearchInput.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import { matchesSearch } from './searchText.js'
import useTradeLabelOrder from './useTradeLabelOrder.js'
import ConfirmationDialog from './ConfirmationDialog.jsx'

export default function TradeTagGroups({workspace,session,row,catalog,onChanged}) {
  const {t}=useTestingLocale()
  const [search,setSearch]=useState(null),[popup,setPopup]=useState(null),[name,setName]=useState('')
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
  const [deleting,setDeleting]=useState(null)
  const lock=useRef(false),drag=useRef(null),[dragging,setDragging]=useState(null)
  const groups=(catalog.groups || []).filter(group=>!group.archived || catalog.items.some(item=>item.group_id===group.id && row.tags?.includes(item.name)))
  if(catalog.items.some(item=>!item.group_id) || row.tags?.some(tag=>!catalog.items.some(item=>item.name===tag)))groups.push({id:'',name:t('Chưa phân nhóm')})
  const order=useTradeLabelOrder(workspace,groups,'trade-tag-groups')
  const disabled=catalog.status!=='ready' || pending || uncertain
  const open=(anchor,group)=>{setPopup({anchor,group});setName(group?.name || '');setError('')}
  const mutate=async body=>{
    if(lock.current || disabled)return
    lock.current=true;setPending(true);setError('')
    try {
      const result=await readJson(await scopedMutation('/api/v2/trade-labels',workspace,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))
      if(result.schema_version!=='trade-labels-v1' || !Array.isArray(result.groups))throw Object.assign(new Error('invalid_label_catalog'),{uncertain:true})
      catalog.accept(result);setPopup(null);setName('');onChanged?.();return true
    }catch(problem){setError(labelError(problem,t));setUncertain(problem.outcomeKnown===false || problem.uncertain || problem.status===409);return false}
    finally{lock.current=false;setPending(false)}
  }
  const rename=event=>{
    event.preventDefault()
    const group=popup?.group
    if(group?.id && name.trim()===group.name){setPopup(null);return}
    void mutate(group?.id?{action:'update_group',id:group.id,expected_revision:group.revision,name:name.trim()}:{action:'create_group',name:name.trim(),capture_ungrouped:Boolean(group)})
  }
  const move=(group,offset)=>{
    const index=order.items.findIndex(item=>item.id===group.id),target=order.items[index+offset]
    if(target)order.move(group.id,target.id,offset<0)
    setPopup(null)
  }
  const duplicate=()=>{
    const group=popup.group,base=group.name.slice(0,45)
    let index=1
    while(groups.some(item=>item.name.toLocaleLowerCase()===`${base} (${index})`.toLocaleLowerCase()))index++
    void mutate({action:'duplicate_group',id:group.id || null,expected_revision:group.revision || null,name:`${base} (${index})`})
  }
  const cancelDrag=()=>{drag.current=null;setDragging(null)}
  return <div className="wm-trade-tag-groups">
    <header><button type="button" className="fxa-button" disabled={disabled} onClick={event=>open(event.currentTarget,null)}><ChartIcon name="order"/>{t('Tag groups')}</button><button type="button" className="fxa-button fxa-icon-button" aria-label={t('Tìm nhóm hoặc nhãn')} aria-expanded={search!==null} onClick={()=>setSearch(search===null?'':null)}><ChartIcon name="search"/></button></header>
    {search!==null && <SearchInput autoFocus type="search" aria-label={t('Tìm nhóm hoặc nhãn')} value={search} onChange={event=>setSearch(event.target.value)}/>}
    {catalog.status==='loading' && <p role="status">{t('Đang đọc nhãn…')}</p>}
    {catalog.status==='error'?<><p role="alert">{t('Không tải được nhãn.')}</p><button className="fxa-button" onClick={catalog.refresh}>{t('Thử lại')}</button></>:order.items.filter(group=>matchesSearch(group.name,search || '') || catalog.items.some(item=>(item.group_id || '')===group.id && matchesSearch(item.name,search || ''))).map(group=><div className="wm-trade-tag-group" data-group-id={group.id} data-dragging={dragging===group.id || undefined} key={group.id}>
      <button type="button" className="wm-button is-icon wm-group-grip" aria-label={t('Di chuyển nhóm {name}',{name:group.name})} disabled={disabled || Boolean(search)} data-tooltip={t('Kéo để đổi thứ tự; dùng phím lên hoặc xuống')} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:group.id,start:event.clientY,target:null}}} onPointerMove={event=>{
        if(!drag.current || Math.abs(event.clientY-drag.current.start)<4 && dragging===null)return
        setDragging(group.id)
        const root=event.currentTarget.closest('.wm-trade-tag-groups'),bounds=root.getBoundingClientRect()
        const target=[...root.querySelectorAll('[data-group-id]')].find(node=>{const box=node.getBoundingClientRect();return event.clientY>=box.top && event.clientY<=box.bottom && event.clientX>=bounds.left && event.clientX<=bounds.right})
        drag.current.target=target?{id:target.dataset.groupId,before:event.clientY<target.getBoundingClientRect().top+target.getBoundingClientRect().height/2}:null
      }} onPointerUp={()=>{if(drag.current?.target)order.move(group.id,drag.current.target.id,drag.current.target.before);cancelDrag()}} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();move(group,event.key==='ArrowUp'?-1:1)}}}><ChartIcon name="grip"/></button>
      <button type="button" className="wm-group-name" disabled={disabled || group.archived} aria-label={t('Sửa nhóm {name}',{name:group.name})} aria-expanded={Boolean(popup?.group && popup.group.id===group.id)} onClick={event=>popup?.group?.id===group.id?setPopup(null):open(event.currentTarget,group)}><ChartIcon name="tag"/>{group.name}</button>
      <TradeLabelCell workspace={workspace} session={session} row={row} catalog={catalog} groupId={group.id} placeholder={t('Thêm nhãn')} className="wm-trade-group-choice" onChanged={onChanged}/>
    </div>)}
    {order.orderError && <p role="status">{t('Không lưu được thứ tự vào trình duyệt; thứ tự chỉ giữ trong phiên này.')}</p>}
    {catalog.status==='ready' && !groups.length && <p>{t('Chưa có nhóm nhãn')}</p>}
    {popup && <LegacyPopover anchor={popup.anchor} label={t(popup.group?'Quản lý nhóm nhãn':'Thêm nhóm nhãn')} role="dialog" theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={()=>{if(!pending)setPopup(null)}}><div className="wm-trade-group-create">
      {popup.group && <div className="wm-group-menu">
        <button type="button" disabled={disabled || !popup.group.id} data-tooltip={!popup.group.id?t('Nhóm mặc định giữ các nhãn chưa phân nhóm'):undefined} onClick={()=>{setDeleting({...popup.group,returnFocus:popup.anchor});setPopup(null)}}><ChartIcon name="trash"/>{t('Xóa nhóm')}</button>
        <button type="button" disabled={disabled} onClick={duplicate}><ChartIcon name="copy"/>{t('Nhân bản nhóm')}</button>
        {[[-1,'Di chuyển lên','up'],[1,'Di chuyển xuống','down']].map(([offset,label,icon])=><button type="button" key={offset} disabled={disabled || !order.items[order.items.findIndex(item=>item.id===popup.group.id)+offset]} onClick={()=>move(popup.group,offset)}><ChartIcon name={icon}/>{t(label)}</button>)}
      </div>}
      <form onSubmit={rename}><label><span><ChartIcon name="tag"/>{t('Tên nhóm')}</span><input autoFocus value={name} maxLength={64} disabled={disabled} onChange={event=>setName(event.target.value)}/></label><button className="fxa-button" type="submit" disabled={disabled || !name.trim()}>{t(pending?'Đang lưu…':popup.group?'Lưu':'Thêm nhóm')}</button></form>
      {error && <p role="alert">{error}</p>}{uncertain && <button type="button" className="fxa-button" onClick={()=>{catalog.refresh();setUncertain(false);setPopup(null)}}>{t('Đọc lại dữ liệu')}</button>}
    </div></LegacyPopover>}
    {deleting && <ConfirmationDialog title={t('Xóa nhóm')} confirmLabel="Xóa nhóm" pending={pending} blocked={disabled} error={error} returnFocus={deleting.returnFocus} onClose={()=>setDeleting(null)} onConfirm={async()=>{if(await mutate({action:'archive_group',id:deleting.id,expected_revision:deleting.revision}))setDeleting(null)}}><p>{t('Xóa nhóm khỏi danh sách chọn trong workspace? Nhãn và lịch sử đã gắn vẫn được giữ.')}</p></ConfirmationDialog>}
    {!popup && !deleting && error && <p role="alert">{error}</p>}
    {!popup && !deleting && uncertain && <button type="button" className="fxa-button" onClick={()=>{catalog.refresh();setUncertain(false);setError('')}}>{t('Đọc lại dữ liệu')}</button>}
  </div>
}
