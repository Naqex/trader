import { useEffect, useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import { AiStatus } from './AiStudio.jsx'
import './ai-workspace.css'
import './studio-workflows.css'

const storageKey = `naqex-studio-workflow:${new URLSearchParams(location.search).get('workspace') || 'local'}`
function savedIntent() {
  try { return JSON.parse(sessionStorage.getItem(storageKey)) || {} } catch { return {} }
}
async function request(input) {
  const response = await fetch('/integrations/paperclip/workflows', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    signal: AbortSignal.timeout(50000),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error || 'outcome_unknown')
  return result.result
}

export default function StudioWorkflows({ language, onClose, onNavigate }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const initial = useRef(savedIntent()).current
  const [catalog, setCatalog] = useState(null), [graph, setGraph] = useState(null)
  const [draft, setDraft] = useState(initial.draft || null), [profile, setProfile] = useState(initial.draft?.profile || 'forex')
  const [creating, setCreating] = useState(Boolean(initial.draft)), [busy, setBusy] = useState('overview')
  const [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [confirm, setConfirm] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const lock = useRef(false), generation = useRef(0)
  const mutationPending = ['create', 'start', 'cancel'].includes(busy)
  const errors = {
    worker_unavailable: say('Worker chưa sẵn sàng. Kiểm tra agent trong Paperclip.', 'The worker is unavailable. Check its agent in Paperclip.'),
    workflow_scope: say('Công việc đã đổi công ty hoặc dự án. Chọn lại quy trình.', 'The task changed company or project. Select the workflow again.'),
    workflow_changed: say('Các bước đã thay đổi. Mở Paperclip để kiểm tra trước khi chạy.', 'The steps changed. Inspect them in Paperclip before starting.'),
    operation_pending: say('Một thao tác đang được xử lý. Kiểm tra lại sau.', 'Another operation is pending. Check again shortly.'),
  }
  const fail = problem => {
    setErrorCode(problem.message)
    const unknown = !['worker_unavailable', 'workflow_scope', 'workflow_changed', 'invalid_request', 'operation_pending'].includes(problem.message)
    setUncertain(unknown)
    setError(errors[problem.message] || say('Chưa xác nhận được kết quả. Kiểm tra lại trước khi thao tác tiếp.', 'The outcome is unconfirmed. Check again before continuing.'))
  }
  const labels = { backlog: say('Bản nháp', 'Draft'), todo: say('Đang chờ', 'Queued'),
    in_progress: say('Đang chạy', 'Running'), in_review: say('Chờ bạn xem', 'Awaiting your review'),
    done: say('Hoàn tất', 'Done'), blocked: say('Bị chặn', 'Blocked'), cancelled: say('Đã hủy', 'Cancelled') }
  const status = value => <AiStatus tone={value === 'blocked' ? 'warning' : value === 'done' ? 'positive' : 'muted'}>{labels[value] || value}</AiStatus>
  const watching = graph?.steps.some(step => ['queued', 'running'].includes(step.observation?.run?.status)
    || (['todo', 'in_progress'].includes(graph.status) && ['todo', 'in_progress'].includes(step.status)
      && step.observation?.state === 'not_started')) || false
  const observations = {
    not_started: say('Chưa có lượt chạy.', 'No run yet.'),
    unavailable: say('Chưa đọc được lượt chạy. Kiểm tra lại trước khi thao tác tiếp.', 'Run details are unavailable. Refresh before continuing.'),
    unknown: say('Chưa đối chiếu được kết quả. Mở công việc để kiểm tra trước khi chạy lại.', 'The outcome is unconfirmed. Inspect the task before rerunning.'),
    interrupted: say('Lượt chạy đã dừng nhưng worker chưa ghi kết quả cuối. Cần kiểm tra trước khi chạy lại.', 'The run stopped without a final worker receipt. Inspect it before rerunning.'),
    delivery_pending: say('Kết quả đã lưu. Kiểm tra việc gửi báo cáo trước khi chạy lại AI.', 'Output was saved. Check report delivery before rerunning AI.'),
    evidence_mismatch: say('Receipt hoặc kết quả không khớp. Cần kiểm tra dữ liệu đã lưu.', 'The receipt or output does not match. Inspect the saved evidence.'),
    recorded: say('Trạng thái lượt chạy và receipt khớp; kết quả đã gửi.', 'Run and receipt states agree; output was delivered.'),
    failed: say('Lượt chạy chưa thành công. Mở công việc để xem nguyên nhân.', 'The run failed. Open the task to inspect the cause.'),
    cancelled: say('Lượt chạy đã hủy. Kết quả cũ được giữ lại.', 'The run was cancelled. Previous output is preserved.'),
    active: say('Đang theo dõi lượt chạy.', 'Tracking the run.'),
  }
  const duration = seconds => seconds == null ? say('Chưa có', 'Unavailable')
    : seconds < 60 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} ${say('phút', 'min')} ${Math.floor(seconds % 60)} s`
  async function load(company = catalog?.company || '', project = catalog?.project || '', parent = graph?.id || '') {
    if (lock.current) return
    const current = ++generation.current
    setBusy('overview'); setError(''); setConfirm('')
    try {
      const result = await request({ action: 'overview', ...(company && { company }), ...(project && { project }) })
      if (current !== generation.current) return
      setCatalog(result)
      if (parent && result.company) {
        const detail = await request({ action: 'get', company: result.company, parent })
        if (current === generation.current) setGraph(detail)
      } else setGraph(null)
      setUncertain(false)
    } catch (problem) { if (current === generation.current) fail(problem) }
    finally { if (current === generation.current) setBusy('') }
  }
  useEffect(() => { void load(initial.company, initial.project, initial.parent); return () => { generation.current++ } }, [])
  useEffect(() => {
    if (!watching || busy || confirm || uncertain || creating) return
    let stopped = false, timer
    const poll = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        try {
          const detail = await request({ action: 'get', company: graph.company, parent: graph.id })
          if (!stopped) setGraph(detail)
        } catch (problem) { if (!stopped) { fail(problem); return } }
      }
      if (!stopped) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [graph?.id, watching, busy, confirm, uncertain, creating])
  useEffect(() => {
    if (!catalog) return
    try { sessionStorage.setItem(storageKey, JSON.stringify({ company: catalog.company, project: catalog.project, parent: graph?.id, draft })) } catch { /* Native tasks remain recoverable without browser storage. */ }
  }, [catalog, graph, draft])
  async function operate(action) {
    if (lock.current || !catalog?.company || (uncertain && action !== 'create')) return
    lock.current = true; setBusy(action); setError('')
    let intent = draft
    if (action === 'create' && !intent) {
      intent = { company: catalog.company, project: catalog.project, profile, key: 'studio-' + crypto.randomUUID() }
      setDraft(intent)
      // Save the idempotency token before the request, including a tab reload mid-flight.
      try { sessionStorage.setItem(storageKey, JSON.stringify({ company: catalog.company, project: catalog.project, draft: intent })) } catch { /* The current dialog still retains the token. */ }
    }
    try {
      const result = await request(action === 'create' ? { action, ...intent } : { action, company: catalog.company, parent: graph.id })
      setGraph(result); setCreating(false); setDraft(null); setConfirm(''); setUncertain(false)
      setCatalog(current => ({ ...current, workflows: [{ id: result.id, identifier: result.identifier, title: result.title, status: result.status },
        ...current.workflows.filter(row => row.id !== result.id)].slice(0, 10) }))
    } catch (problem) { fail(problem) }
    finally { lock.current = false; setBusy('') }
  }
  const close = () => { if (!lock.current) onClose() }
  const openTask = id => { close(); onNavigate(id) }
  const newDraft = () => { setGraph(null); setCreating(true); setError(''); setConfirm(''); setUncertain(false) }
  const resetScope = () => {
    setDraft(null); setCreating(false); setGraph(null)
    try { sessionStorage.removeItem(storageKey) } catch { /* Only the local selection is discarded. */ }
    void load('', '', '')
  }
  return <LegacyModal className="studio-workflows" label={say('Quy trình', 'Workflows')}
    theme={document.querySelector('.fx-app')?.dataset.theme || 'dark'} onClose={close} closeLabel={say('Đóng', 'Close')}>
    <div className="studio-workflow-body" aria-busy={Boolean(busy)}>
      {catalog && <div className="studio-workflow-scope">
        <label>{say('Công ty', 'Company')}<select value={catalog.company || ''} disabled={Boolean(busy) || Boolean(draft)} onChange={event => { setCreating(false); void load(event.target.value, '', '') }}>
          <option value="" disabled>{say('Chọn công ty', 'Choose a company')}</option>
          {catalog.companies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <label>{say('Dự án', 'Project')}<select value={catalog.project || ''} disabled={Boolean(busy) || Boolean(draft) || !catalog.company} onChange={event => { setCreating(false); void load(catalog.company, event.target.value, '') }}>
          <option value="" disabled>{say('Chọn dự án', 'Choose a project')}</option>
          {catalog.projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
      </div>}
      {error && <div><p className="studio-workflow-error" role="alert">{error}</p>{(!draft || ['workflow_scope', 'invalid_request'].includes(errorCode)) && <button className="wm-button" disabled={Boolean(busy)} onClick={resetScope}>{say('Chọn lại công ty và dự án', 'Choose company and project again')}</button>}</div>}
      {busy === 'overview' && <p role="status">{say('Đang đọc công việc…', 'Loading tasks…')}</p>}
      {!catalog && !busy && <button className="wm-button" onClick={() => void load(initial.company, initial.project, initial.parent)}>{say('Thử lại', 'Retry')}</button>}
      {catalog && !creating && !graph && <section>
        <div className="studio-workflow-heading"><h3>{say('Gần đây', 'Recent')}</h3><button className="wm-button is-primary" disabled={!catalog.project || Boolean(busy)} onClick={newDraft}>{say('Tạo quy trình', 'Create workflow')}</button></div>
        {!catalog.workflows.length && !busy && <p>{say('Chưa có quy trình trong dự án này.', 'No workflows in this project yet.')}</p>}
        <ul className="studio-workflow-list">{catalog.workflows.map(row => <li key={row.id}>
          <button disabled={Boolean(busy)} onClick={() => void load(catalog.company, catalog.project, row.id)}><span>{row.title}<small>{row.identifier}</small></span>{status(row.status)}</button>
        </li>)}</ul>
      </section>}
      {catalog && creating && <section>
        <label className="studio-workflow-template">{say('Mẫu quy trình', 'Workflow template')}<select value={profile} disabled={Boolean(busy) || Boolean(draft)} onChange={event => setProfile(event.target.value)}>
          {catalog.profiles.map(row => <option key={row.id} value={row.id}>{row.id === 'forex' ? say('Kiểm luồng Forex', 'Forex system check') : say('Kiểm luồng crypto spot', 'Crypto spot system check')}</option>)}
        </select></label>
        <ol className="studio-workflow-steps">
          <li><span>{profile === 'forex' ? say('Kiểm dữ liệu và mô phỏng EURUSD', 'Check data and simulate EURUSD') : say('Kiểm chứng dữ liệu BTC/ETH', 'Validate BTC/ETH data')}</span></li>
          <li><span>{say('Phản biện kết quả', 'Review the evidence')}</span></li>
          <li><span>{say('Bạn xem báo cáo', 'You review the reports')}</span></li>
          <li><span>{say('Paper — chưa chạy', 'Paper — not started')}</span></li>
        </ol>
        <p className="studio-workflow-note">{say('Dùng dữ liệu và bài kiểm đã chốt. Tạo bản nháp chưa gọi AI hoặc chạy mô phỏng.', 'Uses the registered data and system fixture. Creating a draft makes no AI calls and runs no simulation.')}</p>
      </section>}
      {graph && !creating && <section>
        <div className="studio-workflow-heading"><h3>{graph.title}<small>{graph.identifier}</small></h3>{status(graph.status)}</div>
        {graph.status === 'cancelled' && graph.can_cancel && <p role="alert" className="studio-workflow-error">{say('Một số bước chưa xác nhận dừng. Bấm Dừng để hoàn tất việc hủy.', 'Some steps have not confirmed stopping. Use Stop to finish cancellation.')}</p>}
        <ol className="studio-workflow-steps">{graph.steps.map(step => {
          const observation = step.observation, run = observation?.run
          return <li key={step.id}>
            <button className="studio-workflow-link" disabled={Boolean(busy)} onClick={() => openTask(step.id)}>{step.title}</button>{status(step.status)}
            {observation && <p className={`studio-workflow-observation ${['interrupted', 'delivery_pending', 'evidence_mismatch', 'unknown', 'unavailable', 'failed'].includes(observation.state) ? 'needs-attention' : ''}`}>{observations[observation.state]}</p>}
            {run && <details className="studio-workflow-run"><summary>{say('Thông tin lượt chạy', 'Run details')} · {duration(run.seconds)}</summary>
              <dl>
                <dt>{say('Lượt chạy', 'Run')}</dt><dd title={run.id}>{run.id}</dd>
                <dt>{say('Trạng thái worker', 'Worker status')}</dt><dd>{({ queued: say('Đang chờ', 'Queued'), running: say('Đang chạy', 'Running'), succeeded: say('Đã kết thúc', 'Finished'), failed: say('Lỗi', 'Failed'), timed_out: say('Quá thời gian', 'Timed out'), cancelled: say('Đã hủy', 'Cancelled') })[run.status] || say('Chưa rõ', 'Unknown')}</dd>
                <dt>{say('Model yêu cầu', 'Requested model')}</dt><dd>{step.role === 'research' && graph.profile === 'forex' ? say('Offline, không gọi AI', 'Offline, no AI calls') : run.requested_models.join(', ') || say('Chưa có thông tin', 'Unavailable')}</dd>
                <dt>{say('Model phản hồi', 'Reported model')}</dt><dd>{run.reported_model || say('Chưa được báo cáo', 'Not reported')}</dd>
                <dt>{say('Token vào / ra', 'Input / output tokens')}</dt><dd>{run.input_tokens == null ? '—' : run.input_tokens.toLocaleString()} / {run.output_tokens == null ? '—' : run.output_tokens.toLocaleString()}</dd>
                <dt>{say('Chi phí (USD)', 'Cost (USD)')}</dt><dd>{run.cost_usd == null ? say('Chưa được báo cáo', 'Not reported') : run.cost_usd.toLocaleString(en ? 'en-US' : 'vi-VN', { maximumFractionDigits: 6 })}{run.accounting_pending && ` · ${say('Chờ ghi nhận', 'Pending accounting')}`}</dd>
              </dl>
            </details>}
          </li>
        })}</ol>
        {watching && <p className="studio-workflow-note">{say('Tự cập nhật mỗi 5 giây khi cửa sổ đang hiển thị.', 'Updates every 5 seconds while this window is visible.')}</p>}
        <p className="studio-workflow-note">{say('Báo cáo và lượt chạy được lưu trong Paperclip. Hoàn tất quy trình chưa cấp quyền paper, demo hoặc tiền thật.', 'Reports and runs stay in Paperclip. Workflow completion does not authorize paper, demo or real-money trading.')}</p>
        {confirm && <div className="studio-workflow-confirm" role="group" aria-label={confirm === 'start' ? say('Xác nhận bắt đầu', 'Confirm start') : say('Xác nhận dừng', 'Confirm stop')}>
          <p>{confirm === 'start' ? say('Bắt đầu bài kiểm hệ thống và phản biện bằng model đã cấu hình? Lượt AI có thể dùng quota; chưa có tổng chi phí chính xác.', 'Start the system check and review using the configured model? AI calls may consume quota; the total cost is not yet known.') : say('Dừng các bước còn lại và hủy lượt đang chạy? Kết quả đã hoàn tất sẽ được giữ.', 'Stop remaining steps and cancel active runs? Completed results will be preserved.')}</p>
          <div><button className="wm-button" disabled={Boolean(busy)} onClick={() => setConfirm('')}>{say('Quay lại', 'Back')}</button><button className={`wm-button ${confirm === 'start' ? 'is-primary' : 'is-danger'}`} disabled={Boolean(busy) || uncertain} onClick={() => void operate(confirm)}>{say(busy ? 'Đang xử lý…' : confirm === 'start' ? 'Chạy quy trình' : 'Dừng quy trình', busy ? 'Processing…' : confirm === 'start' ? 'Run workflow' : 'Stop workflow')}</button></div>
        </div>}
      </section>}
    </div>
    <footer className="studio-workflow-footer">
      <button className="wm-button" disabled={Boolean(busy)} onClick={() => void load()}>{say('Kiểm tra lại', 'Refresh')}</button>
      <div>{creating ? <><button className="wm-button" disabled={Boolean(busy) || Boolean(draft)} onClick={() => setCreating(false)}>{say('Quay lại', 'Back')}</button><button className="wm-button is-primary" disabled={Boolean(busy) || !catalog?.project} onClick={() => void operate('create')}>{say(busy === 'create' ? 'Đang tạo…' : draft ? 'Khôi phục bản nháp' : 'Tạo bản nháp', busy === 'create' ? 'Creating…' : draft ? 'Recover draft' : 'Create draft')}</button></> : graph ? <>
        <button className="wm-button" disabled={Boolean(busy)} onClick={() => { setGraph(null); void load(catalog.company, catalog.project, '') }}>{say('Danh sách', 'List')}</button>
        <button className="wm-button" disabled={Boolean(busy)} onClick={() => openTask(graph.id)}>{say('Mở công việc', 'Open task')}</button>
        {graph.can_cancel && <button className="wm-button is-danger" disabled={Boolean(busy) || uncertain} onClick={() => setConfirm('cancel')}>{say('Dừng', 'Stop')}</button>}
        {graph.can_start && <button className="wm-button is-primary" disabled={Boolean(busy) || uncertain} onClick={() => setConfirm('start')}>{say('Bắt đầu', 'Start')}</button>}
      </> : <button className="wm-button" disabled={mutationPending} onClick={close}>{say('Đóng', 'Close')}</button>}</div>
    </footer>
  </LegacyModal>
}
