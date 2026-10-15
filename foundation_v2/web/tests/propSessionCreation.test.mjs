import assert from 'node:assert/strict'
import test from 'node:test'
import { createPropChartSession, openPropReplay, startReadyPropAttempt } from '../src/propSessionCreation.js'

test('dialog name survives Prop bundle and replay creation without technical suffix', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/prop/session-bundles')) {
      const bundle = JSON.parse(options.body)
      assert.equal(bundle.resume_state.setup_metadata.session_name, 'TEST02')
      assert.equal(bundle.session.status, 'running')
      assert.equal(bundle.attempt.status, 'running')
      return Response.json(bundle)
    }
    if (options.method === 'POST') {
      const replay = JSON.parse(options.body)
      assert.equal(replay.name, 'TEST02')
      assert.match(replay.prop_session_id, /^test02-/)
      assert.match(replay.prop_attempt_id, /^attempt-/)
      return Response.json({ record_id: 'replay-2', revision: 1, payload: replay })
    }
    return Response.json({ items: [] })
  })
  const { replay } = await createPropChartSession('tenant-a', { name: 'TEST02', profileKind: 'generic', initialCapital: '10000', currency: 'USD', targetPercent: '10', dailyLoss: '500', overallLoss: '1000', startUtc: '2020-01-02T00:00', durationDays: '30', datasetVersion: 'dataset-1' }, [{ dataset_id: 'dataset-1', artifact_sha256: 'abc' }])
  assert.equal(replay.session_kind, 'prop')
  assert.equal(replay.record_id, 'replay-2')
})

test('legacy ready sessions start with a stable intent without changing virtual time', async t => {
  const bundle = { attempt: { status: 'ready', session_id: 'legacy', attempt_id: 'a', profile_hash: 'profile-hash', revision: 1 }, phase: { last_event_sequence: 0, virtual_time_utc: '2020-01-02T00:00:00Z' } }
  const intents = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const intent = JSON.parse(options.body)
    intents.push(intent)
    assert.equal(intent.action, 'start')
    assert.equal(intent.event_sequence, 0)
    assert.equal(intent.expected_revision, 1)
    return Response.json({ ...bundle, attempt: { ...bundle.attempt, status: 'running', revision: 2 } })
  })
  const started = await startReadyPropAttempt('tenant-a', bundle)
  await startReadyPropAttempt('tenant-a', bundle)
  assert.equal(started.attempt.status, 'running')
  assert.equal(started.phase.virtual_time_utc, bundle.phase.virtual_time_utc)
  assert.equal(intents[0].intent_id, intents[1].intent_id)
})

test('opening running, paused or terminal sessions does not change their lifecycle', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected mutation') })
  for (const status of ['running', 'paused', 'completed_pass', 'failed_breach', 'expired', 'abandoned']) {
    const bundle = { attempt: { status } }
    assert.equal(await startReadyPropAttempt('tenant-a', bundle), bundle)
  }
})

test('opening a ready attempt reuses its persisted replay before execution initializes', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.ok(!options.method || options.method === 'GET')
    return Response.json({ items: [{ record_id: 'existing', prop_session_id: 'prop-1', prop_attempt_id: 'attempt-1' }] })
  })
  const replay = await openPropReplay('tenant-a', { session: { session_id: 'prop-1' }, attempt: { attempt_id: 'attempt-1' }, phase: {}, resume_state: {} }, [])
  assert.equal(replay.record_id, 'existing')
})
