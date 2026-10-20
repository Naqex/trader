import { nativeChartPalette } from './nativeChartPalette.js'
import { orderLabel, orderPriceColor, protectionError, orderKinds } from './replayOrderLabels.js'

// Switching resolution briefly detaches the main series' price range. The
// deprecated chart getter throws in that state; wait for the scale to return.
export function readOrderPriceScale(chart) {
  try {
    const pane = chart?.getPanes?.()[0], scale = pane?.getMainSourcePriceScale?.()
    const visible = scale?.getVisiblePriceRange?.()
    if (!visible || !Number.isFinite(visible.from) || !Number.isFinite(visible.to) || visible.from === visible.to) return null
    return { pane, scale, range: { from:Math.min(visible.from,visible.to), to:Math.max(visible.from,visible.to) } }
  } catch { return null }
}

// v23 exposes the visible raw-price range, mode and inversion, but no public
// coordinate conversion. Percentage/indexed modes are affine in raw price.
export function orderScale(info) {
  const inverted = info.scale.isInverted?.() ?? false
  const log = info.scale.getMode?.() === 1
  const span = info.range.to - info.range.from
  const offset = 10 ** -(4 + (span < 1 && span >= 1e-15 ? Math.ceil(Math.abs(Math.log10(span))) : 0))
  const transform = value => log ? Math.sign(value) * Math.log10(1 + Math.abs(value) / offset) : value
  const inverse = value => log ? Math.sign(value) * Math.expm1(Math.abs(value) * Math.LN10) * offset : value
  const low = transform(info.range.from), high = transform(info.range.to)
  return {
    toY: price => (inverted ? (transform(price) - low) : (high - transform(price))) / (high - low) * info.height,
    toPrice: y => inverse(inverted ? low + y / info.height * (high - low) : high - y / info.height * (high - low)),
  }
}

// Move colliding boxes sideways, never away from their true price. Entry stays
// in the right-hand column; equal-price protection boxes read TP, SL, Entry.
export function orderMarkerColumns(markers, inset = 64, gap = 8) {
  const placed = []
  return markers.map(marker => {
    let right = Math.max(inset, marker.minRight || inset)
    for (const other of placed) {
      if (Math.abs(marker.y - other.y) < (marker.height + other.height) / 2 + 4) {
        const joinedProtections = marker.kind !== 'entry' && other.kind !== 'entry' && marker.y === other.y
        right = Math.max(right, other.right + other.width + (joinedProtections ? 0 : gap))
      }
    }
    placed.push({ ...marker, right })
    return { kind: marker.kind, right }
  })
}

// The vendor paints order labels on canvas. These small DOM controls live in
// that same iframe so the visible handle and the pointer target cannot diverge.
export function createAdvancedOrderOverlay({ getState, getPane, getLine, t }) {
  let root, owner, ownerWindow, drag, resizeObserver, frame = 0, syncFrame = 0
  const rows = new Map()
  const pendingPrices = new Map()
  const toY = (info, price) => orderScale(info).toY(price)
  const toPrice = (info, y) => orderScale(info).toPrice(y)
  const priceOf = (levels, kind) => levels[kind] ?? (kind === 'stop' ? levels.ghostStop : levels.ghostTarget)
  const snap = (price, tick) => tick > 0 ? Number((Math.round(price / tick) * tick).toFixed(8)) : price
  const claim = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation() }
  const setPrice = (kind, price) => { if (price > 0) getLine(kind)?.setPrice(price) }
  const paintPriceColor = (kind, state = getState()) => {
    const row = rows.get(kind)
    getLine(kind)?.setLineColor(orderPriceColor(kind, state.theme, row?.hovered || row?.focused || drag?.kind === kind, state.levels?.side))
  }
  const restoreLine = kind => {
    const state = getState(), price = priceOf(state.levels || {}, kind)
    if (!(price > 0)) return
    setPrice(kind, price)
    paintPriceColor(kind, state)
  }
  const placeRows = () => {
    const markers = [...rows.values()].filter(row => !row.element.hidden).map(row => {
      const rect = row.size || (row.size = row.element.getBoundingClientRect())
      return { kind: row.kind, y: Number.parseFloat(row.element.style.top), width: rect.width, height: rect.height,
        minRight: drag?.kind === row.kind ? drag.right : 64 }
    })
    for (const { kind, right } of orderMarkerColumns(markers)) {
      rows.get(kind).element.style.right = `${right}px`
      // Keep a captured handle from oscillating between columns at the overlap
      // threshold. Return to its normal column once the gesture ends.
      if (drag?.kind === kind) drag.right = right
    }
  }
  const paintRow = (row, state, price, preview = false) => {
    const levels = preview ? { ...state.levels, [row.kind]: price } : state.levels
    const label = orderLabel(levels, row.kind, price, state.theme, t)
    paintPriceColor(row.kind, state)
    row.element.dataset.ghost = String(label.ghost)
    row.element.dataset.compact = String(label.compact)
    row.element.style.setProperty('--order-color', label.color)
    row.element.style.setProperty('--order-border', label.borderColor)
    row.element.style.setProperty('--order-line', label.lineColor)
    row.body.style.color = label.textColor
    const parts = label.text.split(' → ')
    row.name.textContent = parts[0]
    row.arrow.hidden = parts.length < 2
    row.arrow.textContent = parts.length > 1 ? ' → ' : ''
    row.amount.hidden = parts.length < 2
    row.amount.textContent = parts[1] || ''
    row.quantity.textContent = String(levels.targets?.find(target => `target:${target.id}` === row.kind)?.quantity ?? levels.quantity ?? '—')
    row.quantity.hidden = label.compact
    if (row.kind === 'entry') {
      row.quantity.disabled = !state.orderEditable || !state.onOrderEdit
      row.quantity.setAttribute('aria-label', t('Chỉnh sửa vị thế'))
    }
    if (row.kind !== 'entry') {
      const hint = t('Kéo để dời · ↑ ↓ chỉnh giá · Delete để bỏ')
      row.body.title = label.ghost ? hint : `${label.detail} · ${price} · ${hint}`
    }
    row.body.disabled = row.kind !== 'entry' && !state.orderEditable
    row.element.dataset.pending = String(levels.state === 'submitting' || !state.orderEditable)
    if (row.close) {
      const partial = levels.state === 'position' && levels.partialCloseSupported && state.onOrderPartial
      row.close.disabled = !state.orderCloseable
      row.close.setAttribute('aria-label', t(partial ? 'Đóng một phần vị thế' : 'Đóng/hủy lệnh'))
      row.close.style.visibility = state.orderCloseable ? 'visible' : 'hidden'
    }
    return label
  }
  const paintDrag = () => {
    frame = 0
    if (!drag) return
    const state = getState()
    if (state.orderGeneration !== drag.generation || !state.orderEditable) { cancel(); return }
    const price = snap(toPrice(drag.info, drag.startY + drag.clientY - drag.clientStartY), Number(state.tickSize))
    if (!(price > 0)) return
    drag.price = price
    drag.moved ||= Math.abs(drag.clientY - drag.clientStartY) >= 2
    if (!drag.moved || price === drag.paintedPrice) return
    drag.paintedPrice = price
    const row = rows.get(drag.kind)
    paintRow(row, state, price, true)
    setPrice(drag.kind, price)
    row.element.style.top = `${toY(drag.info, price)}px`
    row.element.dataset.invalid = String(Boolean(protectionError(state.levels, drag.kind, price)))
    placeRows()
  }
  const move = event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    claim(event)
    drag.clientY = event.clientY
    if (!frame) frame = requestAnimationFrame(paintDrag)
  }
  const endCapture = gesture => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    drag = null
    const row = rows.get(gesture.kind)
    row?.element.removeAttribute('data-dragging')
    row?.element.removeAttribute('data-invalid')
    if (row?.body.hasPointerCapture(gesture.pointerId)) row.body.releasePointerCapture(gesture.pointerId)
  }
  const cancel = () => {
    if (!drag) return
    const gesture = drag
    endCapture(gesture)
    restoreLine(gesture.kind)
    sync()
  }
  const finish = event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    claim(event)
    drag.clientY = event.clientY
    if (frame) cancelAnimationFrame(frame)
    paintDrag()
    if (!drag) return
    const gesture = drag, state = getState()
    endCapture(gesture)
    if (!gesture.moved || gesture.price === gesture.initialPrice) { sync(); return }
    const error = protectionError(state.levels, gesture.kind, gesture.price)
    if (error) {
      restoreLine(gesture.kind)
      state.onOrderValidationError?.(error)
      sync()
      return
    }
    // Keep the preview until the revisioned request resolves. The caller returns
    // false on rejection; no success toast or persisted state is invented here.
    pendingPrices.set(gesture.kind, { price: gesture.price, generation: gesture.generation })
    Promise.resolve(state.onOrderPriceChange(gesture.kind, gesture.price)).then(() => {
      // React may not have published the server response yet. Keep the accepted
      // preview through that commit instead of restoring an obsolete price.
      requestAnimationFrame(() => {
        pendingPrices.delete(gesture.kind)
        if (!root) return
        restoreLine(gesture.kind)
        sync()
      })
    }, () => { pendingPrices.delete(gesture.kind); restoreLine(gesture.kind); sync() })
  }
  const begin = event => {
    const body = event.target.closest?.('[data-order-drag]')
    const state = getState()
    if (!body || !root?.contains(body) || event.button !== 0 || drag || !state.orderEditable) return
    const kind = body.dataset.orderDrag, info = getPane(), value = priceOf(state.levels, kind)
    if (!info || !(value > 0)) return
    claim(event)
    body.dataset.pointerFocus = 'true'
    body.focus({ preventScroll: true })
    drag = { kind, info, pointerId: event.pointerId, generation: state.orderGeneration, startY: toY(info, value), clientStartY: event.clientY, clientY: event.clientY, price: value, initialPrice: value, paintedPrice: value, moved: false, right: Number.parseFloat(rows.get(kind).element.style.right) }
    rows.get(kind).element.dataset.dragging = 'true'
    body.setPointerCapture(event.pointerId)
    state.onOrderDragStart?.()
  }
  const scheduleSync = event => {
    if (drag || (event.type === 'pointermove' && !event.buttons) || syncFrame) return
    syncFrame = requestAnimationFrame(() => { syncFrame = 0; sync() })
  }
  const keyboard = event => {
    if (event.key === 'Escape' && drag) { claim(event); cancel(); return }
    const body = event.target.closest?.('[data-order-drag]'), state = getState(), tick = Number(state.tickSize)
    if (!body || !root?.contains(body) || !state.orderEditable || !(tick > 0)) return
    delete body.dataset.pointerFocus
    if (!['ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(event.key)) return
    claim(event)
    const kind = body.dataset.orderDrag
    const price = event.key === 'Delete' || event.key === 'Backspace' ? null : snap(priceOf(state.levels, kind) + (event.key === 'ArrowUp' ? tick : -tick), tick)
    if (price !== null) {
      const error = protectionError(state.levels, kind, price)
      if (error) { state.onOrderValidationError?.(error); return }
    }
    state.onOrderPriceChange(kind, price)
  }
  const lostCapture = event => { if (drag?.pointerId === event.pointerId) cancel() }
  const createRow = kind => {
    const element = owner.createElement('div')
    element.className = 'wm-order-marker'
    element.dataset.orderKind = kind
    const body = owner.createElement(kind === 'entry' ? 'span' : 'button')
    body.className = 'wm-order-marker-body'
    const text = owner.createElement('span'), quantity = owner.createElement(kind === 'entry' ? 'button' : 'span')
    text.className = 'wm-order-marker-text'; quantity.className = 'wm-order-marker-quantity'
    const name = owner.createElement('span'), arrow = owner.createElement('span'), amount = owner.createElement('span')
    arrow.className = 'wm-order-marker-arrow'; arrow.textContent = ' → '
    text.append(name, arrow, amount)
    if (kind !== 'entry') {
      body.type = 'button'; body.dataset.orderDrag = kind
      body.addEventListener('blur', () => { delete body.dataset.pointerFocus })
      body.setAttribute('aria-label', kind === 'stop' ? 'Kéo Stop loss' : 'Kéo Take profit')
      body.title = t('Kéo để dời · ↑ ↓ chỉnh giá · Delete để bỏ')
      const grip = owner.createElement('span')
      grip.className = 'wm-order-marker-grip'; grip.setAttribute('aria-hidden', 'true')
      body.append(grip)
    } else {
      element.setAttribute('aria-label', t('Giá vào lệnh'))
      quantity.type = 'button'; quantity.setAttribute('aria-label', t('Chỉnh sửa vị thế'))
      quantity.addEventListener('click', event => {
        claim(event)
        const state = getState()
        if (state.orderEditable) { state.onOrderDragStart?.(); state.onOrderEdit?.() }
      })
    }
    body.append(text, quantity); element.append(body)
    const row = { kind, element, body, text, name, arrow, amount, quantity }
    if (kind !== 'entry') {
      element.addEventListener('pointerenter', () => { row.hovered = true; paintPriceColor(kind) })
      element.addEventListener('pointerleave', () => { row.hovered = false; paintPriceColor(kind) })
      body.addEventListener('focus', () => { row.focused = !body.dataset.pointerFocus; paintPriceColor(kind) })
      body.addEventListener('blur', () => { row.focused = false; paintPriceColor(kind) })
    }
    if (kind === 'entry') {
      const close = owner.createElement('button')
      close.type = 'button'; close.className = 'wm-order-marker-close'; close.textContent = '×'
      close.setAttribute('aria-label', t('Đóng/hủy lệnh'))
      close.addEventListener('click', event => {
        claim(event)
        const state = getState()
        if (state.orderCloseable) {
          state.onOrderDragStart?.()
          if (state.levels.state === 'position' && state.levels.partialCloseSupported && state.onOrderPartial) state.onOrderPartial()
          else state.onOrderClose?.()
        }
      })
      element.append(close); row.close = close
    }
    root.append(element); rows.set(kind, row)
    resizeObserver?.observe(element)
    return row
  }
  function sync() {
    if (drag) return
    const state = getState(), info = getPane()
    if (!state.levels || !info) { if (root) root.hidden = true; return }
    if (!root) {
      owner = info.doc
      ownerWindow = owner.defaultView
      if (!ownerWindow) return
      // The observer delivers real border-box sizes after layout. Reading each
      // marker after every drag write would force layout on the pointer path.
      resizeObserver = new ownerWindow.ResizeObserver(entries => {
        for (const entry of entries) {
          const row = rows.get(entry.target.dataset.orderKind), size = entry.borderBoxSize[0]
          if (row && size?.inlineSize > 0) row.size = { width: size.inlineSize, height: size.blockSize }
        }
        placeRows()
      })
      root = owner.createElement('div'); root.dataset.wmOrderHandles = 'true'
      Object.assign(root.style, { position: 'fixed', pointerEvents: 'none', zIndex: '8', overflow: 'hidden' })
      owner.body.append(root)
      owner.addEventListener('pointerdown', begin, true)
      owner.addEventListener('pointermove', move, true)
      owner.addEventListener('pointerup', finish, true)
      owner.addEventListener('pointercancel', cancel, true)
      owner.addEventListener('lostpointercapture', lostCapture, true)
      owner.addEventListener('keydown', keyboard, true)
      owner.addEventListener('pointermove', scheduleSync)
      owner.addEventListener('pointerup', scheduleSync)
      owner.addEventListener('wheel', scheduleSync, { passive: true })
      ownerWindow.addEventListener('blur', cancel)
    }
    root.hidden = false
    Object.assign(root.style, { left: `${info.rect.left}px`, top: `${info.rect.top}px`, width: `${info.rect.width}px`, height: `${info.height}px` })
    const palette = nativeChartPalette(state.theme)
    root.style.setProperty('--order-bg', palette.canvas)
    root.style.setProperty('--order-ink', palette.text)
    root.style.setProperty('--order-close-bg', palette.orderCloseBackground)
    root.style.setProperty('--order-close-icon', palette.orderCloseIcon)
    root.style.setProperty('--order-close-border', palette.orderCloseBorder)
    const kinds = orderKinds(state.levels)
    for (const [kind,row] of rows) if (!kinds.includes(kind)) { resizeObserver?.unobserve(row.element); row.element.remove(); rows.delete(kind) }
    for (const kind of kinds) {
      const row = rows.get(kind) || createRow(kind), pending = pendingPrices.get(kind)
      const price = pending?.generation === state.orderGeneration ? pending.price : priceOf(state.levels, kind)
      row.element.hidden = !(price > 0)
      if (!(price > 0)) continue
      paintRow(row, state, price, Boolean(pending && pending.generation === state.orderGeneration))
      row.element.style.right = '64px'
      row.element.style.top = `${toY(info, price)}px`
    }
    placeRows()
  }
  return { sync, isDragging: () => Boolean(drag), destroy() {
    if (frame) cancelAnimationFrame(frame)
    if (syncFrame) cancelAnimationFrame(syncFrame)
    drag = null
    resizeObserver?.disconnect()
    if (owner) {
      owner.removeEventListener('pointerdown', begin, true)
      owner.removeEventListener('pointermove', move, true)
      owner.removeEventListener('pointerup', finish, true)
      owner.removeEventListener('pointercancel', cancel, true)
      owner.removeEventListener('lostpointercapture', lostCapture, true)
      owner.removeEventListener('keydown', keyboard, true)
      owner.removeEventListener('pointermove', scheduleSync)
      owner.removeEventListener('pointerup', scheduleSync)
      owner.removeEventListener('wheel', scheduleSync)
      // Removing the chart iframe clears Document.defaultView before React cleanup.
      ownerWindow?.removeEventListener('blur', cancel)
    }
    root?.remove(); root = null; owner = null; ownerWindow = null; rows.clear(); pendingPrices.clear()
  } }
}
