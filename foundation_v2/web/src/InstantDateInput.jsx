import { useEffect, useId, useState } from 'react'
import ProjectDateInput from './ProjectDateInput.jsx'
import { instantToWall, wallToInstant } from './timezone.js'
import { useTestingLocale } from './testingLocale.jsx'

// API boundaries stay UTC; the editable value follows the display preference.
export default function InstantDateInput({ value, onChange, min, max, ...props }) {
  const { t, timezone } = useTestingLocale()
  const [error, setError] = useState(null), errorId = useId()
  useEffect(() => { setError(null) }, [value, timezone])
  const wall = instantToWall(value, timezone)
  const lower = instantToWall(min, timezone), upper = instantToWall(max, timezone)
  let wallBoundsSafe = !lower || !upper || lower <= upper
  try { if (lower) wallToInstant(lower, timezone); if (upper) wallToInstant(upper, timezone) } catch { wallBoundsSafe = false }
  const epoch = input => Date.parse(typeof input === 'string' && !/[Zz]$|[+-]\d\d:\d\d$/.test(input) ? `${input}Z` : input)
  return <span className="instant-date-input"><ProjectDateInput {...props} key={timezone} validationError={error?.message || ''} type="datetime-local" value={wall} min={wallBoundsSafe ? lower || undefined : undefined} max={wallBoundsSafe ? upper || undefined : undefined} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={error ? errorId : props['aria-describedby']} onChange={event => {
    try {
      const next = event.target.value === wall ? value : wallToInstant(event.target.value, timezone)
      if (next && (min && epoch(next) < epoch(min) || max && epoch(next) > epoch(max))) throw new Error('outside_instant_bounds')
      setError(null)
      onChange?.({ ...event, target: { ...event.target, value: next }, currentTarget: { ...event.currentTarget, value: next } })
    } catch (problem) {
      setError({ message: t(problem.message === 'outside_instant_bounds' ? 'Ngày giờ không hợp lệ' : 'Giờ này không tồn tại hoặc bị trùng do DST. Chọn UTC trong Settings để nhập chính xác.') })
    }
  }} />{error && <small id={errorId} role="alert" className="live-field-error">{error.message}</small>}</span>
}
