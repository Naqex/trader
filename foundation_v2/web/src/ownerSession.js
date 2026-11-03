// Only this module holds the browser CSRF token. The session credential stays
// in its HttpOnly cookie and neither value enters persisted command receipts.
const SESSION_PATH = '/api/v2/auth/local/session'
const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
let session = { mode: 'local-trusted-identity', csrf: null, expiresAt: 0 }
let initializing = null

function authError(code, status) {
  const error = new Error(code)
  error.code = code
  error.status = status
  error.outcomeKnown = true
  return error
}

function nativeApi(input) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
  if (typeof value !== 'string') return false
  const origin = globalThis.location?.origin || 'http://naqex.invalid'
  if (!globalThis.location?.origin && !value.startsWith('/')) return false
  try {
    const url = new URL(value, origin)
    return url.origin === origin && url.pathname.startsWith('/api/v2/')
  } catch { return false }
}

export function initializeOwnerSession({ fetchImpl = globalThis.fetch } = {}) {
  if (initializing) return initializing
  // Mark discovery as unavailable until it finishes. A mutation cannot silently
  // use the legacy path while the API's authentication mode is still unknown.
  session = { mode: 'unavailable', csrf: null, expiresAt: 0 }
  initializing = (async () => {
    const response = await fetchImpl(SESSION_PATH, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    const body = await response.json().catch(() => null)
    if (response.ok && body?.mode === 'local-trusted-identity') {
      session = { mode: body.mode, csrf: null, expiresAt: 0 }
    } else if (response.ok && body?.mode === 'local-capability'
      && typeof body.csrf_token === 'string' && /^[a-zA-Z0-9_-]{43,256}$/.test(body.csrf_token)
      && Number.isFinite(Date.parse(body.expires_at_utc)) && Date.parse(body.expires_at_utc) > Date.now()) {
      session = { mode: body.mode, csrf: body.csrf_token, expiresAt: Date.parse(body.expires_at_utc) }
    } else if ([401, 403].includes(response.status)) {
      session = { mode: 'local-capability', csrf: null, expiresAt: 0 }
    } else if (response.status === 404) {
      // The previous API revision predates local-capability authentication.
      session = { mode: 'local-trusted-identity', csrf: null, expiresAt: 0 }
    } else {
      throw authError('local_auth_unavailable', response.status)
    }
    return { mode: session.mode, authenticated: session.mode === 'local-trusted-identity' || Boolean(session.csrf) }
  })().catch(error => {
    if (error?.outcomeKnown === true) throw error
    throw authError('local_auth_unavailable', 503)
  }).finally(() => { initializing = null })
  return initializing
}

function beforeSendAbort(signal) {
  const reason = signal?.reason
  const error = new Error(reason?.message || 'Aborted before submission', { cause: reason })
  error.name = reason?.name || 'AbortError'
  error.outcomeKnown = true
  return error
}

function abortIfRequested(signal) {
  if (signal?.aborted) throw beforeSendAbort(signal)
}

function waitForSession(promise, signal) {
  if (!signal) return promise
  abortIfRequested(signal)
  return new Promise((resolve, reject) => {
    const abort = () => reject(beforeSendAbort(signal))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function ownerFetch(input, options = {}, fetchImpl = globalThis.fetch) {
  const method = String(options.method || input?.method || 'GET').toUpperCase()
  if (!nativeApi(input) || !METHODS.has(method)) return fetchImpl(input, options)
  abortIfRequested(options.signal)
  if (initializing) await waitForSession(initializing, options.signal)
  abortIfRequested(options.signal)
  let headers = options.headers
  if (session.mode === 'unavailable') await waitForSession(initializeOwnerSession({ fetchImpl }), options.signal)
  abortIfRequested(options.signal)
  if (session.mode === 'unavailable') throw authError('local_auth_unavailable', 503)
  if (session.mode === 'local-capability') {
    headers = new Headers(options.headers || input?.headers)
    if (!headers.has('Authorization')) {
      if (!session.csrf || session.expiresAt <= Date.now()) await waitForSession(initializeOwnerSession({ fetchImpl }), options.signal)
      abortIfRequested(options.signal)
      if (!session.csrf) throw authError('owner_login_required', 401)
      if (options.credentials === 'omit') throw authError('owner_login_required', 401)
      headers.set('X-Naqex-CSRF', session.csrf)
    }
  }
  // Never replay a financial or other mutation after an authentication failure.
  // A subsequent explicit action may obtain a fresh CSRF token first.
  const response = await fetchImpl(input, { ...options, ...(headers ? { headers } : {}) })
  if ([401, 403].includes(response.status) && session.mode === 'local-capability') {
    session = { mode: 'local-capability', csrf: null, expiresAt: 0 }
  }
  return response
}
