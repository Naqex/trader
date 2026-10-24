const RETRY_DELAYS = [2000, 5000, 10000, 30000, 30000]
const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504])

export function isRetryableReadError(error) {
  if (!error || error.name === 'AbortError') return false
  const status = Number(error.status)
  if (status) return TRANSIENT_STATUS.has(status)
  return error instanceof TypeError || error.name === 'TypeError' || error.code === 'NETWORK_ERROR'
}

function resourceRevision(snapshot, resource) {
  const value = snapshot?.resources?.[resource]
  if (value != null) return typeof value === 'object' ? value.revision : value
  if (resource === 'research') return JSON.stringify(snapshot?.research?.recent_jobs || [])
  return undefined
}

// All automatic actions are reads. The caller owns requests and their abort/scope fences.
export function createReadRecovery({ refresh, onChange = () => {}, resources = [], workspace,
  reconcileInitial = false,
  now = Date.now, random = Math.random, setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout,
  document: page = globalThis.document, window: browser = globalThis.window,
  navigator: network = globalThis.navigator, subscribe, fallbackMs = 15000 } = {}) {
  let disposed = false, error = null, pending = false, attempts = 0, retryAt = null
  let retryTimer, tickTimer, fallbackTimer, coalesceTimer, waiting = false, sawPending = false
  let seenSnapshot = false, reconnect = false, dirty = false, connection = resources.length ? 'connecting' : 'paused', lastRefresh = -Infinity
  let revisions = new Map()
  const online = () => network?.onLine !== false
  const active = () => !disposed && page?.visibilityState !== 'hidden' && online()
  const clear = name => {
    if (name === 'retry') { cancel(retryTimer); retryTimer = undefined; cancel(tickTimer); tickTimer = undefined }
    if (name === 'fallback') { cancel(fallbackTimer); fallbackTimer = undefined }
    if (name === 'coalesce') { cancel(coalesceTimer); coalesceTimer = undefined }
  }
  const state = () => ({
    retryAt: active() ? retryAt : null,
    seconds: retryAt != null && active() ? Math.max(0, Math.ceil((retryAt - now()) / 1000)) : null,
    offline: !online(), exhausted: Boolean(error && isRetryableReadError(error) && attempts >= RETRY_DELAYS.length && retryAt == null), connection,
  })
  const emit = () => { if (!disposed) onChange(state()) }
  function invoke(reason) {
    if (!active() || connection === 'denied' || pending || waiting || (error && !isRetryableReadError(error))) return false
    if (reason !== 'retry' && (retryAt != null || attempts >= RETRY_DELAYS.length || now() - lastRefresh < 2000)) return false
    lastRefresh = now(); dirty = false
    waiting = true; sawPending = false
    // A consumer may synchronously update its read state during refresh.
    try { refresh(reason) } catch { waiting = false }
    return true
  }
  function countdown() {
    if (!active() || retryAt == null) return
    emit()
    tickTimer = later(countdown, Math.min(1000, Math.max(1, retryAt - now())))
  }
  function armRetry() {
    clear('retry')
    if (!active() || pending || waiting || retryAt == null) return
    retryTimer = later(() => {
      retryTimer = undefined
      if (!active() || pending || waiting) return
      retryAt = null; clear('retry'); attempts++
      invoke('retry'); emit(); armFallback()
    }, Math.max(0, retryAt - now()))
    emit()
    tickTimer = later(countdown, 1000)
  }
  function scheduleRetry() {
    if (connection === 'denied' || !error || !isRetryableReadError(error) || pending || waiting || attempts >= RETRY_DELAYS.length) return
    if (retryAt == null) {
      const delay = Math.min(30000, RETRY_DELAYS[attempts] * (0.9 + random() * 0.2))
      retryAt = now() + Math.max(delay, Number(error.retryAfterMs) || 0)
    }
    armRetry()
  }
  function armFallback() {
    if (!resources.length || !active() || connection === 'connected' || connection === 'denied' || error) { clear('fallback'); return }
    // Reconnect attempts must not keep postponing the independent fallback deadline.
    if (fallbackTimer) return
    fallbackTimer = later(() => { fallbackTimer = undefined; invoke('fallback'); armFallback() }, Math.min(15000, Math.max(1000, fallbackMs)))
  }
  function coalesce() {
    dirty = true
    if (!active() || pending || waiting || error || coalesceTimer) return
    coalesceTimer = later(() => { coalesceTimer = undefined; invoke('event') }, Math.max(200, 2000 - (now() - lastRefresh)))
  }
  function event({ event: kind, data }) {
    if (disposed) return
    if (kind === 'connection') {
      connection = data.state
      if (seenSnapshot && ['disconnected', 'paused', 'connecting'].includes(connection)) reconnect = true
      if (connection === 'denied') { clear('retry'); retryAt = null; clear('coalesce') }
      armFallback(); emit()
    } else if (kind === 'snapshot') {
      if (data.workspace_id && data.workspace_id !== workspace) return
      const next = new Map(resources.map(resource => [resource, resourceRevision(data, resource)]))
      const changed = seenSnapshot && resources.some(resource => next.get(resource) !== revisions.get(resource))
      if (changed && error && isRetryableReadError(error) && attempts >= RETRY_DELAYS.length) {
        attempts = 0; scheduleRetry()
      }
      // A GET can finish with old data after the first SSE snapshot already saw a commit.
      if (changed || (seenSnapshot && reconnect) || (!seenSnapshot && reconcileInitial)) coalesce()
      revisions = next; seenSnapshot = true; reconnect = false; connection = 'connected'
      armFallback(); emit()
    }
  }
  function resume(trigger) {
    if (!active()) { clear('retry'); clear('fallback'); clear('coalesce'); emit(); return }
    // A new user/network opportunity starts a bounded episode; timers never do.
    if (['focus', 'online'].includes(trigger?.type) && error && isRetryableReadError(error) && attempts >= RETRY_DELAYS.length) attempts = 0
    if (error) scheduleRetry()
    else coalesce()
    armFallback(); emit()
  }
  const off = resources.length ? subscribe?.(workspace, event) || (() => {}) : () => {}
  browser?.addEventListener('focus', resume)
  browser?.addEventListener('online', resume)
  browser?.addEventListener('offline', resume)
  page?.addEventListener('visibilitychange', resume)
  armFallback()
  return {
    update(next = {}) {
      if (disposed) return
      const changedError = next.error !== error
      error = next.error || null; pending = Boolean(next.pending)
      if (pending && waiting) sawPending = true
      if (waiting && !pending && (sawPending || changedError)) waiting = false
      if (!pending && !error) {
        attempts = 0; retryAt = null; waiting = false; clear('retry')
      } else if (!isRetryableReadError(error)) { retryAt = null; clear('retry') }
      else if (pending) clear('retry')
      else scheduleRetry()
      if (dirty && !pending && !error && !waiting) coalesce()
      armFallback(); emit()
    },
    event,
    getState: state,
    dispose() {
      disposed = true; clear('retry'); clear('fallback'); clear('coalesce'); off()
      browser?.removeEventListener('focus', resume)
      browser?.removeEventListener('online', resume)
      browser?.removeEventListener('offline', resume)
      page?.removeEventListener('visibilitychange', resume)
    },
  }
}
