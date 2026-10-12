import test from 'node:test'
import assert from 'node:assert/strict'
import { scopedRead } from '../src/scopedRead.js'
import { retryAfterMs } from '../src/researchDataApi.js'

test('Retry-After supports seconds and HTTP date; invalid headers do not schedule a retry', () => {
  const now = Date.parse('2026-10-12T00:00:00Z')
  const response = value => new Response('', { headers: { 'Retry-After': value } })
  assert.equal(retryAfterMs(response('7'), now), 7000)
  assert.equal(retryAfterMs(response('Mon, 12 Oct 2026 00:00:20 GMT'), now), 20000)
  assert.equal(retryAfterMs(response('Mon, 12 Oct 2026 00:00:00 GMT'), now + 1000), 0)
  assert.equal(retryAfterMs(response('invalid'), now), undefined)
})

test('a stalled response body times out and frees its shared request for retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (path, { signal }) => {
    if (++calls > 1) return new Response('{}')
    return { arrayBuffer: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }
  })
  const pending = scopedRead('/fixture/timeout', 'a')
  const rejected = assert.rejects(pending, { name: 'TimeoutError', status: 408 })
  await Promise.resolve()
  t.mock.timers.tick(15000)
  await rejected
  assert.deepEqual(await (await scopedRead('/fixture/timeout', 'a')).json(), {})
  assert.equal(calls, 2)
})

test('simultaneous scoped readers share network work and receive independent bodies; no persistent cache', async t => {
  let finish, calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Promise(resolve => { finish = () => resolve(new Response('{"items":[1]}')) }) })
  const first = scopedRead('/fixture/shared', 'a'), second = scopedRead('/fixture/shared', 'a')
  assert.equal(calls, 1)
  finish()
  const responses = await Promise.all([first, second])
  assert.deepEqual(await Promise.all(responses.map(response => response.json())), [{ items: [1] }, { items: [1] }])
  const next = scopedRead('/fixture/shared', 'a')
  assert.equal(calls, 2)
  finish(); await next
})

test('workspace and query isolate simultaneous reads', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push([path, options.headers['X-Workspace-Id']]); return new Response('{}') })
  await Promise.all([scopedRead('/fixture/page?offset=0', 'a'), scopedRead('/fixture/page?offset=1', 'a'), scopedRead('/fixture/page?offset=0', 'b')])
  assert.equal(calls.length, 3)
})

test('one unmounted consumer does not cancel another; last consumer cancels network', async t => {
  let networkSignal, finish, calls = 0
  t.mock.method(globalThis, 'fetch', async (path, { signal }) => {
    calls++; networkSignal = signal
    return new Promise((resolve, reject) => {
      finish = () => resolve(new Response('{}'))
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const a = new AbortController(), b = new AbortController()
  const first = scopedRead('/fixture/abort', 'a', a.signal), second = scopedRead('/fixture/abort', 'a', b.signal)
  a.abort(); await assert.rejects(first, { name: 'AbortError' })
  assert.equal(networkSignal.aborted, false)
  b.abort(); await assert.rejects(second, { name: 'AbortError' })
  assert.equal(networkSignal.aborted, true)
  const next = scopedRead('/fixture/abort', 'a')
  assert.equal(calls, 2)
  finish(); await next
})

test('cancellation lasts through body download, and errors retain status without caching', async t => {
  let signal, calls = 0
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls++; signal = options.signal
    if (calls > 1) return new Response('{"detail":"denied"}', { status: 403 })
    return { arrayBuffer: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }
  })
  const controller = new AbortController(), pending = scopedRead('/fixture/body', 'a', controller.signal)
  await Promise.resolve(); controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(signal.aborted, true)
  const response = await scopedRead('/fixture/body', 'a')
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { detail: 'denied' })
})

test('an already cancelled reader does not issue network work', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected fetch'))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(scopedRead('/fixture/preabort', 'a', controller.signal), { name: 'AbortError' })
})
