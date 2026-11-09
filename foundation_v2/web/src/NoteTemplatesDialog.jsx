import { useEffect, useId, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import NoteBlockEditor from './NoteBlockEditor.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { builtinNoteTemplates, TEMPLATE_CONTEXTS } from './noteTemplates.js'
import { templateAdapter } from './noteTemplatesApi.js'
import { documentText, noteDocument } from './noteDocument.js'
import { displayDate } from './dateFormat.js'
import useAutosave, { AutosaveBoundaryContext, AutosaveStatus, useAutosaveBoundary } from './useAutosave.jsx'
import ConfirmationDialog from './ConfirmationDialog.jsx'

const CONTEXT_LABELS={'testing-trades':'Testing Trades','live-trades':'Live Trades','live-notes':'Live Notes'}

function EditableTemplate({workspace,template,onSaved}) {
  const {t}=useTestingLocale()
  const save=useAutosave({identity:JSON.stringify(['note-template',workspace,template.id]),initialValue:{name:template.name,document:template.document},adapter:templateAdapter(workspace,template.id,onSaved)})
  const disabled=!save.ready || save.phase==='conflict'
  return <article className="wm-note-template-edit">
    <input className="wm-note-template-title" aria-label={t('Tên mẫu')} maxLength={160} value={save.value.name} disabled={disabled} onChange={event=>save.change({...save.value,name:event.target.value})} onBlur={()=>void save.flush()}/>
    {save.ready && <NoteBlockEditor workspace={workspace} templatesEnabled={false} label={t('Nội dung mẫu')} value={{text:documentText(save.value.document.blocks),document:save.value.document}} onChange={value=>save.change({...save.value,document:value.document})} onBlur={()=>void save.flush()} disabled={disabled}/>}
    <AutosaveStatus save={save}/>
  </article>
}

export default function NoteTemplatesDialog({workspace,library,onClose,onApply,context='testing-trades',bulkSelectionCount=0}) {
  const {t,language,timezone}=useTestingLocale(), id=useId(), dialog=useRef(null)
  const [search,setSearch]=useState(''),[selectedId,setSelectedId]=useState('beginner'),[menu,setMenu]=useState(null)
  const [deleting,setDeleting]=useState(null)
  const {boundary,requestClose,active,closing}=useAutosaveBoundary(onClose)
  const items=[...builtinNoteTemplates(language),...library.items.map(item=>({...item,blocks:item.document.blocks}))]
  const selected=items.find(item=>item.id===selectedId) || items[0]
  const favorites=library.preferences?.favorites || [],defaults=library.preferences?.defaults || {}
  const disabled=library.status!=='ready' || library.pending || library.uncertain || closing
  const flush=async()=>!active || active.flush({drain:true})
  useEffect(()=>{
    const opener=document.activeElement,node=dialog.current
    node.showModal()
    return ()=>{node.close();if(opener?.isConnected)opener.focus({preventScroll:true})}
  },[])
  const choose=async item=>{if(await flush()){setSelectedId(item.id);setMenu(null)}}
  const create=async duplicate=>{
    if(disabled || !await flush())return
    const current=selected.builtin?null:active?.getSnapshot()
    const result=await library.mutate({action:'create',name:duplicate?`${current?.value.name || selected.name} ${t('(bản sao)')}`.slice(0,160):t('Mẫu mới'),document:duplicate?(current?.value.document || selected.document):noteDocument([{type:'paragraph',content:''}])})
    if(result){setSearch('');setSelectedId(result.saved_id);setMenu(null)}
  }
  const preferences=async patch=>{
    if(!await flush())return
    return library.mutate({action:'preferences',expected_revision:library.preferences.revision,favorites,defaults,...patch})
  }
  const apply=async replace=>{
    if(!onApply || !await flush())return
    const blocks=selected.builtin?selected.blocks:active?.getSnapshot().value.document.blocks || selected.blocks
    onApply(structuredClone(blocks),replace);onClose()
  }
  const deleteTemplate=async()=>{
    if(disabled || !deleting)return
    const result=await library.mutate({action:'delete',id:deleting.id,expected_revision:deleting.revision})
    if(result){setDeleting(null);setSelectedId('beginner');dialog.current?.querySelector('.wm-note-template-list button')?.focus({preventScroll:true})}
  }
  const filtered=items.filter(item=>item.name.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language)))
  const row=item=><button type="button" key={item.id} className={selected.id===item.id?'is-selected':''} aria-pressed={selected.id===item.id} onClick={()=>void choose(item)}><ChartIcon name={favorites.includes(item.id)?'star':'document'} fill={favorites.includes(item.id)?'currentColor':'none'} className={favorites.includes(item.id)?'is-favorite':''}/><span>{item.name}</span>{item.builtin && <small>N</small>}</button>
  return <AutosaveBoundaryContext.Provider value={boundary}><dialog ref={dialog} className="wm-note-templates" aria-labelledby={id} data-theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onCancel={event=>{event.preventDefault();event.stopPropagation();if(menu)setMenu(null);else void requestClose()}} onKeyDown={event=>{
    event.stopPropagation()
    if(event.key==='Escape'){event.preventDefault();if(menu)setMenu(null);else void requestClose()}
  }} onClick={event=>{if(event.target===event.currentTarget){const b=event.currentTarget.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)void requestClose()}}}>
    <header><h2 id={id}>{t('Templates')}</h2><button type="button" className="wm-dialog-close" aria-label={t('Đóng mẫu ghi chú')} disabled={closing} onClick={()=>void requestClose()}><ChartIcon name="close"/></button></header>
    <div className="wm-note-template-body">
      <div className="wm-note-template-search"><ChartIcon name="search"/><input type="search" aria-label={t('Tìm mẫu ghi chú')} placeholder={t('Tìm mẫu ghi chú')} value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div className="wm-note-template-meta"><div className="wm-note-template-info">{selected.builtin?<span className="wm-note-template-locked"><ChartIcon name="lock"/>{t('Mẫu Naqex · nhân bản để sửa')}</span>:<span>{t('Sửa lần cuối')} <time dateTime={selected.updated_at_utc}>{displayDate(selected.updated_at_utc,{timeStyle:'short',timeZone:timezone})}</time></span>}</div><div className="wm-note-template-actions">
        <button type="button" className="wm-button is-icon" aria-label={t('Yêu thích mẫu')} data-tooltip={t('Yêu thích mẫu')} aria-pressed={favorites.includes(selected.id)} disabled={disabled} onClick={()=>preferences({favorites:favorites.includes(selected.id)?favorites.filter(id=>id!==selected.id):[...favorites,selected.id]})}><ChartIcon name="star" fill={favorites.includes(selected.id)?'currentColor':'none'}/></button>
        <button type="button" className="wm-button is-icon" aria-label={t('Nhân bản mẫu')} data-tooltip={t('Nhân bản mẫu')} disabled={disabled} onClick={()=>void create(true)}><ChartIcon name="copy"/></button>
        {!selected.builtin && <button type="button" className="wm-button is-icon" aria-label={t('Xóa mẫu')} data-tooltip={t('Xóa mẫu')} disabled={disabled} onClick={async()=>{if(await flush())setDeleting({id:selected.id,revision:active?.getSnapshot().record?.revision || selected.revision})}}><ChartIcon name="trash"/></button>}
      </div></div>
      <aside>
        <div className="wm-note-template-list" role="group" aria-label={t('Mẫu ghi chú')}>
          {filtered.some(item=>favorites.includes(item.id)) && <><h3>{t('Yêu thích')}</h3>{filtered.filter(item=>favorites.includes(item.id)).map(row)}</>}
          <h3>{t('Tất cả mẫu')}</h3>{filtered.filter(item=>!favorites.includes(item.id)).map(row)}
          {!filtered.length && <p>{t('Không tìm thấy mẫu.')}</p>}
        </div>
        <button type="button" className="fxa-button wm-note-new-template" disabled={disabled} onClick={()=>void create(false)}><ChartIcon name="order"/>{t('New template')}</button>
      </aside>
      <section className="wm-note-template-preview" aria-label={t('Xem trước mẫu')}>
        {selected.builtin?<article><h2>{selected.name}</h2>{selected.blocks.map((block,index)=>block.type==='heading'?<h3 key={index}>{block.content}</h3>:<p className="wm-template-bullet" key={index}>{block.content}</p>)}</article>:<EditableTemplate key={selected.id} workspace={workspace} template={selected} onSaved={library.accept}/>}
      </section>
    </div>
    {(library.status==='loading' || library.error) && <div className="wm-note-library-state" role={library.error?'alert':'status'}>{t(library.error?'Không đọc hoặc lưu được thư viện mẫu. Đọc lại trước khi tiếp tục.':'Đang đọc thư viện mẫu…')}{library.error && <button type="button" className="fxa-button" onClick={async()=>{if(await flush())library.refresh()}}>{t('Đọc lại dữ liệu')}</button>}</div>}
    <footer><div className="wm-note-template-default"><button type="button" className="fxa-button" disabled={disabled} aria-expanded={menu==='default'} aria-haspopup="menu" onClick={()=>setMenu(menu==='default'?null:'default')}>{t('Set as default')}<ChartIcon name="down"/>
      </button>{menu==='default' && <div role="menu" aria-label={t('Mẫu mặc định')}>{TEMPLATE_CONTEXTS.map(context=><button type="button" role="menuitemcheckbox" aria-checked={defaults[context]===selected.id} key={context} disabled={disabled} onClick={()=>{const next={...defaults};if(next[context]===selected.id)delete next[context];else next[context]=selected.id;void preferences({defaults:next})}}><span className="wm-template-checkbox" aria-hidden="true">{defaults[context]===selected.id?'✓':''}</span><span>{t(CONTEXT_LABELS[context])}<small>{items.find(item=>item.id===defaults[context])?.name || t('Chưa đặt mẫu mặc định')}</small></span></button>)}</div>}</div>
      <button type="button" className="fxa-button wm-note-template-cancel" disabled={closing} onClick={()=>void requestClose()}>{t('Cancel')}</button>{onApply && !bulkSelectionCount && <button type="button" className="fxa-button is-primary wm-note-template-apply" disabled={disabled} data-tooltip={t(context==='live-notes'?'Áp dụng mẫu vào ghi chú này':'Áp dụng mẫu vào giao dịch này')} onClick={()=>void apply(false)}>{t('Apply')}</button>}
    </footer>
    {deleting && <ConfirmationDialog title={t('Xóa mẫu')} confirmLabel="Xóa mẫu" pending={Boolean(library.pending)} blocked={disabled} error={library.error ? t('Không đọc hoặc lưu được thư viện mẫu. Đọc lại trước khi tiếp tục.') : undefined} onClose={()=>setDeleting(null)} onConfirm={()=>void deleteTemplate()}><p>{t('Xóa mẫu ghi chú này?')}</p></ConfirmationDialog>}
  </dialog></AutosaveBoundaryContext.Provider>
}
