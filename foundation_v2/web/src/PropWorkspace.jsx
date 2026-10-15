import { createPropChartSession, openPropReplay } from './propSessionCreation.js'
import { sessionNavigationHref } from './sessionCatalog.js'
import { scopedMutation } from './scopedMutation.js'
import ProjectDateInput from './ProjectDateInput.jsx'
import { displayDate } from './dateFormat.js'
import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NotionConnector from './NotionConnector.jsx'
import './PropWorkspace.css'

const TERMINAL_STATUSES = new Set(['completed_pass', 'failed_breach', 'expired', 'abandoned'])

function formatPropMoney(value, currency = 'USD', locale = 'vi-VN') {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return 'N/A'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(number)
  } catch {
    return `${number.toLocaleString(locale)} ${currency}`
  }
}

function formatPropUtc(value, locale = 'vi-VN') {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  return displayDate(parsed, { timeStyle: 'short' })
}

function apiError(response, payload) {
  const detail = String(payload?.detail || `HTTP ${response.status}`)
  const error = new Error(detail)
  if (response.status === 403) error.kind = 'denied'
  else if (response.status === 409) error.kind = 'conflict'
  else error.kind = 'error'
  error.status = response.status
  return error
}

async function propJson(url, workspace, options = {}) {
  const method = options.method || 'GET'
  if (method !== 'GET' && !url.startsWith('/api/v2/prop/')) {
    throw new Error('unsafe_prop_mutation_target')
  }
  const transport = !options.method || options.method === 'GET' ? fetch : (target, init) => scopedMutation(target, workspace, init)
  const response = await transport(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Workspace-Id': workspace,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(response, payload)
  return payload
}

function initialDraft() {
  return {
    name: 'Challenge luyện tập',
    profileKind: 'generic',
    initialCapital: '100000',
    currency: 'USD',
    targetPercent: '10',
    dailyLoss: '5000',
    overallLoss: '10000',
    datasetVersion: 'dataset-practice-v1',
    startUtc: '2026-09-01T08:00',
    durationDays: '30',
    // The chart execution snapshot currently exposes this immutable bar-cost model.
    // Keep the Prop contract pinned to it so replay binding cannot drift after creation.
    costVersion: 'replay-fixture-cost-v1',
    engineVersion: 'replay-v1',
  }
}

function readInitialDraft(workspace, query) {
  const fallback = initialDraft()
  try {
    const encoded = query?.get?.('prop_draft')
    if (encoded) {
      const incoming = JSON.parse(encoded)
      if (incoming && typeof incoming === 'object') return normalizeDraft({ ...fallback, ...incoming })
    }
    const key = `wmreplay:prop-draft:${workspace}`
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return fallback
    window.sessionStorage.removeItem(key)
    const incoming = JSON.parse(raw)
    if (!incoming || typeof incoming !== 'object') return fallback
    return normalizeDraft({ ...fallback, ...incoming })
  } catch {
    return fallback
  }
}

function normalizeDraft(value) {
  if (value.targetPercent == null && value.target != null && Number(value.initialCapital) > 0) {
    value.targetPercent = String(Number(value.target) / Number(value.initialCapital) * 100)
  }
  if (!Array.isArray(value.datasetVersions) && value.datasetVersion) value.datasetVersions = [value.datasetVersion]
  return value
}

function StateMessage({ kind, children, testId }) {
  const role = kind === 'error' || kind === 'denied' || kind === 'conflict' ? 'alert' : 'status'
  return <div className={`prop-message prop-message-${kind}`} role={role} data-testid={testId}>{children}</div>
}

function sessionLabel(session) {
  const profile = session?.profile
  if (!profile) return session?.session_id || 'Session'
  return profile.source_kind === 'custom' ? 'Custom practice' : 'Generic practice'
}

function propReasonLabel(code) {
  const labels = {
    daily_loss_breached: 'Daily loss đã bị breach.',
    overall_drawdown_breached: 'Overall drawdown đã bị breach.',
    data_quality_incomplete: 'Thiếu dữ liệu để kết luận đầy đủ.',
    virtual_cutoff_expired: 'Attempt hết thời gian mô phỏng.',
    attempt_abandoned: 'Attempt đã bị bỏ.',
    declared_objectives_satisfied: 'Các objective đã khai báo được thỏa mãn.',
  }
  return labels[code] || code
}

function reportReplayHref(report, workspace) {
  const binding = report?.provenance?.replay_binding
  const cursor = report?.provenance?.replay_cursor
  const cursorIndex = Number(cursor?.bar_index)
  if (!binding?.replay_session_id || !Number.isInteger(cursorIndex) || cursorIndex < 0) return null
  const params = new URLSearchParams({
    view: 'replay',
    workspace,
    session: binding.replay_session_id,
    cursor: String(cursorIndex),
    from: 'prop-report',
  })
  return { href: `/?${params.toString()}`, cursorIndex }
}

function objectiveStateLabel(value) {
  if (value === true) return 'Đạt'
  if (value === false) return 'Chưa đạt'
  return 'Chưa rõ'
}

function objectiveNumber(value, currency = 'USD', locale = 'vi-VN') {
  return value === null || value === undefined ? 'N/A' : formatPropMoney(value, currency, locale)
}

function objectiveSummary(objectives, phase, currency, locale = 'vi-VN') {
  if (!objectives || typeof objectives !== 'object') return null
  const money = objectives.money && typeof objectives.money === 'object' ? objectives.money : null
  const calendar = objectives.calendar && typeof objectives.calendar === 'object' ? objectives.calendar : null
  return {
    technicalStatus: objectives.technical_status || 'unknown',
    passReady: objectives.pass_ready === true,
    positionsReady: objectives.positions_ready === true,
    profitTarget: money?.profit_target ? {
      status: objectiveStateLabel(money.profit_target.hit),
      current: objectiveNumber(money.profit_target.current, currency, locale),
      target: objectiveNumber(money.profit_target.target, currency, locale),
    } : null,
    dailyLoss: money?.daily_loss ? {
      status: money.daily_loss.breached ? 'Breached' : 'Trong giới hạn',
      current: objectiveNumber(money.daily_loss.current, currency, locale),
      floor: objectiveNumber(money.daily_loss.floor, currency, locale),
    } : null,
    overallDrawdown: money?.overall_drawdown ? {
      status: money.overall_drawdown.breached ? 'Breached' : 'Trong giới hạn',
      current: objectiveNumber(money.overall_drawdown.current, currency, locale),
      floor: objectiveNumber(money.overall_drawdown.floor, currency, locale),
      kind: money.overall_drawdown.kind || 'static',
    } : null,
    calendar: calendar ? {
      qualifyingDays: calendar.qualifying_days,
      minDaysSatisfied: calendar.min_qualifying_days_satisfied === true,
      elapsedDays: calendar.elapsed_calendar_days,
      expired: calendar.expired === true,
      deadline: calendar.deadline_utc,
    } : null,
    phaseIndex: objectives.phase_index || phase?.phase_index || null,
  }
}

export default function PropWorkspace({ workspace, query }) {
  const { t, locale, statusLabel } = useTestingLocale()
  const formatMoney = (value, currency) => formatPropMoney(value, currency, locale)
  const formatUtc = value => formatPropUtc(value, locale)
  const reportReasonLabel = code => t(propReasonLabel(code))

  const [draft, setDraft] = useState(() => readInitialDraft(workspace, query))
  const [sessions, setSessions] = useState({ status: 'loading', items: [], error: null })
  const [datasets, setDatasets] = useState({ status: 'loading', items: [], error: null })
  const [selected, setSelected] = useState({ status: 'idle', session: null, attempts: [], bundle: null, report: null, reportError: null, error: null })
  const [activeTab, setActiveTab] = useState('sessions')
  const [reports, setReports] = useState({ status: 'idle', items: [], error: null })
  const [reportFilters, setReportFilters] = useState({ status: '', branchKind: '' })
  const [pendingAction, setPendingAction] = useState('')
  const [conflict, setConflict] = useState(null)
  const autoCreateRef = useRef(false)

  const loadBundle = useCallback(async (session, attempts) => {
    const latest = attempts.length ? attempts[attempts.length - 1] : null
    if (!latest) {
      setSelected({ status: 'ready', session, attempts, bundle: null, report: null, reportError: null, error: null })
      return
    }
    setSelected((current) => ({ ...current, status: 'loading', session, attempts, error: null }))
    try {
      const attemptBase = `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts/${encodeURIComponent(latest.attempt_id)}`
      const bundle = await propJson(attemptBase, workspace)
      let report = null
      let reportError = null
      try {
        report = await propJson(`${attemptBase}/report`, workspace)
      } catch (error) {
        reportError = error.message
      }
      setSelected({ status: 'ready', session, attempts, bundle, report, reportError, error: null })
    } catch (error) {
      setSelected({ status: error.kind || 'error', session, attempts, bundle: null, report: null, reportError: null, error: error.message })
    }
  }, [workspace])

  const openSession = useCallback(async (session) => {
    setConflict(null)
    setSelected({ status: 'loading', session, attempts: [], bundle: null, report: null, reportError: null, error: null })
    try {
      const payload = await propJson(
        `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts`,
        workspace,
      )
      await loadBundle(session, payload.items || [])
    } catch (error) {
      setSelected({ status: error.kind || 'error', session, attempts: [], bundle: null, report: null, reportError: null, error: error.message })
    }
  }, [loadBundle, workspace])

  const loadSessions = useCallback(async ({ preserveSelection = false } = {}) => {
    setSessions((current) => ({ status: 'loading', items: preserveSelection ? current.items : [], error: null }))
    try {
      const payload = await propJson('/api/v2/prop/sessions', workspace)
      const items = payload.items || []
      setSessions({ status: 'ready', items, error: null })

      if (!items.length) {
        setSelected({ status: 'idle', session: null, attempts: [], bundle: null, report: null, reportError: null, error: null })
        return
      }

      const currentId = preserveSelection ? selected.session?.session_id : null
      const target = items.find((item) => item.session_id === currentId) || items[items.length - 1]
      await openSession(target)
    } catch (error) {
      setSessions({ status: error.kind || 'error', items: [], error: error.message })
    }
  }, [openSession, selected.session?.session_id, workspace])

  useEffect(() => {
    loadSessions()
  }, [workspace]) // Re-discover sessions and attempts from the backend on every page load/workspace change.

  useEffect(() => {
    let cancelled = false
    propJson('/api/v2/data/datasets', workspace)
      .then(payload => {
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        setDatasets({ status: 'ready', items, error: null })
        setDraft(current => {
          if (!items.length || items.some(item => item.dataset_id === current.datasetVersion)) return current
          return { ...current, datasetVersion: String(items[0].dataset_id) }
        })
      })
      .catch(error => { if (!cancelled) setDatasets({ status: error.kind || 'error', items: [], error: error.message }) })
    return () => { cancelled = true }
  }, [workspace])

  const loadReports = useCallback(async () => {
    setReports((current) => ({ status: 'loading', items: current.items, error: null }))
    const params = new URLSearchParams()
    if (reportFilters.status) params.set('status', reportFilters.status)
    if (reportFilters.branchKind) params.set('branch_kind', reportFilters.branchKind)
    try {
      const payload = await propJson(`/api/v2/prop/reports${params.size ? `?${params}` : ''}`, workspace)
      setReports({ status: 'ready', items: payload.items || [], error: null })
    } catch (error) {
      setReports({ status: error.kind || 'error', items: [], error: error.message })
    }
  }, [reportFilters, workspace])

  useEffect(() => {
    if (activeTab === 'reports' || activeTab === 'notion') loadReports()
  }, [activeTab, loadReports])

  useEffect(() => {
    const refresh = () => {
      if (pendingAction) return
      loadSessions({ preserveSelection: true })
      if (activeTab === 'reports' || activeTab === 'notion') loadReports()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [activeTab, loadReports, loadSessions, pendingAction])

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }))

  const createSession = useCallback(async (event) => {
    event.preventDefault()
    setConflict(null)
    setPendingAction('create')
    try {
      const { replay } = await createPropChartSession(workspace, draft, datasets.items)
      window.location.assign(sessionNavigationHref('replay', workspace, query, replay, { select: null, surface: 'workspace' }))
    } catch (error) {
      if (error.kind === 'conflict') setConflict(error.message)
      else if (error.kind === 'denied') setSessions({ status: 'denied', items: [], error: error.message })
      else setConflict(t("Không tạo được session: {error}", { error: error.message }))
      if (error.kind !== 'conflict') await loadSessions({ preserveSelection: true }).catch(() => {})
    } finally {
      setPendingAction('')
    }
  }, [datasets.items, draft, loadBundle, loadSessions, workspace])

  useEffect(() => {
    if (query?.get?.('prop_setup') !== '1' || autoCreateRef.current || datasets.status !== 'ready' || pendingAction) return
    autoCreateRef.current = true
    createSession({ preventDefault() {} })
  }, [createSession, datasets.status, pendingAction, query])

  const transitionAttempt = useCallback(async (action) => {
    const session = selected.session
    const attempt = selected.bundle?.attempt
    const phase = selected.bundle?.phase
    if (!session || !attempt || !phase) return
    const pendingKey = `transition:${action}`
    setPendingAction(pendingKey)
    setConflict(null)
    try {
      const payload = await propJson(
        `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts/${encodeURIComponent(attempt.attempt_id)}/transitions`,
        workspace,
        {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: workspace,
            session_id: session.session_id,
            attempt_id: attempt.attempt_id,
            profile_hash: attempt.profile_hash,
            // Revision-scoped IDs make a retried click idempotent after a lost response.
            intent_id: `ui-${action}-${attempt.attempt_id}-${attempt.revision}`,
            expected_revision: attempt.revision,
            event_sequence: phase.last_event_sequence,
            action,
          }),
        },
      )
      const updatedSession = payload.session || session
      setSessions((current) => ({
        ...current,
        items: current.items.map((item) => item.session_id === updatedSession.session_id ? updatedSession : item),
      }))
      await loadBundle(updatedSession, [payload.attempt])
    } catch (error) {
      if (error.kind === 'conflict') setConflict(t("Lifecycle chưa đổi được: {error}", { error: error.message }))
      else if (error.kind === 'denied') setSelected((current) => ({ ...current, status: 'denied', error: error.message }))
      else setConflict(t("Lifecycle chưa đổi được: {error}", { error: error.message }))
    } finally {
      setPendingAction('')
    }
  }, [loadBundle, selected.bundle, selected.session, workspace])

  const retryAttempt = useCallback(async () => {
    const session = selected.session
    const parent = selected.bundle?.attempt
    const previousPhase = selected.bundle?.phase
    if (!session || !parent || !previousPhase || !TERMINAL_STATUSES.has(parent.status) || pendingAction) return
    const profilePhase = session.profile?.phases?.find(item => item.phase_index === 1) || session.profile?.phases?.[0]
    if (!profilePhase) return
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const attemptId = `attempt-${suffix}`
    const startUtc = parent.virtual_start_utc
    const initial = String(profilePhase.initial_capital)
    const phase = {
      ...previousPhase,
      attempt_id: attemptId,
      phase_index: 1,
      initial_balance: initial,
      balance: initial,
      floating_pl: '0',
      equity: initial,
      high_water_mark: initial,
      daily_anchor: initial,
      qualifying_days: 0,
      virtual_time_utc: startUtc,
      last_event_sequence: 0,
      open_positions: 0,
      pending_orders: 0,
    }
    const attempt = {
      ...parent,
      attempt_id: attemptId,
      revision: 1,
      status: 'ready',
      parent_attempt_id: parent.attempt_id,
      branch_kind: 'clean',
      virtual_start_utc: startUtc,
    }
    setPendingAction('retry')
    setConflict(null)
    try {
      const payload = await propJson(`/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts`, workspace, {
        method: 'POST',
        body: JSON.stringify({ attempt, phase, resume_state: { cursor: { bar_index: 0, timestamp_utc: startUtc }, open_positions: [], pending_orders: [] } }),
      })
      if (payload.session) {
        setSessions(current => ({ ...current, items: current.items.map(item => item.session_id === payload.session.session_id ? payload.session : item) }))
      }
      await loadBundle(payload.session || session, [...(selected.attempts || []), payload.attempt])
    } catch (error) {
      setConflict(t("Không tạo được attempt mới: {error}", { error: error.message }))
    } finally {
      setPendingAction('')
    }
  }, [loadBundle, pendingAction, selected.attempts, selected.bundle, selected.session, workspace])

  const exportReport = useCallback(async (report) => {
    const sessionId = report?.session?.session_id
    const attemptId = report?.attempt?.attempt_id
    if (!sessionId || !attemptId) return
    const actionKey = `export:${attemptId}`
    setPendingAction(actionKey)
    setConflict(null)
    try {
      const response = await fetch(
        `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/report.csv`,
        { headers: { 'X-Workspace-Id': workspace } },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw apiError(response, payload)
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `prop-${sessionId}-${attemptId}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    } catch (error) {
      setConflict(t("Không export được report: {error}", { error: error.message }))
    } finally {
      setPendingAction('')
    }
  }, [workspace])

  const openChallengeChart = useCallback(async (source = null) => {
    const session = source?.session || selected.session
    const bundle = source?.bundle || selected.bundle
    const attempt = bundle?.attempt
    const phase = bundle?.phase
    if (!session || !attempt || !phase) return
    setPendingAction('open-chart')
    setConflict(null)
    try {
      const replay = await openPropReplay(workspace, { ...bundle, session }, datasets.items)
      window.location.assign(sessionNavigationHref('replay', workspace, query, replay, { select: null, surface: 'workspace' }))
    } catch (error) {
      setConflict(`Không mở được chart challenge: ${error.message}`)
      setPendingAction('')
    }
  }, [datasets.items, selected.bundle, selected.report, selected.session, workspace])

  const bundle = selected.bundle
  const phase = bundle?.phase
  const attempt = bundle?.attempt
  const report = selected.report
  const currency = selected.session?.profile?.phases?.[0]?.currency || draft.currency
  const lifecycleObjectives = bundle?.resume_state?.prop_lifecycle?.last_objectives || report?.objectives || null
  const objectives = objectiveSummary(lifecycleObjectives, phase, currency, locale)
  const selectedReplayTarget = reportReplayHref(report, workspace)
  const cursor = bundle?.resume_state?.cursor
  const selectedTerminal = TERMINAL_STATUSES.has(attempt?.status)
  const canOpenNextPhase = attempt?.status === 'phase_passed' && Boolean(phase) && (selected.session?.profile?.phases?.length || 0) > phase.phase_index
  const sessionCountLabel = useMemo(() => `${sessions.items.length} session`, [sessions.items.length])

  return (
    <main className="prop-shell wm-page">
      <header className="prop-topbar wm-page-header">
        <div>
          <h1>{t("Luyện challenge")}</h1>
        </div>
        <div className="prop-topbar-actions">
          <a className="context-link" href={`/?view=replay&workspace=${encodeURIComponent(workspace)}`}>{t("Replay")}</a>
          <a className="context-link" href={`/?view=learn&workspace=${encodeURIComponent(workspace)}`}>{t("Học")}</a>
          <div className="prop-lock" data-testid="prop-lock">
            <strong>{t("SIMULATION ONLY")}</strong>
            <span>{t("Không broker call · không credential · tiền ảo")}</span>
          </div>
        </div>
      </header>

      <nav className="prop-tabs" aria-label={t("Testing views")}>
        <button
          type="button"
          className={activeTab === 'sessions' ? 'is-active' : ''}
          aria-current={activeTab === 'sessions' ? 'page' : undefined}
          onClick={() => setActiveTab('sessions')}
        >{t("Sessions")}</button>
        <button
          type="button"
          className={activeTab === 'reports' ? 'is-active' : ''}
          aria-current={activeTab === 'reports' ? 'page' : undefined}
          onClick={() => setActiveTab('reports')}
        >{t("Reports")}</button>
        <button
          type="button"
          className={activeTab === 'notion' ? 'is-active' : ''}
          aria-current={activeTab === 'notion' ? 'page' : undefined}
          data-testid="prop-notion-tab"
          onClick={() => setActiveTab('notion')}
        >{t("Notion")}</button>
      </nav>

      {activeTab === 'sessions' && <section className="prop-layout">
        <aside className="prop-sidebar">
          <div className="prop-section-head">
            <div><span>{t("Workspace")}</span><strong>{workspace}</strong></div>
            <small>{sessionCountLabel}</small>
          </div>

          {sessions.status === 'loading' && <StateMessage kind="loading" testId="prop-loading">{t("Đang tìm session đã lưu…")}</StateMessage>}
          {sessions.status === 'denied' && <StateMessage kind="denied" testId="prop-denied">{t("Workspace này không có quyền đọc Prop session.")}</StateMessage>}
          {sessions.status === 'error' && <StateMessage kind="error" testId="prop-error">{t("Không đọc được danh sách:")} {sessions.error}</StateMessage>}
          {sessions.status === 'ready' && !sessions.items.length && <StateMessage kind="empty" testId="prop-empty">{t("Chưa có session. Tạo một phiên luyện ở form bên cạnh.")}</StateMessage>}

          <div className="prop-session-list" data-testid="prop-session-list">
            {sessions.items.map((session) => {
              const active = selected.session?.session_id === session.session_id
              return (
                <button
                  type="button"
                  key={session.session_id}
                  className={active ? 'is-active' : ''}
                  aria-pressed={active}
                  onClick={() => openSession(session)}
                >
                  <span>{sessionLabel(session)}</span>
                  <strong>{session.session_id}</strong>
                  <small>{statusLabel('session', session.status)} {t("· rev")} {session.revision}</small>
                </button>
              )
            })}
          </div>
        </aside>

        <section className={`prop-main${selected.session ? ' has-selection' : ''}`}>
          {conflict && (
            <StateMessage kind="conflict" testId="prop-conflict">
              <strong>{t("Xung đột / dữ liệu chưa hợp lệ.")}</strong> {conflict}
            </StateMessage>
          )}

          <section className="prop-wizard" aria-label={t("Tạo Prop session")}>
            <div className="prop-section-head">
              <div><strong>{t("Tạo phiên luyện")}</strong><span>{t("Generic / custom practice profile")}</span></div>
              <small>{t("1 phase · UTC · static loss")}</small>
            </div>
            <form onSubmit={createSession}>
              <label className="prop-field prop-field-wide">
                <span>{t("Tên session")}</span>
                <input aria-label={t("Tên session")} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>{t("Profile")}</span>
                <FxSelect label={t("Profile")} value={draft.profileKind} onChange={value => updateDraft('profileKind', value)} localizeOptions={false} options={[({ value: "generic", label: t("Generic practice"), localize: false }), ({ value: "custom", label: t("Custom practice"), localize: false })]} />
              </label>
              <label className="prop-field">
                <span>{t("Vốn ảo")}</span>
                <input aria-label={t("Vốn ảo")} type="number" min="1" value={draft.initialCapital} onChange={(event) => updateDraft('initialCapital', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>{t("Currency")}</span>
                <FxSelect label={t("Currency")} value={draft.currency} onChange={value => updateDraft('currency', value)} localizeOptions={false} options={[({ value: "USD", label: t("USD"), localize: false }), ({ value: "EUR", label: t("EUR"), localize: false })]} />
              </label>
              <label className="prop-field">
                <span>{t("Profit target")}</span>
                <div className="prop-rule-input"><input aria-label={t("Profit target") + " %"} type="number" min="0.1" step="0.1" value={draft.targetPercent} onChange={(event) => updateDraft('targetPercent', event.target.value)} /><span>%</span></div>
              </label>
              <label className="prop-field">
                <span>{t("Max daily loss")}</span>
                <div className="prop-rule-input"><input aria-label={t("Max daily loss") + " " + draft.currency} type="number" min="1" step="0.01" value={draft.dailyLoss} onChange={(event) => updateDraft('dailyLoss', event.target.value)} /><span>{draft.currency}</span></div>
              </label>
              <label className="prop-field">
                <span>{t("Max total loss")}</span>
                <div className="prop-rule-input"><input aria-label={t("Max total loss") + " " + draft.currency} type="number" min="1" step="0.01" value={draft.overallLoss} onChange={(event) => updateDraft('overallLoss', event.target.value)} /><span>{draft.currency}</span></div>
              </label>
              <label className="prop-field prop-field-wide">
                <span>{t("Dataset cho chart")}</span>
                {datasets.items.length ? <FxSelect label={t("Dataset cho chart")} value={draft.datasetVersion} onChange={value => updateDraft('datasetVersion', value)} localizeOptions={false} options={datasets.items.map(item => ({ value: item.dataset_id, label: `${item.instrument_id || item.dataset_id} · ${item.timeframe || 'dataset'} · ${item.dataset_id}`, localize: false }))} /> : <input aria-label={t("Dataset cho chart")} value={draft.datasetVersion} onChange={(event) => updateDraft('datasetVersion', event.target.value)} />}
                {datasets.status === 'loading' && <small>{t("Đang đọc dataset local…")}</small>}
                {datasets.status === 'error' && <small>{t("Không đọc được catalog dataset:")} {datasets.error}</small>}
              </label>
              <label className="prop-field">
                <span>{t("Bắt đầu (UTC)")}</span>
                <ProjectDateInput aria-label={t("Bắt đầu UTC")} type="datetime-local" value={draft.startUtc} onChange={(event) => updateDraft('startUtc', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>{t("Max days")}</span>
                <input aria-label={t("Max days")} type="number" min="1" max="365" value={draft.durationDays} onChange={(event) => updateDraft('durationDays', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>{t("Cost model")}</span>
                <FxSelect label={t("Cost model")} value="replay-fixture-cost-v1" disabled localizeOptions={false} options={[({ value: "replay-fixture-cost-v1", label: t("Replay fixture · immutable"), localize: false })]} />
              </label>
              <label className="prop-field"><span>{t("Engine khớp lệnh")}</span><FxSelect label={t("Engine khớp lệnh")} value="replay-v1" disabled localizeOptions={false} options={[({ value: "replay-v1", label: t("OHLC bar · immutable"), localize: false })]} /></label>
              <div className="prop-review prop-field-wide">
                <strong>{t("Review")}</strong>
                <span>{t("Equity-based daily/overall loss, balance target, reset UTC 00:00. Đây là profile luyện tập, không đại diện điều khoản của hãng prop cụ thể.")}</span>
                {draft.engineVersion === 'replay-tick-v1' && <span>{t("Tick cải thiện giá khớp lệnh; đánh giá giới hạn equity trong từng phút vẫn chưa đầy đủ. Dataset, cost và engine phải khớp phiên replay được nối.")}</span>}
              </div>
              <button className="primary-action prop-create" type="submit" disabled={pendingAction === 'create'}>
                {pendingAction === 'create' ? t("Đang tạo…") : t("Tạo session mô phỏng")}
              </button>
            </form>
          </section>

          <section className="prop-resume" aria-label={t("Resume state")}>
            <div className="prop-section-head">
              <div><strong>{t("Phiên đang chọn")}</strong><span>{t("Trạng thái đã lưu")}</span></div>
            </div>

            {selected.status === 'loading' && <StateMessage kind="loading" testId="prop-selection-loading">{t("Đang đọc attempts và resume state…")}</StateMessage>}
            {selected.status === 'denied' && <StateMessage kind="denied" testId="prop-selection-denied">{t("Không có quyền đọc session này.")}</StateMessage>}
            {selected.status === 'error' && <StateMessage kind="error" testId="prop-selection-error">{t("Không đọc được session:")} {selected.error}</StateMessage>}
            {selected.status === 'idle' && <StateMessage kind="empty">{t("Chọn hoặc tạo session để xem state.")}</StateMessage>}
            {selected.status === 'ready' && selected.session && !attempt && <StateMessage kind="empty">{t("Session chưa có attempt để resume.")}</StateMessage>}

            {selected.status === 'ready' && attempt && phase && (
              <div data-testid="prop-resume-bundle">
                <ol className="prop-phase-list" aria-label={t("Các phase của challenge")}>
                  {(selected.session.profile?.phases || []).map((item) => (
                    <li key={item.phase_index} aria-current={item.phase_index === phase.phase_index ? 'step' : undefined}>
                      <strong>{t("Phase")} {item.phase_index}</strong>
                      <span>{item.phase_index === phase.phase_index ? attempt.status : item.phase_index < phase.phase_index ? t("Phase trước") : t("Chưa mở")}</span>
                    </li>
                  ))}
                </ol>
                <div className="prop-resume-strip">
                  <div><span>{t("Attempt")}</span><strong>{attempt.attempt_id}</strong></div>
                  <div><span>{t("Status")}</span><strong className={selectedTerminal ? 'is-terminal' : ''}>{statusLabel('prop_attempt', attempt.status)}</strong></div>
                  <div><span>{t("Revision")}</span><strong>{attempt.revision}</strong></div>
                  <div><span>{t("Cursor")}</span><strong>{cursor ? `#${cursor.bar_index}` : t("N/A")}</strong></div>
                </div>
                <div className="prop-metrics">
                  <article><span>{t("Balance")}</span><strong>{formatMoney(phase.balance, currency)}</strong></article>
                  <article><span>{t("Equity")}</span><strong>{formatMoney(phase.equity, currency)}</strong></article>
                  <article><span>{t("HWM")}</span><strong>{formatMoney(phase.high_water_mark, currency)}</strong></article>
                  <article><span>{t("Daily anchor")}</span><strong>{formatMoney(phase.daily_anchor, currency)}</strong></article>
                </div>
                <dl className="prop-facts">
                  <div><dt>{t("Virtual time")}</dt><dd>{formatUtc(phase.virtual_time_utc)}</dd></div>
                  <div><dt>{t("Cursor time")}</dt><dd>{formatUtc(cursor?.timestamp_utc)}</dd></div>
                  <div><dt>{t("Dataset")}</dt><dd>{attempt.data_version}</dd></div>
                  <div><dt>{t("Cost / engine")}</dt><dd>{attempt.cost_version} · {attempt.engine_version}</dd></div>
                  <div><dt>{t("Open / pending")}</dt><dd>{phase.open_positions} / {phase.pending_orders}</dd></div>
                  <div><dt>{t("Evaluation quality")}</dt><dd>{phase.evaluation_quality}</dd></div>
                </dl>
                <div className="prop-resume-note" data-testid="prop-resume-note">{t("Resume chỉ khôi phục state đã persist. Các nút lifecycle gửi lệnh rõ ràng tới backend; UI không tự chạy clock hoặc fill lệnh.")}</div>

                <section className="prop-objectives" data-testid="prop-objectives" aria-label={t("Challenge objectives")}>
                  <div className="prop-section-head">
                    <div><span>{t("Challenge objectives")}</span><strong>{objectives ? `Phase ${objectives.phaseIndex} · ${statusLabel('data_quality', objectives.technicalStatus)}` : t("Chưa có snapshot evaluator")}</strong></div>
                    <small>{objectives ? (objectives.passReady ? t("Pass ready") : t("Đang theo dõi")) : t("Chờ event mô phỏng")}</small>
                  </div>
                  {!objectives && <p className="prop-objectives-empty">{t("Chưa có lifecycle event đủ dữ liệu để tính objective. Resume state và provenance vẫn được giữ nguyên.")}</p>}
                  {objectives && (
                    <div className="prop-objective-grid">
                      {objectives.profitTarget && <article><span>{t("Profit target")}</span><strong>{t(objectives.profitTarget.status)}</strong><small>{objectives.profitTarget.current} / {objectives.profitTarget.target}</small></article>}
                      {objectives.dailyLoss && <article><span>{t("Daily loss")}</span><strong className={objectives.dailyLoss.status === 'Breached' ? 'is-breach' : ''}>{t(objectives.dailyLoss.status)}</strong><small>{objectives.dailyLoss.current} {t("· floor")} {objectives.dailyLoss.floor}</small></article>}
                      {objectives.overallDrawdown && <article><span>{t("Overall drawdown ·")} {objectives.overallDrawdown.kind}</span><strong className={objectives.overallDrawdown.status === 'Breached' ? 'is-breach' : ''}>{t(objectives.overallDrawdown.status)}</strong><small>{objectives.overallDrawdown.current} {t("· floor")} {objectives.overallDrawdown.floor}</small></article>}
                      {objectives.calendar && <article><span>{t("Calendar / quality")}</span><strong>{objectives.calendar.minDaysSatisfied ? t("Days ready") : `${objectives.calendar.qualifyingDays ?? 0} qualifying day`}</strong><small>{objectives.calendar.elapsedDays ?? 0} {t("elapsed ·")} {objectives.calendar.expired ? t("expired") : t("within cutoff")} {t("· positions")} {objectives.positionsReady ? t("flat") : t("not ready")}</small></article>}
                    </div>
                  )}
                </section>

                <div className="prop-lifecycle-actions" data-testid="prop-lifecycle-actions">
                  {attempt.status === 'ready' && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-start" disabled={pendingAction === 'transition:start'} onClick={() => transitionAttempt('start')}>{pendingAction === 'transition:start' ? t("Đang bắt đầu…") : t("Bắt đầu mô phỏng")}</button>}
                  {attempt.status === 'running' && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-pause" disabled={pendingAction === 'transition:pause'} onClick={() => transitionAttempt('pause')}>{pendingAction === 'transition:pause' ? t("Đang tạm dừng…") : t("Tạm dừng")}</button>}
                  {attempt.status === 'paused' && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-resume" disabled={pendingAction === 'transition:resume'} onClick={() => transitionAttempt('resume')}>{pendingAction === 'transition:resume' ? t("Đang tiếp tục…") : t("Tiếp tục mô phỏng")}</button>}
                  {canOpenNextPhase && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-next-phase" disabled={pendingAction === 'transition:next_phase'} onClick={() => transitionAttempt('next_phase')}>{pendingAction === 'transition:next_phase' ? t("Đang mở phase…") : t("Mở phase tiếp theo")}</button>}
                  {['ready', 'running', 'paused', 'phase_passed', 'next_phase_ready'].includes(attempt.status) && <button type="button" className="prop-refresh" data-testid="prop-transition-abandon" disabled={pendingAction === 'transition:abandon'} onClick={() => transitionAttempt('abandon')}>{pendingAction === 'transition:abandon' ? t("Đang bỏ…") : t("Bỏ attempt")}</button>}
                  {selectedTerminal && <button type="button" className="ui-button ui-button--primary" data-testid="prop-retry" disabled={pendingAction === 'retry'} onClick={retryAttempt}>{pendingAction === 'retry' ? t("Đang tạo lại…") : t("Thử lại challenge")}</button>}
                  {['ready', 'running', 'paused'].includes(attempt.status) && <button type="button" className="primary-action prop-create" data-testid="prop-open-chart" disabled={pendingAction === 'open-chart'} onClick={openChallengeChart}>{pendingAction === 'open-chart' ? t("Đang mở chart…") : t("Mở chart challenge")}</button>}
                </div>

                {selected.reportError && (
                  <StateMessage kind="error" testId="prop-report-error">{t("Resume state vẫn dùng được, nhưng report chưa tải được:")}{selected.reportError}
                  </StateMessage>
                )}

                {report && (
                  <section className="prop-report" data-testid="prop-report">
                    <div className="prop-section-head">
                      <div><span>{t("Attempt report")}</span><strong>{statusLabel('prop_attempt', report.outcome.status)}</strong></div>
                      <small>{report.result_source}</small>
                    </div>
                    <div className="prop-report-summary">
                      <div><span>{t("Technical")}</span><strong>{report.outcome.technical_status || t("N/A")}</strong></div>
                      <div><span>{t("Terminal")}</span><strong>{report.outcome.terminal ? t("Có") : t("Chưa")}</strong></div>
                      <div><span>{t("Branch")}</span><strong>{report.attempt.branch_kind}</strong></div>
                      <div><span>{t("Quality")}</span><strong>{report.phase.evaluation_quality}</strong></div>
                    </div>
                    <div className="prop-report-copy">
                      <strong>{t("Giải thích kết quả")}</strong>
                      {report.outcome.reason_codes.length ? (
                        <ul>{report.outcome.reason_codes.map((code) => <li key={code}>{reportReasonLabel(code)}</li>)}</ul>
                      ) : (
                        <p>{t("Attempt chưa có terminal reason. Report chỉ phản ánh state mô phỏng đã persist.")}</p>
                      )}
                      {report.provenance.hindsight_exploratory && (
                        <p className="prop-report-warning">{t("Đây là hindsight branch để khám phá sau checkpoint; không gộp với clean attempt.")}</p>
                      )}
                    </div>
                    <div className="prop-report-actions">
                      {selectedReplayTarget && (
                        <a className="context-link" data-testid="prop-report-replay" href={selectedReplayTarget.href}>{t("Mở replay #")}{selectedReplayTarget.cursorIndex}
                        </a>
                      )}
                      <a className="context-link" href={`/?view=learn&workspace=${encodeURIComponent(workspace)}&from=prop&session=${encodeURIComponent(report.session.session_id)}&attempt=${encodeURIComponent(report.attempt.attempt_id)}`}>{t("Mở Learn")}</a>
                      <button
                        type="button"
                        className="prop-refresh"
                        data-testid="prop-report-export"
                        disabled={pendingAction === `export:${report.attempt.attempt_id}`}
                        onClick={() => exportReport(report)}
                      >
                        {pendingAction === `export:${report.attempt.attempt_id}` ? t("Đang export…") : t("Export CSV")}
                      </button>
                    </div>
                  </section>
                )}
              </div>
            )}
          </section>
        </section>
      </section>}

      {activeTab === 'reports' && (
        <section className="prop-reports" data-testid="prop-reports-view">
          <div className="prop-section-head">
            <div><span>{t("Reports")}</span><strong>{t("Read-only từ persisted Prop state")}</strong></div>
            <small>{reports.items.length} {t("report")}</small>
          </div>
          <div className="prop-report-filters">
            <label className="prop-field">
              <span>{t("Status")}</span>
              <FxSelect label={t("Report status")} value={reportFilters.status} onChange={value => setReportFilters((current) => ({ ...current, status: value }))} localizeOptions={false} options={[({ value: "", label: t("Tất cả"), localize: false }), ({ value: "ready", label: t("ready"), localize: false }), ({ value: "running", label: t("running"), localize: false }), ({ value: "paused", label: t("paused"), localize: false }), ({ value: "phase_passed", label: t("phase_passed"), localize: false }), ({ value: "next_phase_ready", label: t("next_phase_ready"), localize: false }), ({ value: "completed_pass", label: t("completed_pass"), localize: false }), ({ value: "failed_breach", label: t("failed_breach"), localize: false }), ({ value: "expired", label: t("expired"), localize: false }), ({ value: "abandoned", label: t("abandoned"), localize: false })]} />
            </label>
            <label className="prop-field">
              <span>{t("Branch")}</span>
              <FxSelect label={t("Report branch")} value={reportFilters.branchKind} onChange={value => setReportFilters((current) => ({ ...current, branchKind: value }))} localizeOptions={false} options={[({ value: "", label: t("Tất cả"), localize: false }), ({ value: "clean", label: t("clean"), localize: false }), ({ value: "hindsight_exploratory", label: t("hindsight_exploratory"), localize: false })]} />
            </label>
          </div>

          {reports.status === 'loading' && <StateMessage kind="loading" testId="prop-reports-loading">{t("Đang đọc reports…")}</StateMessage>}
          {reports.status === 'denied' && <StateMessage kind="denied" testId="prop-reports-denied">{t("Workspace này không có quyền đọc Prop reports.")}</StateMessage>}
          {reports.status === 'error' && <StateMessage kind="error" testId="prop-reports-error">{t("Không đọc được reports:")} {reports.error}</StateMessage>}
          {reports.status === 'ready' && !reports.items.length && <StateMessage kind="empty" testId="prop-reports-empty">{t("Không có report khớp bộ lọc.")}</StateMessage>}

          <div className="prop-report-list" data-testid="prop-report-list">
            {reports.items.map((item) => {
              const replayTarget = reportReplayHref(item, workspace)
              return <article className="prop-report-row" key={`${item.session.session_id}/${item.attempt.attempt_id}`}>
                <div>
                  <span>{statusLabel('prop_attempt', item.outcome.status)} · {statusLabel('prop_branch', item.attempt.branch_kind)}</span>
                  <strong>{item.session.session_id}</strong>
                  <small>{item.attempt.attempt_id}</small>
                </div>
                <div>
                  <span>{t("Balance / equity")}</span>
                  <strong>{item.phase.balance} / {item.phase.equity}</strong>
                  <small>{item.phase.evaluation_quality}</small>
                </div>
                <div className="prop-report-row-reasons">
                  <span>{t("Reason")}</span>
                  <strong>{item.outcome.reason_codes.length ? item.outcome.reason_codes.map(reportReasonLabel).join(' ') : t("Chưa có terminal reason.")}</strong>
                  <small>{item.result_source}</small>
                </div>
                <div className="prop-report-row-actions">
                  {replayTarget && <a className="context-link" href={replayTarget.href}>{t("Replay #")}{replayTarget.cursorIndex}</a>}
                  <a className="context-link" href={`/?view=learn&workspace=${encodeURIComponent(workspace)}&from=prop&session=${encodeURIComponent(item.session.session_id)}&attempt=${encodeURIComponent(item.attempt.attempt_id)}`}>{t("Learn")}</a>
                  <button
                    type="button"
                    className="ui-button ui-button--neutral prop-refresh"
                    disabled={pendingAction === `export:${item.attempt.attempt_id}`}
                    onClick={() => exportReport(item)}
                  >{t("CSV")}</button>
                </div>
              </article>
            })}
          </div>
        </section>
      )}

      {activeTab === 'notion' && (
        <NotionConnector workspace={workspace} reports={reports} />
      )}
    </main>
  )
}
