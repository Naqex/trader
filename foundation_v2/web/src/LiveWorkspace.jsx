import { useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import LiveSurfaces from './LiveSurfaces.jsx'
import './live-workspace.css'

const LIVE_STATUS_URL = '/api/v2/live/status'
const LIVE_SECTIONS = Object.freeze({ calendar: 'Calendar', trades: 'Trades', notes: 'Notes', 'tag-analytics': 'Tag analytics', analytics: 'Analytics', 'trading-accounts': 'Trading accounts' })

function statusError(message, kind = 'error') {
  const error = new Error(message)
  error.kind = kind
  return error
}

async function readLiveStatus(workspace, signal, connectionId, summary = false, cache = {}) {
  const params = new URLSearchParams()
  if (connectionId) params.set('connection_id',connectionId)
  if (summary) params.set('summary','true')
  const response = await fetch(`${LIVE_STATUS_URL}?${params}`, {
    method: 'GET',
    headers: { 'X-Workspace-Id': workspace, ...(cache.etag ? {'If-None-Match':cache.etag} : {}) },
    signal,
  })
  if (response.status === 304 && cache.payload) return cache.payload
  const payload = await response.json().catch(() => null)
  if (response.status === 404 || response.status === 501) throw statusError('live_status_unavailable', 'unavailable')
  if (!response.ok) throw statusError(String(payload?.detail || `HTTP ${response.status}`), response.status === 403 ? 'denied' : 'error')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw statusError('invalid_live_status_payload', 'unavailable')
  if (!['ready', 'unavailable', 'locked'].includes(payload.status)) throw statusError('invalid_live_status_state', 'unavailable')
  cache.payload=payload;cache.etag=response.headers.get('etag')
  return payload
}

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
  const { t, locale } = useTestingLocale()
  const section = LIVE_SECTIONS[query.get('section')] ? query.get('section') : 'calendar'
  const connectionId = query.get('live_account')?.startsWith('broker:') ? query.get('live_account').slice(7) : ''
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
        if (!controller.signal.aborted) setState({ workspace:scopeKey, status: payload.status, payload })
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ workspace:scopeKey, status: error.kind || 'error',
          payload: error.kind === 'denied' || previous.workspace !== scopeKey ? null : previous.payload ? { ...previous.payload, stale: true } : null, error }))
      } finally { refreshing = false }
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reloadToken, workspace, scopeKey, connectionId, summary, preview])
  const copy = statusCopy(state)
  return <section className={`live-workspace wm-page${section === 'trading-accounts' ? ' is-accounts' : ''}`} data-testid="live-workspace" aria-label={t('Live')}>
    {!preview && copy.tone !== 'ready' && state.status !== 'unavailable' && <div className={`live-status live-status-${copy.tone}`} data-testid="live-status" role={copy.tone === 'error' ? 'alert' : 'status'}>
      <span className="live-status-dot" aria-hidden="true" /><span>{t(copy.title)}</span>
      {!preview && ['error', 'denied'].includes(state.status) && <button type="button" className="fxa-button live-retry" onClick={() => setReloadToken(value => value + 1)}>{t('Thử lại')}</button>}
    </div>}
    {state.status === 'loading' ? <TestingSkeleton label="Reading account data…" /> : <LiveSurfaces key={`${workspace}:${Boolean(preview)}`} workspace={workspace} section={section} payload={state.payload} query={query} preview={Boolean(preview)} onRefresh={() => setReloadToken(value => value + 1)} />}

  </section>
}

export { LIVE_SECTIONS, readLiveStatus, statusCopy }
