export function chartDomain(values, { zero = true, maximum, symmetric = false, integer = false } = {}) {
  if (!values.length || !values.every(Number.isFinite)) return null
  if (maximum === 100) {
    return values.every(value => value >= 0 && value <= 100) ? { low: 0, high: 100, ticks: [0, 20, 40, 60, 80, 100] } : null
  }
  let low = Math.min(...values, ...(zero ? [0] : [])), high = Math.max(...values, ...(zero ? [0] : []))
  if (zero && low === 0 && high === 0) return { low: 0, high: 0, ticks: [0] }
  if (symmetric && low < 0 && high > 0) { high = Math.max(Math.abs(low), Math.abs(high)); low = -high }
  if (high === low) { const pad = Math.max(Math.abs(high) * .0001, Math.min(1, Math.abs(high) * .1)) || 1; low -= zero && low === 0 ? 0 : pad; high += pad }
  const rawStep = (high - low) / 4, magnitude = 10 ** Math.floor(Math.log10(rawStep))
  // Round the interval, then expand to whole ticks. Keep the data in view without
  // doubling the extent just to force exactly five labels.
  const candidates = [1, 2, 2.5, 5, 10].map(value => value * magnitude)
  let step = candidates.reduce((best, value) => Math.abs(Math.log(value / rawStep)) < Math.abs(Math.log(best / rawStep)) ? value : best)
  if (integer) step = Math.max(1, Math.ceil(step))
  const clean = value => Number(value.toPrecision(15)) || 0
  low = clean(Math.floor(low / step) * step); high = clean(Math.ceil(high / step) * step)
  const count = Math.round((high - low) / step)
  return { low, high, ticks: Array.from({ length: count + 1 }, (_, index) => clean(low + step * index)) }
}

export function chartTicks(domain, capacity) {
  const ticks = domain.ticks
  if (ticks.length <= capacity) return ticks
  const last = ticks.length - 1, zero = ticks.indexOf(0)
  // Preserve both bounds and zero; thinning must keep equal numeric intervals.
  const stride = Array.from({ length: last }, (_, index) => index + 1).find(step => last % step === 0
    && (zero < 0 || zero % step === 0) && last / step + 1 <= capacity)
  return stride ? ticks.filter((_, index) => index % stride === 0) : ticks.filter((_, index) => index === 0 || index === last || index === zero)
}

// Shape-preserving cubic interpolation: monotone runs share a tangent instead
// of stopping horizontally at every observation. Equal timestamps remain vertical.
export function reportCurvePath(points) {
  const spans = points.slice(1).map(([x, y], index) => ({ h: x - points[index][0], d: x > points[index][0] ? (y - points[index][1]) / (x - points[index][0]) : 0 }))
  const endpoint = (a, b) => {
    if (!a || a.h <= 0) return 0
    if (!b || b.h <= 0) return a.d
    const slope = ((2 * a.h + b.h) * a.d - a.h * b.d) / (a.h + b.h)
    return Math.sign(slope) !== Math.sign(a.d) ? 0 : Math.sign(a.d) !== Math.sign(b.d) && Math.abs(slope) > Math.abs(3 * a.d) ? 3 * a.d : slope
  }
  const slopes = points.map((_, index) => {
    if (!index) return endpoint(spans[0], spans[1])
    if (index === points.length - 1) return endpoint(spans.at(-1), spans.at(-2))
    const a = spans[index - 1], b = spans[index]
    if (a.h <= 0 || b.h <= 0 || a.d * b.d <= 0) return 0
    const w1 = 2 * b.h + a.h, w2 = b.h + 2 * a.h
    return (w1 + w2) / (w1 / a.d + w2 / b.d)
  })
  return points.map(([x, y], index) => {
    if (!index) return `M${x},${y}`
    const [previousX, previousY] = points[index - 1], third = (x - previousX) / 3
    const bound = value => Math.min(Math.max(previousY, y), Math.max(Math.min(previousY, y), value))
    return `C${previousX + third},${bound(previousY + third * slopes[index - 1])} ${x - third},${bound(y - third * slopes[index])} ${x},${y}`
  }).join(' ')
}
