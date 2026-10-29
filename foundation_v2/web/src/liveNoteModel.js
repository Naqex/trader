import { matchesSearch } from './searchText.js'
import { calendarParts, filterValues } from './tradingAnalyticsModel.js'

export const EMPTY_NOTE_FILTERS = {accounts:[],from:'',to:'',tagInclude:'',tagExclude:'',tagIncludeMode:'AND',tagExcludeMode:'AND'}
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
