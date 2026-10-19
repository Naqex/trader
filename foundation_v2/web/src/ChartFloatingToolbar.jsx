import { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export function clampToolbar(position, width, height, parentWidth, parentHeight, minimumY = 36, insetLeft = 0, insetRight = 0, insetBottom = 28) {
  const maximumX = Math.max(0, parentWidth - insetRight - width)
  return { x: Math.max(Math.min(insetLeft, maximumX), Math.min(position.x, maximumX)), y: Math.max(minimumY, Math.min(position.y, Math.max(minimumY, parentHeight - height - insetBottom))) }
}

export default function ChartFloatingToolbar({ name, storageKey, initialPosition, viewport = false, compactRow = 0, compactMinimumY = 36 + compactRow * 64, insetLeft = 0, insetRight = 0, minimal = false, className = '', children }) {
  const { t } = useTestingLocale()

  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { ...saved, pinned: Boolean(saved.pinned), collapsed: Boolean(saved.collapsed) }
    } catch { /* Storage is optional for chart interaction. */ }
    return { ...initialPosition, pinned: false, collapsed: false }
  })
  const ref = useRef(null)
  const drag = useRef(null)
  const constrainPosition = (node, position) => {
    const parent = viewport ? node.ownerDocument.documentElement : node.parentElement
    const height = viewport ? node.ownerDocument.defaultView.innerHeight : parent.clientHeight
    return clampToolbar(position, node.offsetWidth, node.offsetHeight, parent.clientWidth, height,
      viewport ? 8 : parent.clientWidth < 760 ? compactMinimumY : 36,
      viewport ? 8 : insetLeft, viewport ? 8 : insetRight, viewport ? 8 : 28)
  }
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const constrain = () => setLayout(current => {
      const next = constrainPosition(node, current)
      return current.x === next.x && current.y === next.y ? current : { ...current, ...next }
    })
    const observer = new ResizeObserver(constrain)
    observer.observe(viewport ? node.ownerDocument.documentElement : node.parentElement)
    observer.observe(node)
    const view = node.ownerDocument.defaultView
    if (viewport) view.addEventListener('resize', constrain)
    constrain()
    return () => { observer.disconnect(); view.removeEventListener('resize', constrain) }
  }, [viewport, compactMinimumY, insetLeft, insetRight])
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(layout)) } catch { /* Optional preferences. */ } }, [layout, storageKey])
  const move = (x, y) => {
    const node = ref.current
    setLayout(current => {
      const next = constrainPosition(node, { x, y })
      return current.x === next.x && current.y === next.y ? current : { ...current, ...next }
    })
  }
  return <div ref={ref} className={`chart-floating-toolbar ${viewport ? 'is-viewport-floating' : ''} ${className} ${!minimal && layout.collapsed ? 'is-collapsed' : ''}`} role="group" aria-label={t(name)} style={{ left: layout.x, top: layout.y, maxWidth: viewport ? 'calc(100vw - 16px)' : `calc(100% - ${insetRight}px)` }}>
    <button type="button" className="chart-float-grip" aria-label={t('Di chuyển {name}', { name: t(name) })} title={t("Kéo để di chuyển · phím mũi tên để chỉnh vị trí")} disabled={layout.pinned}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX - layout.x, y: event.clientY - layout.y }; event.preventDefault() }}
      onPointerMove={event => { if (drag.current) move(event.clientX - drag.current.x, event.clientY - drag.current.y) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); move(layout.x + (event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0), layout.y + (event.key === 'ArrowUp' ? -12 : event.key === 'ArrowDown' ? 12 : 0)) }}><ChartIcon name="grip" /></button>
    {(minimal || !layout.collapsed) && <div className="chart-float-content">{children}</div>}
    {!minimal && <><button type="button" aria-label={t('Ghim {name}', { name: t(name) })} title={t("Ghim vị trí")} aria-pressed={layout.pinned} onClick={() => setLayout(current => ({ ...current, pinned: !current.pinned }))}><ChartIcon name="pin" /></button>
    <button type="button" aria-label={t(layout.collapsed ? 'Mở {name}' : 'Thu gọn {name}', { name: t(name) })} title={layout.collapsed ? t("Mở thanh công cụ") : t("Thu gọn")} aria-expanded={!layout.collapsed} onClick={() => setLayout(current => ({ ...current, collapsed: !current.collapsed }))}><ChartIcon name={layout.collapsed ? 'expand' : 'collapse'} /></button></>}
  </div>
}
