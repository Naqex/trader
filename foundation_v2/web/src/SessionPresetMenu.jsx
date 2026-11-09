import AppIcon from './AppIcon.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { FilterIcon, SelectChevron } from './FxSelect.jsx'
import ConfirmationDialog from './ConfirmationDialog.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import TestingIcon from './TestingIcon.jsx'
import './session-actions.css'
import './session-presets.css'

export default function SessionPresetMenu({ items, selected, disabled, onApply, onCreate, onEdit, onDelete }) {
  const { t } = useTestingLocale(), id = useId(), trigger = useRef(null)
  const [open,setOpen] = useState(false), [deleting,setDeleting] = useState(null), [problem,setProblem] = useState('')
  const [deletingPending,setDeletingPending] = useState(false)
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const active = items.find(item => item.id === selected)
  return <div className="session-presets fx-select">
    <button ref={trigger} type="button" className={`session-preset-trigger fx-select-trigger${active ? ' is-selected' : ''}`} disabled={disabled} aria-label={t('Preset phiên')} aria-expanded={open} aria-haspopup="dialog" aria-controls={id} onClick={() => setOpen(!open)}><span>{active?.name || t(items.length ? 'Preset' : 'Chưa có preset')}</span><SelectChevron /></button>
    {open && <LegacyPopover anchor={trigger.current} id={id} role="dialog" label={t('Preset phiên')} className="session-preset-menu" theme={trigger.current?.closest('.fx-app')?.dataset.theme || 'dark'} onClose={() => setOpen(false)}>
      <div className="session-preset-list">{items.map(item => <div className="session-preset-row" key={item.id}>
        <button type="button" className="session-preset-apply" aria-pressed={selected === item.id} disabled={disabled} onClick={() => {onApply(item);close()}}><span>{item.name}</span>{selected === item.id && <span aria-hidden="true"><AppIcon name="check" size={16} /></span>}</button>
        <button type="button" className="session-preset-icon" aria-label={t('Sửa preset {name}',{name:item.name})} data-tooltip={t('Sửa preset')} disabled={disabled} onClick={() => {setOpen(false);onEdit(item)}}><FilterIcon kind="edit" /></button>
        <button type="button" className="session-preset-icon" aria-label={t('Xóa preset {name}',{name:item.name})} data-tooltip={t('Xóa preset')} disabled={disabled} onClick={() => {setProblem('');setOpen(false);setDeleting(item)}}><TestingIcon kind="delete" size={16} /></button>
      </div>)}</div>
      <button type="button" className="session-preset-create fx-menu-action" disabled={disabled} onClick={() => {setOpen(false);onCreate()}}><TestingIcon kind="plus" size={16} /><span>{t('Tạo preset')}</span></button>
    </LegacyPopover>}
    {deleting && <ConfirmationDialog title={t('Xóa preset “{name}”?',{name:deleting.name})} confirmLabel="Xóa preset" cancelLabel="Không xóa" pending={deletingPending} error={problem ? t(problem) : undefined} returnFocus={trigger.current} onClose={() => setDeleting(null)} onConfirm={async () => {setDeletingPending(true);try {await onDelete(deleting);setDeleting(null)} catch(error) {setProblem(error.outcomeKnown === false ? 'Chưa xác nhận preset đã xóa. Tải lại trang để kiểm tra.' : error.message)} finally {setDeletingPending(false)}}}><p>{t('Preset sẽ bị xóa. Các phiên đã tạo vẫn giữ nguyên.')}</p></ConfirmationDialog>}
  </div>
}
