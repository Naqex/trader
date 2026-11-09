import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_NOTE_FILTERS, filterJournalNotes, groupJournalNotes, noteCalendarYears } from '../src/liveNoteModel.js'

const note = (id, payload = {}, updated = '2026-10-29T18:00:00Z') => ({record_id:id,updated_at_utc:updated,payload:{title:id,note:'Observation',tags:[],...payload}})
const records = [note('general'),note('daily',{note_type:'daily_review',tags:['London']}),note('weekly',{note_type:'weekly_review'})]
const select = (filters = {}, search = '', rows = records, timezone = 'Asia/Ho_Chi_Minh') => filterJournalNotes(rows,{...EMPTY_NOTE_FILTERS,...filters},search,timezone).map(row => row.record_id)

test('Missing note type is General, filters select exact types without inventing reviews', () => {
  assert.deepEqual(select(),['general','daily','weekly'])
  assert.deepEqual(select({types:['general']}),['general'])
  assert.deepEqual(select({types:['daily_review','weekly_review']}),['daily','weekly'])
  assert.deepEqual(select({types:['monthly_review']}),[])
})
test('Date bounds use local updated date, inclusive, and exclude unknown dates only for date filters', () => {
  const rows = [...records,note('unknown',{},null)]
  assert.deepEqual(select({from:'2026-10-30',to:'2026-10-30'},'',rows), ['general','daily','weekly'])
  assert.deepEqual(select({to:'2026-10-29'},'',rows), [])
  assert.deepEqual(select({from:'2026-10-29',to:'2026-10-29'},'',rows,'UTC'), ['general','daily','weekly'])
  assert.equal(select({},'',rows).length,4)
})
test('Days, month and year combine using real note timestamps in the selected timezone', () => {
  assert.deepEqual(select({days:['5'],months:['10'],years:['2026'],types:['daily_review']}),['daily'])
  assert.deepEqual(select({days:['4']}),[])
  assert.deepEqual(select({days:['4']},'',records,'UTC'),['general','daily','weekly'])
  assert.deepEqual(select({months:['11']}),[])
  assert.deepEqual(select({years:['2025']}),[])
  assert.deepEqual(select({days:['5']},'',[note('unknown',{},null)]),[])
})
test('Year choices include actual note years and the current civil year for an empty journal', () => {
  const now=new Date('2027-01-01T00:30:00Z')
  assert.deepEqual(noteCalendarYears([],'America/New_York',now),['2026'])
  assert.deepEqual(noteCalendarYears([note('old',{},'2024-06-01T00:00:00Z'),note('unknown',{},null)],'UTC',now),['2027','2024'])
})
test('Search remains available and combines with the five Notes filters', () => {
  assert.deepEqual(select({types:['daily_review']},'london'),['daily'])
  assert.deepEqual(select({},'not found'),[])
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
