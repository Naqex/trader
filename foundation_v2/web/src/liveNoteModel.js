import { matchesSearch } from './searchText.js'
import { calendarParts } from './tradingAnalyticsModel.js'

export const EMPTY_NOTE_FILTERS = {types:[],from:'',to:'',days:[],months:[],years:[]}
export const NOTE_TYPES = [['daily_review','Đánh giá ngày'],['general','General'],['monthly_review','Monthly review'],['weekly_review','Đánh giá tuần']]
export const noteType = note => note.payload.note_type || 'general'
export function noteCalendarYears(notes, timezone, now = new Date()) {
  return [...new Set([calendarParts(now,timezone)?.key.slice(0,4),...notes.map(note => calendarParts(note.updated_at_utc,timezone)?.key.slice(0,4))].filter(Boolean))].sort().reverse()
}
export const NOTE_GROUPS = [['none','No grouping'],['type','Note type'],['day','Group by day'],['week','Week'],['month','Month'],['year','Year']]

// Group by the same updated date shown in the list and used by its date filter.
export function groupJournalNotes(notes, mode, timezone) {
  if (mode === 'none') return [{key:'all',rows:notes}]
  const groups = new Map()
  for (const note of notes) {
    const day = calendarParts(note.updated_at_utc,timezone)?.key
    let key = mode === 'type' ? noteType(note) : !day ? 'unknown' : mode === 'year' ? day.slice(0,4) : mode === 'month' ? day.slice(0,7) : day
    if (mode === 'week' && day) {
      const date = new Date(`${day}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7)
      key = date.toISOString().slice(0,10)
    }
    if (!groups.has(key)) groups.set(key,{key,rows:[]})
    groups.get(key).rows.push(note)
  }
  return [...groups.values()].sort((a,b) => a.key === 'unknown' ? 1 : b.key === 'unknown' ? -1 : b.key.localeCompare(a.key))
}
export function filterJournalNotes(notes, filters, search, timezone) {
  const selected = (key,value) => !filters[key]?.length || filters[key].includes(String(value))
  return notes.filter(record => {
    const p = record.payload, date = calendarParts(record.updated_at_utc,timezone), day = date?.key
    return selected('types',noteType(record))
      && (!filters.from || day && day >= filters.from) && (!filters.to || day && day <= filters.to)
      && selected('days',date?.weekday) && selected('months',day ? Number(day.slice(5,7)) : null) && selected('years',day?.slice(0,4))
      && matchesSearch(`${p.title} ${p.note} ${p.tags.join(' ')}`,search)
  })
}
