import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSelection, storedSelection } from '../src/aiSelection.js'

const choice = (model = 'gemini', effort = 'medium', provider = 'local-gateway') => ({ provider, model, effort })
const gateway = (models = [{ id: 'gemini', efforts: ['low', 'medium', 'high'] }], ready = true) => ({ provider: 'local-gateway', ready, models })
const web = { provider: 'chatgpt-web', ready: true, models: [{ id: 'gemini', efforts: ['high'] }] }

test('valid saved selection takes precedence over a changed system default', () => {
  assert.deepEqual(resolveSelection(choice(), choice('other', null), [gateway(), web]), choice())
})
test('gateway outage, empty catalog and incomplete load preserve the saved choice', () => {
  for (const routes of [null, [], [gateway([], false), web], [gateway(undefined, false)]]) {
    assert.deepEqual(resolveSelection(choice(), choice('other'), routes), choice())
  }
})
test('confirmed model removal falls back within its provider before considering another', () => {
  const routes = [web, gateway([{ id: 'replacement', efforts: [] }])]
  assert.deepEqual(resolveSelection(choice(), choice('gemini', 'high', 'chatgpt-web'), routes), choice('replacement', null))
})
test('same-provider default is used if available after removal', () => {
  assert.deepEqual(resolveSelection(choice('removed'), choice('default', null), [gateway([{ id: 'first' }, { id: 'default' }])]), choice('default', null))
  assert.deepEqual(resolveSelection(choice('removed'), choice('default', 'low'), [gateway([{ id: 'first' }, { id: 'default', efforts: ['low', 'high'] }])]), choice('default', 'low'))
})
test('effort disappearance resets to provider default; Web requires an advertised value', () => {
  assert.deepEqual(resolveSelection(choice(), null, [gateway([{ id: 'gemini', efforts: ['low'] }])]), choice('gemini', null))
  assert.deepEqual(resolveSelection(choice('gemini', 'medium', 'chatgpt-web'), null, [web]), choice('gemini', 'high', 'chatgpt-web'))
  assert.deepEqual(resolveSelection(choice(), null, [gateway([{ id: 'gemini', efforts: [] }])]), choice('gemini', null))
})
test('provider removal and invalid default use the first ready model; equal IDs stay scoped', () => {
  assert.deepEqual(resolveSelection(choice(), null, [web]), choice('gemini', 'high', 'chatgpt-web'))
  assert.deepEqual(resolveSelection(null, choice('removed'), [gateway(), web]), choice('gemini', null))
  assert.deepEqual(resolveSelection(choice('gemini', 'high', 'chatgpt-web'), null, [gateway(), web]), choice('gemini', 'high', 'chatgpt-web'))
})
test('first visit with no routes remains empty; malformed stored preferences are ignored', () => {
  assert.equal(resolveSelection(null, null, []), null)
  for (const value of [null, {}, [], 'text', { provider: 5, model: 'x' }, { provider: 'x', model: '' }, { provider: 'x', model: 'y', effort: [] }]) assert.equal(storedSelection(value), null)
  assert.deepEqual(storedSelection({ provider: 'x', model: 'y', extra: 'ignored' }), { provider: 'x', model: 'y', effort: null })
})
test('reconciliation cannot mutate an admitted run snapshot', () => {
  const run = Object.freeze(choice())
  assert.deepEqual(resolveSelection(run, null, [gateway([{ id: 'next' }])]), choice('next', null))
  assert.deepEqual(run, choice())
})
