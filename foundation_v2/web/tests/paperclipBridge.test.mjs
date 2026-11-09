import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paperclipHealth, PAPERCLIP_HEALTH_PATH } from '../paperclipBridge.mjs'

test('the bridge only forwards its fixed GET health route and strips runtime internals', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ status: 'ok', deploymentMode: 'local_trusted', commit: 'pinned-sha', version: '0.3.1', databaseBackup: { backupDir: 'private-path' } }) }
  }
  const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value }, end(value) { this.body = value } })
  try {
    const unrelated = response()
    let forwarded = false
    await paperclipHealth({ url: '/integrations/paperclip/health/../secrets', method: 'GET' }, unrelated, () => { forwarded = true })
    assert(forwarded)
    assert.equal(calls.length, 0)
    const write = response()
    await paperclipHealth({ url: PAPERCLIP_HEALTH_PATH, method: 'POST' }, write, () => assert.fail('not middleware fallthrough'))
    assert.equal(write.statusCode, 405)
    assert.equal(calls.length, 0)
    const healthy = response()
    await paperclipHealth({ url: `${PAPERCLIP_HEALTH_PATH}?url=http://other-host/secrets`, method: 'GET' }, healthy, () => assert.fail('unexpected fallthrough'))
    assert.equal(calls[0].url, 'http://127.0.0.1:17860/api/health')
    assert.equal(calls[0].options.redirect, 'error')
    assert.deepEqual(JSON.parse(healthy.body), { status: 'ok', version: '0.3.1', commit: 'pinned-sha' })
    assert.equal(healthy.headers['Cache-Control'], 'no-store')
    globalThis.fetch = async () => { throw new Error('private connection error') }
    const offline = response()
    await paperclipHealth({ url: PAPERCLIP_HEALTH_PATH, method: 'GET' }, offline, () => assert.fail('unexpected fallthrough'))
    assert.equal(offline.statusCode, 503)
    assert.deepEqual(JSON.parse(offline.body), { status: 'unavailable' })
  } finally { globalThis.fetch = original }
})
