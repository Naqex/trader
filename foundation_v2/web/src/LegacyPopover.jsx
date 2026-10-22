import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './LegacyPopover.css'

export default function LegacyPopover({ anchor, theme, label, onClose, onAnchorLost, children, wide = false, role = 'group', id, onPointerEnter, onPointerLeave }) {
  const ref = useRef(null), closeRef = useRef(onClose), lostRef = useRef(onAnchorLost), [position, setPosition] = useState({ visibility: 'hidden' })
  closeRef.current = onClose
  lostRef.current = onAnchorLost
  useLayoutEffect(() => {
    if (!anchor?.isConnected) { (lostRef.current || closeRef.current)(); return }
    const doc = anchor.ownerDocument, view = doc.defaultView, popup = ref.current
    const place = () => {
      if (!anchor.isConnected || !anchor.getBoundingClientRect().width) { (lostRef.current || closeRef.current)(); return }
      const a = anchor.getBoundingClientRect(), p = popup.getBoundingClientRect()
      const height = Math.min(p.height, view.innerHeight - 16), width = Math.min(p.width, view.innerWidth - 16)
      setPosition({ maxWidth: view.innerWidth - 16, maxHeight: view.innerHeight - 16, left: Math.max(8, Math.min(a.right - width, view.innerWidth - width - 8)), top: Math.max(8, a.bottom + height + 4 <= view.innerHeight ? a.bottom + 4 : a.top - height - 4) })
    }
    place()
    // Placement commits before paint, but a hidden node cannot take initial focus.
    popup.style.visibility = 'visible'
    const selected = popup.querySelector('button[aria-pressed="true"]:not(:disabled),button[aria-checked="true"]:not(:disabled)')
    const initial = selected || popup.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)')
    initial?.focus({ preventScroll: true })
    const close = event => {
      if (event.type === 'keydown' && (event.defaultPrevented || event.target.closest?.('[popover]:popover-open'))) return
      if (event.type === 'pointerdown' && !popup.contains(event.target) && !anchor.contains(event.target)) closeRef.current()
      if (event.type === 'focusin' && !popup.contains(event.target) && !anchor.contains(event.target)) closeRef.current()
      if (event.type === 'keydown' && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); anchor.focus({ preventScroll: true }) }
      if (event.type === 'keydown' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && event.target.tagName === 'BUTTON' && popup.contains(event.target)) {
        event.preventDefault()
        const buttons = [...popup.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(event.target)
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
      }
    }
    const blur = event => {
      if (event.relatedTarget && !popup.contains(event.relatedTarget) && !anchor.contains(event.relatedTarget)) closeRef.current()
    }
    popup.addEventListener('focusout', blur)
    const docs = [...new Set([doc, document])]
    docs.forEach(d => { d.addEventListener('pointerdown', close); d.addEventListener('focusin', close) })
    popup.addEventListener('keydown', close)
    doc.addEventListener('scroll', place, true)
    view.addEventListener('resize', place)
    const observer = new view.ResizeObserver(place); observer.observe(popup); observer.observe(anchor)
    return () => {
      observer.disconnect(); view.removeEventListener('resize', place); doc.removeEventListener('scroll', place, true)
      popup.removeEventListener('keydown', close)
      popup.removeEventListener('focusout', blur)
      docs.forEach(d => { d.removeEventListener('pointerdown', close); d.removeEventListener('focusin', close) })
      if (anchor.isConnected && popup.contains(doc.activeElement)) anchor.focus({ preventScroll: true })
    }
  }, [anchor])
  if (!anchor) return null
  return createPortal(<div ref={ref} id={id} className={`legacy-popover wm-ui-portal ${theme === 'light' ? 'is-light' : ''} ${wide ? 'is-wide' : ''}`} data-theme={theme} style={position} role={role} aria-label={role==='tooltip'?undefined:label} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>{children}</div>, anchor.closest('dialog,[aria-modal="true"]') || anchor.ownerDocument.body)
}
