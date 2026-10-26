export function tooltipPlacement(anchor, popup, viewport, { gap = 8, margin = 8, maxWidth = 320 } = {}) {
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high))
  const targetWidth = Math.min(popup.width, maxWidth, viewport.width - margin * 2)
  const targetHeight = Math.min(popup.height, viewport.height - margin * 2)
  const space = { top: anchor.top - gap - margin, bottom: viewport.height - anchor.bottom - gap - margin,
    left: anchor.left - gap - margin, right: viewport.width - anchor.right - gap - margin }
  const candidates = ['top', 'bottom', 'right', 'left'].map(side => {
    const vertical = side === 'top' || side === 'bottom'
    const width = Math.max(0, Math.min(targetWidth, vertical ? viewport.width - margin * 2 : space[side]))
    const height = Math.max(0, Math.min(targetHeight, vertical ? space[side] : viewport.height - margin * 2))
    return { side, width, height, fits: width >= targetWidth && height >= targetHeight }
  })
  const best = candidates.find(item => item.fits) || candidates.reduce((a, b) => a.width * a.height >= b.width * b.height ? a : b)
  const { side, width, height } = best
  const left = Math.round(clamp(side === 'left' ? anchor.left - gap - width : side === 'right' ? anchor.right + gap : anchor.left + anchor.width / 2 - width / 2, margin, viewport.width - width - margin))
  const top = Math.round(clamp(side === 'top' ? anchor.top - gap - height : side === 'bottom' ? anchor.bottom + gap : anchor.top + anchor.height / 2 - height / 2, margin, viewport.height - height - margin))
  return { side, left, top, maxWidth: width, maxHeight: height,
    arrowX: clamp(anchor.left + anchor.width / 2 - left, Math.min(16, width / 2), width - Math.min(16, width / 2)),
    arrowY: clamp(anchor.top + anchor.height / 2 - top, Math.min(16, height / 2), height - Math.min(16, height / 2)) }
}
