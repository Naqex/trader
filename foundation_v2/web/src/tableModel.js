// Unknown values stay last in both directions; stable identity breaks ties.
export function compareTableValues(left, right, direction = 'asc', locale = 'vi') {
  const missing = value => value == null || typeof value === 'number' && !Number.isFinite(value)
  if (missing(left) || missing(right)) return missing(left) ? missing(right) ? 0 : 1 : -1
  const compared = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), locale, { numeric:true })
  return direction === 'desc' ? -compared : compared
}

export function nextTableSort(current, key, initialDirection = 'asc') {
  return { key, direction:current.key === key ? current.direction === 'asc' ? 'desc' : 'asc' : initialDirection }
}
