import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_NOTE_FILTERS, filterJournalNotes, groupJournalNotes } from '../src/liveNoteModel.js'

const note = (id, payload = {}, updated = '2026-10-29T18:00:00Z') => ({record_id:id,updated_at_utc:updated,payload:{title:id,note:'Observation',tags:[],...payload}})
const records = [note('general'),note('manual',{account_id:'manual',tags:['London','A,B']}),note('broker',{connection_id:'mt5',tags:['London']})]
const select = (filters = {}, search = '', rows = records, timezone = 'Asia/Ho_Chi_Minh') => filterJournalNotes(rows,{...EMPTY_NOTE_FILTERS,...filters},search,timezone).map(row => row.record_id)

test('Notes include every account until the user applies an account filter', () => {
  assert.deepEqual(select(), ['general','manual','broker'])
  assert.deepEqual(select({accounts:['general','broker:mt5']}), ['general','broker'])
  assert.deepEqual(select({accounts:['manual']}), ['manual'])
})
test('Date bounds use local updated date, inclusive, and do not invent missing dates', () => {
  const rows = [...records,note('unknown',{},null)]
  assert.deepEqual(select({from:'2026-10-30',to:'2026-10-30'},'',rows), ['general','manual','broker'])
  assert.deepEqual(select({to:'2026-10-29'},'',rows), [])
  assert.deepEqual(select({from:'2026-10-29',to:'2026-10-29'},'',rows,'UTC'), ['general','manual','broker'])
  assert.equal(select({},'',rows).length, 4)
})
test('Include/exclude respect AND/OR and preserve commas inside a tag', () => {
  const tags = JSON.stringify(['London','A,B'])
  assert.deepEqual(select({tagInclude:tags}), ['manual'])
  assert.deepEqual(select({tagInclude:tags,tagIncludeMode:'OR'}), ['manual','broker'])
  assert.deepEqual(select({tagExclude:tags}), ['general','broker'])
  assert.deepEqual(select({tagExclude:tags,tagExcludeMode:'OR'}), ['general'])
  assert.deepEqual(select({tagInclude:'["London"]',tagExclude:'["A,B"]'}), ['broker'])
})
test('Search matches title, content and tags alongside applied filters', () => {
  assert.deepEqual(select({},'observation'), ['general','manual','broker'])
  assert.deepEqual(select({accounts:['manual']},'london'), ['manual'])
  assert.deepEqual(select({},'not found'), [])
})

test('Grouping uses local updated dates and Monday weeks across year/month boundaries', () => {
  const notes=[note('new',{},'2027-01-01T00:30:00Z'),note('old',{},'2026-12-31T23:00:00Z'),note('unknown',{},null)]
  const keys=(mode,tz='UTC')=>groupJournalNotes(notes,mode,tz).map(group=>[group.key,group.rows.map(note=>note.record_id)])
  assert.deepEqual(keys('none'),[['all',['new','old','unknown']]])
  assert.deepEqual(keys('type'),[['general',['new','old','unknown']]])
  assert.deepEqual(keys('day'),[['2027-01-01',['new']],['2026-12-31',['old']],['unknown',['unknown']]])
  assert.deepEqual(keys('day','America/New_York'),[['2026-12-31',['new','old']],['unknown',['unknown']]])
  assert.deepEqual(keys('week'),[['2026-12-28',['new','old']],['unknown',['unknown']]])
  assert.deepEqual(keys('month'),[['2027-01',['new']],['2026-12',['old']],['unknown',['unknown']]])
  assert.deepEqual(keys('year'),[['2027',['new']],['2026',['old']],['unknown',['unknown']]])
  assert.deepEqual(groupJournalNotes([],'day','UTC'),[])
})
