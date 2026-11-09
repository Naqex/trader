import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeOwnerSession, ownerFetch } from '../src/ownerSession.js'
import { scopedMutation, CommandOutcomeUnknownError } from '../src/scopedMutation.js'
import { commandDemoOrder } from '../src/liveTradingApi.js'
import { mt5Request } from '../src/mt5Connections.js'

const TOKEN = 'a'.repeat(43)
const NEXT_TOKEN = 'b'.repeat(43)
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })
const capability = (token = TOKEN) => json({ mode: 'local-capability', csrf_token: token,
  expires_at_utc: new Date(Date.now() + 60000).toISOString() })
const legacy = () => json({ mode: 'local-trusted-identity' })
afterEach(async () => { await initializeOwnerSession({ fetchImpl: async () => legacy() }) })

test('secure mutations attach CSRF only to normalized native API paths and preserve caller headers', async () => {
  await initializeOwnerSession({ fetchImpl: async () => capability() })
  const calls = []
  const transport = async (path, options) => { calls.push([path, options]); return json({ ok: true }) }
  const headers = { 'Idempotency-Key': 'same-command', 'X-Workspace-Id': 'a' }
  await ownerFetch('/api/v2/live/trading/commands', { method: 'POST', headers, body: '{}' }, transport)
  assert.equal(new Headers(calls[0][1].headers).get('X-Naqex-CSRF'), TOKEN)
  assert.equal(new Headers(calls[0][1].headers).get('Idempotency-Key'), 'same-command')
  assert.deepEqual(headers, { 'Idempotency-Key': 'same-command', 'X-Workspace-Id': 'a' })
  for (const path of ['/api/v2/../../management', '/__paperclip/health', 'http://127.0.0.1:17860/api/v2/tasks', '//example.com/api/v2/orders']) {
    await ownerFetch(path, { method: 'POST' }, transport)
    assert.equal(new Headers(calls.at(-1)[1].headers).has('X-Naqex-CSRF'), false, path)
  }
  await ownerFetch('/api/v2/live/trading', {}, transport)
  assert.equal(new Headers(calls.at(-1)[1].headers).has('X-Naqex-CSRF'), false)
})

test('discovery gates mutations and caller abort does not cancel shared owner discovery', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const discovery = initializeOwnerSession({ fetchImpl: async () => { await gate; return capability() } })
  const calls = []
  const transport = async (path, options) => { calls.push([path, options]); return json({ ok: true }) }
  const controller = new AbortController()
  const aborted = ownerFetch('/api/v2/playbooks', { method: 'POST', signal: controller.signal }, transport)
  const waiting = ownerFetch('/api/v2/research/jobs', { method: 'POST' }, transport)
  controller.abort()
  await assert.rejects(aborted, error => error.name === 'AbortError' && error.outcomeKnown === true)
  assert.equal(controller.signal.reason.outcomeKnown, undefined)
  assert.equal(calls.length, 0)
  release()
  await discovery
  await waiting
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/api/v2/research/jobs')
})

test('401 or 403 invalidates CSRF without replaying a mutation; next explicit action refreshes it', async () => {
  await initializeOwnerSession({ fetchImpl: async () => capability() })
  const calls = []
  const transport = async (path, options) => {
    calls.push([path, options])
    if (path === '/api/v2/auth/local/session') return capability(NEXT_TOKEN)
    return calls.length === 1 ? json({ detail: 'local_capability_denied' }, 403) : json({ ok: true })
  }
  assert.equal((await ownerFetch('/api/v2/live/trading/commands', { method: 'POST' }, transport)).status, 403)
  assert.equal(calls.length, 1)
  await ownerFetch('/api/v2/live/trading/commands', { method: 'POST' }, transport)
  assert.deepEqual(calls.map(([path]) => path), ['/api/v2/live/trading/commands', '/api/v2/auth/local/session', '/api/v2/live/trading/commands'])
  assert.equal(new Headers(calls[2][1].headers).get('X-Naqex-CSRF'), NEXT_TOKEN)
})

test('pre-auth denial is known not submitted and does not leave a command receipt', async () => {
  await initializeOwnerSession({ fetchImpl: async () => json({ detail: 'invalid_local_capability' }, 401) })
  const calls = [], saved = new Map()
  globalThis.sessionStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  try {
    await assert.rejects(scopedMutation('/api/v2/playbooks', 'auth-denied', { method: 'POST', body: '{}' }, {
      fetchImpl: async path => { calls.push(path); return json({ detail: 'invalid_local_capability' }, 401) },
    }), error => error.code === 'owner_login_required' && error.outcomeKnown === true && !(error instanceof CommandOutcomeUnknownError))
    assert.deepEqual(calls, ['/api/v2/auth/local/session'])
    assert.equal(saved.size, 0)
    await initializeOwnerSession({ fetchImpl: async () => capability() })
    const response = await scopedMutation('/api/v2/playbooks', 'auth-denied', { method: 'POST', body: '{}' }, {
      fetchImpl: async () => json({ ok: true }),
    })
    assert.equal(response.status, 200)
  } finally { delete globalThis.sessionStorage }
})

test('live broker commands use owner transport exactly once and preserve original identity/body', async () => {
  await initializeOwnerSession({ fetchImpl: async () => capability() })
  const original = globalThis.fetch, calls = []
  const body = { request_id: 'request-1', account_id: '1234', connection_id: 'connection-1', action: 'place' }
  globalThis.fetch = async (path, options) => { calls.push([path, options]); return json({ status: 'unknown' }) }
  try {
    const result = await commandDemoOrder('a', body)
    assert.equal(result.status, 'unknown')
    assert.equal(calls.length, 1)
    assert.equal(new Headers(calls[0][1].headers).get('X-Naqex-CSRF'), TOKEN)
    assert.deepEqual(JSON.parse(calls[0][1].body), body)
    assert.equal(calls[0][1].signal.aborted, false)
  } finally { globalThis.fetch = original }
})

test('discovery outages fail closed and credentials remain known unsent', async () => {
  await assert.rejects(initializeOwnerSession({ fetchImpl: async () => { throw new TypeError('network unavailable') } }), { code: 'local_auth_unavailable', outcomeKnown: true })
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, options) => { calls.push([path, options]); return json({}, 503) }
  try {
    await assert.rejects(mt5Request('a', '', { login: '1234', password: 'private' }), error => error.code === 'local_auth_unavailable' && error.uncertain === false)
    assert.deepEqual(calls.map(([path]) => path), ['/api/v2/auth/local/session'])
    assert.equal(calls[0][1].body.includes('private'), false)
    globalThis.fetch = async (path, options) => {
      calls.push([path, options])
      return path === '/api/v2/auth/local/session' ? capability() : json({ id: 'connected-account' })
    }
    assert.equal((await mt5Request('a', '', { login: '1234', password: 'private' })).id, 'connected-account')
    assert.deepEqual(calls.map(([path]) => path), ['/api/v2/auth/local/session', '/api/v2/auth/local/session', '/api/v2/live/connections'])
  } finally { globalThis.fetch = original }
})

test('legacy and pre-capability APIs retain existing request contract without extra probes', async () => {
  await initializeOwnerSession({ fetchImpl: async () => json({ detail: 'Not Found' }, 404) })
  const calls = []
  await ownerFetch('/api/v2/live/trading/commands', { method: 'POST', headers: { 'X-Workspace-Id': 'a' } }, async (path, options) => {
    calls.push([path, options]); return json({ ok: true })
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][1].headers, { 'X-Workspace-Id': 'a' })
})
