import { dateFieldDisplay } from './dateFormat.js'

export function boundedDateTimeValue(date, time, min, max) {
  const candidate = `${date}T${time || '00:00'}`
  const lower = min?.replace(/Z$/, '')
  const upper = max?.replace(/Z$/, '')
  // Compare ISO wall times before formatting the editable day/month/year text.
  const bounded = upper?.startsWith(`${date}T`) && candidate > upper ? upper
    : lower?.startsWith(`${date}T`) && candidate < lower ? lower : candidate
  return dateFieldDisplay(bounded, 'datetime-local')
}
