export function projectOrder(levels, chart, series) {
  if (!levels || !chart || !series) return null
  const result = { width: chart.timeScale().width(), height: chart.panes()[0].getHeight() }
  for (const key of ['entry', 'stop', 'target']) {
    const price = levels[key] ?? (key === 'stop' ? levels.ghostStop : levels.ghostTarget)
    if (!Number.isFinite(price)) return null
    result[key] = series.priceToCoordinate(price)
    if (!Number.isFinite(result[key])) return null
  }
  const anchor = chart.timeScale().timeToCoordinate(Number(levels.timestamp))
  result.left = Math.max(0, Math.min(Number.isFinite(anchor) ? anchor : result.width * .6, result.width - 120))
  return result
}

export class ReplayOrderPrimitive {
  constructor(onProject) {
    this.onProject = onProject
    this.levels = null
    this.attachment = null
    this.palette = null
    this.views = [{ zOrder: () => 'normal', renderer: () => ({ draw: target => this.draw(target) }) }]
  }
  attached(attachment) { this.attachment = attachment; attachment.requestUpdate() }
  detached() { this.attachment = null }
  paneViews() { return this.views }
  setPalette(palette) { this.palette = palette; this.attachment?.requestUpdate() }
  autoscaleInfo() {
    if (!this.levels || !['entry', 'stop', 'target'].every(key => {
      const price = this.levels[key] ?? (key === 'stop' ? this.levels.ghostStop : this.levels.ghostTarget)
      return Number.isFinite(price) && price > 0
    })) return null
    const prices = ['entry', 'stop', 'target'].map(key => this.levels[key] ?? (key === 'stop' ? this.levels.ghostStop : this.levels.ghostTarget))
    return { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } }
  }
  setLevels(levels) { this.levels = levels; this.attachment?.requestUpdate() }
  draw(target) {
    const projection = this.attachment ? projectOrder(this.levels, this.attachment.chart, this.attachment.series) : null
    this.onProject(projection)
    if (!projection || !this.palette) return
    const { entry, stop, target: profit, left, width } = projection
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save()
      context.beginPath(); context.rect(0, 0, mediaSize.width, mediaSize.height); context.clip()
      context.fillStyle = `${this.palette.positive}1F`
      context.fillRect(left, Math.min(profit, entry), width - left, Math.abs(profit - entry))
      context.fillStyle = `${this.palette.negative}1F`
      context.fillRect(left, Math.min(stop, entry), width - left, Math.abs(stop - entry))
      context.setLineDash([4, 4])
      for (const [y, color] of [[entry, this.levels.side === 'SELL' ? this.palette.negative : this.palette.positive], [stop, this.palette.warning], [profit, this.palette.positive]]) {
        context.strokeStyle = color; context.lineWidth = 1
        context.beginPath(); context.moveTo(left, y); context.lineTo(width, y); context.stroke()
      }
      context.restore()
    })
  }
}
