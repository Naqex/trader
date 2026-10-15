import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import ChartIcon from './ChartIcon.jsx'

export default function LegacyModal({ theme, label, onClose, children, className = '' }) {
  const panelRef = useRef(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const opener = document.activeElement
    const focusable = () => [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')].filter(node => node.getClientRects().length)
    focusable()[0]?.focus()
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const nodes = focusable(), first = nodes[0], last = nodes.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard, true)
    const app = document.querySelector('.fx-app'), wasInert = app?.inert
    if (app) app.inert = true
    return () => {
      document.removeEventListener('keydown', keyboard, true)
      if (app) app.inert = wasInert
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className={`legacy-modal-overlay ${theme === 'light' ? 'is-light' : ''}`} role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) closeRef.current() }}>
      <section ref={panelRef} className={`legacy-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header><h2 id={titleId}>{label}</h2><button type="button" className="wm-dialog-close" aria-label="Đóng" onClick={() => closeRef.current()}><ChartIcon name="close" /></button></header>
        {children}
      </section>
    </div>,
    document.body,
  )
}
