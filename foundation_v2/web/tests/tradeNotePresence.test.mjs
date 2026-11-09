import test from 'node:test'
import assert from 'node:assert/strict'
import { tradeNotePresenceReader } from '../src/useTradeNotePresence.js'

const note = (source, text = 'Review', extra = {}) => ({ payload: { source, note: text }, ...extra })
const legacy = items => (session, trade) => items.filter(item => !item.deleted && item.payload?.source?.kind !== 'trade-comment').some(item => {
  const source = item.payload?.source
  return source && (source.session_id === session || source.replay_session_id === session) && (source.trade_id || source.id) === String(trade) && Boolean((item.payload.note || item.payload.notes)?.trim?.())
})

test('indexed note presence preserves aliases, strict identity and false for a known empty journal', () => {
  const items = [note({ session_id: 'first', trade_id: '7' }), note({ replay_session_id: 'second', id: '8' }),
    note({ session_id: 'first', replay_session_id: 'second', trade_id: '9' }),
    note({ session_id: 'first', trade_id: 10 }), note({ session_id: 'first', trade_id: '11' }, ''),
    { payload: { source: { session_id: 'first', trade_id: '12' }, note: '', notes: 'Older field' } },
    note({ session_id: 'first', trade_id: '13', kind: 'trade-comment' }),
    note({ session_id: 'first', trade_id: '14' }, 'Deleted', { deleted: true }),
    note({ session_id: 'first', trade_id: '15' }, '  \n '), { payload: {} }]
  const before = structuredClone(items), reader = tradeNotePresenceReader(items), oracle = legacy(items)
  for (const session of ['first', 'second', 'missing', undefined, null, 1]) {
    for (const trade of ['7', 7, '8', '9', '10', 10, '11', '12', '13', '14', '15', null, undefined]) {
      assert.equal(reader(session, trade), Boolean(oracle(session, trade)), `${session}/${trade}`)
    }
  }
  assert.equal(tradeNotePresenceReader([])('first', '7'), false)
  assert.deepEqual(items, before)
})

test('large journal index matches the existing lookup oracle without modifying source records', () => {
  const items = Array.from({ length: 2000 }, (_, i) => note({ session_id: `session-${i % 7}`, trade_id: String(i), ...(i % 13 === 0 ? { kind: 'trade-comment' } : {}) }, i % 17 === 0 ? '' : `Review ${i}`, { deleted: i % 19 === 0 }))
  const reader = tradeNotePresenceReader(items), oracle = legacy(items)
  for (let i = 0; i < 2100; i += 11) for (const session of [`session-${i % 7}`, 'other']) assert.equal(reader(session, i), oracle(session, i))
})
