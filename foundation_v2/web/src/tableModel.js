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

export function nextTableSorts(current, key) {
  return current.some(sort => sort.key === key)
    ? current.map(sort => sort.key === key ? nextTableSort(sort, key) : sort)
    : [...current, { key, direction: 'asc' }]
}

export function sortTableRows(rows, sorts, valueOf, locale = 'vi') {
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    for (const { key, direction } of sorts) {
      const compared = compareTableValues(valueOf(left.row, key), valueOf(right.row, key), direction, locale)
      if (compared) return compared
    }
    return left.index - right.index
  }).map(item => item.row)
}

export function tableColumnsPreference(raw, available) {
  try {
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved) || saved.some(value => typeof value !== 'string')) return available
    const columns = available.filter(key => saved.includes(key))
    return columns.length || !saved.length ? columns : available
  } catch { return available }
}
