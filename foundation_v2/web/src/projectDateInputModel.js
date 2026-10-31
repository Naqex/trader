import { dateFieldDisplay } from './dateFormat.js'
import { parseDateField } from './dateFormat.js'

export function rangeDisplay(value = {}) {
  if (!value.from && !value.to) return ''
  return [value.from, value.to].map(date => date ? dateFieldDisplay(date) : '…').join(' – ')
}
export function parseRange(raw) {
  if (!raw.trim()) return {from:'',to:''}
  const parts = raw.trim().split(/\s*[–—]\s*|\s+-\s+/)
  if (parts.length !== 2) return null
  const from = parseDateField(parts[0] === '…' ? '' : parts[0]), to = parseDateField(parts[1] === '…' ? '' : parts[1])
  return from !== null && to !== null && (!from || !to || from <= to) ? {from,to} : null
}

// Minute precision and explicit zero seconds describe the same wall time.
export function wallTimeAllowed(value, min, max) {
  const comparable = raw => String(raw || '').replace(/Z$/, '').replace(/^((?:\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2})$/, '$1:00')
  const candidate = comparable(value), lower = comparable(min), upper = comparable(max)
  return (!lower || candidate >= lower) && (!upper || candidate <= upper)
}

export function boundedDateTimeValue(date, time, min, max) {
  const candidate = `${date}T${time || '00:00'}`
  const lower = min?.replace(/Z$/, '')
  const upper = max?.replace(/Z$/, '')
  // Compare ISO wall times before formatting the editable day/month/year text.
  const bounded = upper?.startsWith(`${date}T`) && !wallTimeAllowed(candidate, undefined, upper) ? upper
    : lower?.startsWith(`${date}T`) && !wallTimeAllowed(candidate, lower) ? lower : candidate
  return dateFieldDisplay(bounded, 'datetime-local')
}
