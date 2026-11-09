import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cliProxyHealth, GATEWAY_HEALTH_PATH, GATEWAY_MANAGEMENT_URL } from '../cliProxyBridge.mjs'
import services from '../../local-services.json' with { type: 'json' }

test('preview probes only the registry management URL without credentials or management writes', async () => {
  const original = globalThis.fetch
  const calls = []
  let cancelled = 0
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), body: { cancel: async () => { cancelled++ } } }
  }
  const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value }, end(value) { this.body = value } })
  try {
    let forwarded = false
    await cliProxyHealth({ url: `${GATEWAY_HEALTH_PATH}/../config`, method: 'GET' }, response(), () => { forwarded = true })
    assert(forwarded)
    assert.equal(calls.length, 0)
    const write = response()
    await cliProxyHealth({ url: GATEWAY_HEALTH_PATH, method: 'POST' }, write, () => assert.fail('unexpected fallthrough'))
    assert.equal(write.statusCode, 405)
    assert.equal(calls.length, 0)
    const healthy = response()
    await cliProxyHealth({ url: `${GATEWAY_HEALTH_PATH}?url=http://other-host`, method: 'GET' }, healthy, () => assert.fail('unexpected fallthrough'))
    assert.equal(GATEWAY_MANAGEMENT_URL, `http://${services.host}:${services.cliProxyApiPort}/management.html`)
    assert.equal(calls[0].url, GATEWAY_MANAGEMENT_URL)
    assert.equal(calls[0].options.redirect, 'error')
    assert.equal(calls[0].options.headers, undefined)
    assert.equal(cancelled, 1, 'Do not download the management bundle for a health probe')
    assert.deepEqual(JSON.parse(healthy.body), { status: 'ok' })
    assert.equal(healthy.headers['Cache-Control'], 'no-store')
    globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }) })
    const wrongService = response()
    await cliProxyHealth({ url: GATEWAY_HEALTH_PATH, method: 'GET' }, wrongService)
    assert.equal(wrongService.statusCode, 503)
    globalThis.fetch = async () => { throw new Error('private runtime path') }
    const offline = response()
    await cliProxyHealth({ url: GATEWAY_HEALTH_PATH, method: 'GET' }, offline)
    assert.equal(offline.statusCode, 503)
    assert.deepEqual(JSON.parse(offline.body), { status: 'unavailable' })
  } finally { globalThis.fetch = original }
})
