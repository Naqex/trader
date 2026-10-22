import { useEffect, useId, useRef, useState } from 'react'
import LegacyPopover from './LegacyPopover.jsx'
import './project-tooltip.css'

// Delegate hints so lazy pages and disabled controls share one tooltip lifecycle.
export default function ProjectTooltipLayer({ targetDocument = document, theme: suppliedTheme }) {
  const id = useId(), [tip, setTip] = useState(null), current = useRef(null)
  const timers = useRef({ open: null, close: null, anchor: null })
  const clearTimers = () => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); timers.current.anchor = null }
  const hide = () => { clearTimers(); current.current = null; setTip(null) }
  const keepOpen = () => clearTimeout(timers.current.close)
  const closeSoon = () => {
    clearTimers()
    timers.current.close = setTimeout(() => {
      if (!current.current?.anchor.contains(targetDocument.activeElement)) hide()
    }, 120)
  }
  useEffect(() => {
    const doc = targetDocument, view = doc.defaultView
    const hint = node => node instanceof view.Element ? node.closest('[data-tooltip]') : null
    const inTooltip = node => node instanceof view.Element && node.closest('[role="tooltip"]')?.id === id
    const show = (anchor, immediate = false) => {
      if (!anchor?.getAttribute('data-tooltip')?.trim()) { hide(); return }
      clearTimers()
      if (current.current?.anchor === anchor) return
      current.current = null; setTip(null)
      const open = () => {
        timers.current.anchor = null
        const text = anchor.getAttribute('data-tooltip')?.trim()
        if (!anchor.isConnected || !text) return
        current.current = { anchor, text }; setTip(current.current)
      }
      if (immediate) open()
      else { timers.current.anchor = anchor; timers.current.open = setTimeout(open, 180) }
    }
    let dismissed = null
    const over = event => {
      if (event.pointerType === 'touch') return
      if (inTooltip(event.target)) { keepOpen(); return }
      if (hint(event.target) === dismissed && dismissed) return
      const anchor = hint(event.target)
      if (anchor) show(anchor)
      else closeSoon()
    }
    const out = event => {
      if (hint(event.target) === hint(event.relatedTarget) && hint(event.target)) return
      if (hint(event.target) === dismissed) dismissed = null
      if (inTooltip(event.relatedTarget)) { keepOpen(); return }
      closeSoon()
    }
    const focus = event => {
      const anchor = hint(event.target)
      if (anchor && (event.target.matches(':focus-visible') || anchor.hasAttribute('data-tooltip-touch'))) show(anchor, true)
      else hide()
    }
    const down = event => {
      if (!inTooltip(event.target) && !hint(event.target)?.hasAttribute('data-tooltip-touch')) hide()
    }
    const click = event => {
      const anchor = hint(event.target)
      if (anchor?.hasAttribute('data-tooltip-touch')) { dismissed = null; show(anchor, true) }
    }
    const key = event => {
      if (event.key === 'Escape' && (current.current || timers.current.anchor)) {
        event.preventDefault(); event.stopPropagation(); dismissed = current.current?.anchor || timers.current.anchor; hide()
      }
    }
    doc.addEventListener('pointerover', over)
    doc.addEventListener('pointerout', out)
    doc.addEventListener('focusin', focus)
    doc.addEventListener('focusout', closeSoon)
    doc.addEventListener('pointerdown', down, true)
    doc.addEventListener('click', click)
    doc.addEventListener('keydown', key, true)
    doc.addEventListener('scroll', hide, true)
    view.addEventListener('blur', hide)
    view.addEventListener('resize', hide)
    return () => {
      clearTimers()
      doc.removeEventListener('pointerover', over)
      doc.removeEventListener('pointerout', out)
      doc.removeEventListener('focusin', focus)
      doc.removeEventListener('focusout', closeSoon)
      doc.removeEventListener('pointerdown', down, true)
      doc.removeEventListener('click', click)
      doc.removeEventListener('keydown', key, true)
      doc.removeEventListener('scroll', hide, true)
      view.removeEventListener('blur', hide)
      view.removeEventListener('resize', hide)
      current.current = null; setTip(null)
    }
  }, [id, targetDocument])
  useEffect(() => {
    if (!tip) return
    const { anchor } = tip
    const described = anchor.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) || []
    anchor.setAttribute('aria-describedby', [...new Set([...described, id])].join(' '))
    const observer = new targetDocument.defaultView.MutationObserver(() => {
      if (current.current?.anchor !== anchor) return
      const text = anchor.getAttribute('data-tooltip')?.trim()
      if (!anchor.isConnected || !text) { hide(); return }
      if (text !== current.current?.text) { current.current = { anchor, text }; setTip(current.current) }
    })
    observer.observe(anchor, { attributes: true, attributeFilter: ['data-tooltip'] })
    observer.observe(targetDocument.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      const remaining = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id)
      if (remaining.length) anchor.setAttribute('aria-describedby', remaining.join(' '))
      else anchor.removeAttribute('aria-describedby')
    }
  }, [tip?.anchor, id, targetDocument])
  if (!tip) return null
  const theme = suppliedTheme || tip.anchor.closest('[data-theme]')?.dataset.theme || document.querySelector('.fx-app')?.dataset.theme || 'dark'
  return <LegacyPopover anchor={tip.anchor} theme={theme} id={id} role="tooltip" className="wm-tooltip" offset={8} maxWidth={280} onClose={hide} onPointerEnter={keepOpen} onPointerLeave={closeSoon}>{tip.text}</LegacyPopover>
}
