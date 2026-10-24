import test from 'node:test'
import assert from 'node:assert/strict'
import { readJournalContext, enrichJournalTags } from '../src/journalContext.js'
import { filterAnalyticsRows } from '../src/tradingAnalyticsModel.js'

const payload = { schema_version: 'replay-journal-context-v1', workspace_id: 'a', session_id: 's', record_count: 2,
  trades: [{ trade_id: 't', record_count: 2, tags: ['risk', 'risk', 'entry'] }] }

test('compact journal context preserves counts and unions tags without changing finance', () => {
  const context = readJournalContext(payload, 'a', 's')
  const ledger = [{ tradeId: 't', pnl: 25, tags: ['risk', 'base'] }, { tradeId: 'other', pnl: -7 }]
  const enriched = enrichJournalTags(ledger, context)
  assert.deepEqual(enriched[0].tags, ['risk', 'base', 'entry'])
  assert.equal(enriched[0].pnl, 25)
  assert.equal(enriched[0].tag_source, 'journal_annotation')
  assert.deepEqual(enriched[1].tags, [])
  assert.deepEqual(ledger[0].tags, ['risk', 'base'])
  assert.equal(context.byTrade.get('t').count, 2)
})

test('scope, duplicate and invalid schema fail closed; empty is known zero', () => {
  for (const invalid of [{ ...payload, workspace_id: 'b' }, { ...payload, session_id: 'x' },
    { ...payload, record_count: null }, { ...payload, trades: [...payload.trades, ...payload.trades] }]) {
    assert.throws(() => readJournalContext(invalid, 'a', 's'), /journal_context_invalid/)
  }
  assert.equal(readJournalContext({ ...payload, record_count: 0, trades: [] }, 'a', 's').count, 0)
  assert.deepEqual(enrichJournalTags([{ tradeId: 't', tags: ['base'] }], null)[0].tags, ['base'])
})
test('compact note presence distinguishes tag-only annotation from a note', () => {
  const context = readJournalContext({ ...payload, trades: [{ ...payload.trades[0], has_notes: false }] }, 'a', 's')
  assert.equal(enrichJournalTags([{ tradeId: 't' }], context)[0].has_notes, false)
  assert.equal(enrichJournalTags([{ tradeId: 't', note: 'local' }], context)[0].has_notes, true)
  assert.equal(enrichJournalTags([{ tradeId: 't' }], readJournalContext(payload, 'a', 's'))[0].has_notes, null)
  assert.throws(() => readJournalContext({ ...payload, trades: [{ ...payload.trades[0], has_notes: 'yes' }] }, 'a', 's'), /journal_context_invalid/)
})

test('explicit labels override stale journal/execution tags; definitions apply even without a journal row', () => {
  const definitions = [{name:'Momentum',aliases:['Breakout','Momentum'],active:true},{name:'Deleted',aliases:['Deleted'],active:false}]
  const context = readJournalContext({...payload, label_definitions:definitions, trades:[{trade_id:'t',record_count:2,tags:['Momentum'],label_revision:3,labels_authoritative:true}]},'a','s')
  const rows=enrichJournalTags([{tradeId:'t',tags:['stale','Deleted']},{tradeId:'without-note',tags:['Breakout','Deleted']}],context)
  assert.deepEqual(rows[0].tags,['Momentum'])
  assert.equal(rows[0].label_revision,3)
  assert.deepEqual(rows[1].tags,['Momentum'])
  assert.equal(filterAnalyticsRows(rows,{tagInclude:JSON.stringify(['Breakout'])}).length,2,'active filters survive a label rename')
  assert.equal(filterAnalyticsRows(rows,{tagInclude:JSON.stringify(['Deleted'])}).length,0,'deleted include never becomes an unfiltered query')
})
