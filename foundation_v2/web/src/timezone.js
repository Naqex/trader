const KEY = 'tw-timezone'
const listeners = new Set()
export function validTimezone(value) {
  if (typeof value !== 'string' || !value || value.length > 100) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}
function initialTimezone() {
  try { const saved = localStorage.getItem(KEY); if (validTimezone(saved)) return saved } catch { /* Browser storage is optional. */ }
  return 'UTC'
}
let zone = initialTimezone()
export const getTimezone = () => zone
export function setTimezone(value) {
  if (!validTimezone(value)) return false
  zone = value
  let persisted = true
  try { localStorage.setItem(KEY, value) } catch { persisted = false }
  listeners.forEach(listener => listener())
  return persisted
}
export function subscribeTimezone(listener) {
  listeners.add(listener)
  const sync = event => { if (event.key === KEY || event.key === null) { zone = initialTimezone(); listener() } }
  globalThis.addEventListener?.('storage', sync)
  return () => { listeners.delete(listener); globalThis.removeEventListener?.('storage', sync) }
}
export function timezoneLabel(value = zone, at = new Date()) {
  return new Intl.DateTimeFormat('en', { timeZone: value, timeZoneName: 'shortOffset' }).formatToParts(at).find(part => part.type === 'timeZoneName').value.replace('GMT', 'UTC')
}
// Offsets describe displayed observations, including historical DST changes.
export function tableTimezoneLabel(value, instants = []) {
  const offsets = [...new Set(instants.filter(date => date instanceof Date && Number.isFinite(date.getTime())).map(date => timezoneLabel(value, date)))]
  const name = value.replaceAll('_', ' ')
  return offsets.length ? `(${offsets.join(' / ')}) ${name}` : name
}

export function timezoneOptionsAt(at = new Date(), zones = chartTimezones) {
  return zones.map(value => ({ value, label: `(${timezoneLabel(value, at)}) ${value.replaceAll('_', ' ')}`, searchText: value }))
}
const dateFormatters = new Map()
export function zonedDateKey(value, timeZone = zone) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  if (!dateFormatters.has(timeZone)) dateFormatters.set(timeZone, new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }))
  const parts = Object.fromEntries(dateFormatters.get(timeZone).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
// Find the first instant of a civil date. A day can span 23/25 hours or be skipped.
export function dayBoundary(date, timeZone = zone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_calendar_date')
  const nominal = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== date) throw new Error('invalid_calendar_date')
  let low = nominal - 36 * 3600000, high = nominal + 36 * 3600000
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (zonedDateKey(mid, timeZone) < date) low = mid + 1
    else high = mid
  }
  return low
}
export function dateRangeBoundary(date, end = false, timeZone = zone) {
  if (!date) return ''
  dayBoundary(date, timeZone)
  const next = end ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : date
  return new Date(dayBoundary(next, timeZone) - (end ? 1 : 0)).toISOString()
}
export const chartTimezone = () => zone === 'UTC' ? 'Etc/UTC' : zone === 'Asia/Saigon' ? 'Asia/Ho_Chi_Minh' : zone

export function instantToWall(value, timeZone = zone) {
  if (value === null || value === undefined || value === '') return ''
  const date = new Date(typeof value === 'string' && !/[Zz]|[+-]\d\d:\d\d$/.test(value) ? `${value}Z` : value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

// Reject missing/repeated DST wall times instead of silently choosing another instant.
export function wallToInstant(value, timeZone = zone) {
  if (!value) return ''
  const normalized = value.length === 16 ? `${value}:00` : value
  const nominal = Date.parse(`${normalized}Z`)
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 19) !== normalized) throw new Error('invalid_wall_time')
  const offsets = new Set()
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = nominal + hours * 3600000
    offsets.add(Date.parse(`${instantToWall(instant, timeZone)}Z`) - instant)
  }
  const candidates = [...offsets].map(offset => nominal - offset).filter(instant => instantToWall(instant, timeZone) === normalized)
  if (candidates.length !== 1) throw new Error(candidates.length ? 'ambiguous_wall_time' : 'nonexistent_wall_time')
  return new Date(candidates[0]).toISOString()
}

// Supported by the bundled Advanced Charts version; all surfaces share this selection.
export const chartTimezones = ["UTC", "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "America/Argentina/Buenos_Aires", "America/Bogota", "America/Caracas", "America/Chicago", "America/El_Salvador", "America/Juneau", "America/Lima", "America/Los_Angeles", "America/Mexico_City", "America/New_York", "America/Phoenix", "America/Santiago", "America/Sao_Paulo", "America/Toronto", "America/Vancouver", "Asia/Almaty", "Asia/Ashkhabad", "Asia/Bahrain", "Asia/Bangkok", "Asia/Chongqing", "Asia/Dubai", "Asia/Ho_Chi_Minh", "Asia/Hong_Kong", "Asia/Jakarta", "Asia/Jerusalem", "Asia/Karachi", "Asia/Kathmandu", "Asia/Kolkata", "Asia/Kuwait", "Asia/Manila", "Asia/Muscat", "Asia/Qatar", "Asia/Riyadh", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Taipei", "Asia/Tehran", "Asia/Tokyo", "Atlantic/Reykjavik", "Australia/ACT", "Australia/Adelaide", "Australia/Brisbane", "Australia/Perth", "Australia/Sydney", "Europe/Amsterdam", "Europe/Athens", "Europe/Belgrade", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels", "Europe/Bucharest", "Europe/Budapest", "Europe/Copenhagen", "Europe/Dublin", "Europe/Helsinki", "Europe/Istanbul", "Europe/Lisbon", "Europe/London", "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Moscow", "Europe/Oslo", "Europe/Paris", "Europe/Riga", "Europe/Rome", "Europe/Stockholm", "Europe/Tallinn", "Europe/Vilnius", "Europe/Warsaw", "Europe/Zurich", "Pacific/Auckland", "Pacific/Chatham", "Pacific/Fakaofo", "Pacific/Honolulu", "Pacific/Norfolk", "US/Mountain"]
