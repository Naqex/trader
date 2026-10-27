// A focused row stays mounted even when wheel scrolling moves it outside the window.
export function virtualTableSegments({ count, rowHeight, offset, height, overscan = 6, focusedIndex = -1 }) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(rowHeight) || rowHeight < 48
    || !Number.isFinite(offset) || !Number.isFinite(height) || height < 0
    || !Number.isSafeInteger(overscan) || overscan < 0) throw new RangeError('Invalid fixed-row table geometry')
  if (!count) return []
  const top = Math.max(0, Math.min(offset, Math.max(0, count * rowHeight - height)))
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan)
  const end = Math.min(count, Math.max(start + 1, Math.ceil((top + height) / rowHeight)) + overscan)
  const ranges = [{ start, end }]
  if (Number.isInteger(focusedIndex) && focusedIndex >= 0 && focusedIndex < count && (focusedIndex < start || focusedIndex >= end)) ranges.push({ start:focusedIndex, end:focusedIndex + 1 })
  ranges.sort((a, b) => a.start - b.start)
  const segments = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ spacer:true, start:cursor, end:range.start, height:(range.start - cursor) * rowHeight })
    segments.push(range); cursor = range.end
  }
  if (cursor < count) segments.push({ spacer:true, start:cursor, end:count, height:(count - cursor) * rowHeight })
  return segments
}
