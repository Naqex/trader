import test from 'node:test'
import assert from 'node:assert/strict'
import { installChunkRecovery } from '../src/chunkRecovery.js'

test('a failed lazy chunk reloads once per build and never loops', () => {
  const target = new EventTarget(), storage = new Map()
  let reloads = 0
  Object.assign(target, { navigator: { onLine: true }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, location: { reload: () => reloads++ } })
  const remove = installChunkRecovery('build-a', target)
  const first = new Event('vite:preloadError', { cancelable: true })
  target.dispatchEvent(first)
  assert.equal(first.defaultPrevented, true)
  target.dispatchEvent(new Event('vite:preloadError'))
  assert.equal(reloads, 1)
  remove()
  const cleanup = installChunkRecovery('build-b', target)
  target.navigator.onLine = false
  target.dispatchEvent(new Event('vite:preloadError'))
  assert.equal(reloads, 1)
  target.navigator.onLine = true
  target.dispatchEvent(new Event('vite:preloadError'))
  assert.equal(reloads, 2)
  cleanup()
})

test('storage denial does not cause an unbounded refresh', () => {
  const target = new EventTarget()
  Object.assign(target, { navigator: { onLine: true }, sessionStorage: { getItem: () => { throw new Error('denied') } }, location: { reload: () => assert.fail('must not reload without a durable guard') } })
  const cleanup = installChunkRecovery('build', target)
  target.dispatchEvent(new Event('vite:preloadError'))
  cleanup()
})
