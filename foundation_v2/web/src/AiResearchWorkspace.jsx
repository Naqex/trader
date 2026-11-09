import { useEffect, useId, useRef, useState } from 'react'
import AppIcon from './AppIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import FxSelect from './FxSelect.jsx'
import SearchInput from './SearchInput.jsx'
import { matchesSearch } from './searchText.js'
import { PREVIEW_BASELINES, PREVIEW_DATASETS, PREVIEW_PHASES, PREVIEW_STATUSES, PREVIEW_TRIALS, initialResearchPreview, validPreviewTask } from './aiResearchPreview.js'
import './ai-research.css'

function readPreview(key) {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return { tasks: initialResearchPreview(), selected: 'sample-volatility' }
    const value = JSON.parse(saved)
    if (value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 100 || !value.tasks.every(validPreviewTask) || new Set(value.tasks.map(task => task.id)).size !== value.tasks.length) throw new Error('invalid-preview')
    return { tasks: value.tasks, selected: value.tasks.some(task => task.id === value.selected) ? value.selected : value.tasks[0]?.id || null }
  } catch {
    return { tasks: initialResearchPreview(), selected: 'sample-volatility', error: true }
  }
}

function Status({ status, text }) {
  const info = PREVIEW_STATUSES[status]
  return <span className={`air-status is-${info.tone}`}><AppIcon name={info.icon} size={16} />{text(info.label)}</span>
}

function CreateResearchDialog({ en, theme, onClose, onCreate }) {
  const say = (vi, english) => en ? english : vi
  const id = useId(), titleInput = useRef(null)
  const [title, setTitle] = useState(''), [objective, setObjective] = useState('')
  const [error, setError] = useState('')
  const [dataset, setDataset] = useState('crypto-daily'), [baseline, setBaseline] = useState('trend'), [limit, setLimit] = useState('12')
  useEffect(() => { titleInput.current?.focus() }, [])
  const submit = event => {
    event.preventDefault()
    if (!title.trim() || !objective.trim()) { setError(say('Nhập tên và mục tiêu nghiên cứu.', 'Enter a research name and objective.')); return }
    if (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) return
    onCreate({ id: crypto.randomUUID(), title: title.trim(), objective: objective.trim(), dataset, baseline, limit: Number(limit), status: 'draft', decision: null })
  }
  return <LegacyModal theme={theme} label={say('Nghiên cứu mới', 'New research')} closeLabel={say('Đóng', 'Close')} className="air-create-dialog" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="air-form-body">
        <p className="air-preview-note"><AppIcon name="info" size={16} />{say('Bản mẫu · Nhiệm vụ chỉ được lưu trên trình duyệt.', 'Preview · Tasks are saved in this browser only.')}</p>
        <label className="air-field" htmlFor={`${id}-title`}><span>{say('Tên nghiên cứu', 'Research name')}</span><input ref={titleInput} id={`${id}-title`} value={title} onChange={event => setTitle(event.target.value)} placeholder={say('Ví dụ: Bộ lọc biến động', 'For example: Volatility filter')} required maxLength={120} /></label>
        <label className="air-field" htmlFor={`${id}-objective`}><span>{say('Bạn muốn kiểm tra điều gì?', 'What would you like to test?')}</span><textarea id={`${id}-objective`} value={objective} onChange={event => setObjective(event.target.value)} placeholder={say('Mô tả ý tưởng và điều bạn muốn cải thiện…', 'Describe your idea and what you want to improve…')} required maxLength={1000} rows={3} /></label>
        <div className="air-form-grid">
          <div className="air-field"><span id={`${id}-data`}>{say('Dữ liệu mẫu', 'Sample data')}</span><FxSelect label={say('Dữ liệu mẫu', 'Sample data')} aria-labelledby={`${id}-data`} value={dataset} options={PREVIEW_DATASETS} localizeOptions={false} onChange={setDataset} /></div>
          <div className="air-field"><span id={`${id}-baseline`}>{say('Chiến lược so sánh', 'Baseline strategy')}</span><FxSelect label={say('Chiến lược so sánh', 'Baseline strategy')} aria-labelledby={`${id}-baseline`} value={baseline} options={PREVIEW_BASELINES.map(item => ({ value: item.value, label: item.label[en ? 1 : 0] }))} localizeOptions={false} onChange={setBaseline} /></div>
        </div>
        <label className="air-field air-limit-field" htmlFor={`${id}-limit`}><span>{say('Số lần thử tối đa', 'Maximum trials')}</span><input id={`${id}-limit`} type="number" min="1" max="100" step="1" required value={limit} onChange={event => setLimit(event.target.value)} /></label>
        {error && <p className="air-form-error" role="alert">{error}</p>}
      </div>
      <footer className="air-dialog-footer"><button type="button" className="wm-button" onClick={onClose}>{say('Hủy', 'Cancel')}</button><button type="submit" className="wm-button is-primary">{say('Tạo bản nháp', 'Create draft')}</button></footer>
    </form>
  </LegacyModal>
}

export default function AiResearchWorkspace({ workspace, language, theme = 'dark' }) {
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const text = value => Array.isArray(value) ? value[en ? 1 : 0] : value
  const key = `naqex:ai-research-preview:v1:${workspace}`
  const [initial] = useState(() => readPreview(key))
  const [tasks, setTasks] = useState(initial.tasks), [selected, setSelected] = useState(initial.selected)
  const [saveError, setSaveError] = useState(Boolean(initial.error)), [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const [tab, setTab] = useState('overview'), [creating, setCreating] = useState(false), [confirm, setConfirm] = useState(null), [notice, setNotice] = useState('')
  const [scenarioOutcome, setScenarioOutcome] = useState('review')
  const [mobileDetail, setMobileDetail] = useState(false)
  const detailHeading = useRef(null), tabsId = useId()
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ version: 1, tasks, selected })); setSaveError(false) }
    catch { setSaveError(true) }
  }, [tasks, selected, key])
  const visible = tasks.filter(task => (filter === 'all' || task.status === filter) && matchesSearch(`${text(task.title)} ${text(task.objective)} ${PREVIEW_DATASETS.find(item => item.value === task.dataset)?.label}`, search))
  const task = visible.find(item => item.id === selected) || visible[0] || null
  const updateTask = patch => {
    setTasks(items => items.map(item => item.id === task.id ? { ...item, ...patch } : item))
    setSelected(task.id)
    if (patch.status && filter !== 'all' && patch.status !== filter) setFilter('all')
  }
  const select = id => { setSelected(id); setTab('overview'); setMobileDetail(true); setNotice(''); requestAnimationFrame(() => detailHeading.current?.focus()) }
  const create = value => {
    setTasks(items => [value, ...items]); setFilter('all'); setSearch(''); setSelected(value.id); setTab('overview'); setCreating(false); setMobileDetail(true)
    setNotice(say('Đã tạo bản nháp trong bản mẫu.', 'Draft created in this preview.'))
    requestAnimationFrame(() => detailHeading.current?.focus())
  }
  const tabs = [['overview', say('Tổng quan', 'Overview')], ['trials', say('Thử nghiệm', 'Experiments')], ['activity', say('Nhật ký', 'Activity')]]
  const title = task ? text(task.title) : ''
  const current = task && PREVIEW_STATUSES[task.status]
  const dataset = task && PREVIEW_DATASETS.find(item => item.value === task.dataset)
  const baseline = task && PREVIEW_BASELINES.find(item => item.value === task.baseline)
  const outcome = task?.status === 'review' ? say('Ứng viên v2 sẵn sàng để bạn xem xét.', 'Candidate v2 is ready for review.') : task?.status === 'insufficient' ? say('Cần thêm dữ liệu trước khi kết luận.', 'More data is needed before drawing a conclusion.') : task?.status === 'failed' ? say('Dữ liệu mẫu bị thiếu. Chưa tạo được kết quả.', 'Sample data is incomplete. No result was produced.') : task?.status === 'stopped' ? say('Nghiên cứu đã dừng tại bước thử ứng viên.', 'Research stopped during candidate testing.') : task?.status === 'draft' ? say('Mục tiêu đã lưu. Chưa chạy nghiên cứu.', 'The objective is saved. Research has not started.') : say('Đang thử các ứng viên trong tình huống minh họa.', 'Candidates are being tested in this sample scenario.')
  return <section className={`air-workspace ${mobileDetail && task ? 'is-detail-open' : ''}`} data-testid="ai-research-preview" aria-labelledby="air-title">
    <header className="air-page-heading"><div className="air-heading-name"><h1 id="air-title">{say('Nghiên cứu', 'Research')}</h1></div><button type="button" className="wm-button is-primary" onClick={() => setCreating(true)} disabled={tasks.length >= 100}><AppIcon name="plus" size={16} />{say('Nghiên cứu mới', 'New research')}</button></header>
    <div className="air-preview-bar"><span><AppIcon name="info" size={16} />{say('Dữ liệu minh họa · Lưu trên trình duyệt', 'Sample data · Saved in this browser')}</span><button type="button" className="air-text-button" onClick={() => setConfirm('reset')}><AppIcon name="restore" size={16} />{say('Khôi phục mẫu', 'Reset preview')}</button></div>
    {saveError && <p className="air-message is-warning" role="alert">{say('Không đọc hoặc lưu được bản mẫu trên trình duyệt. Các thay đổi hiện chỉ giữ trong phiên này.', 'Browser storage could not be read or saved. Changes are currently kept in this session only.')}</p>}
    {initial.error && !saveError && <p className="air-message is-warning" role="alert">{say('Không đọc được bản đã lưu. Đã mở lại dữ liệu mẫu.', 'The saved preview could not be read. Sample data has been restored.')}</p>}
    <p className="air-announcement" role="status">{notice}</p>
    <div className="air-layout">
      <aside className="air-sidebar" aria-label={say('Danh sách nghiên cứu', 'Research list')}>
        <div className="air-list-tools"><SearchInput aria-label={say('Tìm nghiên cứu', 'Search research')} placeholder={say('Tìm nghiên cứu…', 'Search research…')} value={search} onChange={event => { setSearch(event.target.value); setMobileDetail(false) }} /><FxSelect label={say('Trạng thái nghiên cứu', 'Research status')} icon="filter" value={filter} localizeOptions={false} options={[{ value: 'all', label: say('Tất cả trạng thái', 'All statuses') }, ...Object.entries(PREVIEW_STATUSES).map(([value, info]) => ({ value, label: text(info.label) }))]} onChange={value => { setFilter(value); setMobileDetail(false) }} /></div>
        <div className="air-task-list">{visible.map(item => <button type="button" key={item.id} className={`air-task ${task?.id === item.id ? 'is-selected' : ''}`} aria-current={task?.id === item.id ? 'true' : undefined} onClick={() => select(item.id)}><span className="air-task-title">{text(item.title)}</span><Status status={item.status} text={text} /><small>{PREVIEW_DATASETS.find(data => data.value === item.dataset)?.label}</small></button>)}</div>
        {!visible.length && <div className="air-list-empty"><AppIcon name="search" size={24} /><p>{say('Không tìm thấy nghiên cứu.', 'No research found.')}</p><button type="button" className="air-text-button" onClick={() => { setSearch(''); setFilter('all') }}>{say('Xóa bộ lọc', 'Clear filters')}</button></div>}
      </aside>
      <div className="air-detail">{task ? <>
        <button type="button" className="air-text-button air-back" onClick={() => { setMobileDetail(false); requestAnimationFrame(() => document.querySelector('.air-task.is-selected')?.focus()) }}><AppIcon name="arrow-left" size={16} />{say('Danh sách nghiên cứu', 'Research list')}</button>
        <header className="air-detail-heading"><div><Status status={task.status} text={text} /><h2 ref={detailHeading} tabIndex={-1}>{title}</h2><p>{text(task.objective)}</p></div>{task.status === 'running' && <button type="button" className="wm-button" onClick={() => setConfirm('stop')}><AppIcon name="pause" size={16} />{say('Dừng bản mẫu', 'Stop preview')}</button>}</header>
        <div className="air-context"><div><span>{say('Dữ liệu mẫu', 'Sample data')}</span><strong><AppIcon name="database" size={16} />{dataset.label}</strong></div><div><span>{say('Mốc so sánh', 'Baseline')}</span><strong>{text(baseline.label)}</strong></div><div><span>{say('Giới hạn', 'Limit')}</span><strong>{say(`Tối đa ${task.limit} lần thử`, `Up to ${task.limit} trials`)}</strong></div></div>
        <div className="air-tabs" role="tablist" aria-label={say('Chi tiết nghiên cứu', 'Research details')}>{tabs.map(([value, label], index) => <button type="button" key={value} role="tab" id={`${tabsId}-${value}`} aria-controls={`${tabsId}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
          setTab(tabs[next][0]); event.currentTarget.parentElement.children[next].focus()
        }}>{label}{value === 'trials' && task.status === 'review' && <span>3</span>}</button>)}</div>
        <div className="air-tab-panel" id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} tabIndex={0} key={`${task.id}:${tab}`}>
          {tab === 'overview' && <>
            <section className="air-section"><h3>{say('Quy trình nghiên cứu', 'Research process')}</h3><ol className="air-process">{PREVIEW_PHASES.map((phase, index) => {
              const done = index < current.phase && task.status !== 'failed', active = task.status === 'running' && index === current.phase
              return <li key={index} className={done ? 'is-done' : active ? 'is-active' : ''}><span className="air-process-mark"><AppIcon name={done ? 'check' : task.status === 'failed' && index === 0 ? 'warning' : active ? 'activity' : 'clock'} size={16} /></span><span>{text(phase)}</span><small>{done ? say('Hoàn tất', 'Complete') : task.status === 'failed' && index === 0 ? say('Lỗi dữ liệu', 'Data error') : active ? say('Đang xử lý', 'In progress') : task.status === 'stopped' && index >= current.phase ? say('Đã dừng', 'Stopped') : say('Chưa thực hiện', 'Not started')}</small></li>
            })}</ol></section>
            <section className={`air-outcome is-${current.tone}`}><div><AppIcon name={current.icon} size={20} /><h3>{say('Kết luận hiện tại', 'Current conclusion')}</h3></div><p>{outcome}</p>{task.status === 'review' && <><p className="air-outcome-detail">{say('Trong ví dụ này, v2 cải thiện kết quả sau phí. Bước tiếp theo là xem bằng chứng trước khi xét demo.', 'In this example, v2 improves results after costs. Review the evidence before considering a demo.')}</p><button type="button" className="air-text-button" onClick={() => setTab('trials')}>{say('Xem các thử nghiệm', 'View experiments')}<AppIcon name="arrow-right" size={16} /></button></>}{task.status === 'insufficient' && <p className="air-outcome-detail">{say('Số giao dịch và điều kiện thị trường trong mẫu chưa đủ để đánh giá độ bền.', 'The sample has too few trades and market conditions to assess robustness.')}</p>}{task.status === 'failed' && <p className="air-outcome-detail">{say('Một đoạn dữ liệu bị thiếu. Đây là lỗi lượt chạy, chưa phải kết luận về chiến lược.', 'A segment of data is missing. This is a run error, not a verdict on the strategy.')}</p>}</section>
          </>}
          {tab === 'trials' && <section className="air-section"><div className="air-section-heading"><h3>{say('Các phiên bản đã thử', 'Candidate experiments')}</h3><span className="air-subtle">{say('Số liệu minh họa', 'Illustrative values')}</span></div>{task.status === 'review' ? <>
            <div className="air-table-scroll" role="region" aria-label={say('Bảng thử nghiệm', 'Experiments table')} tabIndex={0}><table className="air-trials-table"><thead><tr>{[say('Phiên bản', 'Version'), say('Thay đổi', 'Change'), say('Sau phí', 'After costs'), say('Sụt giảm', 'Drawdown'), say('Kết luận', 'Verdict')].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody><tr className="air-baseline-row"><th scope="row">{say('Mốc gốc', 'Baseline')}</th><td>{text(baseline.label)}</td><td>+6.2%</td><td>−8.6%</td><td>—</td></tr>{PREVIEW_TRIALS.map(trial => <tr key={trial.version}><th scope="row">{trial.version}</th><td>{text(trial.change)}</td><td>{trial.pnl || '—'}</td><td>{trial.drawdown || '—'}</td><td><span className={`air-verdict is-${trial.tone}`}>{text(trial.verdict)}</span></td></tr>)}</tbody></table></div>
            <div className="air-evidence"><h3>{say('Bằng chứng cần xem', 'Evidence to review')}</h3><ul><li><AppIcon name="check" size={16} />{say('So sánh cùng dữ liệu và chi phí', 'Same data and cost assumptions')}</li><li><AppIcon name="check" size={16} />{say('Lưu cả thử nghiệm không cải thiện', 'Includes experiments with no improvement')}</li><li><AppIcon name="clock" size={16} />{say('Demo chưa được thực hiện', 'Demo has not been run')}</li></ul></div>
          </> : <div className="air-empty"><AppIcon name="layers" size={28} /><h3>{say('Chưa có kết quả thử nghiệm', 'No experiment results yet')}</h3><p>{outcome}</p></div>}</section>}
          {tab === 'activity' && <section className="air-section"><div className="air-section-heading"><h3>{say('Nhật ký nghiên cứu', 'Research activity')}</h3><span className="air-subtle">{say('Tình huống minh họa', 'Sample scenario')}</span></div><ol className="air-activity"><li><AppIcon name="document" size={16} /><div><strong>{say('Đã lưu mục tiêu nghiên cứu', 'Research objective saved')}</strong><p>{text(task.objective)}</p></div></li>{task.status !== 'draft' && <li><AppIcon name={task.status === 'failed' ? 'warning' : 'database'} size={16} /><div><strong>{task.status === 'failed' ? say('Phát hiện dữ liệu thiếu', 'Missing data detected') : say('Đã kiểm tra dữ liệu mẫu', 'Sample data checked')}</strong><p>{dataset.label}</p></div></li>}{!['draft', 'failed'].includes(task.status) && <li><AppIcon name="layers" size={16} /><div><strong>{say('Đã tạo ứng viên để thử nghiệm', 'Candidates prepared for testing')}</strong><p>{say('Mọi lần thử được giữ trong cùng hồ sơ.', 'All trials are kept in the same record.')}</p></div></li>}{task.status === 'stopped' && <li><AppIcon name="pause" size={16} /><div><strong>{say('Bạn đã dừng tình huống mẫu', 'You stopped the sample scenario')}</strong></div></li>}{task.decision && <li><AppIcon name="shield" size={16} /><div><strong>{task.decision === 'demo-requested' ? say('Đã ghi nhận lựa chọn xét demo trong bản mẫu', 'Demo review choice recorded in the preview') : say('Đã yêu cầu nghiên cứu thêm trong bản mẫu', 'Further research requested in the preview')}</strong><p>{say('Chưa tạo lượt chạy hoặc gửi lệnh.', 'No run or order was created.')}</p></div></li>}</ol></section>}
        </div>
        <footer className="air-detail-footer">{task.decision ? <><p role="status"><AppIcon name="check" size={16} />{task.decision === 'demo-requested' ? say('Đã ghi nhận: xét chạy demo · Bản mẫu', 'Recorded: review for demo · Preview') : say('Đã ghi nhận: nghiên cứu thêm · Bản mẫu', 'Recorded: further research · Preview')}</p><button type="button" className="air-text-button" onClick={() => updateTask({ decision: null })}>{say('Đổi lựa chọn', 'Change choice')}</button></> : task.status === 'review' ? <><span className="air-subtle">{say('Bước tiếp theo', 'Next step')}</span><div><button type="button" className="wm-button" onClick={() => setConfirm('rework')}>{say('Nghiên cứu thêm', 'Research further')}</button><button type="button" className="wm-button is-primary" onClick={() => setConfirm('demo')}><AppIcon name="shield" size={16} />{say('Xét chạy demo', 'Review for demo')}</button></div></> : task.status === 'draft' ? <><span className="air-subtle">{say('Thử workflow với dữ liệu minh họa', 'Explore the workflow with sample data')}</span><button type="button" className="wm-button is-primary" onClick={() => { setScenarioOutcome('review'); setConfirm('start') }}><AppIcon name="play" size={16} />{say('Xem luồng mẫu', 'Explore sample flow')}</button></> : task.status === 'running' ? <><span className="air-subtle">{say('Tiến trình minh họa', 'Sample process')}</span><button type="button" className="wm-button" onClick={() => { updateTask({ status: task.previewOutcome || 'review' }); setNotice(say('Đã mở kết quả minh họa. Chưa chạy engine.', 'Sample result opened. No engine was run.')) }}>{say('Xem kết quả mẫu', 'View sample result')}<AppIcon name="arrow-right" size={16} /></button></> : <p className="air-subtle"><AppIcon name="info" size={16} />{say('Chọn nhiệm vụ mẫu khác để xem các trạng thái.', 'Select another sample task to explore its state.')}</p>}</footer>
      </> : <div className="air-empty air-no-selection"><AppIcon name="search" size={28} /><h2>{say('Chưa có nghiên cứu phù hợp', 'No matching research')}</h2><p>{say('Đổi bộ lọc hoặc tạo một bản nghiên cứu mới.', 'Adjust your filters or create a research draft.')}</p></div>}</div>
    </div>
    {creating && <CreateResearchDialog en={en} theme={theme} onClose={() => setCreating(false)} onCreate={create} />}
    {confirm && <LegacyModal theme={theme} className="air-confirm-dialog" closeLabel={say('Đóng', 'Close')} label={confirm === 'reset' ? say('Khôi phục dữ liệu mẫu?', 'Reset sample data?') : confirm === 'stop' ? say('Dừng tình huống mẫu?', 'Stop the sample scenario?') : confirm === 'start' ? say('Xem luồng nghiên cứu mẫu', 'Explore a sample research flow') : confirm === 'demo' ? say('Xét chạy demo', 'Review for demo') : say('Nghiên cứu thêm', 'Research further')} onClose={() => setConfirm(null)}><div className="air-form-body"><p>{confirm === 'reset' ? say('Các bản nháp và lựa chọn trong bản mẫu này sẽ được thay bằng dữ liệu ban đầu.', 'Drafts and choices in this preview will be replaced with the original sample data.') : confirm === 'stop' ? say('Dừng tiến trình minh họa và giữ lại hồ sơ. Không có tác vụ AI thật đang chạy.', 'Stop the sample process and keep its record. No real AI task is running.') : confirm === 'start' ? say('Chọn tình huống để thử giao diện. Mọi tiến trình và số liệu đều là minh họa; chưa gọi AI hoặc engine.', 'Choose a scenario to try the interface. All progress and values are illustrative; no AI or engine is called.') : confirm === 'demo' ? say('Bản mẫu chỉ ghi nhận lựa chọn của bạn. Chưa kết nối engine, tài khoản demo hoặc gửi lệnh.', 'This preview only records your choice. It does not connect an engine or demo account, or send orders.') : say('Ghi nhận yêu cầu tìm thêm bằng chứng. Bản mẫu chưa khởi chạy nghiên cứu mới.', 'Record a request for more evidence. This preview does not start new research.')} </p>{confirm === 'start' && <FxSelect label={say('Kết quả minh họa', 'Sample outcome')} value={scenarioOutcome} localizeOptions={false} options={['review', 'insufficient', 'failed'].map(value => ({ value, label: text(PREVIEW_STATUSES[value].label) }))} onChange={setScenarioOutcome} />}</div><footer className="air-dialog-footer"><button type="button" className="wm-button" onClick={() => setConfirm(null)}>{say('Hủy', 'Cancel')}</button><button type="button" className="wm-button is-primary" onClick={() => {
      if (confirm === 'reset') { setTasks(initialResearchPreview()); setSelected('sample-volatility'); setSearch(''); setFilter('all'); setMobileDetail(false); setTab('overview') }
      else if (confirm === 'stop') updateTask({ status: 'stopped' })
      else if (confirm === 'start') updateTask({ status: scenarioOutcome === 'failed' ? 'failed' : 'running', previewOutcome: scenarioOutcome })
      else updateTask({ decision: confirm === 'demo' ? 'demo-requested' : 'rework' })
      setConfirm(null); setNotice(say('Đã cập nhật bản mẫu trên trình duyệt.', 'Browser preview updated.'))
      if (confirm !== 'reset') requestAnimationFrame(() => detailHeading.current?.focus())
    }}>{confirm === 'reset' ? say('Khôi phục mẫu', 'Reset preview') : confirm === 'stop' ? say('Dừng bản mẫu', 'Stop preview') : confirm === 'start' ? say('Mở tình huống mẫu', 'Open sample scenario') : say('Ghi nhận lựa chọn', 'Record choice')}</button></footer></LegacyModal>}
  </section>
}
