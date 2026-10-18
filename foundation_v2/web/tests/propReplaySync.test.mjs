import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPendingPropReplayEvents, syncPropReplayEvents } from '../src/propReplaySync.js'

const initial = () => ({ status: 'ready', attempt: { revision: 4, status: 'running' }, phase: { last_event_sequence: 2 }, resumeState: { replay_binding: { last_replay_event_sequence: 3 } } })
const events = [{ sequence: 3, kind: 'price_mark' }, { sequence: 4, kind: 'protection_change' }, { sequence: 5, kind: 'manual_close' }, { sequence: 6, kind: 'price_mark' }]
const args = propState => ({ workspace: 'sync-unit', sessionId: 'replay', propSessionId: 'prop', propAttemptId: 'attempt', propState, events })
const fed = (sequence, revision, status = 'running') => ({ attempt: { revision, status }, phase: { last_event_sequence: revision - 2 }, resume_state: { replay_binding: { last_replay_event_sequence: sequence } } })

test('partial failure preserves acknowledged progress and retry only feeds outstanding events', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    requests.push({ url, body })
    return body.replay_event_sequence === 5 ? Response.json(fed(5, 5)) : Response.json({ detail: 'temporarily_unavailable' }, { status: 503 })
  })
  let failure
  await assert.rejects(syncPropReplayEvents(args(initial())), error => { failure = error; return error.message === 'temporarily_unavailable' })
  assert.equal(failure.propState.resumeState.replay_binding.last_replay_event_sequence, 5)
  assert.equal(failure.propState.attempt.revision, 5)
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body })
    return Response.json(fed(6, 6))
  })
  const recovered = await syncPropReplayEvents(args(failure.propState))
  assert.equal(recovered.resumeState.replay_binding.last_replay_event_sequence, 6)
  assert.deepEqual(requests.map(r => r.body.replay_event_sequence), [5, 6, 6])
  assert.deepEqual(requests.map(r => r.body.expected_prop_revision), [4, 5, 5])
  assert.ok(requests.every(r => r.url.endsWith('/feed')), 'recovery never resends an order')
})

test('revision failures retain server detail; terminal attempts stop consuming further marks', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ detail: 'attempt revision conflict' }, { status: 409 }) })
  await assert.rejects(syncPropReplayEvents(args(initial())), error => error.status === 409 && error.message === 'attempt revision conflict' && error.propState.attempt.revision === 4)
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json(fed(5, 5, 'failed_breach')) })
  const result = await syncPropReplayEvents(args(initial()))
  assert.equal(result.attempt.status, 'failed_breach')
  assert.equal(requests, 2)
})

test('missing history or mismatched acknowledgement cannot unlock synchronization', async t => {
  await assert.rejects(syncPropReplayEvents({ ...args(initial()), events: undefined }), /lịch sử/)
  t.mock.method(globalThis, 'fetch', async () => Response.json(fed(999, 5)))
  await assert.rejects(syncPropReplayEvents(args(initial())), /không khớp/)
})

test('calendar expiry can stop before a requested price mark without claiming it was consumed', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body).replay_event_sequence)
    return Response.json({ ...fed(3, 5, 'expired'), terminal_boundary:{ requested_replay_event_sequence:5, acknowledged_replay_event_sequence:3 } })
  })
  const result = await syncPropReplayEvents(args(initial()))
  assert.equal(result.attempt.status, 'expired')
  assert.equal(result.resumeState.replay_binding.last_replay_event_sequence, 3)
  assert.deepEqual(requests, [5])
  t.mock.method(globalThis, 'fetch', async () => Response.json(fed(2, 5, 'expired')))
  await assert.rejects(syncPropReplayEvents(args(initial())), /không khớp/)
  t.mock.method(globalThis, 'fetch', async () => Response.json(fed(3, 5, 'expired')))
  await assert.rejects(syncPropReplayEvents(args(initial())), /không khớp/)
})

test('reopening with saved replay events but no challenge acknowledgement stays blocked', () => {
  const replay = { payload: { execution: { ledger: Array.from({ length: 6 }, (_, i) => ({ sequence: i + 1, kind: i === 5 ? 'price_mark' : 'protection_change' })) } } }
  assert.equal(hasPendingPropReplayEvents(replay, initial()), true)
  const synchronized = initial(); synchronized.resumeState.replay_binding.last_replay_event_sequence = 6
  assert.equal(hasPendingPropReplayEvents(replay, synchronized), false)
})

test('portfolio recovery compares the aggregate sequence even after switching to a shorter asset ledger', () => {
  const replay = { payload: { asset_states: { a: {}, b: {} }, execution: { ledger: [] }, portfolio_execution: { ledger: Array.from({ length: 6 }, (_, i) => ({ sequence: i + 1, kind: 'price_mark' })) } } }
  assert.equal(hasPendingPropReplayEvents(replay, initial()), true)
  const synchronized = initial(); synchronized.resumeState.replay_binding.last_replay_event_sequence = 6
  assert.equal(hasPendingPropReplayEvents(replay, synchronized), false)
  replay.payload.execution.ledger.push({ sequence: 10, kind: 'price_mark' })
  assert.equal(hasPendingPropReplayEvents(replay, synchronized), false)
})
