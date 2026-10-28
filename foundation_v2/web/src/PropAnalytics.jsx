import PropChallengeObjectives from './PropChallengeObjectives.jsx'
import { navigate } from './clientNavigation.js'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useMemo, useState } from 'react'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import { SelectField } from './FxAnalytics.jsx'
import { propReplayQuery } from './propAnalyticsModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import useReadRefresh from './useReadRefresh.js'

const reportKey = report => `${report.session.session_id}:${report.attempt.attempt_id}`
export default function PropAnalytics({ workspace, query, embedded = false }) {


  const { t, statusLabel } = useTestingLocale()

  const [state, setState] = useState({ status: 'loading', loaded: false, items: [], error: '' }), [reload, setReload] = useState(0)
  const [selected, setSelected] = useState(query.get('prop_session') && query.get('attempt') ? `${query.get('prop_session')}:${query.get('attempt')}` : null)
  useReadRefresh(() => setReload(value => value + 1), true, {
    workspace, resources: ['prop'], error: state.readError, reconcileInitial: true,
    pending: state.status === 'loading' || Boolean(state.refreshing),
  })
  useEffect(() => {
    const controller = new AbortController()
    setState(current => current.loaded ? { ...current, refreshing: true, error: '' } : { status: 'loading', loaded: false, items: [], error: '' })
    fetch('/api/v2/prop/reports', { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => {
      const value = await response.json().catch(() => null)
      if (!response.ok) throw Object.assign(new Error(value?.detail || `HTTP ${response.status}`), { status: response.status })
      const object = item => item && typeof item === 'object' && !Array.isArray(item)
      const identifier = value => typeof value === 'string' && value.trim().length > 0
      if (value?.schema_version !== 'prop-report-list-v1' || value.broker_execution_capability !== false || !Array.isArray(value.items) || value.items.some(item => !object(item) || !identifier(item.session?.session_id) || !identifier(item.attempt?.attempt_id) || item.schema_version !== 'prop-attempt-report-v1' || !object(item.phase) || !Number.isSafeInteger(item.phase.phase_index) || !object(item.profile) || !identifier(item.profile.profile_id) || typeof item.profile.terms_version !== 'string' || !object(item.outcome) || typeof item.outcome.status !== 'string' || item.phase.virtual_time_utc != null && typeof item.phase.virtual_time_utc !== 'string' || item.phase.evaluation_quality != null && typeof item.phase.evaluation_quality !== 'string')) throw new Error('prop_report_invalid')
      return value.items
    }).then(items => { if (!controller.signal.aborted) setState(current => ({ status: 'ready', loaded: true, items: items.map(item => current.items.find(previous => reportKey(previous) === reportKey(item) && JSON.stringify(previous) === JSON.stringify(item)) || item), error: '', readError: null })) }).catch(error => {
      if (!controller.signal.aborted) setState(current => [401, 403].includes(error.status) ? { status: 'error', loaded: false, items: [], error: error.message, readError: error } : { ...current, status: current.loaded ? 'stale' : 'error', refreshing: false, error: error.message, readError: error })
    })
    return () => controller.abort()
  }, [workspace, reload])
  const report = selected === null ? state.items[0] : state.items.find(item => reportKey(item) === selected)
  const boundQuery = useMemo(() => propReplayQuery(report, new URLSearchParams(window.location.search)), [report, query])
  const choose = value => { setSelected(value); const report = state.items.find(item => reportKey(item) === value); const url = new URL(window.location.href); if (report) { url.searchParams.set('prop_session', report.session.session_id); url.searchParams.set('attempt', report.attempt.attempt_id) } else { url.searchParams.delete('prop_session'); url.searchParams.delete('attempt') } url.searchParams.delete('trade'); navigate(url, { replace: true }) }
  return <section className={`${embedded ? 'fx-dashboard-prop' : 'wm-page'} fxa-prop-page`} aria-label={t("Prop firm Analytics")} data-testid="prop-analytics" data-state={state.status} aria-busy={state.status === 'loading' || Boolean(state.refreshing)}>{!embedded && <h1 className="sr-only">{t("Analytics")}</h1>}
    {state.status === 'loading' && <TestingSkeleton label="Đang đọc báo cáo challenge…" />}{state.loaded && state.refreshing ? <p role="status">{t('Đang cập nhật…')}</p> : ['error', 'stale'].includes(state.status) && <TestingReadState error={state.status === 'error'} message={state.status === 'stale' ? t('Dữ liệu chưa cập nhật.') : t('Không đọc được báo cáo:') + ' ' + t(state.error)} onRetry={() => setReload(value => value + 1)} />}
    {state.loaded && <div className="fxa-prop-selector"><SelectField label={t("Prop firm attempt")} value={report ? reportKey(report) : ''} onChange={choose} options={[["", 'Chọn challenge'], ...state.items.map(item => [reportKey(item), `${item.profile.profile_id} · ${t('Phase {number}', { number: item.phase.phase_index })} · attempt ${item.attempt.attempt_id.slice(0, 8)} · ${statusLabel('prop_attempt', item.outcome.status)}`])]} /><a className="fxa-button" href={buildWorkspaceHref('testing', workspace, query)}>{t("Quản lý challenge")}</a></div>}
    {state.loaded && !report && <p className="fxa-empty">{state.items.length ? t("Không tìm thấy attempt này. Chọn challenge khác.") : t("Chưa có báo cáo Prop firm. Tạo challenge mô phỏng và gắn replay để có phân tích giao dịch.")}</p>}
    {report && <>
      {boundQuery ? <AnalyticsWorkspace key={`${workspace}:${reportKey(report)}:${report.attempt.revision}:${report.phase.last_event_sequence}`} workspace={workspace} query={boundQuery} sessionName={report.profile.profile_id} propReport={report} embedded /> : <><PropChallengeObjectives report={report}/><p className="fxa-empty">{t("Attempt chưa có replay binding và cutoff hợp lệ. Objectives vẫn đọc được; gắn replay trong phần quản lý challenge để phân tích giao dịch và mô phỏng.")}</p></>}
    </>}
  </section>
}
