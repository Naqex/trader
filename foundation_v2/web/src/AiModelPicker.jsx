import { useEffect, useId, useRef, useState } from 'react'

const effortNames = { low: ['Nhanh', 'Fast'], medium: ['Vừa', 'Medium'], high: ['Cao', 'High'], xhigh: ['Rất cao', 'Extra high'], max: ['Pro', 'Pro'], ultra: ['Ultra', 'Ultra'] }

export default function AiModelPicker({ models, selection, disabled, active, en, onSelect }) {
  const id = useId()
  const popup = useRef(null), trigger = useRef(null), submitting = useRef(false), restoreFocus = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState('effort')
  const [preview, setPreview] = useState(selection.effort)
  const model = models.find(item => item.id === selection.model)
  const efforts = model?.efforts || []
  const name = value => effortNames[value]?.[en ? 1 : 0] || value
  useEffect(() => { setPreview(selection.effort) }, [selection.effort, disabled])
  useEffect(() => {
    if (!active || disabled) popup.current?.hidePopover()
    if (active && !disabled && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus() }
  }, [active, disabled])
  useEffect(() => {
    if (expanded) popup.current?.querySelector(view === 'models' ? '[aria-selected="true"]' : '.wm-ai-model-current')?.focus()
  }, [expanded, view])
  useEffect(() => {
    const close = () => popup.current?.hidePopover()
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [])
  async function commit(effort) {
    if (disabled || submitting.current || effort === selection.effort || !efforts.includes(effort)) return
    submitting.current = true
    restoreFocus.current = true
    try { await onSelect({ model: selection.model, effort }) }
    finally { submitting.current = false }
  }
  function toggle() {
    if (expanded) { popup.current.hidePopover(); return }
    setView('effort'); setPreview(selection.effort)
    const box = trigger.current.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 32)
    Object.assign(popup.current.style, { width: `${width}px`, left: `${Math.max(16, Math.min(box.right - width, window.innerWidth - width - 16))}px`, bottom: `${window.innerHeight - box.top + 8}px` })
    popup.current.showPopover()
  }
  function moveModel(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const options = [...event.currentTarget.querySelectorAll('[role="option"]')]
    const index = options.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    options[next]?.focus()
  }
  return <div className="wm-ai-picker">
    <button ref={trigger} type="button" className="wm-ai-model-trigger" disabled={disabled} aria-label={en ? 'AI model and effort' : 'Model và mức suy luận AI'} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={id} onClick={toggle} title={`${model?.name || selection.model} · ${name(selection.effort)}`}>
      <span>{name(selection.effort)}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} ref={popup} popover="auto" className="wm-ai-selection" role="dialog" aria-label={en ? 'AI model and effort' : 'Model và mức suy luận AI'} onToggle={event => setExpanded(event.newState === 'open')}>
      {view === 'effort' ? <>
        <button type="button" className="wm-ai-model-current" onClick={() => setView('models')} aria-label={en ? 'AI model' : 'Model AI'}><span>{model?.name || selection.model}</span><span aria-hidden="true">›</span></button>
        <div className="wm-ai-effort-heading"><span>{en ? 'Thinking effort' : 'Mức suy luận'}</span><strong>{name(preview)}</strong></div>
        <input type="range" aria-label={en ? 'AI reasoning effort' : 'Mức suy luận AI'} aria-valuetext={name(preview)} min="0" max={Math.max(0, efforts.length - 1)} step="1" value={Math.max(0, efforts.indexOf(preview))} disabled={disabled || efforts.length < 2} onChange={event => setPreview(efforts[Number(event.target.value)])} onPointerUp={event => void commit(efforts[Number(event.currentTarget.value)])} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void commit(efforts[Number(event.currentTarget.value)]) }} onBlur={event => void commit(efforts[Number(event.currentTarget.value)])} />
        <div className="wm-ai-effort-stops" aria-hidden="true">{efforts.map(value => <span key={value}>{name(value)}</span>)}</div>
      </> : <>
        <button type="button" className="wm-ai-model-back" onClick={() => setView('effort')}>‹ {en ? 'Thinking effort' : 'Mức suy luận'}</button>
        <div role="listbox" aria-label={en ? 'AI model' : 'Model AI'} onKeyDown={moveModel}>{models.map(item => <button type="button" role="option" tabIndex={selection.model === item.id ? 0 : -1} aria-selected={selection.model === item.id} key={item.id} onClick={() => { popup.current.hidePopover(); trigger.current?.focus(); if (selection.model !== item.id) { restoreFocus.current = true; void onSelect({ model: item.id, effort: item.efforts.includes(selection.effort) ? selection.effort : item.efforts.includes('high') ? 'high' : item.efforts[0] }) } }}><span>{item.name}</span>{selection.model === item.id && <span aria-hidden="true">✓</span>}</button>)}</div>
      </>}
    </div>
  </div>
}
