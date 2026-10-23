import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './LegacyPopover.css'

export default function LegacyPopover({ anchor, theme, label, onClose, onAnchorLost, children, wide = false, role = 'group', id, onPointerEnter, onPointerLeave, className = '', offset = 4, maxWidth = Infinity }) {
  const ref = useRef(null), closeRef = useRef(onClose), lostRef = useRef(onAnchorLost), [position, setPosition] = useState({ style: { visibility: 'hidden' } })
  closeRef.current = onClose
  lostRef.current = onAnchorLost
  useLayoutEffect(() => {
    if (!anchor?.isConnected) { (lostRef.current || closeRef.current)(); return }
    const doc = anchor.ownerDocument, view = doc.defaultView, popup = ref.current
    const place = () => {
      if (!anchor.isConnected || !anchor.getBoundingClientRect().width) { (lostRef.current || closeRef.current)(); return }
      const a = anchor.getBoundingClientRect(), p = popup.getBoundingClientRect()
      const height = Math.min(p.height, view.innerHeight - 16), width = Math.min(p.width, view.innerWidth - 16)
      const below = a.bottom + height + offset <= view.innerHeight
      const left = Math.max(8, Math.min(a.right - width, view.innerWidth - width - 8))
      setPosition({ side: below ? 'bottom' : 'top', style: {
        maxWidth: Math.min(maxWidth, view.innerWidth - 16), maxHeight: view.innerHeight - 16,
        left, top: Math.max(8, below ? a.bottom + offset : a.top - height - offset),
        ...(role === 'tooltip' ? { '--wm-tooltip-arrow-x': `${Math.max(12, Math.min(a.left + a.width / 2 - left, width - 12))}px` } : {}),
      } })
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
  }, [anchor, offset, maxWidth, role])
  if (!anchor) return null
  return createPortal(<div ref={ref} id={id} className={`legacy-popover wm-ui-portal ${theme === 'light' ? 'is-light' : ''} ${wide ? 'is-wide' : ''} ${className}`} data-theme={theme} data-side={role==='tooltip'?position.side:undefined} style={position.style} role={role} aria-label={role==='tooltip'?undefined:label} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>{children}</div>, anchor.closest('dialog,[aria-modal="true"]') || anchor.ownerDocument.body)
}
