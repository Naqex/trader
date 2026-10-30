import { useEffect, useRef, useState } from 'react'
import LegacyPopover from './LegacyPopover.jsx'
import SearchInput from './SearchInput.jsx'
import TestingIcon from './TestingIcon.jsx'
import ChartIcon from './ChartIcon.jsx'
import useTradeLabelOrder from './useTradeLabelOrder.js'
import { useTestingLocale } from './testingLocale.jsx'
import { matchesSearch } from './searchText.js'
import { scopedRead } from './scopedRead.js'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import useReadRefresh from './useReadRefresh.js'
import './trade-labels.css'

export const LABEL_COLORS = ['green', 'blue', 'orange', 'red', 'purple', 'cyan', 'gray']
const COLOR_NAMES = { green:'Xanh lá', blue:'Xanh dương', orange:'Cam', red:'Đỏ', purple:'Tím', cyan:'Xanh nhạt', gray:'Xám' }
function LabelContents({ tags, options, placeholder }) {
  return <>{tags.map(tag => <span className="wm-trade-label" data-color={options.find(item => item.name === tag)?.color || 'gray'} key={tag}>{tag}</span>)}{!tags.length && <span className="wm-label-placeholder">{placeholder}</span>}</>
}
export function TradeLabelDisplay({ tags, options = [], placeholder = 'Không có nhãn' }) {
  const { t } = useTestingLocale()
  return <span className={`wm-label-cell${tags.length ? ' has-labels' : ''}`} tabIndex={0} aria-label={tags.length ? tags.join(', ') : t(placeholder)}>
    <LabelContents tags={tags} options={options} placeholder={t(placeholder)} />
  </span>
}
export function useTradeLabels(workspace) {
  const [catalog, setCatalog] = useState({ workspace, items: [], status: 'loading' })
  const [reload, setReload] = useState(0)
  const sequence = useRef(0)
  const activeWorkspace = useRef(workspace)
  activeWorkspace.current = workspace
  useReadRefresh(() => setReload(value => value + 1), Boolean(workspace), { workspace, resources: ['journal'], scopeKey: 'trade-label-catalog', error: catalog.error, pending: catalog.status === 'loading' })
  useEffect(() => {
    if (!workspace) return
    const controller = new AbortController()
    const request = ++sequence.current
    setCatalog(current => current.workspace === workspace && current.status === 'ready' ? { ...current, refreshing: true } : { workspace, status: 'loading', items: [] })
    scopedRead('/api/v2/trade-labels', workspace, controller.signal).then(readJson).then(payload => {
      if (!Array.isArray(payload.items) || payload.schema_version !== 'trade-labels-v1') throw new Error('invalid_label_catalog')
      if (!controller.signal.aborted && request === sequence.current) setCatalog({ ...payload, workspace, status: 'ready' })
    }).catch(error => { if (!controller.signal.aborted && request === sequence.current) setCatalog({ workspace, items: [], status: 'error', error }) })
    return () => controller.abort()
  }, [workspace, reload])
  const visible = catalog.workspace === workspace ? catalog : { status: 'loading', items: [] }
  const order = useTradeLabelOrder(workspace,visible.items)
  return { ...visible, ...order,
    refresh: () => setReload(value => value + 1), accept: payload => { if (activeWorkspace.current !== workspace) return; sequence.current++; setCatalog({ ...payload, workspace, status: 'ready' }) } }
}
export function labelError(error, t) {
  if (error.outcomeKnown === false || error.uncertain) return t('Chưa xác nhận được kết quả. Đọc lại dữ liệu trước khi thao tác tiếp.')
  if (error.message === 'label_name_exists' || error.message === 'label_group_name_exists') return t('Tên đã được sử dụng. Chọn tên khác.')
  if (error.status === 409) return t('Nhãn vừa thay đổi. Đã yêu cầu đọc lại; kiểm tra trước khi lưu tiếp.')
  return t('Không lưu được nhãn. Thử đọc lại dữ liệu.')
}
export default function TradeLabelCell({ workspace, session, row, catalog, onChanged, placeholder = 'Chọn nhãn…', groupId, className='' }) {
  const { t } = useTestingLocale()
  const [anchor, setAnchor] = useState(null), [search, setSearch] = useState(''), [editing, setEditing] = useState(null)
  const [name, setName] = useState(''), [color, setColor] = useState('gray'), [confirmDelete, setConfirmDelete] = useState(false)
  const [editAnchor, setEditAnchor] = useState(null)
  const [dragging,setDragging] = useState(null), drag = useRef(null)
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const lock = useRef(false)
  const [saved, setSaved] = useState(null)
  const identity = `${workspace}:${session}:${row.trade_id || row.tradeId}`
  const activeIdentity = useRef(identity), searchInput = useRef(null), nameInput = useRef(null)
  activeIdentity.current = identity
  useEffect(() => { setAnchor(null); setEditing(null); setConfirmDelete(false); setSearch(''); setSaved(null); setPending(false); setError(''); setUncertain(false); lock.current = false; drag.current = null; setDragging(null) }, [identity])
  useEffect(() => { if (anchor) searchInput.current?.focus({ preventScroll: true }) }, [anchor])
  useEffect(() => { if (editing && editAnchor) nameInput.current?.focus({ preventScroll: true }) }, [editing?.id, editAnchor])
  const latest = saved?.identity === identity && saved.revision > (row.label_revision || 0) ? saved : null
  const tags = latest?.tags || (Array.isArray(row.tags) ? row.tags : [])
  const options = [...catalog.items, ...tags.filter(tag => !catalog.items.some(item => item.name === tag)).map(tag => ({ id: null, name: tag, color: 'gray' }))]
  const close = () => { setAnchor(null); setEditing(null); setEditAnchor(null); setConfirmDelete(false); setSearch(''); drag.current = null; setDragging(null) }
  async function mutate(body) {
    if (lock.current || uncertain || catalog.status !== 'ready') return null
    lock.current = true; setPending(true); setError('')
    try {
      const payload = await readJson(await scopedMutation('/api/v2/trade-labels', workspace, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      if (activeIdentity.current !== identity) return null
      if (payload.schema_version !== 'trade-labels-v1' || !Array.isArray(payload.items)) throw Object.assign(new Error('invalid_label_catalog'), { uncertain: true })
      if (body.action === 'assign') {
        const assignment = payload.assignment
        if (assignment?.session_id !== session || assignment.trade_id !== (row.trade_id || row.tradeId) || !Number.isSafeInteger(assignment.revision) || assignment.revision <= body.expected_revision || !Array.isArray(assignment.tags)) throw Object.assign(new Error('invalid_label_assignment'), { uncertain: true })
        setSaved({ identity, revision: assignment.revision, tags: assignment.tags })
      }
      catalog.accept(payload); onChanged?.(); return payload
    } catch (problem) {
      if (activeIdentity.current !== identity) return null
      setError(labelError(problem, t)); setUncertain(problem.outcomeKnown === false || problem.uncertain === true)
      if (problem.status === 409) { setEditing(null); catalog.refresh(); onChanged?.() }
      return null
    } finally { if (activeIdentity.current === identity) { lock.current = false; setPending(false) } }
  }
  const assign = next => mutate({ action: 'assign', session_id: session, trade_id: row.trade_id || row.tradeId, expected_revision: latest?.revision ?? row.label_revision ?? 0, tags: next })
  const createLabel = async () => {
    // Creation disables/removes its button; keep Escape owned by this popup.
    searchInput.current?.focus({preventScroll:true})
    const created = await mutate({ action: 'create', name: search.trim(), color: 'gray',...(groupId!==undefined?{group_id:groupId || null}:{}) })
    if (created) { await assign([...tags, search.trim()]); setSearch(''); searchInput.current?.focus({preventScroll:true}) }
  }
  const chooseEdit = async (item, target) => {
    if (disabled) return
    if (item.id && editing?.id === item.id) {
      closeEditor()
      return
    }
    let label = item
    if (!label.id) { const payload = await mutate({ action: 'create', name: label.name, color: 'gray' }); if (!payload) return; label = payload.items.find(entry => entry.name === item.name) }
    setEditing(label); setEditAnchor(target); setName(label.name); setColor(label.color); setConfirmDelete(false)
  }
  const disabled = !workspace || !session || pending || uncertain || catalog.status !== 'ready'
  const title = t(placeholder)
  const theme = document.querySelector('.fx-app')?.dataset.theme || 'dark'
  const saveEdit = async (nextColor = color) => {
    if (disabled || !name.trim() || !editing) return false
    if (name.trim() === editing.name && nextColor === editing.color) return true
    const payload = await mutate({ action:'update', id:editing.id, expected_revision:editing.revision, name:name.trim(), color:nextColor })
    if (!payload) return false
    const next = payload.items.find(item => item.id === editing.id)
    if (next) { setEditing(next); setName(next.name); setColor(next.color) }
    return true
  }
  const closeEditor = () => { setEditing(null); setConfirmDelete(false) }
  const inGroup=item=>groupId===undefined || (item.group_id || '')===groupId
  const displayed=tags.filter(tag=>inGroup(options.find(item=>item.name===tag) || {}))
  const visibleOptions = options.filter(item => (!item.archived || tags.includes(item.name)) && inGroup(item) && matchesSearch(item.name,search))
  const cancelDrag = () => { drag.current = null; setDragging(null) }
  const dragTo = event => {
    if (!drag.current) return
    const list = event.currentTarget.closest('.wm-label-options')
    const rows = [...list.querySelectorAll('[data-label-id]')]
    const row = rows.find(el => { const box = el.getBoundingClientRect(); return event.clientY >= box.top && event.clientY <= box.bottom })
    if (!row || event.clientX < list.getBoundingClientRect().left || event.clientX > list.getBoundingClientRect().right) { drag.current = {...drag.current,target:null}; setDragging(drag.current); return }
    const next = {...drag.current,target:row.dataset.labelId,before:event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2}
    drag.current = next; setDragging(next)
  }
  return <>
    <button type="button" className={`wm-label-cell ${className}${displayed.length ? ' has-labels' : ''}`} aria-label={groupId!==undefined?title:t('Nhãn giao dịch {id}', { id: row.trade_id || row.tradeId })} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} disabled={!workspace || !session} onClick={event => { setAnchor(event.currentTarget); setError(''); setSearch('') }}>
      <LabelContents tags={displayed} options={options} placeholder={title} />
    </button>
    {anchor && <LegacyPopover anchor={anchor} label={t('Nhãn giao dịch')} role="dialog" className="wm-label-popup" maxWidth={360} theme={theme} onClose={close}>
        <div className="wm-label-options" aria-label={t('Chọn nhiều nhãn')}>
          {visibleOptions.map((item,index) => <div className="wm-label-option" data-label-id={item.id || undefined} data-drop={dragging?.target === item.id && dragging.id !== item.id ? dragging.before ? 'before' : 'after' : undefined} key={item.id || item.name}>
            <button type="button" className="wm-label-grip" disabled={disabled || !item.id} aria-label={t('Đổi thứ tự nhãn {name}',{name:item.name})} data-tooltip={dragging ? undefined : t('Kéo để đổi thứ tự · Alt + ↑/↓')} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({preventScroll:true}); event.currentTarget.setPointerCapture(event.pointerId); drag.current = {id:item.id,target:null}; setDragging(drag.current) }} onPointerMove={dragTo} onPointerUp={event => { if (!drag.current) return; dragTo(event); const next = drag.current; cancelDrag(); if (next.target) catalog.move(next.id,next.target,next.before) }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDownCapture={event => { if (event.key === 'Escape' && drag.current) {event.preventDefault();event.stopPropagation();cancelDrag();return} if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault();event.stopPropagation(); const target = visibleOptions[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target?.id) catalog.move(item.id,target.id,event.key === 'ArrowUp') }}><ChartIcon name="grip" /></button>
            <button type="button" className="wm-label-choice" role="checkbox" aria-checked={tags.includes(item.name)} aria-disabled={disabled} onClick={() => { if (!disabled) assign(tags.includes(item.name) ? tags.filter(tag => tag !== item.name) : [...tags, item.name]) }}><span className="wm-trade-label" data-color={item.color}>{item.name}</span></button>
            {tags.includes(item.name) && <span className="fx-select-check wm-label-check" aria-hidden="true">✓</span>}
            <button type="button" className="wm-label-more" aria-label={t('Sửa nhãn {name}', { name: item.name })} aria-haspopup="dialog" aria-expanded={editing?.id === item.id && Boolean(editing)} aria-disabled={disabled} onClick={event => chooseEdit(item,event.currentTarget)}><svg viewBox="0 0 16 20" width="16" height="20" fill="currentColor" aria-hidden="true">{[4,10,16].map(y=><circle key={y} cx="8" cy={y} r="1.5"/>)}</svg></button>
          </div>)}
        </div>
        <SearchInput ref={searchInput} type="search" aria-label={t('Tìm hoặc tạo nhãn')} placeholder={t('Chọn hoặc tạo nhãn mới…')} value={search} maxLength={64} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!disabled && search.trim() && !options.some(item => item.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase())) createLabel() } }} />
        {search.trim() && !options.some(item => item.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase()) && <button type="button" className="wm-label-create" disabled={disabled} onClick={createLabel}><TestingIcon kind="plus" size={16}/>{t('Tạo nhãn')} “{search.trim()}”</button>}
        {!options.length && catalog.status === 'ready' && !search && <p>{t('Chưa có nhãn')}</p>}
        {catalog.orderError && <p role="status">{t('Không lưu được thứ tự vào trình duyệt; thứ tự chỉ giữ trong phiên này.')}</p>}
      {editing && editAnchor && <LegacyPopover anchor={editAnchor} label={t('Sửa nhãn {name}',{name:editing.name})} role="dialog" className="wm-label-edit-popup" placement="right-start" maxWidth={300} theme={theme} onClose={closeEditor}>
        <div className="wm-label-editor">
          <form onSubmit={async event => { event.preventDefault(); if (await saveEdit()) setEditing(null) }}>
            <input aria-label={t('Tên nhãn')} ref={nameInput} value={name} maxLength={64} readOnly={disabled} onChange={event => setName(event.target.value)} required />
          </form>
          <div className="wm-label-color-list" role="group" aria-label={t('Màu nhãn')}>{LABEL_COLORS.map(value => <button key={value} type="button" data-color={value} aria-pressed={color === value} disabled={disabled || !name.trim()} onClick={() => saveEdit(value)}><span className="wm-label-swatch wm-trade-label" data-color={value}/><span>{t(COLOR_NAMES[value])}</span>{color === value && <span className="fx-select-check wm-label-check" aria-hidden="true">✓</span>}</button>)}</div>
          <div className="wm-label-delete-section">{confirmDelete ? <div className="wm-label-delete"><p>{t('Xóa nhãn này khỏi mọi giao dịch?')}</p><button type="button" className="fxa-button is-danger" disabled={disabled} onClick={async () => { if (await mutate({ action:'delete', id:editing.id, expected_revision:editing.revision })) setEditing(null) }}>{t('Xóa nhãn')}</button><button type="button" className="fxa-button" onClick={() => setConfirmDelete(false)}>{t('Hủy')}</button></div> : <button type="button" className="wm-label-delete-trigger" disabled={disabled} onClick={() => setConfirmDelete(true)}><TestingIcon kind="delete" size={16}/>{t('Xóa nhãn')}</button>}</div>
          {error && <p role="alert" className="live-record-error">{error}</p>}
        </div>
      </LegacyPopover>}
      {catalog.status === 'loading' && <p role="status">{t('Đang đọc nhãn…')}</p>}
      {(!editing && error || catalog.status === 'error') && <p role="alert" className="live-record-error">{error || t('Không tải được nhãn.')}</p>}
      {(uncertain || catalog.status === 'error') && <button type="button" className="fxa-button" onClick={() => { close(); catalog.refresh(); onChanged?.(); setUncertain(false) }}>{t('Đọc lại dữ liệu')}</button>}
    </LegacyPopover>}
  </>
}
