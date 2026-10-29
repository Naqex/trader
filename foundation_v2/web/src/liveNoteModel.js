import { matchesSearch } from './searchText.js'
import { calendarParts, filterValues } from './tradingAnalyticsModel.js'

export const EMPTY_NOTE_FILTERS = {accounts:[],from:'',to:'',tagInclude:'',tagExclude:'',tagIncludeMode:'AND',tagExcludeMode:'AND'}
export const NOTE_GROUPS = [['none','No grouping'],['type','Note type'],['day','Group by day'],['week','Week'],['month','Month'],['year','Year']]

// Group by the same updated date shown in the list and used by its date filter.
export function groupJournalNotes(notes, mode, timezone) {
  if (mode === 'none') return [{key:'all',rows:notes}]
  const groups = new Map()
  for (const note of notes) {
    const day = calendarParts(note.updated_at_utc,timezone)?.key
    let key = mode === 'type' ? 'general' : !day ? 'unknown' : mode === 'year' ? day.slice(0,4) : mode === 'month' ? day.slice(0,7) : day
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
  const include = filterValues(filters.tagInclude), exclude = filterValues(filters.tagExclude)
  const matchesTags = (values,tags,mode) => mode === 'OR' ? values.some(tag => tags.includes(tag)) : values.every(tag => tags.includes(tag))
  return notes.filter(record => {
    const p = record.payload, account = p.connection_id ? `broker:${p.connection_id}` : p.account_id || 'general'
    const day = calendarParts(record.updated_at_utc,timezone)?.key
    return (!filters.accounts.length || filters.accounts.includes(account))
      && (!filters.from || day && day >= filters.from) && (!filters.to || day && day <= filters.to)
      && (!include.length || matchesTags(include,p.tags,filters.tagIncludeMode))
      && (!exclude.length || !matchesTags(exclude,p.tags,filters.tagExcludeMode))
      && matchesSearch(`${p.title} ${p.note} ${p.tags.join(' ')}`,search)
  })
}
