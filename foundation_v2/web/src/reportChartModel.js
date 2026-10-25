export function chartDomain(values, { zero = true, maximum, symmetric = false } = {}) {
  if (!values.length || !values.every(Number.isFinite)) return null
  if (symmetric) {
    const rawStep = Math.max(1, ...values.map(Math.abs)) / 2
    const magnitude = 10 ** Math.floor(Math.log10(rawStep))
    const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= rawStep) * magnitude
    return { low: -2 * step, high: 2 * step, ticks: [-2, -1, 0, 1, 2].map(value => value * step) }
  }
  let low = Math.min(...values, ...(zero ? [0] : [])), high = maximum ?? Math.max(...values, ...(zero ? [0] : []))
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  if (high === low) { const pad = Math.max(Math.abs(high) * .0001, 1); low -= zero && low === 0 ? 0 : pad; high += pad }
  return { low, high, ticks: Array.from({ length: maximum === 100 ? 6 : 5 }, (_, index) => low + (high - low) * index / (maximum === 100 ? 5 : 4)) }
}

// Controls stay inside each pair's bounds: smoothing cannot invent an Equity extremum.
export function reportCurvePath(points) {
  return points.map(([x, y], index) => {
    if (!index) return `M${x},${y}`
    const [previousX, previousY] = points[index - 1], middleX = (previousX + x) / 2
    return `C${middleX},${previousY} ${middleX},${y} ${x},${y}`
  }).join(' ')
}
