import { useEffect, useId, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { FilterIcon, SelectChevron } from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import './session-actions.css'
import './session-presets.css'

export default function SessionPresetMenu({ items, selected, disabled, onApply, onCreate, onEdit, onDelete }) {
  const { t } = useTestingLocale(), id = useId(), root = useRef(null), trigger = useRef(null), popup = useRef(null)
  const [open,setOpen] = useState(false), [deleting,setDeleting] = useState(null), [problem,setProblem] = useState('')
  const [deletingPending,setDeletingPending] = useState(false)
  const confirm = useRef(null), opener = useRef(null)
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    popup.current?.querySelector('button')?.focus()
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown',outside)
    return () => document.removeEventListener('pointerdown',outside)
  },[open])
  useEffect(() => {
    if (!deleting) return
    const element = confirm.current
    element.showModal(); element.querySelector('button')?.focus()
    return () => { element.close(); if(opener.current?.isConnected) opener.current.focus(); else trigger.current?.focus() }
  },[deleting])
  const active = items.find(item => item.id === selected)
  return <div className="session-presets" ref={root} onKeyDown={event => {if(event.key === 'Escape' && open && !deleting) {event.preventDefault();event.stopPropagation();close()}}}>
    <button ref={trigger} type="button" className={`session-preset-trigger${active ? ' is-selected' : ''}`} disabled={disabled} aria-label={t('Preset phiên')} aria-expanded={open} aria-haspopup="dialog" aria-controls={id} onClick={() => setOpen(!open)}><span>{active?.name || t(items.length ? 'Preset' : 'Chưa có preset')}</span><SelectChevron /></button>
    {open && <div ref={popup} id={id} className="session-preset-menu fx-select-menu" role="dialog" aria-label={t('Preset phiên')}>
      <div className="session-preset-list">{items.map(item => <div className="session-preset-row" key={item.id}>
        <button type="button" className="session-preset-apply" aria-pressed={selected === item.id} onClick={() => {onApply(item);close()}}><span>{item.name}</span>{selected === item.id && <span aria-hidden="true">✓</span>}</button>
        <button type="button" className="session-preset-icon" aria-label={t('Sửa preset {name}',{name:item.name})} title={t('Sửa preset')} onClick={() => {setOpen(false);onEdit(item)}}><FilterIcon kind="edit" /></button>
        <button type="button" className="session-preset-icon" aria-label={t('Xóa preset {name}',{name:item.name})} title={t('Xóa preset')} onClick={event => {opener.current=event.currentTarget;setProblem('');setDeleting(item)}}><TestingIcon kind="delete" size={16} /></button>
      </div>)}</div>
      <button type="button" className="session-preset-create" onClick={() => {setOpen(false);onCreate()}}>+ {t('Tạo preset')}</button>
    </div>}
    {deleting && <dialog ref={confirm} className="fx-dashboard-dialog fxs-action-dialog session-preset-confirm" aria-labelledby={`${id}-delete`} onCancel={event => {event.preventDefault();event.stopPropagation();if(!deletingPending) setDeleting(null)}}>
      <h2 id={`${id}-delete`}>{t('Xóa preset “{name}”?',{name:deleting.name})}</h2>
      <p>{t('Preset sẽ bị xóa. Các phiên đã tạo vẫn giữ nguyên.')}</p>
      {problem && <p role="alert">{t(problem)}</p>}
      <footer><button type="button" className="fxr-button fxr-button-secondary" disabled={deletingPending} onClick={() => setDeleting(null)}>{t('Không xóa')}</button><button type="button" className="fxr-button fxs-delete-confirm is-danger" disabled={deletingPending} onClick={async () => {setDeletingPending(true);try {await onDelete(deleting);setDeleting(null)} catch(error) {setProblem(error.outcomeKnown === false ? 'Chưa xác nhận preset đã xóa. Tải lại trang để kiểm tra.' : error.message)} finally {setDeletingPending(false)}}}>{t('Xóa preset')}</button></footer>
    </dialog>}
  </div>
}
