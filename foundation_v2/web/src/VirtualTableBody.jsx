import { useEffect, useMemo, useRef, useState } from 'react'
import { virtualTableSegments } from './virtualTableModel.js'

// Opt in only with fixed column widths and single-line cells; paged tables stay native.
export default function VirtualTableBody({ rows, columns, getRowKey, viewportRef, rowHeight = 60, overscan = 6, headerRows = 1, getRowProps }) {
  const body = useRef(null), [view, setView] = useState({ offset:0, height:0 }), [focusedKey, setFocusedKey] = useState(null)
  const keyIndex = useMemo(() => new Map(rows.map((row, index) => [String(getRowKey(row)), index])), [rows, getRowKey])
  const focusedIndex = keyIndex.get(focusedKey) ?? -1
  const segments = virtualTableSegments({ count:rows.length, rowHeight, ...view, overscan, focusedIndex })
  useEffect(() => { if (focusedKey !== null && !keyIndex.has(focusedKey)) setFocusedKey(null) }, [focusedKey, keyIndex])
  // The parent's viewport ref is attached after this child's layout effects.
  useEffect(() => {
    const viewport = viewportRef.current, tbody = body.current
    if (!viewport || !tbody) return
    let frame = 0, lastTop = -1, bodyOffset = 0, headingHeight = 0, viewportHeight = 0
    const update = () => {
      frame = 0
      const offset = Math.max(0, viewport.scrollTop + headingHeight - bodyOffset), height = Math.max(0, viewportHeight - headingHeight)
      setView(previous => Math.floor(previous.offset / rowHeight) === Math.floor(offset / rowHeight)
        && Math.ceil((previous.offset + previous.height) / rowHeight) === Math.ceil((offset + height) / rowHeight)
        && previous.height === height ? previous : { offset, height })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const measure = () => {
      bodyOffset = tbody.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - viewport.clientTop
      headingHeight = tbody.closest('table').tHead?.getBoundingClientRect().height || 0
      viewportHeight = viewport.clientHeight
      lastTop = viewport.scrollTop; schedule()
    }
    const scroll = () => {
      if (viewport.scrollTop === lastTop) return
      lastTop = viewport.scrollTop; schedule()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    const heading = tbody.closest('table').tHead
    if (heading) observer.observe(heading)
    viewport.addEventListener('scroll', scroll, { passive:true })
    measure()
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', scroll); cancelAnimationFrame(frame) }
  }, [viewportRef, rowHeight, rows.length])
  return <tbody ref={body} className="wm-virtual-body" style={{ '--wm-virtual-row-height':`${rowHeight}px` }}
    onFocusCapture={event => { const row = event.target.closest('[data-virtual-key]'); if (row) setFocusedKey(row.dataset.virtualKey) }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null) }}>
    {segments.flatMap(segment => segment.spacer
      ? <tr key={`gap:${segment.start}`} className="wm-virtual-spacer" aria-hidden="true" role="presentation" style={{ height:segment.height }}><td colSpan={columns.length} /></tr>
      : rows.slice(segment.start, segment.end).map((row, relative) => {
        const index = segment.start + relative, key = String(getRowKey(row)), props = getRowProps?.(row, index) || {}
        return <tr {...props} key={key} className={`wm-virtual-row ${props.className || ''}`} data-virtual-key={key} aria-rowindex={index + headerRows + 1}>
          {columns.map(column => <td key={column.key} className={column.className}><div className="wm-virtual-cell">{column.render(row, index)}</div></td>)}
        </tr>
      }))}
  </tbody>
}
