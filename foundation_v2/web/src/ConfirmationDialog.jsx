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
    if (node && !node.open) node.showModal()
    cancel.current?.focus({ preventScroll: true })
    return () => { if (node?.open) node.close(); if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (pending && dialog.current?.open) dialog.current.focus({ preventScroll: true })
  }, [pending])
  const dismiss = () => { if (!pending) close.current() }
  const handleKeyDown = event => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.nativeEvent?.stopPropagation?.()
      return
    }
    if (event.key !== 'Tab') return
    const node = dialog.current
    if (!node) return
    const nodes = [...node.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],summary,[tabindex]')]
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length)
    const first = nodes[0], last = nodes.at(-1)
    if (!first) { event.preventDefault(); node.focus({ preventScroll: true }); return }
    if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }
  return <dialog ref={dialog} tabIndex={-1} className="wm-confirmation-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss() }} onKeyDown={handleKeyDown} onClick={event => {
    if (event.detail === 0 || event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss()
  }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" className="wm-dialog-close" aria-label={t('Đóng')} disabled={pending} onClick={dismiss}><AppIcon name="close" size={16}/></button></header>
    <div id={descriptionId} className="wm-confirmation-copy">{children}</div>
    {error && <p className="wm-confirmation-error" role="alert">{error}</p>}
    <footer><button ref={cancel} type="button" className="wm-button" disabled={pending} onClick={dismiss}>{t(cancelLabel)}</button><button type="button" className="wm-button is-danger" disabled={pending || blocked} onClick={onConfirm}>{t(pending ? 'Đang xử lý…' : confirmLabel)}</button></footer>
  </dialog>
}
