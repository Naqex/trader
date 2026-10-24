import { useEffect, useRef } from 'react'
import { AreaSeries, BarSeries, BaselineSeries, CandlestickSeries, LineSeries, HistogramSeries, createChart } from 'lightweight-charts'
import { displayDate } from './dateFormat.js'
import { chartSeriesPalette } from './projectPalette.js'
import { nativeChartPalette } from './nativeChartPalette.js'
import { useTestingLocale } from './testingLocale.jsx'
import { ReplayDrawingPrimitive } from './replayDrawingPrimitive.js'
import { ReplayOrderPrimitive } from './replayOrderPrimitive.js'
import ChartIcon from './ChartIcon.jsx'
import { orderKinds } from './replayOrderLabels.js'

export default function LightweightReplayChart({ rows, sessionId, chartType, showVolume, showAverage, viewportRequest, drawings, onCrosshair, onAnchorSelect, theme, levels, orderEditable, tickSize, onOrderPriceChange, orderGeneration, onOrderDragStart, onStatusChange }) {
  const { t, locale, fmt } = useTestingLocale()
  const formatTimestamp = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : displayDate(new Date(Number(value) * 1000), { timeStyle: 'medium' })
  const formatPrice = value => fmt(value, '', 8)
  const money = (value, currency) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(Number(value)) } catch { return fmt(value, ' ' + (currency || t('Đơn vị tài khoản'))) }
  }

  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const latestRef = useRef(null)
  latestRef.current = { rows, onCrosshair, onAnchorSelect, levels, orderEditable, tickSize, onOrderPriceChange, orderGeneration, onStatusChange }
  const orderDrag = useRef(null)
  const paintFrame = useRef(null)
  const previousSessionRef = useRef(null)
  const rangeRef = useRef(null)
  const previousRowCountRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const palette = nativeChartPalette(theme)
    const chart = createChart(host, {
      width: host.clientWidth, height: host.clientHeight,
      layout: { background: { color: palette.canvas }, textColor: palette.text, fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: 0 },
      localization: { locale: 'vi-VN', timeFormatter: time => displayDate(typeof time === 'object' ? new Date(Date.UTC(time.year, time.month - 1, time.day)) : time, { timeStyle: typeof time === 'number' ? 'short' : undefined }) },
    })
    const seriesType = chartType === 'bars' ? BarSeries : chartType === 'line' ? LineSeries : chartType === 'area' ? AreaSeries : chartType === 'baseline' ? BaselineSeries : CandlestickSeries
    const series = chart.addSeries(seriesType, {
      ...chartSeriesPalette(palette), borderVisible: false, lineWidth: 2,
    })
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    const average = chart.addSeries(LineSeries, { color: palette.highlight, lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const drawingPrimitive = new ReplayDrawingPrimitive()
    series.attachPrimitive(drawingPrimitive)
    const orderPrimitive = new ReplayOrderPrimitive(projection => {
      cancelAnimationFrame(paintFrame.current)
      paintFrame.current = requestAnimationFrame(() => {
        for (const node of host.querySelectorAll('[data-order-level]')) {
          const y = projection?.[node.dataset.orderLevel]
          node.style.display = Number.isFinite(y) && y > 14 && y < projection.height - 14 ? 'flex' : 'none'
          if (Number.isFinite(y)) { node.style.top = `${y}px`; node.style.right = `${host.clientWidth - projection.width + 10}px` }
        }
      })
    })
    series.attachPrimitive(orderPrimitive)
    const lookup = (time) => latestRef.current.rows.find((row) => Number(row.timestamp) === Number(time))
    const crosshair = (event) => latestRef.current.onCrosshair?.(event?.time && lookup(event.time) ? { row: lookup(event.time) } : null)
    let pointerStart = null
    const pointerDown = event => {
      if (event.target.closest('.chart-order-level')) { pointerStart = null; return }
      pointerStart = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null
    }
    const cancelPointer = () => { pointerStart = null }
    const pointerUp = event => {
      const start = pointerStart
      pointerStart = null
      if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
      const bounds = host.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      if (x < 0 || x >= chart.timeScale().width() || y < 0 || y >= chart.panes()[0].getHeight()) return
      const row = lookup(chart.timeScale().coordinateToTime(x))
      const price = series.coordinateToPrice(y)
      if (row && Number.isFinite(price)) latestRef.current.onAnchorSelect?.({ timestamp: Number(row.timestamp), price })
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) { host.dataset.rangeFrom = String(range.from); host.dataset.rangeTo = String(range.to) }
    })
    chart.subscribeCrosshairMove(crosshair)
    // Native pointer-up preserves rapid two-point drawings: the engine's
    // double-click recognizer otherwise drops a second distant click.
    host.addEventListener('pointerdown', pointerDown)
    host.addEventListener('pointerup', pointerUp)
    host.addEventListener('pointercancel', cancelPointer)
    chartRef.current = { chart, series, volume, average, drawingPrimitive, orderPrimitive }
    let resizeFrame = 0, lastWidth = -1, lastHeight = -1
    const resize = new ResizeObserver(() => {
      if (resizeFrame !== 0) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        const width = host.clientWidth, height = host.clientHeight
        if (width === lastWidth && height === lastHeight) return
        lastWidth = width; lastHeight = height
        chart.applyOptions({ width, height })
      })
    })
    resize.observe(host)
    return () => {
      rangeRef.current = chart.timeScale().getVisibleLogicalRange()
      resize.disconnect()
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(paintFrame.current)
      chart.unsubscribeCrosshairMove(crosshair)
      host.removeEventListener('pointerdown', pointerDown)
      host.removeEventListener('pointerup', pointerUp)
      host.removeEventListener('pointercancel', cancelPointer)
      chart.remove()
      chartRef.current = null
    }
  }, [chartType])

  useEffect(() => {
    if (!chartRef.current) return
    const palette = nativeChartPalette(theme)
    chartRef.current.chart.applyOptions({
      layout: { background: { color: palette.canvas }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border }, timeScale: { borderColor: palette.border },
    })
    chartRef.current.series.applyOptions(chartSeriesPalette(palette))
    chartRef.current.average.applyOptions({ color: palette.highlight })
    chartRef.current.orderPrimitive.setPalette(palette)
    chartRef.current.drawingPrimitive.setPalette(palette)
  }, [chartType, theme])

  useEffect(() => { chartRef.current?.orderPrimitive.setLevels(levels) }, [levels, chartType])

  useEffect(() => {
    const instance = chartRef.current
    if (!instance) return
    const { chart, series, volume, average } = instance
    const previousRange = chart.timeScale().getVisibleLogicalRange() || rangeRef.current
    const sameSession = previousSessionRef.current === sessionId
    const data = rows.map((row) => ({ time: Number(row.timestamp), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) }))
    const prices = data.flatMap((row) => [row.open, row.high, row.low, row.close])
    const precision = prices.reduce((max, price) => {
      let digits = 2
      while (digits < 8 && Math.abs(Number(price.toFixed(digits)) - price) > 1e-10) digits += 1
      return Math.max(max, digits)
    }, 2)
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } })
    series.setData(chartType === 'candles' || chartType === 'bars' ? data : data.map((row) => ({ time: row.time, value: row.close })))
    if (chartType === 'baseline' && data.length) series.applyOptions({ baseValue: { type: 'price', price: data[0].close } })
    const palette = nativeChartPalette(theme)
    volume.setData(rows.filter((row) => (row.volume ?? row.tick_volume) !== null && (row.volume ?? row.tick_volume) !== undefined && Number.isFinite(Number(row.volume ?? row.tick_volume))).map((row) => ({ time: Number(row.timestamp), value: Number(row.volume ?? row.tick_volume), color: Number(row.close) >= Number(row.open) ? `${palette.positive}80` : `${palette.negative}80` })))
    let sum = 0
    const sma = []
    data.forEach((row, index) => {
      sum += row.close
      if (index >= 20) sum -= data[index - 20].close
      if (index >= 19) sma.push({ time: row.time, value: sum / 20 })
    })
    average.setData(sma)
    // A replay step updates this instance instead of destroying its pan/zoom and canvas.
    // The server-visible prefix is the only dataset ever handed to the renderer.
    if (sameSession && previousRange && previousRange.from < rows.length) {
      const added = Math.max(0, rows.length - previousRowCountRef.current)
      const follow = previousRange.to >= previousRowCountRef.current - 1
      chart.timeScale().setVisibleLogicalRange(follow && added ? { from: previousRange.from + added, to: previousRange.to + added } : previousRange)
    } else if (rows.length < 60) chart.timeScale().setVisibleLogicalRange({ from: rows.length - 60, to: rows.length + 2 })
    else chart.timeScale().fitContent()
    previousRowCountRef.current = rows.length
    previousSessionRef.current = sessionId
    rangeRef.current = null
    latestRef.current.onStatusChange?.('ready')
  }, [chartType, rows, sessionId, theme])

  useEffect(() => {
    chartRef.current?.volume.applyOptions({ visible: showVolume })
    chartRef.current?.average.applyOptions({ visible: showAverage })
  }, [chartType, showAverage, showVolume])

  useEffect(() => {
    chartRef.current?.drawingPrimitive.setDrawings(drawings)
  }, [drawings, chartType])

  useEffect(() => {
    const instance = chartRef.current
    if (!instance || !viewportRequest || !rows.length) return
    const scale = instance.chart.timeScale()
    if (viewportRequest.kind === 'fit') scale.fitContent()
    else if (viewportRequest.kind === 'latest') scale.setVisibleLogicalRange({ from: Math.max(-1, rows.length - 80), to: rows.length + 2 })
    else if (viewportRequest.kind === 'range') {
      const cutoff = Number(rows.at(-1).timestamp) - viewportRequest.days * 86400
      const index = rows.findIndex((row) => Number(row.timestamp) >= cutoff)
      scale.setVisibleLogicalRange({ from: Math.max(-1, index - 1), to: rows.length + 1 })
    }
  }, [viewportRequest])

  const lastBar = rows.at(-1)
  const dragPrice = event => {
    const instance = chartRef.current
    if (!instance) return null
    const value = instance.series.coordinateToPrice(event.clientY - hostRef.current.getBoundingClientRect().top)
    const tick = Number(latestRef.current.tickSize)
    return Number.isFinite(value) && value > 0 ? Number((tick > 0 ? Math.round(value / tick) * tick : value).toFixed(8)) : null
  }
  const endDrag = (event, commit) => {
    const drag = orderDrag.current
    orderDrag.current = null
    const current = latestRef.current
    if (drag && commit && current.orderEditable && drag.generation === current.orderGeneration) {
      const value = dragPrice(event)
      if (value) {
        chartRef.current?.orderPrimitive.setLevels({ ...current.levels, [drag.kind]: value })
        current.onOrderPriceChange(drag.kind, value)
        return
      }
    }
    // A cancelled/invalid drag returns to the last authoritative levels. A
    // committed drag stays optimistic until the server revision arrives.
    chartRef.current?.orderPrimitive.setLevels(current.levels)
  }
  return <div ref={hostRef} className="replay-chart" role="group" data-testid="replay-chart" data-visible-row-count={rows.length} data-visible-object-count={drawings.filter(record => !record.hidden).length} aria-label={`Biểu đồ replay với ${rows.length} nến đã mở. Nến cuối: ${formatTimestamp(lastBar?.timestamp)} UTC, mở ${formatPrice(lastBar?.open)}, cao ${formatPrice(lastBar?.high)}, thấp ${formatPrice(lastBar?.low)}, đóng ${formatPrice(lastBar?.close)}. Cuộn để zoom, kéo để pan; bấm nến để chọn mốc giá.`}>
    {levels && orderKinds(levels).map(kind => kind === 'entry'
      ? <span key={kind} className="chart-order-level is-entry" data-order-level={kind}>{levels.side} · {levels.state === 'draft' ? t("Nháp entry") : levels.state === 'queued' ? t("Chờ fill") : t("Entry")} {formatPrice(levels.entry)}{levels.floating !== null && <> {t("· PnL")} {money(levels.floating, levels.currency)}</>}</span>
      : <button key={kind} type="button" className={`chart-order-level is-${kind.startsWith('target') ? 'target' : kind} ${levels[kind] == null ? 'is-ghost' : ''}`} data-order-level={kind} aria-label={`${kind === 'stop' ? 'Kéo Stop loss' : 'Kéo Take profit'}`} data-tooltip={t("Kéo để đặt hoặc đổi giá · phím ↑ ↓ chỉnh một tick")} disabled={!orderEditable}
        onPointerDown={event => { if (!latestRef.current.orderEditable || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); onOrderDragStart(); event.currentTarget.setPointerCapture(event.pointerId); orderDrag.current = { kind, generation: latestRef.current.orderGeneration } }}
        onPointerMove={event => { if (!orderDrag.current) return; const value = dragPrice(event); if (value) chartRef.current?.orderPrimitive.setLevels({ ...latestRef.current.levels, [kind]: value }) }}
        onPointerUp={event => endDrag(event, true)} onPointerCancel={event => endDrag(event, false)}
        onKeyDown={event => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const tick = Number(tickSize); if (tick > 0) onOrderPriceChange(kind, Number(((levels[kind] ?? (kind === 'stop' ? levels.ghostStop : levels.ghostTarget)) + (event.key === 'ArrowUp' ? tick : -tick)).toFixed(8))) }}>
        <ChartIcon name="grip" />{kind === 'stop' ? t("SL") : levels.targets?.length ? `TP${levels.targets.findIndex(row => `target:${row.id}` === kind)+1}` : t("TP")}{levels[kind] == null ? ` · ${t('Kéo để đặt')}` : levels.state === 'edit' ? t(" nháp") : ''} {formatPrice(levels[kind] ?? (kind === 'stop' ? levels.ghostStop : levels.ghostTarget))}
      </button>)}
  </div>
}
