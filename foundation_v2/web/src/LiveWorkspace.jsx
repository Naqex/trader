import { lazy, Suspense, useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import './live-workspace.css'

import { readLiveStatus } from './liveStatusApi.js'
const LiveTradingWorkspace = lazy(() => import('./LiveTradingWorkspace.jsx'))
const LiveSurfaces = lazy(() => import('./LiveSurfaces.jsx'))
const LIVE_SECTIONS = Object.freeze({ terminal:'Giao dịch MT5', calendar: 'Calendar', trades: 'Trades', notes: 'Notes', 'tag-analytics': 'Tag analytics', analytics: 'Analytics', 'trading-accounts': 'Trading accounts' })


function statusCopy(state) {
  if (state.status === 'loading') return { tone: 'loading', title: 'Reading account data…' }
  if (state.payload?.stale) return { tone: 'warning', title: 'Previous snapshot · connection interrupted' }
  if (state.status === 'ready') return { tone: 'ready', title: 'Synced · read only' }
  if (state.status === 'denied') return { tone: 'error', title: 'This workspace cannot read account data.' }
  if (state.status === 'unavailable') return { tone: 'muted', title: 'No account connected' }
  if (state.status === 'locked') return { tone: 'muted', title: 'Account data access is locked.' }
  return { tone: 'error', title: 'Could not read account data.' }
}

export default function LiveWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search), preview }) {
  if (query.get('section') === 'terminal') return <Suspense fallback={<TestingSkeleton label="Đang tải giao dịch MT5…" />}><LiveTradingWorkspace workspace={workspace} query={query} preview={Boolean(preview)}/></Suspense>
  return <LiveJournalWorkspace workspace={workspace} query={query} preview={preview}/>
}

function LiveJournalWorkspace({ workspace, query, preview }) {
  const { t, locale } = useTestingLocale()
  const section = LIVE_SECTIONS[query.get('section')] ? query.get('section') : 'calendar'
  // Calendar reads the primary snapshot once; its multi-account reader owns selection.
  const connectionId = section !== 'calendar' && query.get('live_account')?.startsWith('broker:') ? query.get('live_account').slice(7) : ''
  const summary = section === 'trading-accounts' && query.get('account_tab') !== 'transactions'
  const scopeKey = `${workspace}:${connectionId}:${summary}`
  const [reloadToken, setReloadToken] = useState(0)
  const [snapshot, setState] = useState({ workspace:scopeKey, status: 'loading', payload: null })
  const state = preview ? { status: 'ready', payload: preview } : snapshot.workspace === scopeKey ? snapshot : { status: 'loading', payload: null }
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setState(previous => previous.workspace === scopeKey && previous.status !== 'loading' ? previous : { workspace:scopeKey, status: 'loading', payload: null })
    const readCache = {}
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const payload = await readLiveStatus(workspace, controller.signal, connectionId, summary, readCache)
        if (!controller.signal.aborted) setState(previous => previous.workspace === scopeKey && previous.status === payload.status && previous.payload === payload ? previous : { workspace:scopeKey, status: payload.status, payload })
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ workspace:scopeKey, status: error.kind || 'error',
          payload: error.kind === 'denied' || previous.workspace !== scopeKey ? null : previous.payload ? { ...previous.payload, stale: true } : null, error }))
      } finally { refreshing = false }
    }
    refresh()
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void refresh() }
    const timer = setInterval(visibleRefresh, 5000)
    document.addEventListener('visibilitychange',visibleRefresh)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange',visibleRefresh) }
  }, [reloadToken, workspace, scopeKey, connectionId, summary, preview])
  const copy = statusCopy(state)
  return <section className={`live-workspace wm-page${section === 'trading-accounts' ? ' is-accounts' : section === 'calendar' ? ' is-calendar' : section === 'trades' ? ' is-trades' : section === 'notes' ? ' is-notes' : ''}`} data-testid="live-workspace" aria-label={t('Live')}>
    {!preview && !(summary && state.status === 'ready') && copy.tone !== 'ready' && state.status !== 'unavailable' && <div className={`live-status live-status-${copy.tone}`} data-testid="live-status" role={copy.tone === 'error' ? 'alert' : 'status'}>
      <span className="live-status-dot" aria-hidden="true" /><span>{t(copy.title)}</span>
      {!preview && ['error', 'denied'].includes(state.status) && <button type="button" className="fxa-button live-retry" onClick={() => setReloadToken(value => value + 1)}>{t('Thử lại')}</button>}
    </div>}
    <Suspense fallback={<TestingSkeleton label="Reading account data…" />}>{state.status === 'loading' ? <TestingSkeleton label="Reading account data…" /> : <LiveSurfaces key={`${workspace}:${Boolean(preview)}`} workspace={workspace} section={section} payload={state.payload} query={query} preview={Boolean(preview)} onRefresh={() => setReloadToken(value => value + 1)} />}</Suspense>

  </section>
}

export { LIVE_SECTIONS, readLiveStatus, statusCopy }
