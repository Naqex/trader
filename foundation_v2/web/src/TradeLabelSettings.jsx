import { useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { LABEL_COLORS, labelError, useTradeLabels } from './TradeLabelCell.jsx'
import { scopedMutation } from './scopedMutation.js'
import { readJson } from './researchDataApi.js'
import SearchInput from './SearchInput.jsx'
import TestingIcon from './TestingIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import { matchesSearch } from './searchText.js'
import './trade-label-settings.css'

export default function TradeLabelSettings({ workspace }) {
  const { t } = useTestingLocale(), catalog = useTradeLabels(workspace)
  const [search, setSearch] = useState(''), [draft, setDraft] = useState(null)
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const lock = useRef(false), currentWorkspace = useRef(workspace)
  currentWorkspace.current = workspace
  const groups = (catalog.groups || []).filter(group => !group.archived)
  const labels = catalog.items.filter(item => !item.archived)
  const disabled = pending || uncertain || catalog.refreshing || catalog.status !== 'ready'
  const close = () => { if (!lock.current) { setDraft(null); setError('') } }
  const open = (kind, item, groupId = '') => { setError(''); setDraft({kind,item,name:item?.name || '',color:item?.color || 'gray',group_id:item?.group_id || groupId}) }
  async function save(body) {
    if (lock.current || disabled) return
    lock.current = true; setPending(true); setError('')
    try {
      const payload = await readJson(await scopedMutation('/api/v2/trade-labels', workspace, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))
      if (currentWorkspace.current !== workspace) return
      if (payload.schema_version !== 'trade-labels-v1' || !Array.isArray(payload.items)) throw Object.assign(new Error('invalid_label_catalog'), {uncertain:true})
      catalog.accept(payload); setDraft(null)
    } catch (problem) {
      if (currentWorkspace.current !== workspace) return
      setError(labelError(problem,t)); setUncertain(problem.outcomeKnown === false || problem.uncertain === true)
      if (problem.status === 409) { setDraft(null); catalog.refresh() }
    } finally { lock.current = false; if (currentWorkspace.current === workspace) setPending(false) }
  }
  const submit = event => {
    event.preventDefault()
    const item = draft.item, group = draft.kind === 'group'
    return save({action:group ? item ? 'update_group' : 'create_group' : item ? 'update' : 'create',
      ...(item ? {id:item.id,expected_revision:item.revision} : {}),name:draft.name.trim(),
      ...(!group ? {color:draft.color,group_id:draft.group_id || null} : {})})
  }
  return <section className="trade-label-settings" aria-label={t('Quản lý nhãn')}>
    <div className="trade-label-settings-toolbar"><h2>{t('Nhóm nhãn')}</h2><button type="button" className="fxa-button" disabled={disabled} onClick={() => open('group')}><TestingIcon kind="plus"/>{t('Thêm nhóm')}</button><button type="button" className="fxa-button" disabled={disabled} onClick={() => open('label')}><TestingIcon kind="plus"/>{t('Thêm nhãn')}</button></div>
    <SearchInput type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={t('Tìm nhóm hoặc nhãn')} placeholder={t('Tìm nhóm hoặc nhãn…')} />
    {catalog.status === 'loading' && <p role="status">{t('Đang đọc nhãn…')}</p>}
    {catalog.status === 'error' && <p role="alert">{t('Không tải được nhãn.')}</p>}
    {!draft && error && <p role="alert">{error}</p>}
    {(catalog.status === 'error' || uncertain) && <button className="fxa-button" onClick={() => { catalog.refresh(); setUncertain(false); setError('') }}>{t('Đọc lại dữ liệu')}</button>}
    {catalog.status === 'ready' && <div className="trade-label-groups">{[...groups,{id:'',name:t('Chưa phân nhóm')}].map(group => {
      const items = labels.filter(item => (item.group_id || '') === group.id && (matchesSearch(group.name,search) || matchesSearch(item.name,search)))
      if (!items.length && (!group.id || !matchesSearch(group.name,search))) return null
      return <section key={group.id} className="trade-label-group" aria-label={group.name}>
        <header><h3>{group.name}</h3><div><button type="button" className="fxa-button" disabled={disabled} onClick={() => open('label',null,group.id)} aria-label={t('Thêm nhãn vào {name}',{name:group.name})}><TestingIcon kind="plus"/>{t('Thêm nhãn')}</button>{group.id && <button className="fxa-button" type="button" disabled={disabled} onClick={() => open('group',group)} aria-label={t('Sửa nhóm {name}',{name:group.name})}>{t('Sửa')}</button>}</div></header>
        <ul>{items.map(item => <li key={item.id}><span className="wm-trade-label" data-color={item.color}>{item.name}</span><button type="button" className="fxa-button fxa-icon-button" disabled={disabled} onClick={() => open('label',item)} aria-label={t('Sửa nhãn {name}',{name:item.name})}>{t('Sửa')}</button></li>)}</ul>
        {!items.length && <p>{t('Chưa có nhãn')}</p>}
      </section>
    })}</div>}
    {catalog.status === 'ready' && !groups.length && !labels.length && <p>{t('Chưa có nhãn')}</p>}
    {catalog.status === 'ready' && search && ![...groups,...labels,...(labels.some(item => !item.group_id) ? [{name:t('Chưa phân nhóm')}] : [])].some(item => matchesSearch(item.name,search)) && <p>{t('Không tìm thấy nhóm hoặc nhãn.')}</p>}
    {draft && <LegacyModal theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} className="trade-label-settings-dialog" label={t(draft.archive ? draft.kind === 'group' ? 'Lưu trữ nhóm nhãn' : 'Lưu trữ nhãn' : draft.kind === 'group' ? draft.item ? 'Sửa nhóm nhãn' : 'Thêm nhóm nhãn' : draft.item ? 'Sửa nhãn' : 'Thêm nhãn')} onClose={close}>
      {draft.archive ? <div className="trade-label-settings-archive"><p>{t(draft.kind === 'group' ? 'Lưu trữ nhóm “{name}” và ẩn các nhãn trong nhóm khỏi bộ chọn? Nhãn đã gắn trên giao dịch được giữ nguyên.' : 'Lưu trữ “{name}”? Nhãn đã gắn trên giao dịch được giữ nguyên.',{name:draft.name})}</p><div className="trade-label-settings-actions"><button type="button" className="wm-button" disabled={disabled} onClick={() => save({action:draft.kind === 'group' ? 'archive_group' : 'archive',id:draft.item.id,expected_revision:draft.item.revision})}>{t('Lưu trữ')}</button><button type="button" className="wm-button" disabled={pending} onClick={() => setDraft({...draft,archive:false})}>{t('Quay lại')}</button></div></div> : <form onSubmit={submit}>
        <label>{t(draft.kind === 'group' ? 'Tên nhóm' : 'Tên nhãn')}<input required maxLength={64} value={draft.name} readOnly={disabled} onChange={event => setDraft({...draft,name:event.target.value})}/></label>
        {draft.kind === 'label' && <><label>{t('Nhóm nhãn')}<select disabled={disabled} value={draft.group_id} onChange={event => setDraft({...draft,group_id:event.target.value})}><option value="">{t('Chưa phân nhóm')}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="wm-label-colors" role="group" aria-label={t('Màu nhãn')}>{LABEL_COLORS.map(color => <button type="button" key={color} disabled={disabled} aria-label={t(`Màu nhãn ${color}`)} aria-pressed={draft.color === color} onClick={() => setDraft({...draft,color})}><span className="wm-trade-label" data-color={color}>{draft.color === color ? '✓' : ''}</span></button>)}</div><span className="wm-trade-label" data-color={draft.color}>{draft.name || t('Tên nhãn')}</span></>}
        <div className="trade-label-settings-actions"><button type="submit" className="wm-button is-primary" disabled={disabled || !draft.name.trim()}>{t(pending ? 'Đang lưu…' : 'Lưu thay đổi')}</button>{draft.item && <button type="button" className="wm-button" disabled={disabled} onClick={() => setDraft({...draft,archive:true})}>{t('Lưu trữ')}</button>}</div>
      </form>}
      {error && <p role="alert">{error}</p>}
      {uncertain && <button className="fxa-button" onClick={() => {setDraft(null);catalog.refresh();setUncertain(false);setError('')}}>{t('Đọc lại dữ liệu')}</button>}
    </LegacyModal>}
  </section>
}
