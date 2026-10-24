import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadRecovery, isRetryableReadError } from '../src/readRecovery.js'

function fixture(extra = {}) {
  let clock = 0, sequence = 0, listener, unsubscribed = false
  const jobs = new Map(), calls = [], states = []
  const page = new EventTarget(); page.visibilityState = 'visible'
  const browser = new EventTarget(), network = { onLine: true }
  const controller = createReadRecovery({ workspace: 'a', resources: ['sessions'], refresh: reason => calls.push({ reason, time: clock }),
    onChange: value => states.push(value), now: () => clock, random: () => 0.5, document: page, window: browser, navigator: network,
    subscribe: (workspace, fn) => { assert.equal(workspace, 'a'); listener = fn; return () => { unsubscribed = true } },
    setTimeout: (fn, delay) => { const id = ++sequence; jobs.set(id, { fn, time: clock + delay }); return id },
    clearTimeout: id => jobs.delete(id), ...extra,
  })
  const tick = ms => {
    const target = clock + ms
    for (;;) {
      const due = [...jobs.entries()].filter(([, job]) => job.time <= target).sort((a, b) => a[1].time - b[1].time)[0]
      if (!due) break
      clock = due[1].time; jobs.delete(due[0]); due[1].fn()
    }
    clock = target
  }
  const snapshot = (sessions, datasets = 'd1', workspace = 'a') => listener({ event: 'snapshot', data: { workspace_id: workspace, resources: {
    sessions: { revision: sessions, count: 1 }, datasets: { revision: datasets, count: 1 },
  } } })
  const connection = state => listener({ event: 'connection', data: { state } })
  return { controller, tick, snapshot, connection, calls, states, page, browser, network, jobs, get unsubscribed() { return unsubscribed } }
}

test('only transient reads retry; denied, missing, conflict, validation and aborted reads do not', () => {
  for (const status of [408, 429, 502, 503, 504]) assert.equal(isRetryableReadError(Object.assign(new Error(), { status })), true)
  for (const status of [400, 401, 403, 404, 409, 422, 500]) assert.equal(isRetryableReadError(Object.assign(new TypeError(), { status })), false)
  assert.equal(isRetryableReadError(new TypeError('fetch failed')), true)
  assert.equal(isRetryableReadError(Object.assign(new Error(), { name: 'AbortError' })), false)
  assert.equal(isRetryableReadError('Network error'), false)
})

test('five bounded retries preserve budget through pending, then success starts a fresh episode', () => {
  const f = fixture()
  try {
    const failure = () => Object.assign(new Error('unavailable'), { status: 503 })
    f.controller.update({ error: failure(), pending: false })
    for (const [index, delay] of [2000, 5000, 10000, 30000, 30000].entries()) {
      f.tick(delay - 1); assert.equal(f.calls.length, index)
      f.tick(1); assert.equal(f.calls.length, index + 1)
      f.controller.update({ error: null, pending: true })
      f.tick(100); f.controller.update({ error: failure(), pending: false })
    }
    assert.equal(f.controller.getState().exhausted, true)
    f.tick(120000); assert.equal(f.calls.length, 5)
    f.controller.update({ error: null, pending: false })
    assert.equal(f.controller.getState().exhausted, false)
    f.controller.update({ error: failure(), pending: false }); f.tick(2000)
    assert.equal(f.calls.length, 6)
  } finally { f.controller.dispose() }
})

test('Retry-After countdown is honored; hidden and offline pause and resume without spending attempts', () => {
  const f = fixture()
  try {
    f.controller.update({ error: Object.assign(new Error(), { status: 429, retryAfterMs: 8000 }) })
    f.tick(1000); assert.equal(f.controller.getState().seconds, 7)
    f.network.onLine = false; f.browser.dispatchEvent(new Event('offline'))
    assert.equal(f.controller.getState().offline, true)
    assert.equal(f.controller.getState().retryAt, null)
    f.tick(12000); assert.equal(f.calls.length, 0)
    f.network.onLine = true; f.browser.dispatchEvent(new Event('online')); f.tick(0)
    assert.equal(f.calls.length, 1)
    f.controller.update({ error: null, pending: true })
    f.controller.update({ error: Object.assign(new Error(), { status: 503 }), pending: false })
    f.page.visibilityState = 'hidden'; f.page.dispatchEvent(new Event('visibilitychange'))
    f.tick(10000); assert.equal(f.calls.length, 1)
    f.page.visibilityState = 'visible'; f.page.dispatchEvent(new Event('visibilitychange')); f.tick(0)
    assert.equal(f.calls.length, 2)
  } finally { f.controller.dispose() }
})

test('exhaustion waits for focus, online or relevant revision instead of endlessly retrying or remaining stuck', () => {
  for (const trigger of ['focus', 'online', 'revision']) {
    const f = fixture()
    try {
      f.snapshot('s1')
      const failure = () => Object.assign(new Error('unavailable'), { status: 503 })
      f.controller.update({ error: failure() })
      for (const delay of [2000, 5000, 10000, 30000, 30000]) {
        f.tick(delay); f.controller.update({ pending: true }); f.controller.update({ error: failure(), pending: false })
      }
      assert.equal(f.controller.getState().exhausted, true)
      f.page.visibilityState = 'hidden'; f.page.dispatchEvent(new Event('visibilitychange'))
      f.page.visibilityState = 'visible'; f.page.dispatchEvent(new Event('visibilitychange'))
      f.snapshot('s1', 'd2'); f.tick(60000)
      assert.equal(f.calls.length, 5)
      if (trigger === 'revision') f.snapshot('s2')
      else f.browser.dispatchEvent(new Event(trigger))
      assert.equal(f.controller.getState().exhausted, false)
      f.tick(2000); assert.equal(f.calls.length, 6)
    } finally { f.controller.dispose() }
  }
})

test('first snapshot avoids duplicate GET; matching changes coalesce and unrelated changes are ignored', () => {
  const f = fixture()
  try {
    f.controller.update({ error: null }); f.snapshot('s1'); f.tick(1000)
    assert.equal(f.calls.length, 0)
    f.snapshot('s1', 'd2'); f.tick(1000); assert.equal(f.calls.length, 0)
    f.snapshot('s2'); f.snapshot('s3'); f.tick(199); assert.equal(f.calls.length, 0)
    f.tick(1); assert.equal(f.calls.length, 1)
    f.controller.update({ pending: true }); f.snapshot('s4'); f.tick(3000)
    assert.equal(f.calls.length, 1)
    f.controller.update({ pending: false }); f.tick(200)
    assert.equal(f.calls.length, 2)
    f.snapshot('wrong', 'd', 'another'); f.controller.update({ pending: true }); f.controller.update({ pending: false }); f.tick(3000)
    assert.equal(f.calls.length, 2)
  } finally { f.controller.dispose() }
})

test('Prop and research refresh only for their resource, defer while busy, and resync after reconnect', () => {
  for (const resource of ['prop', 'research']) {
    const f = fixture({ resources: [resource] })
    const snapshot = (revision, other = 'a') => f.controller.event({ event: 'snapshot', data: {
      workspace_id: 'a', resources: { [resource]: { revision }, sessions: { revision: other } },
    } })
    try {
      f.controller.update({}); snapshot('r1'); f.tick(30000)
      assert.equal(f.calls.length, 0)
      snapshot('r1', 'b'); f.tick(3000)
      assert.equal(f.calls.length, 0)
      f.controller.update({ pending: true }); snapshot('r2'); snapshot('r3'); f.tick(3000)
      assert.equal(f.calls.length, 0)
      f.controller.update({ pending: false }); f.tick(200)
      assert.equal(f.calls.length, 1)
      f.controller.update({ pending: true }); f.controller.update({ pending: false })
      f.connection('disconnected'); f.connection('connecting'); snapshot('r3'); f.tick(2000)
      assert.equal(f.calls.length, 2)
    } finally { f.controller.dispose() }
  }
})

test('opt-in initial reconciliation cannot lose a completion between the first GET and first SSE snapshot', () => {
  for (const resource of ['prop', 'research']) {
    const f = fixture({ resources: [resource], reconcileInitial: true })
    try {
      f.controller.update({ pending: true }) // GET captured the pre-completion state.
      f.controller.event({ event: 'snapshot', data: { workspace_id: 'a', resources: { [resource]: { revision: 'completed' } } } })
      f.tick(5000); assert.equal(f.calls.length, 0)
      f.controller.update({ pending: false }) // The old GET arrives; no further server event.
      f.tick(200); assert.equal(f.calls.length, 1)
      f.controller.update({ pending: true }); f.controller.update({ pending: false })
      f.tick(30000); assert.equal(f.calls.length, 1)
    } finally { f.controller.dispose() }
  }
})

test('reconnect reconciles even same revision; healthy stream suppresses fallback and no overlap during a read', () => {
  const f = fixture()
  try {
    f.controller.update({}); f.snapshot('s1'); f.tick(30000); assert.equal(f.calls.length, 0)
    f.connection('disconnected'); f.connection('connecting'); f.snapshot('s1'); f.tick(200)
    assert.equal(f.calls.length, 1)
    f.controller.update({ pending: true }); f.connection('disconnected'); f.tick(30000)
    assert.equal(f.calls.length, 1)
    f.controller.update({ pending: false }); f.tick(15000)
    assert.equal(f.calls.length, 2)
  } finally { f.controller.dispose() }
})

test('repeated SSE reconnect attempts cannot starve the read fallback', () => {
  const f = fixture()
  try {
    f.controller.update({}); f.snapshot('r1'); f.connection('disconnected')
    for (let index = 0; index < 14; index++) {
      f.tick(1000); f.connection('connecting'); f.connection('disconnected')
    }
    assert.equal(f.calls.length, 0)
    f.tick(1000); assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].reason, 'fallback')
  } finally { f.controller.dispose() }
})

test('terminal read errors and denied stream have no automatic fallback requests', () => {
  for (const status of [401, 403, 404, 409, 422]) {
    const f = fixture()
    f.controller.update({ error: Object.assign(new Error(), { status }) }); f.tick(60000)
    f.browser.dispatchEvent(new Event('focus')); f.tick(5000)
    assert.equal(f.calls.length, 0); f.controller.dispose()
  }
  const f = fixture(); f.controller.update({}); f.connection('denied'); f.tick(60000)
  f.browser.dispatchEvent(new Event('focus')); f.tick(5000)
  assert.equal(f.calls.length, 0); f.controller.dispose()
})

test('fixed historical scope skips stream and fallback, retains return-to-app reconciliation and retry', () => {
  let subscriptions = 0
  const f = fixture({ resources: [], subscribe: () => { subscriptions++; return () => {} } })
  try {
    f.controller.update({}); f.tick(60000)
    assert.equal(f.calls.length, 0); assert.equal(subscriptions, 0)
    f.browser.dispatchEvent(new Event('focus')); f.tick(200)
    assert.equal(f.calls.length, 1)
    f.controller.update({ pending: true }); f.controller.update({ error: new TypeError(), pending: false }); f.tick(2000)
    assert.equal(f.calls.length, 2)
  } finally { f.controller.dispose() }
})

test('scope/unmount disposal cancels scheduled retries, event reconciliation, fallback and subscription', () => {
  const f = fixture()
  f.controller.update({ error: new TypeError() }); f.controller.dispose()
  f.tick(120000); f.browser.dispatchEvent(new Event('focus')); f.snapshot('s2'); f.tick(30000)
  assert.equal(f.calls.length, 0); assert.equal(f.jobs.size, 0); assert.equal(f.unsubscribed, true)
})
