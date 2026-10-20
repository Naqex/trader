import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './LegacyModal.css'

const modalStack = []
let background
function syncModals() {
  modalStack.forEach((panel, index) => {
    panel.parentElement.inert = index !== modalStack.length - 1
    panel.parentElement.style.zIndex = `calc(var(--wm-layer-modal, 11000) + ${index})`
  })
}

export default function LegacyModal({ theme, label, onClose, children, className = '', overlayClassName = '', headerActions, closeLabel = 'Đóng' }) {
  const { t } = useTestingLocale()
  const panelRef = useRef(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const opener = document.activeElement
    if (!modalStack.length) {
      const app = document.querySelector('.fx-app')
      background = { app, inert: app?.inert, overflow: document.body.style.overflow }
      if (app) app.inert = true
      document.body.style.overflow = 'hidden'
    }
    modalStack.push(panel)
    syncModals()
    const focusable = () => [...panel.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],summary,[tabindex]')].filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert]') && node.getClientRects().length)
    const initial = focusable()[0] || panel
    initial.focus({ preventScroll: true })
    const keyboard = event => {
      if (modalStack.at(-1) !== panel || event.defaultPrevented) return
      if (event.key === 'Escape' && event.target.closest?.('[popover]:popover-open')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const nodes = focusable(), first = nodes[0], last = nodes.at(-1)
      if (!first) { event.preventDefault(); panel.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      const wasTop = modalStack.at(-1) === panel
      modalStack.splice(modalStack.indexOf(panel), 1)
      syncModals()
      if (!modalStack.length) {
        if (background.app) background.app.inert = background.inert
        document.body.style.overflow = background.overflow
        background = undefined
      }
      if (wasTop && opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className={`legacy-modal-overlay wm-ui-portal ${overlayClassName} ${theme === 'light' ? 'is-light' : ''}`} data-theme={theme} role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) closeRef.current() }}>
      <section ref={panelRef} className={`legacy-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header><h2 id={titleId}>{label}</h2>{headerActions}<button type="button" className="wm-dialog-close" aria-label={t(closeLabel)} onClick={() => closeRef.current()}><ChartIcon name="close" /></button></header>
        {children}
      </section>
    </div>,
    document.body,
  )
}
