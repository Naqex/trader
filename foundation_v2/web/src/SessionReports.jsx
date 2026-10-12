import { navigate } from './clientNavigation.js'
import { useTestingLocale } from './testingLocale.jsx'
import TestingReadState from './TestingReadState.jsx'
import { TestingEmptyState, TestingPageSkeleton, TestingResourceStatus } from './TestingPageState.jsx'
import { useEffect, useMemo, useState } from 'react'
import AnalyticsWorkspace, { analyticsQuery, buildAnalyticsModel, ProvenanceInspector, readAnalyticsFilters } from './AnalyticsWorkspace.jsx'
import { FxAnalyticsFilters } from './FxAnalytics.jsx'
import FxTradeLedger, { TradeInspector } from './FxTradeLedger.jsx'
import SessionFilter from './SessionFilter.jsx'
import { defaultSession, fetchReplaySessions, readLastSession, reportSessions, sessionAnalyticsQuery } from './sessionCatalog.js'
import { DEFAULT_EXTRA_FILTERS, readAnalyticsExtraFilters, validateTradesPagePayload } from './tradingAnalyticsModel.js'
import useReadRefresh from './useReadRefresh.js'
import { scopedRead } from './scopedRead.js'
import { readJson } from './researchDataApi.js'

function AggregateTrades({ workspace, ids, query, sessionControl, onClearSessions, catalogStatus }) {
  const { t } = useTestingLocale()

  const filters = useMemo(() => readAnalyticsFilters(query), [query])
  const extra = useMemo(() => readAnalyticsExtraFilters(query), [query])
  const [readState, setState] = useState({ status: 'loading', payload: null })
  const [reload, setReload] = useState(0), [selected, setSelected] = useState(''), [paging, setPaging] = useState({ page: 1, pageSize: 10, sort: { key: 'close_time_utc', direction: 'desc' } })
  const params = useMemo(() => {
    const params = analyticsQuery(filters)
    if (ids !== null) params.set('sessions', ids.join(','))
    params.set('page', paging.page); params.set('page_size', paging.pageSize); params.set('sort_key', paging.sort.key); params.set('sort_direction', paging.sort.direction); params.set('extra_filters', JSON.stringify(extra))
    return params.toString()
  }, [ids, filters, extra, paging])
  const state = readState.params === params && readState.workspace === workspace ? readState : { status: 'loading', payload: null, facets: readState.payload?.facets || readState.facets }
  useEffect(() => { setPaging(current => ({ ...current, page: 1 })); setSelected('') }, [workspace, ids])
  const recovery = useReadRefresh(() => setReload(value => value + 1), true, { workspace, resources: ['sessions'], scopeKey: params, error: state.readError, pending: state.status === 'loading' || state.pending })
  useEffect(() => {
    const controller = new AbortController()
    setState(current => current.params === params && current.workspace === workspace && (current.payload || current.readError) ? { ...current, pending: true, refreshing: Boolean(current.payload) } : { status: 'loading', pending: true, payload: null, params, workspace, facets: current.payload?.facets || current.facets })
    scopedRead(`/api/v2/replay/trades?${params}`, workspace, controller.signal).then(readJson).then(payload => {
      try { validateTradesPagePayload(payload) } catch (error) { error.status = 422; throw error }
      if (!controller.signal.aborted) {
        if (readState.params === params && readState.payload?.snapshot_key && readState.payload.snapshot_key !== payload.snapshot_key && paging.page > 1) { setPaging(current => ({ ...current, page: 1 })); return }
        const signature = JSON.stringify([payload.snapshot_key, payload.pagination, payload.ledger])
        setState(current => current.signature === signature && current.params === params && current.workspace === workspace ? { ...current, status: payload.status, refreshing: false, pending: false, error: null, readError: null } : { status: payload.status, payload, signature, params, workspace, pending: false, readError: null })
      }
    }).catch(error => { if (!controller.signal.aborted) setState(current => current.params === params && current.workspace === workspace && current.payload && ![401,403].includes(error.status) ? { ...current, status: 'stale', refreshing: false, pending: false, error: error.message, readError: error } : { status: 'error', pending: false, error: error.message, readError: error, payload: null, params, workspace, denied: [401,403].includes(error.status) }) })
    return () => controller.abort()
  }, [workspace, params, reload])
  useEffect(() => { setSelected('') }, [workspace, params])
  const changeFilters = patch => {
    const url = new URL(window.location.href)
    const next = { ...readAnalyticsFilters(url.searchParams), ...patch }
    for (const key of ['from_close_utc', 'to_close_utc']) url.searchParams.delete(key)
    for (const [key, value] of Object.entries(next)) value && value !== 'all' ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    setPaging(current => ({ ...current, page: 1 }))
    navigate(url, { replace: true })
  }
  const changeExtra = patch => {
    const url = new URL(window.location.href)
    const next = { ...readAnalyticsExtraFilters(url.searchParams), ...patch }
    for (const [key, value] of Object.entries(next)) {
      const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
      value !== DEFAULT_EXTRA_FILTERS[key] ? url.searchParams.set(param, value) : url.searchParams.delete(param)
    }
    setPaging(current => ({ ...current, page: 1 }))
    navigate(url, { replace: true })
  }
  const model = useMemo(() => {
    const base = buildAnalyticsModel({ ledger: state.payload?.ledger || [], metrics: {}, status: state.payload?.status, scope: state.payload?.scope, multi_session: true, account_currency: t('Đơn vị từng phiên'), paged: true })
    return { ...base, ledger: base.ledger.map(row => ({ ...row, tradeId: JSON.stringify([row.session_id, row.trade_id]) })) }
  }, [state.payload, t])
  const row = model.ledger.find(row => row.tradeId === selected)
  useEffect(() => { if (selected && !row) setSelected('') }, [row, selected])
  const detailModel = useMemo(() => buildAnalyticsModel({ ...row?.source_provenance, ledger: row ? [row] : [], metrics: {} }), [row])
  const link = view => {
    const params = new URLSearchParams({ workspace, view, session: row.session_id, trade: row.trade_id })
    if (view === 'replay') { params.set('surface', 'workspace'); params.set('cursor', row.close_cursor_index); params.set('event_sequence', row.close_event_sequence); if (row.source_provenance.dataset_id) params.set('dataset', row.source_provenance.dataset_id) }
    return `/?${params}`
  }
  const backgroundStatus = state.refreshing ? 'refreshing' : state.status === 'stale' ? 'stale' : state.payload?.status === 'partial' ? 'partial' : catalogStatus?.state
  const statusControl = <TestingResourceStatus state={backgroundStatus} resource={state.refreshing || state.status === 'stale' || state.payload?.status === 'partial' ? 'bảng giao dịch' : 'danh mục phiên'} recovery={state.readError ? recovery : catalogStatus?.recovery} />
  const readNotice = state.status === 'error' ? <TestingReadState error message={t('Không đọc được giao dịch: {error}', { error: state.error })} recovery={recovery} /> : null
  if (state.denied) return <TestingEmptyState kind="denied" viewport />
  return <section className="as-page fxa-page wm-page" aria-label={t("Trades")} data-testid="aggregate-trades">
    <FxTradeLedger readNotice={readNotice} hidden={state.status === 'error' && !state.payload} emptyScopeKnown={state.payload?.pagination.filtered_count === 0 && state.payload.status !== 'partial' && !Object.values(filters).some(value => value && value !== 'all') && Object.entries(extra).every(([key, value]) => value === DEFAULT_EXTRA_FILTERS[key])} model={model} extra={extra} selected={selected} onSelect={setSelected} remotePage={{ page: state.payload?.pagination.page || paging.page, pageSize: paging.pageSize, sort: paging.sort, totalCount: state.payload?.pagination.filtered_count ?? null, pending: state.status === 'loading', onChange: patch => setPaging(current => ({ ...current, ...patch })) }} renderFilters={columnControl => <FxAnalyticsFilters statusControl={statusControl} filters={filters} onChange={changeFilters} extra={extra} onExtra={changeExtra} rows={model.ledger} facets={state.payload?.facets || state.facets} sessionControl={sessionControl} onClearSessions={onClearSessions} pending={!state.payload} columnControl={columnControl} ledgerOnly />} />
    {state.payload && <>
      {row && <TradeInspector onClose={() => setSelected('')} className="fxa-trade-inspector" aria-label={t("Chi tiết giao dịch")}><div className="fxa-section-heading"><h2>{t("Trade detail ·")} {row.session_name}</h2><button className="fxa-button" type="button" onClick={() => setSelected('')}>{t("Đóng chi tiết")}</button></div><ProvenanceInspector model={detailModel} selectedTrade={{ ...row, tradeId: row.trade_id }} journalCount={null} links={{ replay: link('replay'), journal: link('journal') }} /></TradeInspector>}
    </>}
  </section>
}

export default function SessionReports({ workspace, query, ledgerOnly = false }) {
  const { t } = useTestingLocale()

  const [catalogState, setCatalog] = useState({ workspace, status: 'loading', items: [] })
  const catalog = catalogState.workspace === workspace ? catalogState : { status: 'loading', items: [] }
  const [scope, setScope] = useState(() => ledgerOnly ? reportSessions(query) : query.get('session') || query.get('replay_session') || '')
  const [reload, setReload] = useState(0)
  const queryScope = ledgerOnly ? JSON.stringify(reportSessions(query)) : query.get('session') || query.get('replay_session') || ''
  useEffect(() => { setScope(ledgerOnly ? JSON.parse(queryScope) : queryScope || defaultSession(catalog.items, '', readLastSession(workspace))) }, [workspace, ledgerOnly, queryScope])
  const recovery = useReadRefresh(() => setReload(value => value + 1), true, { workspace, resources: ['sessions'], scopeKey: 'session-catalog', error: catalog.readError, pending: catalog.status === 'loading' || catalog.pending })
  useEffect(() => {
    const controller = new AbortController()
    setCatalog(current => current.workspace === workspace && (['ready','stale'].includes(current.status) || current.readError) ? { ...current, pending: true, refreshing: ['ready','stale'].includes(current.status) } : { workspace, status: 'loading', items: [], pending: true })
    fetchReplaySessions(workspace, controller.signal).then(items => { if (!controller.signal.aborted) { setCatalog({ workspace, status: 'ready', items, pending: false, readError: null }); if (!ledgerOnly) setScope(current => defaultSession(items, current, readLastSession(workspace))) } }).catch(error => { if (!controller.signal.aborted) setCatalog(current => current.workspace === workspace && ['ready','stale'].includes(current.status) && ![401,403].includes(error.status) ? { ...current, status: 'stale', refreshing: false, pending: false, error: error.message, readError: error } : { workspace, status: 'error', items: [], pending: false, error: error.message, readError: error, denied: [401,403].includes(error.status) }) })
    return () => controller.abort()
  }, [workspace, reload, ledgerOnly])
  const change = next => {
    const url = new URL(window.location.href)
    for (const key of ['session', 'replay_session', 'sessions', 'dataset', 'cursor', 'cutoff', 'cursor_index', 'decision_cutoff', 'event_sequence', 'trade', 'trade_id']) url.searchParams.delete(key)
    if (ledgerOnly) { if (next === null) url.searchParams.set('sessions', 'all'); else if (!next.length) url.searchParams.set('sessions', 'none'); else next.forEach(id => url.searchParams.append('sessions', id)) }
    else url.searchParams.set('session', next)
    navigate(url, { replace: true }); setScope(next)
  }
  const control = <SessionFilter items={catalog.items} multiple={ledgerOnly} value={scope} onChange={change} disabled={catalog.status !== 'ready'} />
  const sessionId = ledgerOnly ? scope?.length === 1 ? scope[0] : '' : scope
  const item = catalog.items.find(item => item.record_id === sessionId)
  const scopedQuery = item ? sessionAnalyticsQuery(new URLSearchParams(window.location.search), item) : query
  useEffect(() => {
    if (ledgerOnly || !scope || query.get('session') || query.get('replay_session')) return
    const url = new URL(window.location.href); url.searchParams.set('session', scope); navigate(url, { replace: true })
  }, [scope, ledgerOnly])
  if (catalog.status === 'loading') return <TestingPageSkeleton view={ledgerOnly ? 'trade' : 'analytics'} label="Đang tải danh mục phiên…" />
  if (catalog.denied) return <TestingEmptyState kind="denied" viewport />
  if (catalog.status === 'error') return <section className="as-page fxa-page wm-page" aria-label={ledgerOnly ? t('Trades') : t('Analytics')} data-testid="session-catalog-error"><FxAnalyticsFilters ledgerOnly={ledgerOnly} sourceType="Backtesting" disabled pending filters={readAnalyticsFilters(query)} extra={readAnalyticsExtraFilters(query)} rows={[]} onChange={() => {}} onExtra={() => {}} sessionControl={control} statusControl={<TestingResourceStatus />} /><TestingReadState error message={t('Không tải được danh mục phiên:') + ' ' + t(catalog.error)} recovery={recovery} /></section>
  if (!catalog.items.length && !query.get('session') && !query.get('replay_session')) return <TestingEmptyState viewport />
  const catalogStatus = { state: catalog.refreshing ? 'refreshing' : catalog.status === 'stale' ? 'stale' : undefined, recovery }
  return <>
    {ledgerOnly && !(sessionId && ['cursor', 'cursor_index', 'cutoff', 'decision_cutoff', 'event_sequence', 'trade', 'trade_id'].some(key => new URLSearchParams(window.location.search).has(key))) ? <AggregateTrades catalogStatus={catalogStatus} workspace={workspace} ids={scope} query={query} sessionControl={control} onClearSessions={() => change(null)} /> : <AnalyticsWorkspace catalogStatus={catalogStatus} key={`${workspace}:${sessionId}`} workspace={workspace} query={scopedQuery} ledgerOnly={ledgerOnly} sessionName={item?.name || ''} sessionControl={control} />}
  </>
}
