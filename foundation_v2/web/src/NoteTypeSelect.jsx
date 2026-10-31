import { useRef, useState } from 'react'
import LegacyPopover from './LegacyPopover.jsx'
import AppIcon from './AppIcon.jsx'
import SearchInput from './SearchInput.jsx'
import useTradeLabelOrder from './useTradeLabelOrder.js'
import { LABEL_COLORS } from './TradeLabelCell.jsx'
import { useNoteTypes, noteTypeLabel } from './useNoteTypes.js'
import { useTestingLocale } from './testingLocale.jsx'
import { NOTE_TYPE_DEFINITIONS } from './liveNoteModel.js'

const colorNames={green:'Xanh lá',blue:'Xanh dương',orange:'Cam',red:'Đỏ',purple:'Tím',cyan:'Xanh nhạt',gray:'Xám'}
export default function NoteTypeSelect({ value, onChange, disabled=false, workspace, label='Loại ghi chú' }) {
  const {t}=useTestingLocale(),catalog=useNoteTypes(workspace)
  const [anchor,setAnchor]=useState(null),[search,setSearch]=useState(''),[editing,setEditing]=useState(null),[editAnchor,setEditAnchor]=useState(null),[name,setName]=useState(''),[confirm,setConfirm]=useState(false)
  const drag=useRef(null)
  const order=useTradeLabelOrder(workspace,catalog.items,'note-types')
  const builtIn=id=>NOTE_TYPE_DEFINITIONS.some(item=>item.value===id)
  const labelFor=item=>noteTypeLabel(item,t)
  const selected=catalog.items.find(item=>item.id===value)
  const options=order.items.filter(item=>!item.archived && labelFor(item).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const locked=disabled||catalog.pending||catalog.uncertain||catalog.status!=='ready'||Boolean(catalog.error)
  const theme=document.querySelector('.fx-app')?.dataset.theme || 'dark'
  const close=()=>{setAnchor(null);setEditing(null);setSearch('');setConfirm(false)}
  const choose=item=>{onChange(item.id);close()}
  const update=async patch=>{
    const focused=document.activeElement
    const items=catalog.items.map(item=>item.id===editing.id?{...item,...patch}:item)
    if(await catalog.save(items)){
      setEditing({...editing,...patch})
      // Pending controls lose focus when disabled; return it after the update.
      requestAnimationFrame(()=>{const target=focused?.isConnected&&!focused.disabled?focused:editAnchor?.isConnected&&!editAnchor.disabled?editAnchor:anchor;target?.focus({preventScroll:true})})
      return true
    }return false
  }
  const create=async()=>{
    const text=search.trim();if(!text||locked||catalog.items.some(item=>!item.archived&&labelFor(item).toLocaleLowerCase()===text.toLocaleLowerCase()))return
    const item={id:`custom_${crypto.randomUUID()}`,name:text,color:'cyan',archived:false}
    if(await catalog.save([...catalog.items,item]))choose(item)
  }
  const beginEdit=(item,anchor)=>{setEditing(item);setEditAnchor(anchor);setName(labelFor(item));setConfirm(false)}
  const editedName=()=>name.trim()===labelFor(editing)?editing.name:name.trim()
  return <>
    <button type="button" className="wm-note-type-trigger" aria-label={t(label)} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} disabled={disabled} onClick={event=>setAnchor(event.currentTarget)}><span className="wm-trade-label" data-color={selected?.color || 'gray'}>{selected?labelFor(selected):t('Chọn loại ghi chú')}</span></button>
    {anchor && <LegacyPopover anchor={anchor} theme={theme} role="dialog" label={t(label)} className="wm-label-popup wm-note-type-menu" maxWidth={365} onClose={close}>
      <div className="wm-label-options" role="listbox" aria-label={t(label)}>{options.map((item,index)=><div key={item.id} className="wm-label-option" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(drag.current)order.move(drag.current,item.id,true);drag.current=null}}>
        <button type="button" className="wm-label-grip" aria-label={t('Đổi thứ tự {name}',{name:labelFor(item)})} disabled={locked} draggable={!locked} onDragStart={()=>{drag.current=item.id}} onDragEnd={()=>{drag.current=null}} onKeyDown={event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();const target=options[index+(event.key==='ArrowUp'?-1:1)];if(target)order.move(item.id,target.id,event.key==='ArrowUp')}}}><AppIcon name="grip" size={14}/></button>
        <button type="button" role="option" aria-selected={item.id===value} className="wm-label-choice" disabled={locked} onClick={()=>choose(item)}><span className="wm-trade-label" data-color={item.color}>{labelFor(item)}</span></button>
        {item.id===value && <AppIcon name="check" size={14}/>}
        <button type="button" className="wm-label-more" aria-label={t('Sửa loại ghi chú {name}',{name:labelFor(item)})} disabled={locked} onClick={event=>beginEdit(item,event.currentTarget)}><AppIcon name="more-vertical" size={16}/></button>
      </div>)}</div>
      <SearchInput aria-label={t('Tìm hoặc tạo loại ghi chú')} placeholder={t('Tìm hoặc tạo loại ghi chú')} maxLength={64} value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void create()}}}/>
      {search.trim()&&!catalog.items.some(item=>!item.archived&&labelFor(item).toLocaleLowerCase()===search.trim().toLocaleLowerCase())&&<button type="button" className="wm-label-create" disabled={locked} onClick={create}><AppIcon name="plus" size={16}/>{t('Tạo loại ghi chú')} “{search.trim()}”</button>}
      {catalog.status==='loading'&&<p role="status">{t('Đang tải…')}</p>}
      {catalog.error&&<p role="alert">{t(catalog.error.status===409?'Danh sách vừa thay đổi. Đọc lại trước khi sửa.':'Không lưu hoặc tải được loại ghi chú. Đọc lại để kiểm tra.')}</p>}
      {catalog.error&&<button type="button" className="fxa-button" onClick={()=>{setEditing(null);catalog.refresh()}}>{t('Đọc lại dữ liệu')}</button>}
      {order.orderError&&<p role="status">{t('Không lưu được thứ tự vào trình duyệt; thứ tự chỉ giữ trong phiên này.')}</p>}
      {editing&&editAnchor&&<LegacyPopover anchor={editAnchor} theme={theme} role="dialog" placement="right-start" maxWidth={280} className="wm-label-edit-popup" label={t('Sửa loại ghi chú')} onClose={()=>setEditing(null)}><div className="wm-label-editor">
        <form onSubmit={async event=>{event.preventDefault();if(await update({name:editedName()}))setEditing(null)}}><input aria-label={t('Tên loại ghi chú')} value={name} maxLength={64} disabled={locked} onChange={event=>setName(event.target.value)} required/></form>
        <div className="wm-label-color-list" role="group" aria-label={t('Màu loại ghi chú')}>{LABEL_COLORS.map(color=><button type="button" key={color} disabled={locked||!name.trim()} aria-pressed={editing.color===color} onClick={()=>void update({color,name:editedName()})}><span className="wm-label-swatch wm-trade-label" data-color={color}/>{t(colorNames[color])}{editing.color===color&&<AppIcon name="check" size={14}/>}</button>)}</div>
        {!builtIn(editing.id)&&<div className="wm-label-delete-section">{confirm?<><p>{t('Xóa loại ghi chú này? Ghi chú đã dùng loại này vẫn được giữ.')}</p><button type="button" className="fxa-button is-danger" disabled={locked} onClick={async()=>{if(await update({archived:true})){if(value===editing.id)onChange('general');setEditing(null);requestAnimationFrame(()=>anchor?.focus({preventScroll:true}))}}}>{t('Xóa loại ghi chú')}</button><button type="button" className="fxa-button" onClick={()=>setConfirm(false)}>{t('Hủy')}</button></>:<button type="button" className="wm-label-delete-trigger" disabled={locked} onClick={()=>setConfirm(true)}><AppIcon name="trash" size={16}/>{t('Xóa loại ghi chú')}</button>}</div>}
      </div></LegacyPopover>}
    </LegacyPopover>}
  </>
}
