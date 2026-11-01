import { useEffect, useId, useRef } from 'react'
import AppIcon from './AppIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './confirmation-dialog.css'

// Native top-layer dialogs also work inside an existing native drawer/dialog.
export default function ConfirmationDialog({ title, children, confirmLabel, cancelLabel = 'Hủy', pending = false, blocked = false, error, onConfirm, onClose, returnFocus }) {
  const { t } = useTestingLocale(), titleId = useId(), descriptionId = useId()
  const dialog = useRef(null), cancel = useRef(null), close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const node = dialog.current, opener = returnFocus || document.activeElement
    node.showModal()
    cancel.current?.focus({ preventScroll: true })
    return () => { node.close(); if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true }) }
  }, [])
  const dismiss = () => { if (!pending) close.current() }
  return <dialog ref={dialog} className="wm-confirmation-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss() }} onKeyDown={event => event.stopPropagation()} onClick={event => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss()
  }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" className="wm-dialog-close" aria-label={t('Đóng')} disabled={pending} onClick={dismiss}><AppIcon name="close" size={16}/></button></header>
    <div id={descriptionId} className="wm-confirmation-copy">{children}</div>
    {error && <p className="wm-confirmation-error" role="alert">{error}</p>}
    <footer><button ref={cancel} type="button" className="wm-button" disabled={pending} onClick={dismiss}>{t(cancelLabel)}</button><button type="button" className="wm-button is-danger" disabled={pending || blocked} onClick={onConfirm}>{t(pending ? 'Đang xử lý…' : confirmLabel)}</button></footer>
  </dialog>
}
