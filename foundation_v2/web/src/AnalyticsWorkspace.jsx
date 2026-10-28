import { displayDate } from './dateFormat.js'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { TestingEmptyState, TestingPageSkeleton, TestingResourceStatus } from './TestingPageState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './analytics-story.css'
import { FxAnalyticsFilters, FxAnalyticsReport } from './FxAnalytics.jsx'
import FxTradeLedger, { TradeInspector } from './FxTradeLedger.jsx'
import { advancedAnalytics, DEFAULT_EXTRA_FILTERS, readAnalyticsExtraFilters, tradesCsv } from './tradingAnalyticsModel.js'
import useReadRefresh from './useReadRefresh.js'
import { buildPropAnalyticsView } from './propAnalyticsModel.js'
import PropChallengeObjectives from './PropChallengeObjectives.jsx'
import { navigate } from './clientNavigation.js'
import { scopedRead } from './scopedRead.js'
import { readJson } from './researchDataApi.js'
import { readAnalyticsExperiment } from './analyticsExperimentApi.js'
import { enrichJournalTags, readJournalContext } from './journalContext.js'
import { frontendPerformance } from './frontendPerformance.js'
import { useContentReadyMetric } from './useContentReadyMetric.js'

import { analyticsQuery, analyticsViewResult, buildAnalyticsModel, dateFromValue, readAnalyticsFilters } from './analyticsViewModel.js'
export { analyticsQuery, analyticsViewResult, buildAnalyticsModel, readAnalyticsFilters } from './analyticsViewModel.js'

function analyticsViewStatus(view) {
  if (!view) return 'empty'
  if (Array.isArray(view.blocked_by_data) && view.blocked_by_data.length) return 'blocked_by_data'
  if (view.analytics_available === false) return 'blocked_by_data'
  if (view.stale === true || view.freshness === 'stale' || view.provenance?.freshness === 'stale' || view.provenance?.status === 'stale') return 'stale'
  if (view.partial === true || view.freshness === 'partial' || view.provenance?.status === 'partial') return 'partial'
  if (view.scope?.selected_trade_count === 0) return 'empty'
  return 'ready'
}

function StoryMetric({ label, value, detail, source, tone = '' }) {
  const { t } = useTestingLocale()

  return <dl className={'as-story-metric ' + tone}><dt>{t(label)}</dt><dd>{value}</dd><dd className="as-metric-detail"><small>{t(detail)}</small><em>{source}</em></dd></dl>
}

function ContextValue({ label, value, code = false }) {
  const { t } = useTestingLocale()

  const displayValue = value === null || value === undefined || value === '' ? '-' : value
  return <div className="as-context-value"><dt>{t(label)}</dt><dd className={code ? 'as-code' : ''}>{displayValue}</dd></div>
}

export function ProvenanceInspector({ model, selectedTrade, journalCount, links }) {
  const formatNumber = (value, digits = 2, suffix = '') => fmt(value, suffix, digits)
  const formatDate = value => dateFromValue(value) ? displayDate(dateFromValue(value), { timeStyle: 'short', timeZone: timezone }) : '-'

  const { t, locale, fmt, timezone } = useTestingLocale()

  return (
    <aside className="as-inspector" aria-label={t("Provenance và drilldown")}>
      {selectedTrade && <div className="as-section-head"><h2>{selectedTrade.tradeId}</h2><span className="as-inspector-state">{t("Chỉ đọc")}</span></div>}
      {selectedTrade ? (
        <section className="as-inspector-selection" aria-label={t("Trade detail")}>
          <div className="as-selection-outcome"><span className={'as-outcome-dot is-' + selectedTrade.outcome} />{selectedTrade.status === 'open' ? t('Open') : selectedTrade.outcome === 'win' ? t("Thắng") : selectedTrade.outcome === 'loss' ? t("Thua") : selectedTrade.outcome === 'breakeven' ? t("Hòa vốn") : t("Chưa xác định")}<strong>{selectedTrade.status === 'open' ? <span title={t('Chưa áp dụng khi lệnh đang mở')}>N/A</span> : formatNumber(selectedTrade.pnl)}</strong></div>
          <dl className="as-detail-list"><ContextValue label={`${t("Thoát lệnh")} (${model.result?.scope?.time_basis === 'market' ? 'Chart' : 'Realtime'} · ${timezone})`} value={selectedTrade.closeDate} /><ContextValue label={t("Side")} value={selectedTrade.side} /><ContextValue label={t("Symbol")} value={selectedTrade.symbol} /><ContextValue label={t("Khối lượng")} value={formatNumber(selectedTrade.quantity, 4)} /><ContextValue label={t("Giá mở")} value={formatNumber(selectedTrade.price_open, 6)} /><ContextValue label={t("Giá đóng")} value={formatNumber(selectedTrade.price_close, 6)} /><ContextValue label={t("Net R")} value={selectedTrade.status === 'open' || selectedTrade.realized_r == null ? 'N/A' : formatNumber(selectedTrade.realized_r, 2, 'R')} /><ContextValue label={t("Risk budget")} value={formatNumber(selectedTrade.planned_risk_budget)} /></dl>
          <details className="as-raw-details"><summary>{t("Xem record gốc")}</summary><pre>{JSON.stringify(selectedTrade, null, 2)}</pre></details>
        </section>
      ) : null}
      <details className="as-provenance-details"><summary>{t("Nguồn và giới hạn")}</summary>
      <dl className="as-provenance-list"><ContextValue label={t("Session revision")} value={model.result?.revision} /><ContextValue label={`${t("Cutoff")} (${timezone})`} value={formatDate(model.result?.cutoff_timestamp)} /><ContextValue label={t("Dataset")} value={model.result?.dataset_id} code /><ContextValue label={t("Dataset SHA")} value={model.result?.dataset_sha256} code /><ContextValue label={t("Protocol SHA")} value={model.result?.protocol_sha256} code /><ContextValue label={t("Artifact SHA")} value={model.sourceHash} code /><ContextValue label={t("Strategy / engine")} value={model.strategy} /><ContextValue label={t("Split")} value={model.result?.split} /><ContextValue label={t("Metric schema")} value={model.result?.metrics_schema_version || model.metrics.metric_schema_version} code /><ContextValue label={t("Observed range")} value={model.observed.start + ' → ' + model.observed.end} /><ContextValue label={t("Journal context")} value={journalCount === null ? '-' : journalCount + ' entries'} /></dl>
      <p className="as-limit-note">{t("- là dữ liệu chưa được cung cấp; N/A là chỉ số chưa áp dụng hoặc chưa có cơ sở để tính. Research/simulation đang broker locked; không có đường nào gửi lệnh.")}</p>
      </details>
      <div className="as-inspector-actions"><a href={links.journal}>{t("Mở Journal →")}</a>{links.replay && <a href={links.replay}>{t("Mở Replay →")}</a>}</div>
    </aside>
  )
}

function AnalyticsStoryWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(), ledgerOnly = false, summaryOnly = false, embedded = false, sessionName = '', propReport = null, sessionControl = null, catalogStatus = null, sessionAssets = [] }) {
  const formatNumber = (value, digits = 2, suffix = '') => fmt(value, suffix, digits)

  const { t, fmt, timezone } = useTestingLocale()

  const jobId = query?.get('job') || query?.get('job_id') || ''
  const sessionId = query?.get('session') || query?.get('replay_session') || ''
  const resourceId = jobId || sessionId
  const resourceKind = jobId ? 'research/jobs' : 'replay/sessions'
  const replayCursor = jobId ? null : query?.get('cursor') ?? query?.get('cursor_index')
  const replayCutoff = jobId ? null : query?.get('cutoff') ?? query?.get('decision_cutoff')
  const eventSequence = jobId ? null : query?.get('event_sequence')
  const tradeId = query?.get('trade') || query?.get('trade_id') || ''
  const [localFilters, setLocalFilters] = useState(() => readAnalyticsFilters(query, timezone))
  const filters = useMemo(() => summaryOnly ? localFilters : readAnalyticsFilters(query, timezone), [summaryOnly, localFilters, query, timezone])
  const [state, setState] = useState({ status: resourceId ? 'loading' : 'idle', payload: null, error: null })
  const [journalContext, setJournalContext] = useState(null)
  const [journalStatus, setJournalStatus] = useState('idle')
  const journalCache = useRef(null)
  const [journalRead, setJournalRead] = useState({ error: null, pending: false, scope: '' })
  const [journalReload, setJournalReload] = useState(0)
  const [localTradeId, setLocalTradeId] = useState(tradeId)
  const selectedTradeId = summaryOnly ? localTradeId : tradeId
  const setSelectedTradeId = useCallback(value => {
    if (summaryOnly) { setLocalTradeId(value); return }
    const next = new URL(window.location.href)
    next.searchParams.delete('trade_id')
    if (value) next.searchParams.set('trade', value)
    else next.searchParams.delete('trade')
    navigate(next.href, { replace: true })
  }, [summaryOnly])
  const [exportPending, setExportPending] = useState(false)
  const [exportError, setExportError] = useState('')
  const [localExtra, setLocalExtra] = useState(() => readAnalyticsExtraFilters(query))
  const extra = useMemo(() => ({ ...(summaryOnly ? localExtra : readAnalyticsExtraFilters(query)), timezone, ...(ledgerOnly ? { days: '', weekday: 'all', types: '', notes: '' } : {}) }), [summaryOnly, localExtra, query, ledgerOnly, timezone])
  const updateExtra = useCallback(patch => {
    if (summaryOnly) { setLocalExtra(current => ({ ...current, ...patch })); return }
    const next = new URL(window.location.href)
    next.searchParams.delete('analytics_timezone')
    for (const [key, value] of Object.entries({ ...extra, ...patch })) {
      if (key === 'timezone') continue
      const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
      if (value === DEFAULT_EXTRA_FILTERS[key]) next.searchParams.delete(param)
      else next.searchParams.set(param, value)
    }
    navigate(next.href, { replace: true })
  }, [summaryOnly, extra])
  const experimentConfig = useMemo(() => ({ stop_distance_ticks: 20, stop_multiplier: 1, target_r: 2 }), [])
  const [experiments, setExperiments] = useState({ status: 'idle', payload: null, error: '' })
  const [experimentReload, setExperimentReload] = useState(0)
  const [experimentDemand, setExperimentDemand] = useState(null)
  const requestSequence = useRef(0)
  const readController = useRef(null)

  const filterParams = useMemo(() => {
    const params = analyticsQuery(filters, timezone, sessionId && !jobId && !ledgerOnly ? 'market' : 'activity')
    if (replayCursor !== null && replayCursor !== undefined) params.set('cursor_index', replayCursor)
    if (replayCutoff !== null && replayCutoff !== undefined) params.set('cutoff_timestamp', replayCutoff)
    if (eventSequence !== null && eventSequence !== undefined) params.set('event_sequence', eventSequence)
    return params
  }, [filters, replayCursor, replayCutoff, eventSequence, timezone, sessionId, jobId, ledgerOnly])
  const analyticsPath = useMemo(() => {
    const suffix = filterParams.toString()
    return `/api/v2/${resourceKind}/${encodeURIComponent(resourceId)}/analytics${suffix ? `?${suffix}` : ''}`
  }, [filterParams, resourceId, resourceKind])
  useContentReadyMetric(ledgerOnly ? 'trade' : 'analytics', state.readPath === analyticsPath ? state.status : resourceId ? 'loading' : 'empty', `${workspace}:${analyticsPath}`)


  const load = useCallback(async ({ signal, background = false } = {}) => {
    const requestId = ++requestSequence.current
    readController.current?.abort()
    if (!resourceId) {
      setState({ status: 'idle', payload: null, error: null })
      return
    }
    const controller = new AbortController()
    readController.current = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    setState(current => current.readPath === analyticsPath && current.workspace === workspace && (current.payload || current.readError) ? { ...current, pending: true, refreshing: Boolean(current.payload) } : { status: 'loading', payload: null, error: null, pending: true, readPath: analyticsPath, workspace })
    try {
      const requestSignal = controller.signal
      const response = await scopedRead(analyticsPath, workspace, requestSignal)
      let payload = await readJson(response)
      if (requestSignal?.aborted || requestId !== requestSequence.current) return
      const selectedCount = payload?.scope?.selected_trade_count
      const totalCount = payload?.scope?.total_trade_count
      const metricTradeCount = payload?.metrics?.closed_trade_count
      const countConsistent = metricTradeCount === undefined || (typeof metricTradeCount === 'number' && Number.isSafeInteger(metricTradeCount) && metricTradeCount === selectedCount)
      const hasReadyShape = payload?.analytics_available === false || (payload?.provenance && typeof payload.provenance === 'object' && payload?.metrics && typeof payload.metrics === 'object' && Array.isArray(payload.ledger) && typeof selectedCount === 'number' && Number.isSafeInteger(selectedCount) && selectedCount >= 0 && selectedCount === payload.ledger.length && typeof totalCount === 'number' && Number.isSafeInteger(totalCount) && totalCount >= selectedCount && countConsistent)
      if (payload?.schema_version !== 'analytics-read-model-v1' || typeof payload.analytics_available !== 'boolean' || !payload.scope || typeof payload.scope !== 'object' || !hasReadyShape) {
        const schemaError = new Error('analytics_read_model_invalid')
        schemaError.status = 422
        schemaError.payload = payload
        throw schemaError
      }
      if (propReport) payload = buildPropAnalyticsView(payload, propReport)
      setState({ status: analyticsViewStatus(payload), payload, error: null, readError: null, pending: false, readPath: analyticsPath, workspace })
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError' || requestId !== requestSequence.current) return
      const blocked = error?.payload?.analytics_available === false || error?.payload?.blocked_by_data?.length > 0
      const status = blocked ? 'blocked_by_data' : 'error'
      setState(current => current.readPath === analyticsPath && current.workspace === workspace && ![401, 403].includes(error?.status) && current.payload && ['ready', 'partial', 'stale', 'empty'].includes(current.status) ? { ...current, status: 'stale', refreshing: false, pending: false, readError: blocked ? null : error, error: String(error.message || error) } : { status, pending: false, readPath: analyticsPath, workspace, readError: blocked ? null : error, payload: blocked && ![401, 403].includes(error?.status) ? error.payload : null, error: String(error.message || error), denied: [401,403].includes(error?.status) })
    } finally {
      signal?.removeEventListener('abort', abort)
      if (readController.current === controller) readController.current = null
    }
  }, [analyticsPath, resourceId, workspace, propReport])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => { controller.abort(); readController.current?.abort(); requestSequence.current += 1 }
  }, [load])
  const fixedHistoricalScope = !jobId && [replayCursor, replayCutoff, eventSequence].some(value => value !== null && value !== undefined)
  const recovery = useReadRefresh(() => { load({ background: true }); setExperimentReload(value => value + 1); setJournalReload(value => value + 1) }, Boolean(resourceId), { workspace, resources: fixedHistoricalScope ? [] : [jobId ? 'research' : 'sessions'], scopeKey: analyticsPath, error: state.readPath === analyticsPath && state.workspace === workspace ? state.readError : null, pending: state.readPath !== analyticsPath || state.workspace !== workspace || state.status === 'loading' || state.pending })
  const experimentHasTrades = state.readPath === analyticsPath && state.workspace === workspace && ['ready', 'partial', 'stale'].includes(state.status) && state.payload?.ledger?.length > 0
  const experimentScope = JSON.stringify([workspace, analyticsPath, state.payload?.provenance?.revision, experimentReload])
  const requestExperiments = useCallback(() => setExperimentDemand(experimentScope), [experimentScope])
  useEffect(() => {
    if (jobId || !sessionId || summaryOnly || ledgerOnly || experimentDemand !== experimentScope || !experimentHasTrades) return
    const controller = new AbortController()
    setExperiments({ status: 'loading', payload: null, error: '', scope: experimentScope })
    readAnalyticsExperiment({ workspace, sessionId, filters: filterParams, config: experimentConfig, signal: controller.signal }).then(payload => {
      if (!controller.signal.aborted) {
        setExperiments({ status: 'ready', payload, error: '', scope: experimentScope })
      }
    }).catch(error => { if (!controller.signal.aborted) setExperiments({ status: 'error', payload: null, error: `Chưa đọc được đường giá: ${error.message}`, scope: experimentScope }) })
    return () => controller.abort()
  }, [workspace, sessionId, jobId, filterParams.toString(), experimentConfig, experimentScope, experimentDemand, summaryOnly, ledgerOnly, experimentHasTrades])
  const journalScope = `${workspace}:${sessionId}`
  const journalRecovery = useReadRefresh(() => setJournalReload(value => value + 1), Boolean(sessionId && !jobId && !summaryOnly), { workspace, resources: ['journal'], scopeKey: journalScope, error: journalRead.scope === journalScope ? journalRead.error : null, pending: journalRead.scope !== journalScope || journalRead.pending })
  useEffect(() => {
    if (!sessionId || jobId || summaryOnly) { setJournalContext(null); setJournalStatus('idle'); return }
    const controller = new AbortController()
    setJournalRead(current => current.scope === journalScope ? { ...current, pending: true } : { scope: journalScope, error: null, pending: true })
    setJournalStatus(current => journalCache.current?.workspace === workspace && journalCache.current?.session === sessionId ? current : journalRead.scope === journalScope && current === 'error' ? 'error' : 'loading')
    scopedRead(`/api/v2/journal/context?session_id=${encodeURIComponent(sessionId)}`, workspace, controller.signal)
      .then(readJson).then(payload => {
        if (!controller.signal.aborted) { journalCache.current = readJournalContext(payload, workspace, sessionId); setJournalContext(journalCache.current); setJournalStatus('ready'); setJournalRead({ scope: journalScope, error: null, pending: false }) }
      }).catch(error => { if (!controller.signal.aborted) { if (![401, 403].includes(error.status) && journalCache.current?.workspace === workspace && journalCache.current?.session === sessionId) setJournalStatus('stale'); else { journalCache.current = null; setJournalContext(null); setJournalStatus('error') }; setJournalRead({ scope: journalScope, error, pending: false }) } })
    return () => controller.abort()
  }, [sessionId, jobId, workspace, summaryOnly, journalReload])

  const scopedJournal = journalContext?.workspace === workspace && journalContext.session === sessionId ? journalContext : null
  const journalCount = scopedJournal ? (selectedTradeId ? scopedJournal.byTrade.get(selectedTradeId)?.count || 0 : scopedJournal.count) : null

  const result = useMemo(() => state.readPath === analyticsPath && state.workspace === workspace && state.payload?.schema_version === 'analytics-read-model-v1' ? analyticsViewResult(state.payload) : null, [state.payload, state.readPath, state.workspace, analyticsPath, workspace])
  const model = useMemo(() => {
    const base = buildAnalyticsModel(result, propReport ? 'prop' : jobId ? 'research' : 'app', timezone)
    const finish = frontendPerformance().beginDomain('analytics-project')
    const ledger = enrichJournalTags(base.ledger, scopedJournal)
    finish('ready')
    return { ...base, ledger }
  }, [result, scopedJournal, propReport, jobId, timezone])
  useEffect(() => {
    if (!selectedTradeId || !result || state.readPath !== analyticsPath || state.workspace !== workspace || state.status === 'loading') return
    const isKnown = model.ledger.some((trade) => trade.tradeId === selectedTradeId) || ledgerOnly && result.open_rows?.some(trade => trade.trade_id === selectedTradeId) || model.curve.some((point) => point.tradeId === selectedTradeId)
    if (!isKnown) setSelectedTradeId('')
  }, [model, result, ledgerOnly, selectedTradeId, setSelectedTradeId, state.readPath, state.workspace, state.status, analyticsPath, workspace])
  const updateFilters = useCallback(patch => {
    if (summaryOnly) { setLocalFilters(current => ({ ...current, ...patch })); return }
    const value = { ...filters, ...patch }
    const next = new URL(window.location.href)
    for (const key of ['side', 'outcome', 'from', 'to', 'from_close_utc', 'to_close_utc']) next.searchParams.delete(key)
    if (value.side !== 'all') next.searchParams.set('side', value.side)
    if (value.outcome !== 'all') next.searchParams.set('outcome', value.outcome)
    if (value.from) next.searchParams.set('from', value.from)
    if (value.to) next.searchParams.set('to', value.to)
    navigate(next.href, { replace: true })
  }, [filters, summaryOnly])
  const exportCsv = useCallback(async (event) => {
    event.preventDefault()
    if (!resourceId || exportPending) return
    setExportPending(true)
    setExportError('')
    try {
      if (!result || !['ready', 'partial', 'stale', 'empty'].includes(state.status)) throw new Error('Kết quả chưa sẵn sàng')
      const blob = new Blob([tradesCsv(advancedAnalytics(model, extra).rows, result.account_currency, { session_id: sessionId || jobId, revision: result.revision, cursor_index: result.cursor_index, execution_event_sequence: result.execution_event_sequence, dataset_sha256: result.dataset_sha256, filters: JSON.stringify({ ...filters, ...extra }), balance_basis: result.scope?.balance_curve_scope })], { type: 'text/csv;charset=utf-8' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `analytics-${resourceId}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setExportError(`Không tạo được CSV: ${String(error.message || error)}`)
    } finally {
      setExportPending(false)
    }
  }, [exportPending, resourceId, result, model, extra, state.status, filters, sessionId, jobId])
  const tableModel = useMemo(() => {
    if (!ledgerOnly || !result?.open_rows?.length) return model
    const open = buildAnalyticsModel({ ...result, ledger: result.open_rows, metrics: {}, paged: true }, model.reportKind, timezone)
    return { ...model, ledger: [...model.ledger, ...enrichJournalTags(open.ledger, scopedJournal)] }
  }, [model, result, ledgerOnly, timezone, scopedJournal])
  const selectedTrade = tableModel.ledger.find((trade) => trade.tradeId === selectedTradeId) || (() => {
    const point = model.curve.find((item) => item.tradeId === selectedTradeId)
    return point ? { tradeId: point.tradeId, pnl: null, realized_r: null, planned_risk_budget: null, closeDate: '-', source: 'closed balance curve', outcome: 'unknown', balance: point.value } : null
  })()
  const replayParams = new URLSearchParams({ workspace, view: 'replay', surface: 'workspace' })
  if (sessionId) replayParams.set('session', sessionId)
  if (result?.dataset_id) replayParams.set('dataset', result.dataset_id)
  const tradeCursor = selectedTrade?.status === 'open' ? selectedTrade.open_cursor_index : selectedTrade?.close_cursor_index
  if (Number.isInteger(tradeCursor)) replayParams.set('cursor', String(tradeCursor))
  else if (Number.isInteger(result?.cursor_index)) replayParams.set('cursor', String(result.cursor_index))
  const journalParams = new URLSearchParams({ workspace, view: 'journal' })
  if (sessionId) journalParams.set('session', sessionId)
  if (selectedTradeId) journalParams.set('trade', selectedTradeId)
  const researchParams = new URLSearchParams({ workspace, view: 'research' })
  if (jobId) researchParams.set('job', jobId)
  const links = { journal: '/?' + journalParams.toString(), replay: sessionId ? '/?' + replayParams.toString() : '', research: '/?' + researchParams.toString() }
  const currentExperiments = experiments.scope === experimentScope ? experiments : { status: 'idle', payload: null, error: '' }
  const experimentScopeMatches = currentExperiments.payload && result && ['session_id', 'dataset_id', 'dataset_sha256', 'revision', 'cursor_index', 'execution_event_sequence'].every(key => currentExperiments.payload.provenance?.[key] === result[key])

  const loadExperiment = useCallback((config, signal) => {
    if (!sessionId || jobId || !result) return Promise.reject(new Error('Nguồn này chưa hỗ trợ mô phỏng từ đường giá.'))
    return readAnalyticsExperiment({ workspace, sessionId, filters: filterParams, config, signal, expected: result })
  }, [workspace, sessionId, jobId, filterParams.toString(), result])

  const Inspector = ledgerOnly ? TradeInspector : 'section'
  const journalFilterPending = Boolean(sessionId && !jobId && !summaryOnly && !['ready', 'stale'].includes(journalStatus) && (extra.tag !== 'all' || extra.tagInclude || extra.tagExclude || extra.notesPresence))
  // The trade ledger keeps the partial state in its model and empty-state
  // logic, but does not add a persistent toolbar badge for it. Analytics
  // views retain the partial indicator because their summary needs that
  // provenance signal.
  const primaryStatus = state.refreshing ? 'refreshing' : state.status === 'stale' ? 'stale' : !ledgerOnly && state.status === 'partial' ? 'partial' : undefined
  const journalBackground = scopedJournal && (journalRead.pending ? 'refreshing' : journalStatus === 'stale' ? 'stale' : undefined)
  const statusControl = <TestingResourceStatus textSummary={ledgerOnly} state={primaryStatus || journalBackground || catalogStatus?.state} resource={primaryStatus ? 'kết quả phân tích' : journalBackground ? 'ghi chú và nhãn giao dịch' : 'danh mục phiên'} recovery={primaryStatus ? recovery : journalBackground ? journalRecovery : catalogStatus?.recovery} />
  const readNotice = <>{journalStatus === 'error' && <TestingReadState error message="Chưa đọc được ghi chú và nhãn giao dịch. Số ghi chú hiện chưa xác minh." recovery={journalRecovery} />}{state.status === 'error' && !state.denied && <TestingReadState error message={t('Không đọc được kết quả:') + ' ' + t(state.error)} recovery={recovery} />}</>
  const renderFilters = columnControl => <FxAnalyticsFilters labels={scopedJournal?.definitions || []} statusControl={statusControl} sourceType={propReport ? 'Prop firm' : jobId ? 'Research' : 'Backtesting'} sessionControl={sessionControl} filters={filters} onChange={updateFilters} extra={extra} onExtra={updateExtra} rows={tableModel.ledger} facets={ledgerOnly ? { assets: [...new Set([...tableModel.ledger.map(row => row.symbol).filter(Boolean), ...sessionAssets])] } : undefined} onExport={exportCsv} pending={exportPending || journalFilterPending || !result || !['ready', 'partial', 'stale', 'empty'].includes(state.status)} columnControl={columnControl} ledgerOnly={ledgerOnly} />
  return <section className={`as-page fxa-page ${embedded ? 'as-embedded' : 'wm-page'}`} aria-label={ledgerOnly ? t("Trades") : t("Analytics")} data-testid="analytics-workspace">
    {!embedded && <h1 className="sr-only">{ledgerOnly ? t("Trades") : t("Analytics")}</h1>}
    {(resourceId || sessionControl) && !summaryOnly && (ledgerOnly ? <FxTradeLedger preferenceWorkspace={workspace} workspace={!jobId && sessionId ? workspace : undefined} onLabelsChanged={()=>setJournalReload(value=>value+1)} model={tableModel} extra={extra} selected={selectedTradeId} onSelect={setSelectedTradeId} sessionName={sessionName} hidden={journalFilterPending || !result || !['ready', 'stale', 'partial', 'empty'].includes(state.status)} renderFilters={renderFilters} readNotice={readNotice} /> : <>{renderFilters()}{readNotice}</>)}
    {summaryOnly && readNotice}
    {journalFilterPending && journalStatus === 'loading' && <TestingReadState message="Đang đọc nhãn giao dịch…" />}
    {exportError && <p role="alert" className="fxa-error">{t(exportError)}</p>}
    {result?.historical_view && <p className="as-message" data-testid="analytics-historical-scope">{t("Kết quả tới nến #")}{result.cursor_index}{t(". Phiên hiện ở nến #")}{result.canonical_cursor_index}{t("; báo cáo không gồm giao dịch sau mốc đang xem.")}</p>}
    {!resourceId && <p className="fxa-empty">{t("Chọn một phiên replay hoặc research job để xem kết quả.")}</p>}
    {propReport && (!result || !['ready', 'stale', 'partial', 'empty'].includes(state.status)) && <PropChallengeObjectives report={propReport}/>}
    {state.status === 'loading' && <TestingPageSkeleton view={ledgerOnly ? 'trade' : 'analytics'} label="Đang tải kết quả…" />}
    {state.denied && <TestingEmptyState kind="denied" />}
    {state.status === 'blocked_by_data' && <section className="as-empty-state" data-testid="analytics-blocked"><h2>{t("Chưa đủ dữ liệu để tính analytics")}</h2><p>{state.payload?.blocked_by_data?.map(reason => t(reason)).join(' · ') || t(state.error) || t("Nguồn chưa có kết quả đã phát hành.")}</p></section>}
    {result && !journalFilterPending && ['ready', 'stale', 'partial', 'empty'].includes(state.status) && <>
      {summaryOnly ? <section className="as-metric-strip" aria-label={t("Metrics chính")}><StoryMetric label={t("Net PnL")} value={formatNumber(model.netPnl)} detail={result.account_currency} /><StoryMetric label={t("Win rate")} value={formatNumber(model.winRate, 1, '%')} /><StoryMetric label={t("Trades")} value={formatNumber(model.tradeCount, 0)} /><StoryMetric label={t("Max DD")} value={formatNumber(model.maxDrawdown)} detail={t("Closed balance")} /></section> : ledgerOnly ? null : <FxAnalyticsReport model={model} extra={extra} experiments={experimentScopeMatches ? experiments.payload : null} experimentStatus={experimentScopeMatches ? currentExperiments.status : currentExperiments.status === 'ready' ? 'error' : currentExperiments.status} experimentError={currentExperiments.error || (currentExperiments.status === 'ready' && !experimentScopeMatches ? 'Đường giá chưa khớp revision/cutoff của báo cáo.' : '')} propReport={propReport} config={experimentConfig} loadExperiment={loadExperiment} selected={selectedTradeId} onSelect={setSelectedTradeId} experimentScope={experimentScope} onNeedExperiments={requestExperiments} />}
      {!summaryOnly && selectedTrade && <Inspector onClose={() => setSelectedTradeId('')} className="fxa-trade-inspector" aria-label={t("Chi tiết giao dịch")}><div className="fxa-section-heading"><h2>{t("Trade detail")}</h2><button className="fxa-button" type="button" onClick={() => setSelectedTradeId('')}>{t("Đóng chi tiết")}</button></div><ProvenanceInspector model={model} selectedTrade={selectedTrade} journalCount={journalCount} links={links} /></Inspector>}
    </>}
  </section>
}

export default AnalyticsStoryWorkspace
