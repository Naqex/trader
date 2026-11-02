import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { workflowMiddleware } from '../studioWorkflowBridge.mjs'

const company = 'a0000000-0000-4000-8000-000000000001'
function req(body, headers = {}, method = 'POST') {
  return Object.assign(Readable.from([JSON.stringify(body)]), { url: '/integrations/paperclip/workflows', method,
    headers: { host: '127.0.0.1:5180', origin: 'http://127.0.0.1:5180', 'content-type': 'application/json', ...headers } })
}
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v }, end(body) { this.body = JSON.parse(body) } }
}
test('foreign origins, rebinding hosts, methods and arbitrary actions cannot invoke the control script', async () => {
  let calls = 0
  const middleware = workflowMiddleware(async () => { calls++; return { ok: true } })
  for (const request of [req({ action: 'overview' }, { origin: 'https://other.example' }),
    req({ action: 'overview' }, { host: 'evil.example:5180', origin: 'http://evil.example:5180' }),
    req({ action: 'overview' }, {}, 'GET'), req({ action: 'shell', command: 'echo' }),
    req({ action: 'create', company: ['not-a-uuid'] }), req({ action: 'overview' }, { 'content-type': 'text/plain' })]) {
    const res = response()
    await middleware(request, res, () => assert.fail('unexpected fallthrough'))
    assert.ok(res.statusCode >= 400)
  }
  assert.equal(calls, 0)
})
test('concurrent writes are rejected without releasing the first operation lock', async () => {
  let release, calls = 0
  const middleware = workflowMiddleware(() => { calls++; return new Promise(resolve => { release = resolve }) })
  const first = response()
  const running = middleware(req({ action: 'create', company }), first, () => {})
  await new Promise(resolve => setImmediate(resolve))
  for (let i = 0; i < 2; i++) {
    const duplicate = response()
    await middleware(req({ action: 'create', company: i ? company.toUpperCase() : company }), duplicate, () => {})
    assert.equal(duplicate.statusCode, 409)
  }
  assert.equal(calls, 1)
  release({ ok: true, result: { status: 'backlog' } })
  await running
  assert.equal(first.statusCode, 200)
  assert.equal(first.headers['Cache-Control'], 'no-store')
})
test('interrupted control calls report an unknown outcome without exposing private errors', async () => {
  const middleware = workflowMiddleware(async () => { throw new Error('private path or token') })
  const res = response()
  await middleware(req({ action: 'get', company }), res, () => {})
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { ok: false, error: 'outcome_unknown' })
})
