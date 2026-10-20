import { navigate } from './clientNavigation.js'
import { displayDate } from './dateFormat.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { createPlaybookDraft, diffPayloads, fetchPlaybookRevisions, fetchPlaybooks, forkPlaybook, freezePlaybook, MANUAL_STRATEGY_FIELDS, manualStrategyForm, manualStrategyPayload, revisePlaybook } from './playbookApi.js'
import LegacyModal from './LegacyModal.jsx'
import FxSelect from './FxSelect.jsx'
import './playbook-story.css'

const MAX_GET_RETRIES = 3
const CAPABILITY_LABELS = { 'manual-only': 'Giao dịch thủ công', 'engine-supported': 'Có định nghĩa cho engine', 'needs-definition': 'Chưa hoàn thiện quy tắc' }
const statusLabel = status => status === 'frozen' ? 'Đã cố định' : status === 'draft' ? 'Bản nháp' : 'Chưa xác định'
const capabilityLabel = value => CAPABILITY_LABELS[value] || 'Chưa xác định'
const recordName = record => String(record?.payload?.name || 'Chiến lược chưa đặt tên')
const formatUtc = value => !value ? '—' : Number.isNaN(new Date(value).getTime()) ? '—' : displayDate(new Date(value), { timeStyle: 'short' })

export function PlaybookList({ items, selectedId, onSelect }) {
  if (!items.length) return <div className="pb-empty" data-testid="playbook-empty"><strong>Chưa có chiến lược</strong><span>Tạo chiến lược để lưu quy tắc và sử dụng trong các phiên giao dịch.</span></div>
  return <nav className="pb-list" aria-label="Danh sách chiến lược" data-testid="playbook-list">{items.map(record => <button className={`pb-list-row ${selectedId === record.record_id ? 'is-selected' : ''}`} key={record.record_id} type="button" onClick={() => onSelect(record.record_id)} aria-pressed={selectedId === record.record_id} data-testid={`playbook-row-${record.record_id}`}><span className="pb-list-main"><strong>{recordName(record)}</strong><small>Phiên bản {record.revision}</small></span><span className={`pb-status is-${record.payload?.status || 'unknown'}`}>{statusLabel(record.payload?.status)}</span></button>)}</nav>
}

export function PlaybookSummary({ record, journalHref, actions }) {
  const payload = record?.payload || {}, notes = payload.rules?.manual_notes || {}
  const otherRules = Object.entries(payload.rules || {}).filter(([key]) => key !== 'manual_notes')
  const hasNotes = MANUAL_STRATEGY_FIELDS.some(([key]) => typeof notes[key] === 'string' && notes[key].trim())
  return <section className="pb-summary" aria-label="Chi tiết chiến lược" data-testid="playbook-summary">
    <div className="pb-section-heading"><div><h2>{recordName(record)}</h2><span className="pb-muted">Phiên bản {record.revision} · {capabilityLabel(payload.execution_capability)}</span></div><span className={`pb-status is-${payload.status || 'unknown'}`}>{statusLabel(payload.status)}</span></div>
    {actions && <div className="pb-actions">{actions}</div>}
    <div className="pb-rule-notes">{hasNotes ? MANUAL_STRATEGY_FIELDS.filter(([key]) => notes[key]?.trim?.()).map(([key, label]) => <section key={key}><h3>{label}</h3><p>{notes[key]}</p></section>) : !otherRules.length && <p className="pb-muted">Chưa có quy tắc. Bổ sung điều kiện vào lệnh, thoát lệnh và mức rủi ro để dễ đối chiếu khi luyện tập.</p>}
      {otherRules.length > 0 && <details><summary>Quy tắc đã lưu ({otherRules.length})</summary><dl className="pb-stored-rules">{otherRules.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl></details>}
    </div>
    <dl className="pb-facts"><div><dt>Cập nhật</dt><dd>{formatUtc(record.updated_at_utc)}</dd></div><div><dt>Tạo lúc</dt><dd>{formatUtc(record.created_at_utc)}</dd></div>{payload.parent_playbook_id && <div><dt>Phát triển từ</dt><dd>Phiên bản {payload.parent_revision} · <code>{payload.parent_playbook_id}</code></dd></div>}</dl>
    {journalHref && <a className="pb-journal-link" href={journalHref}>Xem nhật ký của chiến lược →</a>}
  </section>
}

function RevisionDiff({ revisions, leftRevision, rightRevision, setLeftRevision, setRightRevision }) {
  const left = revisions.find(item => item.revision === Number(leftRevision)) || revisions[0]
  const right = revisions.find(item => item.revision === Number(rightRevision)) || revisions.at(-1)
  const diff = useMemo(() => left && right ? diffPayloads(left.payload || {}, right.payload || {}) : [], [left, right])
  if (!revisions.length) return <p className="pb-muted">Chưa có lịch sử phiên bản.</p>
  const options = revisions.map(item => ({ value: item.revision, label: `Phiên bản ${item.revision}`, localize: false }))
  return <details className="pb-diff-section" data-testid="playbook-diff"><summary>Lịch sử phiên bản ({revisions.length})</summary><div className="pb-diff-controls"><label>Bản trước<FxSelect label="Phiên bản gốc" className="is-field" value={left?.revision || ''} options={options} onChange={setLeftRevision} /></label><span aria-hidden="true">→</span><label>Bản đối chiếu<FxSelect label="Phiên bản đối chiếu" className="is-field" value={right?.revision || ''} options={options} onChange={setRightRevision} /></label></div>
    {!diff.length ? <p className="pb-muted" data-testid="playbook-no-diff">Hai phiên bản có cùng nội dung.</p> : <div className="pb-diff-table" role="table" aria-label="Nội dung thay đổi" tabIndex={0}><div className="pb-diff-head" role="row"><span role="columnheader">Nội dung</span><span role="columnheader">Phiên bản {left.revision}</span><span role="columnheader">Phiên bản {right.revision}</span></div>{diff.map(item => <div className="pb-diff-row" key={item.path} role="row"><code role="cell">{item.path}</code><span role="cell" className="is-old">{item.leftDisplay}</span><span role="cell" className="is-new">{item.rightDisplay}</span></div>)}</div>}
  </details>
}

function StrategyEditor({ workspace, record, onClose, onSaved }) {
  const [form, setForm] = useState(() => manualStrategyForm(record)), [pending, setPending] = useState(false), [problem, setProblem] = useState(null)
  const lock = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const save = async event => {
    event.preventDefault()
    if (lock.current || problem?.uncertain) return
    let payload
    try { payload = manualStrategyPayload(record, form) } catch (error) { setProblem({ text: error.message }); return }
    lock.current = true; setPending(true); setProblem(null)
    try {
      const result = record ? await revisePlaybook(workspace, record, payload) : await createPlaybookDraft(workspace, payload.name, payload)
      if (!result?.record_id || !Number.isInteger(result.revision) || !result.payload) throw Object.assign(new Error('Chưa xác nhận được chiến lược đã lưu. Tải lại danh sách để kiểm tra.'), { outcomeKnown: false })
      if (alive.current) onSaved(result)
    } catch (error) {
      if (alive.current) setProblem({ text: error.status === 409 ? 'Chiến lược đã thay đổi ở nơi khác. Đóng cửa sổ và tải lại danh sách trước khi sửa tiếp.' : error.message, uncertain: error.outcomeKnown === false || !error.status || error.status >= 500 })
    } finally { lock.current = false; if (alive.current) setPending(false) }
  }
  return <LegacyModal theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label={record ? 'Sửa chiến lược' : 'Tạo chiến lược'} className="pb-editor-dialog" onClose={() => { if (!lock.current) onClose() }}>
    <form className="pb-editor" onSubmit={save}>
      <label>Tên chiến lược<input autoComplete="off" name="name" value={form.name} required maxLength={160} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} disabled={pending || problem?.uncertain} /></label>
      {MANUAL_STRATEGY_FIELDS.map(([key, label]) => <label key={key}>{label}<textarea name={key} rows={key === 'notes' ? 2 : 3} maxLength={4000} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} disabled={pending || problem?.uncertain} /></label>)}
      <p className="pb-muted">Quy tắc dùng để đối chiếu khi giao dịch thủ công. Mỗi lần lưu tạo một phiên bản mới; các phiên giao dịch cũ giữ nguyên phiên bản đã chọn.</p>
      {problem && <p className="pb-form-error" role="alert">{problem.text}</p>}
      <footer><button className="pb-button" type="button" onClick={onClose} disabled={pending}>{problem?.uncertain ? 'Đóng và kiểm tra danh sách' : 'Hủy'}</button><button className="pb-button is-primary" type="submit" disabled={pending || problem?.uncertain}>{pending ? 'Đang lưu…' : record ? 'Lưu phiên bản mới' : 'Tạo chiến lược'}</button></footer>
    </form>
  </LegacyModal>
}

function StrategyWorkspace({ workspace, query }) {
  const requestedId = query.get('playbook') || ''
  const requestedRevision = query.get('playbook_revision')
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [selectedId, setSelectedId] = useState(requestedId), [search, setSearch] = useState('')
  const [history, setHistory] = useState({ status: 'idle', items: [], error: null, selectedId: '' })
  const [leftRevision, setLeftRevision] = useState(1), [rightRevision, setRightRevision] = useState(1)
  const [catalogRetryToken, setCatalogRetryToken] = useState(0), [catalogRetryCount, setCatalogRetryCount] = useState(0)
  const [historyRetryToken, setHistoryRetryToken] = useState(0), [historyRetryCount, setHistoryRetryCount] = useState(0)
  const [editor, setEditor] = useState(null), [confirmFreeze, setConfirmFreeze] = useState(false), [pending, setPending] = useState(false), [problem, setProblem] = useState(null)
  const catalogRequestSeq = useRef(0), historyRequestSeq = useRef(0), mutationLock = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (requestedId) setSelectedId(requestedId); setConfirmFreeze(false) }, [requestedId, requestedRevision])
  useEffect(() => {
    const requestSeq = ++catalogRequestSeq.current, controller = new AbortController()
    setCatalog(current => ({ ...current, status: 'loading', error: null }))
    fetchPlaybooks(workspace, controller.signal).then(items => {
      if (requestSeq !== catalogRequestSeq.current) return
      setCatalog({ status: 'ready', items, error: null }); setCatalogRetryCount(0)
      setSelectedId(current => current || items[0]?.record_id || '')
    }).catch(error => { if (!controller.signal.aborted && requestSeq === catalogRequestSeq.current) setCatalog(current => ({ ...current, status: 'error', items: [401,403].includes(error.status) ? [] : current.items, error: error.message })) })
    return () => { controller.abort(); if (requestSeq === catalogRequestSeq.current) catalogRequestSeq.current += 1 }
  }, [catalogRetryToken, workspace])
  useEffect(() => {
    const requestSeq = ++historyRequestSeq.current
    if (!selectedId) { setHistory({ status: 'idle', items: [], error: null, selectedId: '' }); return }
    const controller = new AbortController()
    setHistory(current => ({ status: 'loading', items: current.selectedId === selectedId ? current.items : [], error: null, selectedId }))
    fetchPlaybookRevisions(workspace, selectedId, controller.signal).then(items => {
      if (requestSeq !== historyRequestSeq.current) return
      const sorted = [...items].sort((a, b) => a.revision - b.revision)
      setHistory({ status: 'ready', items: sorted, error: null, selectedId }); setHistoryRetryCount(0)
      setLeftRevision(sorted.at(-2)?.revision || sorted[0]?.revision || 1); setRightRevision(sorted.at(-1)?.revision || 1)
    }).catch(error => { if (!controller.signal.aborted && requestSeq === historyRequestSeq.current) setHistory(current => ({ ...current, status: 'error', items: [401,403].includes(error.status) ? [] : current.items, error: error.message })) })
    return () => { controller.abort(); if (requestSeq === historyRequestSeq.current) historyRequestSeq.current += 1 }
  }, [historyRetryToken, selectedId, workspace])
  const current = catalog.items.find(item => item.record_id === selectedId) || null
  const viewingHistorical = Boolean(current && requestedId === selectedId && requestedRevision && Number(requestedRevision) !== current.revision)
  const exact = history.selectedId === selectedId ? history.items.find(item => item.revision === Number(requestedRevision)) : null
  const selected = viewingHistorical ? exact ? { ...current, ...exact, record_id: current.record_id, updated_at_utc: exact.created_at_utc } : null : current
  const visible = catalog.items.filter(item => recordName(item).toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
  const selectPlaybook = recordId => {
    if (mutationLock.current) return
    setSelectedId(recordId); setProblem(null); setHistoryRetryCount(0)
    const record = catalog.items.find(item => item.record_id === recordId)
    navigate(buildWorkspaceHref('playbook', workspace, query, { area: 'strategies', section: 'my-strategies', playbook: recordId, playbook_revision: record?.revision || null }), { replace: true })
  }
  const saved = record => {
    catalogRequestSeq.current += 1
    setCatalog(current => ({ status: 'ready', items: [record, ...current.items.filter(item => item.record_id !== record.record_id)], error: null }))
    setSelectedId(record.record_id); setEditor(null); setConfirmFreeze(false); setProblem(null)
    setHistoryRetryToken(current => current + 1)
    navigate(buildWorkspaceHref('playbook', workspace, query, { area: 'strategies', section: 'my-strategies', playbook: record.record_id, playbook_revision: record.revision }), { replace: true })
  }
  const command = async action => {
    if (!selected || mutationLock.current || problem?.uncertain) return
    mutationLock.current = true; setPending(true); setProblem(null)
    try {
      const result = action === 'freeze' ? await freezePlaybook(workspace, selected) : await forkPlaybook(workspace, selected, `${recordName(selected).slice(0, 145)} (bản mới)`)
      if (!result?.record_id || !Number.isInteger(result.revision) || !result.payload) throw Object.assign(new Error('Chưa xác nhận kết quả. Tải lại danh sách để kiểm tra.'), { outcomeKnown: false })
      if (alive.current) saved(result)
    } catch (error) { if (alive.current) setProblem({ text: error.status === 409 ? 'Phiên bản đã thay đổi. Tải lại danh sách trước khi tiếp tục.' : error.message, uncertain: error.outcomeKnown === false || !error.status || error.status >= 500 }) }
    finally { mutationLock.current = false; if (alive.current) { setPending(false); setConfirmFreeze(false) } }
  }
  const retryCatalog = () => { if (catalogRetryCount >= MAX_GET_RETRIES || catalog.status === 'loading' || pending) return; setCatalogRetryCount(current => current + 1); setCatalogRetryToken(current => current + 1) }
  const retryHistory = () => { if (historyRetryCount >= MAX_GET_RETRIES || history.status === 'loading') return; setHistoryRetryCount(current => current + 1); setHistoryRetryToken(current => current + 1) }
  const refresh = () => { if (mutationLock.current) return; setCatalogRetryCount(0); setCatalogRetryToken(current => current + 1); setHistoryRetryToken(current => current + 1); setProblem(null) }
  const context = selected ? { playbook: selected.record_id, playbook_revision: selected.revision } : {}
  const journalHref = selected ? buildWorkspaceHref('journal', workspace, query, context) : ''
  return <main className="pb-page wm-page" data-testid="playbook-root">
    <header className="pb-topbar wm-page-header"><h1>Chiến lược của tôi</h1><div className="pb-actions"><button className="pb-button" type="button" onClick={refresh} disabled={catalog.status === 'loading' || pending}>Tải lại</button><button className="pb-button is-primary" type="button" onClick={() => setEditor({ record: null })} disabled={pending || catalog.status !== 'ready'}>Tạo chiến lược</button></div></header>
    {catalog.status === 'loading' && <p className="pb-message" role="status">Đang tải chiến lược…</p>}
    {catalog.status === 'error' && <div className="pb-message is-error" role="alert"><span>Không tải được chiến lược: {catalog.error}</span><button type="button" className="pb-button pb-retry-button" data-testid="playbook-catalog-retry" onClick={retryCatalog} disabled={catalogRetryCount >= MAX_GET_RETRIES}>{catalogRetryCount >= MAX_GET_RETRIES ? 'Đã hết lượt thử' : 'Thử lại'}</button></div>}
    {problem && <div className="pb-message is-error" role="alert">{problem.text}<button className="pb-button" type="button" onClick={refresh} disabled={pending}>Tải lại danh sách</button></div>}
    {viewingHistorical && <p className="pb-message" role="status">{selected ? 'Đang xem phiên bản ' + selected.revision + '. Các thay đổi mới hơn không áp dụng cho phiên bản này.' : history.status === 'ready' ? 'Không tìm thấy phiên bản trong liên kết. Chọn chiến lược để xem bản mới nhất.' : 'Đang đọc phiên bản chiến lược trong liên kết…'}</p>}
    <div className="pb-layout"><aside className="pb-sidebar" aria-busy={catalog.status === 'loading'}><div className="pb-section-heading"><h2>Chiến lược</h2><span className="pb-muted">{catalog.status === 'ready' ? catalog.items.length : '—'}</span></div>{catalog.items.length > 0 && <label className="pb-search"><span className="sr-only">Tìm chiến lược</span><input type="search" placeholder="Tìm chiến lược" value={search} onChange={event => setSearch(event.target.value)} /></label>}{catalog.status === 'ready' || catalog.items.length > 0 ? visible.length || !catalog.items.length ? <PlaybookList items={visible} selectedId={selectedId} onSelect={selectPlaybook} /> : <p className="pb-muted">Không có chiến lược khớp tìm kiếm.</p> : null}</aside>
      <div className="pb-content" aria-busy={history.status === 'loading'}>{selected ? <>
        <PlaybookSummary record={selected} journalHref={journalHref} actions={viewingHistorical ? <button className="pb-button" type="button" onClick={() => selectPlaybook(selectedId)}>Xem phiên bản mới nhất</button> : <><button className="pb-button" type="button" onClick={() => selected.payload.status === 'frozen' ? command('fork') : setEditor({ record: selected })} disabled={pending || problem?.uncertain || catalog.status !== 'ready'}>{selected.payload.status === 'frozen' ? 'Tạo bản nháp từ bản này' : 'Sửa chiến lược'}</button>{selected.payload.status === 'draft' && <button className="pb-button" type="button" onClick={() => setConfirmFreeze(true)} disabled={pending || problem?.uncertain || catalog.status !== 'ready'}>Cố định phiên bản</button>}</>} />
        <div className="pb-use-links"><a className="pb-button" href={buildWorkspaceHref('overview', workspace, query, { ...context, area: 'testing', section: 'dashboard', create: 'backtest' })}>Dùng trong Luyện tập</a><a className="pb-button" href={buildWorkspaceHref('live', workspace, query, { ...context, area: 'live', section: 'trades' })}>Xem trong Trực tiếp</a></div>
        <p className="pb-muted pb-version-note">Phiên giao dịch lưu cả chiến lược và phiên bản. Sửa bản nháp không thay đổi những phiên đã tạo.</p>
      </> : catalog.status === 'ready' && catalog.items.length > 0 ? <p className="pb-muted">{requestedId ? 'Chiến lược trong liên kết không còn khả dụng. Chọn một chiến lược trong danh sách.' : 'Chọn chiến lược để xem quy tắc và lịch sử.'}</p> : null}
      {current && history.status === 'loading' && <p className="pb-message" role="status">Đang tải lịch sử phiên bản…</p>}
      {current && history.status === 'error' && <div className="pb-message is-error" role="alert"><span>Không tải được lịch sử: {history.error}</span><button type="button" className="pb-button pb-retry-button" data-testid="playbook-history-retry" onClick={retryHistory} disabled={historyRetryCount >= MAX_GET_RETRIES}>{historyRetryCount >= MAX_GET_RETRIES ? 'Đã hết lượt thử' : 'Thử lại'}</button></div>}
      {current && history.status === 'ready' && <RevisionDiff revisions={history.items} leftRevision={leftRevision} rightRevision={rightRevision} setLeftRevision={setLeftRevision} setRightRevision={setRightRevision} />}</div>
    </div>
    {editor && <StrategyEditor workspace={workspace} record={editor.record} onClose={() => { setEditor(null); refresh() }} onSaved={saved} />}
    {confirmFreeze && selected && <LegacyModal theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} label="Cố định phiên bản?" className="pb-freeze-dialog" onClose={() => { if (!mutationLock.current) setConfirmFreeze(false) }}><div className="pb-editor"><p>Giữ nguyên quy tắc của “{recordName(selected)}” để dùng làm mốc đối chiếu. Sau khi cố định, bạn có thể tạo bản nháp mới từ chiến lược này.</p><p className="pb-muted">Thao tác này chỉ lưu chiến lược, không chạy hay gửi lệnh giao dịch.</p><footer><button className="pb-button" type="button" onClick={() => setConfirmFreeze(false)} disabled={pending}>Hủy</button><button className="pb-button is-primary" type="button" onClick={() => command('freeze')} disabled={pending}>{pending ? 'Đang lưu…' : 'Cố định phiên bản'}</button></footer></div></LegacyModal>}
  </main>
}

export default function PlaybookWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  return <StrategyWorkspace key={workspace} workspace={workspace} query={query} />
}

export { capabilityLabel, diffPayloads, statusLabel }
