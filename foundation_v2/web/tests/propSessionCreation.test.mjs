import assert from 'node:assert/strict'
import test from 'node:test'
import { createPropChartSession, openPropReplay, startReadyPropAttempt } from '../src/propSessionCreation.js'

test('auto cutoff is the common immutable data end; custom cutoff and explicit calendar limits stay independent', async t => {
  const bundles = [], replays = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/prop/session-bundles')) { const bundle = JSON.parse(options.body); bundles.push(bundle); return Response.json(bundle) }
    if (options.method === 'POST') { const replay = JSON.parse(options.body); replays.push(replay); return Response.json({record_id:'qa',revision:1,payload:replay}) }
    return Response.json({items:[]})
  })
  const epoch = date => Date.parse(date) / 1000
  const datasets = ['a','b'].map((dataset_id,i) => ({dataset_id,artifact_sha256:dataset_id,first_timestamp:epoch('2020-01-01Z'),last_timestamp:epoch(i ? '2020-03-01Z' : '2020-04-01Z')}))
  const draft = {name:'Auto',profileKind:'generic',initialCapital:'10000',currency:'USD',targetPercent:'10',dailyLoss:'500',overallLoss:'1000',startUtc:'2020-01-02T00:00',datasetVersion:'a',datasetVersions:['a','b']}
  await createPropChartSession('tenant-a',draft,datasets)
  assert.equal(bundles[0].attempt.virtual_cutoff_utc,'2020-03-01T00:00:00.000Z')
  assert.equal(bundles[0].session.profile.phases[0].max_calendar_days,null)
  assert.equal(bundles[0].resume_state.setup_metadata.period_end_utc,null)
  assert.equal(replays[0].end_timestamp,undefined)
  await createPropChartSession('tenant-a',{...draft,endUtc:'2020-02-01T23:59',durationDays:'30'},datasets)
  assert.equal(bundles[1].attempt.virtual_cutoff_utc,'2020-02-01T23:59:00.000Z')
  assert.equal(bundles[1].session.profile.phases[0].max_calendar_days,30)
  assert.equal(replays[1].end_timestamp,epoch('2020-02-01T23:59Z'))
  await assert.rejects(createPropChartSession('tenant-a',{...draft,endUtc:'2020-05-01T00:00'},datasets),/Khoảng dữ liệu/)
  await assert.rejects(createPropChartSession('tenant-a',{...draft,datasetVersions:['a','missing']},datasets),/Khoảng dữ liệu/)
  assert.equal(bundles.length,2,'invalid boundaries are rejected before persistence')
})

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
  const { replay } = await createPropChartSession('tenant-a', { name: 'TEST02', profileKind: 'generic', initialCapital: '10000', currency: 'USD', targetPercent: '10', dailyLoss: '500', overallLoss: '1000', startUtc: '2020-01-02T00:00', durationDays: '30', datasetVersion: 'dataset-1' }, [{ dataset_id: 'dataset-1', artifact_sha256: 'abc', first_timestamp: 1577923200, last_timestamp: 1578009600 }])
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
