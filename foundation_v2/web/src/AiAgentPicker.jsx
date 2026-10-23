import { useEffect, useId, useRef, useState } from 'react'

export default function AiAgentPicker({ agents, agent, active, en, onSelect, onCreate }) {
  const id = useId(), trigger = useRef(null), menu = useRef(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (!active) menu.current?.hidePopover() }, [active])
  useEffect(() => {
    const close = () => menu.current?.hidePopover()
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [])
  function toggle() {
    if (expanded) { menu.current.hidePopover(); return }
    const rect = trigger.current.getBoundingClientRect(), width = Math.min(300, innerWidth - 32)
    Object.assign(menu.current.style, { width: `${width}px`, top: `${rect.bottom + 8}px`, left: `${Math.max(16, Math.min(rect.left, innerWidth - width - 16))}px` })
    menu.current.showPopover()
    menu.current.querySelector('[aria-checked="true"]')?.focus()
  }
  return <>
    <button className="wm-ai-agent-trigger" type="button" ref={trigger} aria-label={en ? 'Choose agent' : 'Chọn agent'} aria-haspopup="menu" aria-expanded={expanded} aria-controls={id} onClick={toggle}>
      <span>{agent.name}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} className="wm-ai-agent-menu" ref={menu} popover="auto" role="menu" aria-label={en ? 'Agents' : 'Agent'} onToggle={event => setExpanded(event.newState === 'open')} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.current.hidePopover(); trigger.current.focus(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = [...menu.current.querySelectorAll('[role^="menuitem"]')], index = items.indexOf(document.activeElement)
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }}>
      {agents.map(item => <button type="button" role="menuitemradio" aria-checked={item.id === agent.id} key={item.id} onClick={() => { menu.current.hidePopover(); trigger.current.focus(); if (item.id !== agent.id) onSelect(item) }}><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>{item.id === agent.id && <span aria-hidden="true">✓</span>}</button>)}
      <button type="button" role="menuitem" className="wm-ai-agent-add" onClick={() => { menu.current.hidePopover(); onCreate(trigger.current) }}><span aria-hidden="true">＋</span>{en ? 'Create agent' : 'Tạo agent'}</button>
    </div>
  </>
}
