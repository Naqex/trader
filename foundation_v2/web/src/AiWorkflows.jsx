import { displayDate } from './dateFormat.js'
import { useEffect, useRef, useState } from 'react'
import { useFxReplayContext } from './FxReplayShell.jsx'
import AiSourcePicker, { AiSourceProvenance } from './AiSourcePicker.jsx'
import { aiErrorCopy, aiEffortName } from './aiProvider.js'

const running = run => ['queued', 'running', 'cancelling'].includes(run?.status)
function stored(key) { try { return JSON.parse(localStorage.getItem(key)) || {} } catch { return {} } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Server history remains authoritative. */ } }

export default function AiWorkflows({ workspace, language }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const { buildHref } = useFxReplayContext()
  const storage = `wm-ai-workflow:${workspace}`
  const [text, setText] = useState(''), [source, setSource] = useState(null), [items, setItems] = useState([]), [next, setNext] = useState(null)
  const [selected, setSelected] = useState(() => stored(storage).id || null), [pending, setPending] = useState(() => stored(storage).pending || null)
  const [run, setRun] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [historyVersion, reload] = useState(0), [connectionVersion, reconnect] = useState(0)
  const operation = useRef(null), epoch = useRef(0), submitting = useRef(false)
  const statuses = { waiting: say('Chờ đến lượt', 'Pending'), queued: say('Đang chờ', 'Queued'), running: say('Đang chạy', 'Running'), sent: say('Đang xử lý', 'Processing'), cancelling: say('Đang dừng', 'Stopping'), cancelled: say('Đã dừng', 'Stopped'), completed: say('Hoàn tất', 'Completed'), failed: say('Lỗi', 'Failed'), interrupted: say('Gián đoạn', 'Interrupted') }
  const nodes = { facts: say('Phân tích bằng chứng', 'Analyze evidence'), gaps: say('Tìm điểm còn thiếu', 'Find gaps'), reviewer: say('Tổng hợp và kiểm tra', 'Review and synthesize') }
  async function api(path, { body, method = 'GET', signal } = {}) {
    const response = await fetch(`/api/v2/ai/assistant/workflows${path}`, { method, signal, headers: { 'X-Workspace-Id': workspace, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.detail), { status: response.status }); return value
  }
  useEffect(() => {
    epoch.current++; operation.current?.abort(); submitting.current = false; setBusy(false); setText(''); setSource(null); setRun(null); setError('')
    const previous = stored(storage); setSelected(previous.id || null); setPending(previous.pending || null)
    return () => { epoch.current++; operation.current?.abort() }
  }, [workspace])
  useEffect(() => {
    const abort = new AbortController(); setLoading(true)
    api('', { signal: abort.signal }).then(value => { if (!abort.signal.aborted) { setItems(value.items); setNext(value.next) } }).catch(failure => { if (!abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [workspace, en, historyVersion])
  useEffect(() => {
    setRun(null)
    if (!selected) return
    const abort = new AbortController(); let timer
    async function read() {
      try {
        const value = await api(`/${selected}`, { signal: abort.signal })
        if (abort.signal.aborted) return
        setRun(value); setError('')
        if (running(value)) timer = setTimeout(read, 1500)
        else reload(n => n + 1)
      } catch (failure) { if (!abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) }
    }
    void read()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [workspace, en, selected, connectionVersion])
  async function submit(event, retry = false) {
    event?.preventDefault()
    if (submitting.current || (!retry && (!text.trim() || pending))) return
    const body = retry ? pending : { text: text.trim(), locale: en ? 'en' : 'vi', idempotency_key: crypto.randomUUID(), ...(source ? { source } : {}) }
    if (!body) return
    const version = epoch.current, abort = new AbortController(); operation.current = abort; submitting.current = true; setBusy(true); setError(''); setPending(body); remember(storage, { id: selected, pending: body })
    try {
      const value = await api('/evidence-review', { method: 'POST', body, signal: abort.signal })
      if (version !== epoch.current || abort.signal.aborted) return
      remember(storage, { id: value.id }); setPending(null); setSelected(value.id); setRun(value); setText(''); reconnect(n => n + 1); reload(n => n + 1)
    } catch (failure) { if (version === epoch.current && !abort.signal.aborted) { setError(aiErrorCopy(failure.message, en)); if (failure.status >= 400 && failure.status < 500) { setPending(null); remember(storage, { id: selected }); setText(body.text); setSource(body.source || null) } } }
    finally { if (version === epoch.current) { submitting.current = false; setBusy(false) } }
  }
  async function stop() {
    if (submitting.current || !running(run)) return
    const version = epoch.current, abort = new AbortController(); operation.current = abort; submitting.current = true; setBusy(true)
    try { const value = await api(`/${run.id}`, { method: 'DELETE', signal: abort.signal }); if (version === epoch.current && !abort.signal.aborted) { setRun(value); reconnect(n => n + 1) } }
    catch (failure) { if (version === epoch.current && !abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) }
    finally { if (version === epoch.current) { submitting.current = false; setBusy(false) } }
  }
  async function more() {
    const abort = new AbortController(), version = epoch.current; operation.current = abort; setBusy(true)
    try { const value = await api(`?${new URLSearchParams(next)}`, { signal: abort.signal }); if (version === epoch.current && !abort.signal.aborted) { setItems(old => [...new Map([...old, ...value.items].map(item => [item.id, item])).values()]); setNext(value.next) } }
    catch (failure) { if (version === epoch.current && !abort.signal.aborted) setError(aiErrorCopy(failure.message, en)) }
    finally { if (version === epoch.current) setBusy(false) }
  }
  function select(id) { setSelected(id); remember(storage, { id, ...(pending ? { pending } : {}) }) }
  return <section className="ai-workflows" aria-labelledby="ai-workflows-title">
    <header className="ai-page-heading"><div><h1 id="ai-workflows-title">{say('Luồng AI', 'Workflows')}</h1><p>{say('Hai nhánh phân tích song song, sau đó một reviewer tổng hợp.', 'Two parallel analysis branches, followed by a reviewer.')}</p></div><a href={buildHref('ai', { area: 'ai', section: 'models' })}>{say('Cấu hình model', 'Configure models')} →</a></header>
    <form className="ai-workflow-form" onSubmit={submit}><label htmlFor="ai-workflow-input">{say('Bạn muốn đánh giá điều gì?', 'What would you like to review?')}</label><textarea id="ai-workflow-input" rows={4} value={text} maxLength={2000} disabled={busy || !!pending} onChange={event => setText(event.target.value)} placeholder={say('Ví dụ: đánh giá điểm mạnh, điểm thiếu và rủi ro của chiến lược này…', 'For example: review this strategy’s evidence, gaps and risks…')} />
      <AiSourcePicker workspace={workspace} value={source} onChange={setSource} en={en} disabled={busy || !!pending} />
      <div className="ai-row-actions"><button className="wm-button is-primary" type="submit" disabled={busy || !!pending || !text.trim()}>{say('Chạy đánh giá', 'Run review')}</button>{pending && <button className="wm-button" type="button" disabled={busy} onClick={event => void submit(event, true)}>{say('Kiểm tra yêu cầu đã gửi', 'Recover submitted request')}</button>}</div>
      {pending && <p className="ai-detail-note">{say('Yêu cầu đang được xác nhận. Kiểm tra lại dùng cùng mã yêu cầu để tránh chạy trùng.', 'The request is awaiting confirmation. Recovery reuses its request key to prevent duplicate runs.')}</p>}
    </form>
    {error && <p className="ai-inline-error" role="alert">{error} <button className="wm-button" type="button" disabled={busy} onClick={() => { reconnect(n => n + 1); reload(n => n + 1) }}>{say('Kết nối lại', 'Reconnect')}</button></p>}
    <div className="ai-workflow-layout"><nav className="ai-workflow-history" aria-label={say('Lịch sử luồng AI', 'Workflow history')}><h2>{say('Lần chạy gần đây', 'Recent runs')}</h2>{loading && <p role="status">{say('Đang tải…', 'Loading…')}</p>}{!loading && !items.length && <p className="ai-detail-note">{say('Chưa có lần chạy.', 'No runs yet.')}</p>}{items.map(item => <button type="button" key={item.id} disabled={busy} aria-current={selected === item.id ? 'true' : undefined} onClick={() => select(item.id)}><span>{item.title}</span><small>{statuses[item.status] || item.status} · {displayDate(item.created_at, { timeStyle: 'medium' })}</small></button>)}{next && <button type="button" disabled={busy} onClick={() => void more()}>{say('Xem thêm', 'Load more')}</button>}</nav>
      <div className="ai-workflow-run" aria-live="polite">{run ? <><div className="ai-workflow-run-heading"><h2>{statuses[run.status] || run.status}</h2>{running(run) && <button type="button" className="wm-button" disabled={busy || run.status === 'cancelling'} onClick={() => void stop()}>{say('Dừng', 'Stop')}</button>}</div><AiSourceProvenance source={run.grounding?.source} en={en} /><ol className="ai-workflow-steps">{['facts', 'gaps', 'reviewer'].map(node => { const step = run.steps?.find(item => item.node === node), selection = step?.selection || run.roles?.[node]?.selection || run.roles?.[node === 'reviewer' ? 'reviewer' : 'analyst']?.selection; return <li key={node}><span>{nodes[node]}</span><small>{statuses[step?.status] || (running(run) ? say('Chờ đến lượt', 'Pending') : '—')}</small>{selection && <small>{selection.model} · {selection.provider === 'local-gateway' ? 'CLIProxyAPI' : 'ChatGPT Web'}{selection.effort ? ` · ${aiEffortName(selection.effort, en)}` : ''}</small>}</li> })}</ol>{run.text && <div className="ai-workflow-output">{run.text}</div>}{run.error && <p className="ai-inline-error">{aiErrorCopy(run.error, en)}</p>}</> : <p className="ai-detail-note">{say('Chọn một lần chạy để xem tiến trình và kết quả. Rời trang không dừng tác vụ.', 'Select a run to see its progress and result. Leaving this page does not cancel it.')}</p>}</div>
    </div>
  </section>
}
