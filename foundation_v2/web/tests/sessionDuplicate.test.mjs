import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanSessionConfiguration, duplicateSession } from '../src/sessionCatalog.js'

const item = { record_id: 'original', revision: 3, dataset_id: 'asset-a', cursor_index: 42 }
const original = {
  ...item,
  payload: {
    dataset_id: 'asset-a', dataset_ids: ['asset-a', 'asset-b'], name: 'My session', description: 'Notes',
    starting_balance: '10000', playbook_id: 'strategy', playbook_revision: 7,
    trading_options: { version: 'session-trading-options-v2', costs_enabled: true },
    session_kind: 'prop', prop_session_id: 'challenge', prop_attempt_id: 'attempt',
    cursor_index: 42, execution: { starting_balance: '10000', balance: '12000', ledger: ['fill'] },
    timing: { active_seconds: 100 }, parent_session_id: 'ancestor', trading_options_seed: 'old-seed',
    session_period: { requested_start_timestamp: 1700000000, requested_end_timestamp: 1700100000 },
  },
}

test('clean duplicate preserves creation settings and never copies execution, timing or Prop authority', () => {
  assert.deepEqual(cleanSessionConfiguration(original), {
    dataset_id: 'asset-a', dataset_ids: ['asset-a', 'asset-b'], name: 'My session (bản sao)', description: 'Notes',
    starting_balance: '10000', playbook_id: 'strategy', playbook_revision: 7,
    trading_options: original.payload.trading_options, start_timestamp: 1700000000, end_timestamp: 1700100000,
  })
  assert.equal(original.payload.execution.balance, '12000')
})

test('clean duplicate uses initial balance for older sessions and preserves effective period bounds', () => {
  const record = { payload: { dataset_id: 'asset-a', execution: { starting_balance: '3000', balance: '9000' }, session_period: { start_timestamp: 100, end_timestamp: 200 } } }
  const config = cleanSessionConfiguration(record)
  assert.equal(config.starting_balance, '3000')
  assert.equal(config.start_timestamp, 100)
  assert.equal(config.end_timestamp, 200)
  for (const bad of [{}, { payload: {} }, { payload: { dataset_id: 'x', session_period: { start_timestamp: 200, end_timestamp: 100 } } }]) assert.throws(() => cleanSessionConfiguration(bad))
})

test('clean submit reads the chosen revision then creates an independent session only', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options })
    return new Response(JSON.stringify(options.method === 'POST' ? { record_id: 'fresh', revision: 1, payload: { dataset_id: 'asset-a' } } : original))
  })
  assert.equal((await duplicateSession('tenant-a', item)).record_id, 'fresh')
  assert.deepEqual(calls.map(call => [call.path, call.options.method || 'GET']), [
    ['/api/v2/replay/sessions/original', 'GET'], ['/api/v2/replay/sessions', 'POST'],
  ])
  assert.deepEqual(JSON.parse(calls[1].options.body), cleanSessionConfiguration(original))
  for (const call of calls) assert.equal(call.options.headers['X-Workspace-Id'], 'tenant-a')
})

test('stale source revision does not create a duplicate', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push(options.method || 'GET'); return new Response(JSON.stringify({ ...original, revision: 4 })) })
  await assert.rejects(duplicateSession('tenant-a', item), error => error.status === 409)
  assert.deepEqual(calls, ['GET'])
})

test('legacy execution costs never silently reset in a clean duplicate', async t => {
  const legacy = { ...original, payload: { ...original.payload, trading_options: undefined, execution: { cost_model: { commission_per_side_account: '7' } } } }
  assert.throws(() => cleanSessionConfiguration(legacy), error => error.status === 422)
  let writes = 0
  t.mock.method(globalThis, 'fetch', async (path, options) => { if (options.method) writes++; return new Response(JSON.stringify(legacy)) })
  await assert.rejects(duplicateSession('tenant-a', item), error => error.status === 422)
  assert.equal(writes, 0)
})

test('keep history uses the branch checkpoint and rejects Prop duplication before any request', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push({ path, options }); return new Response(JSON.stringify({ record_id: 'fork' })) })
  await duplicateSession('tenant-a', item, { history: 'keep' })
  assert.equal(calls[0].path, '/api/v2/replay/sessions/original/branch')
  assert.deepEqual(JSON.parse(calls[0].options.body), { expected_revision: 3, cursor_index: 42 })
  await assert.rejects(duplicateSession('tenant-a', { ...item, session_kind: 'prop' }, { history: 'keep' }))
  await assert.rejects(duplicateSession('tenant-a', item, { history: 'invalid' }))
  assert.equal(calls.length, 1)
})
