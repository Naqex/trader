import { displayDate, displayTime } from './dateFormat.js'
import { nativeChartPalette } from './nativeChartPalette.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useRef, useState } from 'react'
import { createAdvancedReplayDatafeed } from './advancedReplayDatafeed.js'
import { createReplayChartWindowReader } from './replayChartWindow.js'
import { readChartSnapshot, writeChartSnapshot } from './advancedChartStorage.js'
import { createChartSave } from './advancedChartSave.js'
import ChartLoadingState from './ChartLoadingState.jsx'

let libraryPromise
const volumeAppearance = theme => {
  const p = nativeChartPalette(theme)
  return {
    'volume.color.0': p.candleNegative,
    'volume.color.1': p.candlePositive,
    'volume ma.color': p.highlight,
    // Volume and its SMA are opt-in in the replay workspace. Keep restored
    // layouts from reviving the default SMA 9 line on a fresh chart.
    'volume ma.visible': false,
    'smoothedMA.visible': false,
  }
}
function hideDefaultVolumeStudies(chart) {
  for (const study of chart.getAllStudies()) {
    if (study.name !== 'Volume') continue
    chart.setEntityVisibility(study.id, false)
  }
}
function applyVolumeAppearance(widget, chart, theme) {
  const overrides = volumeAppearance(theme)
  widget.applyStudiesOverrides(Object.fromEntries(Object.entries(overrides).map(([key, value]) => [`volume.${key}`, value])))
  // Restored Volume studies carry their own styles; defaults alone cannot repaint them.
  for (const study of chart.getAllStudies()) if (study.name === 'Volume') chart.getStudyById(study.id).applyOverrides(overrides)
}
const paneAppearance = theme => {
  const p = nativeChartPalette(theme)
  return {
    'paneProperties.backgroundType': 'solid', 'paneProperties.background': p.canvas,
    'paneProperties.vertGridProperties.color': p.grid, 'paneProperties.horzGridProperties.color': p.grid,
    'scalesProperties.textColor': p.text, 'scalesProperties.lineColor': p.border,
    ...Object.fromEntries(['candleStyle', 'hollowCandleStyle', 'haStyle'].flatMap(style =>
      ['upColor', 'borderUpColor', 'wickUpColor', 'downColor', 'borderDownColor', 'wickDownColor'].map(key =>
        [`mainSeriesProperties.${style}.${key}`, key.includes('Up') || key === 'upColor' ? p.candlePositive : p.candleNegative]))),
    'mainSeriesProperties.barStyle.upColor': p.candlePositive,
    'mainSeriesProperties.barStyle.downColor': p.candleNegative,
    'mainSeriesProperties.lineStyle.color': p.primary,
    'mainSeriesProperties.areaStyle.linecolor': p.primary,
    'mainSeriesProperties.areaStyle.color1': `${p.primary}33`,
    'mainSeriesProperties.areaStyle.color2': `${p.primary}05`,
  }
}
function loadLibrary() {
  if (window.TradingView?.widget) return Promise.resolve()
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/charting_library/charting_library.standalone.js?iframe=srcdoc'
    script.onload = () => window.TradingView?.widget ? resolve() : reject(new Error('Advanced Charts bundle không hợp lệ.'))
    script.onerror = () => { script.remove(); libraryPromise = null; reject(new Error('Không tải được bộ Advanced Charts local tại /charting_library/.')) }
    document.head.append(script)
  })
  return libraryPromise
}

export default function TradingViewReplayChart(props) {
  const { t, locale } = useTestingLocale()

  const { workspace, sessionId, datasetId, datasetSha256, symbol, assetClass, seconds, tickSize, rows, cutoff, theme, drawings, levels, orderEditable, orderGeneration, viewportRequest } = props
  const host = useRef(null), instance = useRef(null), latest = useRef(props)
  latest.current = props
  const [status, setStatus] = useState('loading'), [message, setMessage] = useState('')
  const [layoutStatus, setLayoutStatus] = useState('saved')
  const storageKey = `tw:advanced-chart:v1:${workspace}:${sessionId}:${datasetId}`

  useEffect(() => {
    let cancelled = false, layoutSave, historyReader, saveState = 'saved', restoringImports = false, importedShapes = [], lines = []
    let widget, adapter, chart, headerSlots, headerObserver, nativeHeader, chartReady = false, renderingOverlays = false, fittedLevels = '', reservedWidth = -1, chromeWidth = -1, chromeHeight = -1, resizeFrame = 0, publishFrame = 0
    let orderHandleHost = null, orderHandles = new Map(), orderHandleCleanups = new Map(), lineByKind = new Map(), activeOrderDrag = null, orderDragFrame = 0
    const resizeChrome = () => {
      const frame = host.current?.querySelector('iframe'), canvas = host.current?.closest('.chart-canvas')
      if (!frame?.contentDocument || !canvas) return
      canvas.closest('.replay-shell')?.style.setProperty('--legacy-frame-height', `${canvas.closest('.chart-frame').clientHeight}px`)
      const width = Math.round(host.current.clientWidth), height = Math.round(host.current.clientHeight)
      const reserved = Math.max(0, Math.round(host.current.clientWidth - canvas.clientWidth))
      if (width === chromeWidth && height === chromeHeight && reserved === reservedWidth) return
      chromeWidth = width; chromeHeight = height; reservedWidth = reserved
      frame.contentDocument.documentElement.style.setProperty('--legacy-reserved-width', `${reserved}px`)
      // v23 measures body on resize. Coalesce chart-frame changes to one native
      // resize per animation frame so a grip drag cannot queue layout work.
      if (resizeFrame === 0) resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        const current = host.current?.querySelector('iframe')
        if (current?.isConnected) current.contentWindow?.dispatchEvent(new Event('resize'))
      })
    }
    const pauseNative = () => latest.current.onOrderDragStart()
    const publishHeader = interval => {
      if (!cancelled && chartReady && host.current && headerSlots?.market) latest.current.onHeaderSlots?.({ ...headerSlots, saveState, interval: typeof interval === 'string' ? interval : chart.resolution(), chartType: chart.chartType(), compact: host.current.clientWidth < 1180, headerHeight: headerSlots.market.ownerDocument.querySelector('.layout__area--top')?.getBoundingClientRect().height || 38 })
    }
    const loadingTimer = setTimeout(() => {
      if (cancelled || chartReady) return
      setStatus('error')
      setMessage('Advanced Charts chưa tải được. Thử mở trang này trong Chrome/Edge hoặc dùng chart dự phòng.')
    }, 20000)
    setStatus('loading'); setMessage('')
    const save = () => layoutSave?.save()
    const scheduleSave = () => { if (chartReady && !restoringImports && !renderingOverlays) layoutSave?.dirty() }
    const clearOrderHandles = () => {
      activeOrderDrag = null
      if (orderDragFrame) { cancelAnimationFrame(orderDragFrame); orderDragFrame = 0 }
      for (const cleanup of orderHandleCleanups.values()) cleanup()
      orderHandleCleanups.clear()
      for (const handle of orderHandles.values()) handle.remove()
      orderHandles.clear()
      orderHandleHost?.remove()
      orderHandleHost = null
    }
    const orderPane = () => {
      const frame = host.current?.querySelector('iframe'), doc = frame?.contentDocument
      const scale = chart?.getPanes?.()[0]?.getMainSourcePriceScale?.()
      const paneApi = chart?.getPanes?.()[0]
      if (!doc || !scale || !paneApi) return null
      const pane = doc.querySelector('td.chart-markup-table.pane div.chart-gui-wrapper') || doc.querySelector('td.chart-markup-table.pane')
      const rect = pane?.getBoundingClientRect?.()
      const canvas = host.current?.closest('.chart-canvas')
      if (!rect || !Number.isFinite(rect.top) || !canvas) return null
      const range = scale.getVisiblePriceRange?.() || chart.getVisiblePriceRange?.()
      const height = Number(paneApi.getHeight?.() || rect.height)
      if (!range || !(height > 0) || !(range.to > range.from)) return null
      return { doc, scale, rect, range, height, canvas }
    }
    const priceToPaneCoordinate = (info, price) => {
      const native = typeof info.scale.priceToCoordinate === 'function' ? info.scale.priceToCoordinate(price) : null
      return Number.isFinite(native) ? native : (info.range.to - price) / (info.range.to - info.range.from) * info.height
    }
    const paneCoordinateToPrice = (info, coordinate) => {
      const native = typeof info.scale.coordinateToPrice === 'function' ? info.scale.coordinateToPrice(coordinate) : null
      return Number.isFinite(native) ? native : info.range.to - coordinate / info.height * (info.range.to - info.range.from)
    }
    const protectionError = (state, kind, price) => {
      const reference = Number(state?.levels?.reference ?? state?.levels?.entry)
      if (!(reference > 0) || !(price > 0)) return 'Giá TP/SL không hợp lệ.'
      const side = state?.levels?.side
      const valid = kind === 'stop'
        ? (side === 'BUY' ? price < reference : side === 'SELL' ? price > reference : false)
        : (side === 'BUY' ? price > reference : side === 'SELL' ? price < reference : false)
      if (valid) return ''
      return side === 'SELL'
        ? (kind === 'stop' ? 'Lệnh SELL cần SL trên giá tham chiếu.' : 'Lệnh SELL cần TP dưới giá tham chiếu.')
        : (kind === 'stop' ? 'Lệnh BUY cần SL dưới giá tham chiếu.' : 'Lệnh BUY cần TP trên giá tham chiếu.')
    }
    const protectionLabel = (state, kind, price, ghost) => {
      const levels = state?.levels || {}
      const name = kind === 'stop' ? 'SL' : 'TP'
      if (ghost) return `${name} · ${t('Kéo để đặt')}`
      const distanceUnit = Number(levels.pipSize) > 0 ? 'pips' : Number(levels.tickSize) > 0 ? 'ticks' : ''
      const distance = Number(levels.pipSize || levels.tickSize) > 0
        ? Math.abs(Number(price) - Number(levels.entry)) / Number(levels.pipSize || levels.tickSize)
        : null
      const quantity = Number(levels.quantity), contract = Number(levels.contractSize)
      const declaredRate = Number(levels.quoteToAccountRate)
      // A missing conversion rate is safe to treat as 1 only when the quote
      // and account currencies are identical. Otherwise keep the USD/PnL
      // portion out of the label instead of presenting a fabricated value.
      const rate = Number.isFinite(declaredRate) && declaredRate > 0
        ? declaredRate
        : levels.quoteCurrency && levels.currency && levels.quoteCurrency === levels.currency ? 1 : NaN
      const signed = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(contract) && contract > 0 && Number.isFinite(rate) && rate > 0
        ? (Number(price) - Number(levels.entry)) * (levels.side === 'SELL' ? -1 : 1) * quantity * contract * rate
        : null
      const details = []
      if (Number.isFinite(distance)) details.push(`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(distance)} ${distanceUnit}`)
      if (Number.isFinite(signed)) {
        try { details.push(new Intl.NumberFormat(locale, { style: 'currency', currency: levels.currency || 'USD', maximumFractionDigits: 2 }).format(signed)) } catch { /* unsupported account currency */ }
      }
      return details.length ? `${name} · ${details.join(' · ')}` : name
    }
    const syncOrderHandles = () => {
      if (cancelled || !latest.current.levels || !latest.current.orderEditable) { clearOrderHandles(); return }
      const info = orderPane()
      if (!info) return
      if (!orderHandleHost) {
        orderHandleHost = info.doc.createElement('div')
        orderHandleHost.dataset.wmOrderHandles = 'true'
        // Keep the hit surface in the same document as Advanced Charts. The
        // native order line is rendered inside this iframe, so pointer capture
        // must stay in that browsing context instead of crossing the iframe
        // boundary through the parent page.
        Object.assign(orderHandleHost.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483000' })
        info.doc.body.append(orderHandleHost)
      }
      const levels = latest.current.levels
      const overlap = levels.stop === null && levels.target === null && levels.ghostStop === levels.ghostTarget
      for (const kind of ['stop', 'target']) {
        const value = levels[kind] ?? (kind === 'stop' ? levels.ghostStop : levels.ghostTarget)
        if (!(value > 0)) {
          orderHandleCleanups.get(kind)?.(); orderHandleCleanups.delete(kind)
          orderHandles.get(kind)?.remove(); orderHandles.delete(kind); continue
        }
        let handle = orderHandles.get(kind)
        if (!handle) {
          handle = info.doc.createElement('button')
          handle.type = 'button'
          handle.tabIndex = -1
          handle.setAttribute('aria-label', kind === 'stop' ? 'Kéo Stop loss' : 'Kéo Take profit')
          // Native order-line text is painted on canvas, so it has no DOM hit
          // target. Keep a compact invisible button over the right-side label
          // instead of covering the whole chart; chart pan remains available
          // everywhere else and the pointer communicates the drag affordance.
          Object.assign(handle.style, { position: 'fixed', width: '210px', height: '24px', transform: 'translateY(-50%)', padding: '0', border: '0', background: 'transparent', pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' })
          const paintDrag = () => {
            orderDragFrame = 0
            const drag = activeOrderDrag
            if (!drag || !drag.info || !Number.isFinite(drag.clientY)) return
            const raw = paneCoordinateToPrice(drag.info, drag.clientY - drag.info.rect.top)
            const tick = Number(latest.current.tickSize)
            const rounded = tick > 0 ? Number((raw / tick).toFixed(8)) : raw
            if (!(rounded > 0)) return
            drag.price = tick > 0 ? Number((Math.round(rounded) * tick).toFixed(8)) : rounded
            const line = lineByKind.get(drag.kind)
            if (line) { renderingOverlays = true; try { line.setPrice(drag.price) } finally { renderingOverlays = false } }
          }
          const move = event => {
            const drag = activeOrderDrag
            if (!drag || drag.kind !== kind || (drag.pointerId !== null && drag.pointerId !== event.pointerId)) return
            // Pointer-capable browsers also emit compatibility mouse events.
            // Ignore that second stream for a pointer gesture so one physical
            // move schedules one preview update at most.
            if (drag.pointerId !== null && !Number.isFinite(event.pointerId)) return
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.()
            drag.clientY = event.clientY
            if (orderDragFrame === 0) orderDragFrame = requestAnimationFrame(paintDrag)
          }
          const finish = event => {
            const drag = activeOrderDrag
            if (!drag || drag.kind !== kind || (drag.pointerId !== null && drag.pointerId !== event.pointerId)) return
            if (drag.pointerId !== null && !Number.isFinite(event.pointerId)) return
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.()
            if (Number.isFinite(event.clientY)) drag.clientY = event.clientY
            if (orderDragFrame) { cancelAnimationFrame(orderDragFrame); orderDragFrame = 0; paintDrag() }
            activeOrderDrag = null
            info.doc.removeEventListener('pointermove', move, true)
            info.doc.removeEventListener('pointerup', finish, true)
            info.doc.removeEventListener('pointercancel', finish, true)
            info.doc.removeEventListener('mousemove', move, true)
            info.doc.removeEventListener('mouseup', finish, true)
            orderHandleCleanups.delete(kind)
            handle.style.cursor = 'grab'
            if (drag.price > 0) {
              const error = protectionError(latest.current, kind, drag.price)
              if (error) {
                const authoritative = latest.current.levels?.[kind] ?? (kind === 'stop' ? latest.current.levels?.ghostStop : latest.current.levels?.ghostTarget)
                const line = lineByKind.get(kind)
                if (line && authoritative > 0) { renderingOverlays = true; try { line.setPrice(authoritative) } finally { renderingOverlays = false } }
                latest.current.onOrderValidationError?.(error)
                latest.current.onOrderPriceChange?.(kind, drag.price)
              } else latest.current.onOrderPriceChange(kind, drag.price)
            }
          }
          const begin = event => {
            if (event.button !== 0 || !latest.current.orderEditable || activeOrderDrag) return
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.()
            handle.style.cursor = 'grabbing'
            const dragInfo = orderPane() || info
            activeOrderDrag = {
              kind,
              pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
              price: Number(latest.current.levels?.[kind] ?? value),
              clientY: event.clientY,
              info: dragInfo,
            }
            // Mark the gesture before pausing replay. Pausing updates the
            // parent state and may request a chart refresh; the refresh must
            // see the active drag and defer rebuilding the native overlays.
            latest.current.onOrderDragStart?.()
            info.doc.addEventListener('pointermove', move, true)
            info.doc.addEventListener('pointerup', finish, true)
            info.doc.addEventListener('pointercancel', finish, true)
            info.doc.addEventListener('mousemove', move, true)
            info.doc.addEventListener('mouseup', finish, true)
          }
          // Advanced Charts listens for pointerdown on an ancestor of the
          // label layer and can stop propagation before a DOM button reaches
          // its target phase. Delegate the start from the iframe document so
          // the native chart cannot swallow the drag gesture. The document
          // listener is intentionally capture-phase and only claims events
          // whose hit target is one of our compact SL/TP handles.
          const delegatedBegin = event => {
            if (event.target === handle || handle.contains(event.target)) begin(event)
          }
          info.doc.addEventListener('pointerdown', delegatedBegin, true)
          // Keep the fallback in the iframe document too. Listening only once
          // at document capture avoids duplicate move/up work when a pointer
          // event bubbles through the handle and its owner document.
          info.doc.addEventListener('mousedown', delegatedBegin, true)
          orderHandleCleanups.set(kind, () => {
            info.doc.removeEventListener('pointerdown', delegatedBegin, true)
            info.doc.removeEventListener('mousedown', delegatedBegin, true)
            info.doc.removeEventListener('pointermove', move, true)
            info.doc.removeEventListener('pointerup', finish, true)
            info.doc.removeEventListener('pointercancel', finish, true)
            info.doc.removeEventListener('mousemove', move, true)
            info.doc.removeEventListener('mouseup', finish, true)
          })
          orderHandleHost.append(handle); orderHandles.set(kind, handle)
        }
        const coordinate = priceToPaneCoordinate(info, value)
        if (Number.isFinite(coordinate)) {
          // FX Replay keeps both ghost markers at the entry price. Give each
          // marker a stacked, overlapping hit band so the visible entry line
          // never has a dead gap between the SL and TP targets.
          const offset = overlap ? (kind === 'stop' ? -8 : 8) : 0
          handle.style.left = `${Math.max(info.rect.left, info.rect.right - Math.min(210, info.rect.width))}px`
          handle.style.top = `${info.rect.top + coordinate + offset}px`
          handle.style.height = overlap ? '28px' : '24px'
        }
      }
    }
    const saveShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); save() }
    }
    loadLibrary().then(() => {
      if (cancelled) return
      const current = latest.current
      historyReader = datasetSha256 ? createReplayChartWindowReader({ workspace, sessionId, datasetId, datasetSha256 }) : null
      const readHistory = historyReader ? (resolution, period) => {
        const state = latest.current
        return historyReader.read({ resolution, ...period, cursorIndex: state.viewCursorIndex, cutoff: state.cutoff })
      } : undefined
      adapter = createAdvancedReplayDatafeed({ symbol, assetClass, seconds, tickSize, rows: current.rows, cutoff: current.cutoff, readHistory })
      let saved
      try { saved = readChartSnapshot(localStorage, storageKey, Number(current.cutoff)) }
      catch { setMessage('Không đọc được chart đã lưu trên trình duyệt này.') }
      const seriesState = saved?.charts?.[0]?.panes?.flatMap(pane => pane.sources || []).find(source => source.type === 'MainSeries')?.state
      const restoredInterval = adapter.supported.includes(current.preferredInterval) ? current.preferredInterval : adapter.supported.includes(seriesState?.interval) ? seriesState.interval : adapter.interval
      if (seriesState) { seriesState.symbol = symbol; seriesState.interval = restoredInterval }
      widget = new window.TradingView.widget({
        container: host.current, library_path: '/charting_library/', datafeed: adapter.datafeed,
        symbol, interval: restoredInterval, locale: locale.slice(0, 2), timezone: 'Etc/UTC', theme: theme === 'light' ? 'Light' : 'Dark', autosize: true,
        ...(saved ? { saved_data: saved } : {}),
        custom_formatters: { dateFormatter: { format: date => displayDate(date), formatLocal: date => displayDate(date, { timeZone: null }) }, timeFormatter: { format: date => displayTime(date, { seconds: true }), formatLocal: date => displayTime(date, { seconds: true, timeZone: null }) } },
        custom_css_url: '/chart-legacy.css', favorites: { intervals: adapter.supported, chartTypes: ['Candles'] },
        header_widget_buttons_mode: 'adaptive',
        auto_save_delay: 1,
        enabled_features: ['seconds_resolution', 'items_favoriting'],
        // v23's sampled analytics assumes an http document URL and fails on srcdoc.
        disabled_features: ['14851', 'create_volume_indicator_by_default', 'main_series_scale_menu', 'header_symbol_search', 'symbol_search_hot_key', 'compare_symbol', 'header_compare', 'header_saveload', 'use_localstorage_for_settings', 'header_screenshot', 'header_fullscreen_button', 'widget_logo'],
        overrides: paneAppearance(theme),
        studies_overrides: Object.fromEntries(Object.entries(volumeAppearance(theme)).map(([key, value]) => [`volume.${key}`, value])),
      })
      widget.onChartReady(() => {
        if (cancelled) return
        const frame = host.current?.querySelector('iframe')
        if (frame) { frame.title = t('Biểu đồ replay {symbol}', { symbol }); if (frame.contentDocument) frame.contentDocument.title = `WMReplay · ${symbol}` }
        chart = widget.activeChart()
        layoutSave = createChartSave({
          snapshot: callback => widget.save(callback),
          persist: (at, layout) => writeChartSnapshot(localStorage, storageKey, at, layout),
          context: () => ({ generation: latest.current.orderGeneration, cutoff: Number(latest.current.cutoff) }),
          onState: value => { saveState = value; setLayoutStatus(value); publishHeader(); if (value === 'error') setMessage('Không lưu được chart: bộ nhớ trình duyệt không khả dụng hoặc đã đầy.'); else if (value === 'saved') setMessage('Đã lưu chart trên trình duyệt này.'); else if (value === 'dirty') setMessage('Có thay đổi chart chưa lưu.'); else setMessage('') },
        })
        // Restoring a layout cannot change the authoritative dataset symbol.
        if (chart.symbol() !== symbol) chart.setSymbol(symbol)
        if (!adapter.supported.includes(chart.resolution())) chart.setResolution(adapter.interval)
        const refresh = () => {
          if (cancelled || !chart || !latest.current.rows.length) return
          // Parent state changes (for example pausing replay on pointerdown)
          // can arrive while the pointer is between the SL/TP label and the
          // chart. Rebuilding the overlay layer here would remove the
          // document-level move/up listeners and make the drag appear dead.
          // The committed pointerup performs the authoritative update and the
          // next render then refreshes the overlay normally.
          if (activeOrderDrag) return
          renderingOverlays = true
          try {
            for (const line of lines) line.remove()
            lines = []
            lineByKind.clear()
            clearOrderHandles()
            const state = latest.current
            if (state.levels) for (const kind of ['entry', 'stop', 'target']) {
            const value = state.levels[kind] ?? (kind === 'stop' ? state.levels.ghostStop : state.levels.ghostTarget)
            if (!(value > 0)) continue
            const ghost = state.levels[kind] === null
            const line = chart.createOrderLine()
            if (!line) continue
            const palette = nativeChartPalette(state.theme)
            const color = kind === 'stop' ? palette.warning : kind === 'target' ? palette.positive : palette.primary
            const pnl = state.levels.floating == null ? '' : new Intl.NumberFormat(locale, { style: 'currency', currency: state.levels.currency || 'USD', maximumFractionDigits: 2 }).format(Number(state.levels.floating))
            const label = kind === 'entry' ? `${state.levels.side} · ${t(state.levels.state === 'queued' ? 'Chờ khớp' : state.levels.state === 'draft' ? 'Lệnh nháp' : 'Vị thế')}${pnl ? ` · ${pnl}` : ''}` : protectionLabel(state, kind, value, ghost)
            const quantity = state.levels.quantity == null || state.levels.quantity === '' ? '—' : String(state.levels.quantity)
            const editable = kind !== 'entry' && state.orderEditable
            line.setPrice(value).setDirection(state.levels.side === 'SELL' ? 'sell' : 'buy').setMode(kind === 'stop' ? 'stop' : kind === 'target' ? 'limit' : '').setText(label).setQuantity(quantity)
              .setLineColor(color).setBodyBorderColor(color).setQuantityBorderColor(color)
              .setBodyBackgroundColor(palette.surface).setBodyTextColor(palette.text)
              .setQuantityBackgroundColor(palette.surface).setQuantityTextColor(palette.text)
              .setCancelButtonBackgroundColor(palette.surface).setCancelButtonBorderColor(ghost ? palette.surface : color).setCancelButtonIconColor(ghost ? palette.surface : palette.text)
              .setBodyFont('12px Inter, sans-serif').setQuantityFont('12px Inter, sans-serif')
              .setLineStyle(ghost ? 2 : 0).setEditable(editable)
              .setCancellable(kind === 'entry' ? state.orderCloseable : !ghost && state.orderEditable && state.levels.state !== 'draft')
            line.setEditable(editable)
            const generation = state.orderGeneration
            line.onCancel(() => {
              const now = latest.current
              if (cancelled || now.orderGeneration !== generation) return
              if (kind === 'entry') { if (now.orderCloseable) { now.onOrderDragStart(); now.onOrderClose() } }
              else if (now.orderEditable && !ghost) { now.onOrderDragStart(); now.onOrderPriceChange(kind, null) }
            })
            if (kind !== 'entry') {
              const generation = state.orderGeneration
              line.onMove(() => {
                const now = latest.current
                // setPrice() is also used for the optimistic preview while a
                // custom SL/TP handle is being dragged. Do not turn that
                // preview repaint into a second request or a React refresh;
                // the handle commits once on pointerup.
                if (renderingOverlays || activeOrderDrag) return
                if (cancelled || !now.orderEditable || now.orderGeneration !== generation) { line.setPrice(now.levels?.[kind] ?? value); return }
                now.onOrderDragStart()
                const tick = Number(now.tickSize)
                const price = line.getPrice()
                const rounded = tick > 0 ? Number((Math.round(price / tick) * tick).toFixed(8)) : price
                // Keep the native line at the snapped pointer position while the
                // revisioned protection request is in flight. Resetting it to the
                // last server value here makes a drag visibly jump on every move.
                if (Number.isFinite(rounded) && rounded > 0) {
                  const error = protectionError(now, kind, rounded)
                  if (error) {
                    line.setPrice(now.levels?.[kind] ?? value)
                    now.onOrderValidationError?.(error)
                    return
                  }
                  line.setPrice(rounded)
                  now.onOrderPriceChange(kind, rounded)
                }
              })
            }
              lines.push(line); lineByKind.set(kind, line)
            }
            const signature = state.levels ? [state.levels.entry, state.levels.stop, state.levels.target].join(':') : ''
            if (signature !== fittedLevels) {
              fittedLevels = signature
              if (state.levels) fitOrder()
              else chart.getPanes()[0]?.getMainSourcePriceScale()?.setAutoScale(true)
            }
          } finally {
            renderingOverlays = false
          }
          syncOrderHandles()
        }
        const fitOrder = () => {
          const levels = latest.current.levels
          if (!levels) return
          const range = chart.getVisiblePriceRange()
          const prices = [levels.entry, levels.stop, levels.target, levels.ghostStop, levels.ghostTarget].filter(value => Number.isFinite(value) && value > 0)
          const from = Math.min(range.from, ...prices)
          const to = Math.max(range.to, ...prices)
          const padding = (to - from) * .06
          chart.getPanes()[0]?.getMainSourcePriceScale()?.setVisiblePriceRange({ from: from - padding, to: to + padding })
        }
        const importAnnotations = () => {
          if (cancelled) return
          restoringImports = true
          try {
            const existing = new Set(chart.getAllShapes().map(shape => shape.id))
            for (const id of importedShapes) if (existing.has(id)) chart.removeEntity(id)
            importedShapes = []
            for (const record of latest.current.drawings) {
              if (record.hidden) continue
              const payload = record.payload
              const shape = { 'horizontal-line': 'horizontal_line', entry: 'horizontal_line', sl: 'horizontal_line', tp: 'horizontal_line',
                trendline: 'trend_line', zone: 'rectangle', text: 'text', arrow: payload.anchors.length > 1 ? 'arrow' : 'arrow_up' }[payload.annotation_type]
              if (!shape) continue
              const points = payload.anchors.map(anchor => ({ time: Number(anchor.timestamp), price: Number(anchor.price) }))
              const palette = nativeChartPalette(latest.current.theme)
              const color = payload.annotation_type === 'sl' ? palette.negative : payload.annotation_type === 'tp' ? palette.positive : record.local ? palette.highlight : palette.primary
              const options = { shape, text: payload.label, lock: true, disableSelection: true, disableSave: true, disableUndo: true, showInObjectsTree: false,
                overrides: { linecolor: color, color, textColor: color, backgroundColor: color, transparency: 85 } }
              const id = points.length === 1 && shape !== 'text' ? chart.createShape(points[0], options) : chart.createMultipointShape(points, options)
              if (id) importedShapes.push(id)
            }
          } finally { restoringImports = false }
        }
        const ready = () => {
          if (cancelled) return
          // Saved layouts carry palette values; repaint with the native chart theme.
          widget.changeTheme(latest.current.theme === 'light' ? 'Light' : 'Dark').then(() => {
            if (cancelled) return
            widget.applyOverrides(paneAppearance(latest.current.theme))
            applyVolumeAppearance(widget, chart, latest.current.theme)
            hideDefaultVolumeStudies(chart)
            refresh(); importAnnotations()
            clearTimeout(loadingTimer)
            setStatus('ready')
            chartReady = true
            publishHeader()
            if (!saved) scheduleSave()
          }).catch(error => { if (!cancelled) { clearTimeout(loadingTimer); setStatus('error'); setMessage(String(error.message || error)) } })
        }
        instance.current = { widget, adapter, historyReader, chart, refresh, importAnnotations, save, scheduleSave }
        if (!adapter.update(latest.current.rows, latest.current.cutoff)) { historyReader?.reset(); chart.resetData() }
        // Pause before native drawing/pan/order gestures, not after a drag ends.
        let replayHoverTimestamp = null
        widget.subscribe('mouse_down', () => {
          latest.current.onOrderDragStart()
          if (!latest.current.selectingReplayBar) return
          // Crosshair updates from the same native pointer event may arrive
          // after mouse_down. Read that event before selecting a known candle.
          requestAnimationFrame(() => { if (!cancelled && latest.current.selectingReplayBar && replayHoverTimestamp != null) latest.current.onReplayBarSelect?.(replayHoverTimestamp) })
        })
        widget.subscribe('onAutoSaveNeeded', scheduleSave)
        widget.subscribe('study_event', scheduleSave)
        widget.subscribe('drawing_event', (id, event) => {
          if (restoringImports || renderingOverlays) return
          if (importedShapes.includes(id)) { if (event === 'remove') setTimeout(importAnnotations, 0); return }
          if (['create', 'move', 'remove', 'hide', 'show', 'properties_changed', 'points_changed'].includes(event)) scheduleSave()
        })
        chart.crossHairMoved().subscribe(null, event => {
          const time = Number(event.time)
          replayHoverTimestamp = Number.isFinite(time) && time <= Number(latest.current.cutoff) ? time : null
          const row = latest.current.rows.find(row => Number(row.timestamp) === time) || historyReader?.nativeRow(time, adapter.interval)
          latest.current.onCrosshair?.(row ? { row } : null)
        })
        headerSlots = { save, fitOrder, intervals: adapter.supported,
          setInterval: value => { if (!cancelled && adapter.supported.includes(value)) { latest.current.onOrderDragStart(); chart.setResolution(value) } },
          setType: value => { if (!cancelled) { latest.current.onOrderDragStart(); chart.setChartType(value) } },
          action: value => { if (!cancelled) { latest.current.onOrderDragStart(); chart.executeActionById(value) } },
          objects: () => cancelled ? [] : [...chart.getAllStudies().map(item => ({ ...item, kind:'study', visible:chart.getStudyById(item.id).isVisible() })), ...chart.getAllShapes().filter(item => !importedShapes.includes(item.id)).map(item => ({ ...item, kind:'shape', visible:chart.getShapeById(item.id).getProperties().visible !== false }))],
          objectAction: (item, action) => {
            if (cancelled) return
            latest.current.onOrderDragStart()
            if (action === 'remove') chart.removeEntity(item.id)
            else if (action === 'visibility') chart.setEntityVisibility(item.id, !item.visible)
            else if (chart.selection().canBeAddedToSelection(item.id)) chart.selection().set(item.id)
            if (action !== 'select') scheduleSave()
            else publishHeader()
          },
          capture: async (mode = 'download') => {
            latest.current.onOrderDragStart()
            const generation = latest.current.orderGeneration, cutoff = Number(latest.current.cutoff), resolution = chart.resolution()
            try {
              // Client-only export; native takeScreenshot() uploads to a server.
              const canvas = await widget.takeClientScreenshot()
              if (cancelled || generation !== latest.current.orderGeneration) { if (!cancelled) setMessage('Cutoff đã đổi; chụp lại chart tại mốc mới.'); return }
              const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
              if (cancelled || generation !== latest.current.orderGeneration || cutoff !== Number(latest.current.cutoff) || resolution !== chart.resolution()) { if (!cancelled) setMessage('Chart đã đổi; chụp lại tại mốc mới.'); return }
              if (!blob) throw new Error('Không tạo được ảnh PNG.')
              if (mode === 'copy') {
                if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error(t('Trình duyệt chưa hỗ trợ sao chép ảnh.'))
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                if (!cancelled) setMessage('Đã sao chép ảnh chart.')
                return
              }
              const url = URL.createObjectURL(blob), link = document.createElement('a')
              link.href = url; link.download = `WMReplay-${symbol}-${resolution}-cutoff-${cutoff}.png`; link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            } catch (error) { if (!cancelled) setMessage(`Không chụp được chart: ${error.message || error}`) }
          },
        }
        widget.headerReady().then(() => {
          if (cancelled) return
          // Official extension hosts; native controls and their menus remain library-owned.
          for (const [key, align] of [['market', 'left'], ['layout', 'left'], ['session', 'right'], ['search', 'right'], ['tools', 'right']]) {
            const slot = widget.createButton({ align, useTradingViewStyle: false })
            slot.className = `legacy-${key}-host`
            slot.parentElement.parentElement.classList.add(`legacy-${key}-group`)
            headerSlots[key] = slot
          }
          nativeHeader = headerSlots.market.ownerDocument.querySelector('.layout__area--top')
          nativeHeader.addEventListener('pointerdown', pauseNative, true)
          nativeHeader.addEventListener('keydown', pauseNative, true)
          nativeHeader.ownerDocument.addEventListener('keydown', saveShortcut, true)
          document.addEventListener('keydown', saveShortcut, true)
          headerObserver = new ResizeObserver(() => {
            resizeChrome()
            if (publishFrame === 0) publishFrame = requestAnimationFrame(() => { publishFrame = 0; publishHeader() })
          })
          headerObserver.observe(host.current)
          headerObserver.observe(host.current.closest('.chart-canvas'))
          resizeChrome()
          publishHeader()
        })
        chart.onIntervalChanged().subscribe(null, value => { publishHeader(value); scheduleSave() })
        chart.onVisibleRangeChanged?.().subscribe(null, () => syncOrderHandles())
        chart.onChartTypeChanged().subscribe(null, () => { publishHeader(); scheduleSave() })
        publishHeader()
        chart.dataReady(ready)
      })
      if (new URLSearchParams(window.location.search).get('chart_iframe') === 'srcdoc') {
        // v23 always navigates to blob:. Some embedded browsers cancel that
        // navigation; load the same generated document with its original hash.
        const frame = host.current?.querySelector('iframe')
        if (!frame || !frame.src.startsWith('blob:')) throw new Error('Advanced Charts v23 iframe source is unavailable.')
        const source = new URL(frame.src)
        fetch(source.href.split('#')[0]).then(response => {
          if (!response.ok) throw new Error('Advanced Charts iframe document could not be loaded.')
          return response.text()
        }).then(html => {
          if (cancelled || !frame.isConnected) return
          const hash = JSON.stringify(source.hash).replaceAll('<', '\\u003c')
          frame.srcdoc = html.replace(/<head[^>]*>/i, head => `${head}<script>location.hash=${hash};</script>`)
        }).catch(error => { if (!cancelled) { clearTimeout(loadingTimer); setStatus('error'); setMessage(String(error.message || error)) } })
      }
    }).catch(error => { if (!cancelled) { clearTimeout(loadingTimer); setStatus('error'); setMessage(String(error.message || error)) } })
    return () => {
      cancelled = true; clearOrderHandles(); layoutSave?.dispose(); clearTimeout(loadingTimer); headerObserver?.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(publishFrame); resizeFrame = 0; publishFrame = 0; nativeHeader?.removeEventListener('pointerdown', pauseNative, true); nativeHeader?.removeEventListener('keydown', pauseNative, true); nativeHeader?.ownerDocument.removeEventListener('keydown', saveShortcut, true); document.removeEventListener('keydown', saveShortcut, true); instance.current = null
      latest.current.onHeaderSlots?.(null)
      adapter?.dispose(); historyReader?.dispose(); widget?.remove()
    }
  }, [workspace, sessionId, datasetId, datasetSha256, symbol, assetClass, seconds, tickSize, storageKey, locale])

  useEffect(() => {
    const item = instance.current
    if (!item) return
    if (!item.adapter.update(rows, cutoff)) { item.historyReader?.reset(); item.chart.resetData() }
    const refresh = () => item === instance.current && item.refresh()
    item.chart.dataReady(refresh)
  }, [rows, cutoff, levels, orderEditable, props.orderCloseable, orderGeneration])
  useEffect(() => { instance.current?.importAnnotations() }, [drawings])
  useEffect(() => {
    if (!message || status !== 'ready' || !message.startsWith('Đã lưu')) return undefined
    const timer = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(timer)
  }, [message, status])
  useEffect(() => {
    const item = instance.current
    if (!item) return
    item.widget.changeTheme(theme === 'light' ? 'Light' : 'Dark').then(() => {
      if (item === instance.current) {
        item.widget.applyOverrides(paneAppearance(theme))
        applyVolumeAppearance(item.widget, item.chart, theme)
        item.refresh(); item.importAnnotations()
        item.scheduleSave()
      }
    })
  }, [theme])
  useEffect(() => {
    const chart = instance.current?.chart
    if (!chart || !viewportRequest || !rows.length) return
    const to = Number(rows.at(-1).timestamp)
    const from = viewportRequest.kind === 'fit' ? Number(rows[0].timestamp) : Math.max(Number(rows[0].timestamp), to - (viewportRequest.days ? viewportRequest.days * 86400 : 80 * seconds))
    if (from < to) chart.setVisibleRange({ from, to }).catch(() => {})
  }, [viewportRequest])

  const fallbackUrl = new URL(window.location.href)
  fallbackUrl.searchParams.set('chart_engine', 'lightweight')
  return <div className="replay-chart advanced-replay-chart" data-testid="replay-chart" data-chart-engine="advanced" data-chart-status={status} data-visible-row-count={rows.length} data-cutoff={cutoff} role="group" aria-label={t('Advanced Charts · {symbol} · {count} nến đến cutoff {cutoff} UTC', { symbol, count: rows.length, cutoff })}>
    <div ref={host} className="advanced-chart-host" inert={status !== 'ready'} aria-hidden={status !== 'ready' ? true : undefined} />
    {status === 'loading' && <ChartLoadingState />}
    {status === 'error' && <div className="advanced-chart-message" role="alert">{t(message)} <a href={fallbackUrl.href}>{t("Mở chart dự phòng")}</a></div>}
    {status === 'ready' && layoutStatus === 'error' && <div className="advanced-chart-message" role="alert">{t(message)}</div>}
  </div>
}
