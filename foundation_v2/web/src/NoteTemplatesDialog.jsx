import { useEffect, useId, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { NOTE_TEMPLATES } from './noteTemplates.js'

export default function NoteTemplatesDialog({ onClose, onApply }) {
  const { t } = useTestingLocale(), id = useId(), dialog = useRef(null)
  const [search,setSearch] = useState(''), [selected,setSelected] = useState(NOTE_TEMPLATES[0])
  const [favorites,setFavorites] = useState(NOTE_TEMPLATES.map(item=>item.id)), [applyMenu,setApplyMenu] = useState(false)
  useEffect(()=>{
    const opener=document.activeElement, node=dialog.current
    node.showModal()
    return ()=>{node.close();if(opener?.isConnected)opener.focus({preventScroll:true})}
  },[])
  const apply = replace => { onApply(structuredClone(selected.blocks),replace); onClose() }
  return <dialog ref={dialog} className="wm-note-templates" aria-labelledby={id} data-theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose()}} onKeyDown={event=>{
    event.stopPropagation()
    if(event.key==='Escape'){event.preventDefault();if(applyMenu)setApplyMenu(false);else onClose()}
  }} onClick={event=>{if(event.target===event.currentTarget){const b=event.currentTarget.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)onClose()}}}>
    <header><h2 id={id}>{t('Templates')}</h2><button type="button" className="wm-dialog-close" aria-label={t('Đóng mẫu ghi chú')} onClick={onClose}><ChartIcon name="close"/></button></header>
    <div className="wm-note-template-body">
      <aside><div className="wm-note-template-search"><input type="search" aria-label={t('Tìm mẫu ghi chú')} placeholder={t('Search')} value={search} onChange={event=>setSearch(event.target.value)}/></div>
        <div className="wm-note-template-list" role="group" aria-label={t('Mẫu ghi chú')}><h3>{t('Yêu thích')}</h3>
          {NOTE_TEMPLATES.filter(item=>item.name.toLowerCase().includes(search.toLowerCase())).map(item=><button type="button" key={item.id} className={selected.id===item.id?'is-selected':''} aria-pressed={selected.id===item.id} onClick={()=>setSelected(item)}><span className={favorites.includes(item.id)?'is-favorite':''} aria-hidden="true">★</span><span>{item.name}</span><small>Naqex</small></button>)}
          {!NOTE_TEMPLATES.some(item=>item.name.toLowerCase().includes(search.toLowerCase())) && <p>{t('Không tìm thấy mẫu.')}</p>}
        </div>
        <button type="button" className="fxa-button wm-note-new-template" disabled title={t('Tạo mẫu sẽ được bổ sung sau.')}>＋ {t('New template')}</button>
      </aside>
      <section className="wm-note-template-preview" aria-label={t('Xem trước mẫu')}>
        <div className="wm-note-template-meta"><span>♧ {t('Mẫu Naqex · nhân bản để sửa')}</span><div><button type="button" className="wm-button is-icon" aria-label={t('Yêu thích mẫu')} aria-pressed={favorites.includes(selected.id)} onClick={()=>setFavorites(items=>items.includes(selected.id)?items.filter(id=>id!==selected.id):[...items,selected.id])}>★</button><button type="button" className="wm-button is-icon" aria-label={t('Nhân bản mẫu')} disabled title={t('Tạo mẫu sẽ được bổ sung sau.')}><ChartIcon name="copy"/></button></div></div>
        <article><h2>{selected.name}</h2>{selected.blocks.map((block,index)=>block.type==='heading'?<h3 key={index}>{block.content}</h3>:block.type==='bulletListItem'?<p className="wm-template-bullet" key={index}>• {block.content}</p>:block.type==='checkListItem'?<p key={index}>☐ {block.content}</p>:<p key={index}>{block.content}</p>)}</article>
      </section>
    </div>
    <footer><button type="button" className="fxa-button" disabled title={t('Tùy chọn mặc định sẽ được bổ sung sau.')}>{t('Set as default')} ⌃</button><div><button type="button" className="fxa-button" onClick={onClose}>{t('Cancel')}</button><div className="wm-note-template-apply"><button type="button" className="fxa-button is-primary" aria-expanded={applyMenu} aria-haspopup="menu" onClick={()=>setApplyMenu(value=>!value)}>{t('Apply to')} ⌃</button>{applyMenu && <div role="menu" aria-label={t('Áp dụng mẫu')}><button type="button" role="menuitem" onClick={()=>apply(false)}>{t('Chèn vào ghi chú')}</button><button type="button" role="menuitem" onClick={()=>{if(window.confirm(t('Thay toàn bộ nội dung ghi chú bằng mẫu này?')))apply(true)}}>{t('Thay nội dung ghi chú')}</button></div>}</div></div></footer>
  </dialog>
}
