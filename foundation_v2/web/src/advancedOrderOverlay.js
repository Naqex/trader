import { nativeChartPalette } from './nativeChartPalette.js'
import { orderLabel, protectionError } from './replayOrderLabels.js'

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
        right = Math.max(right, other.right + other.width + gap)
      }
    }
    placed.push({ ...marker, right })
    return { kind: marker.kind, right }
  })
}

// The vendor paints order labels on canvas. These small DOM controls live in
// that same iframe so the visible handle and the pointer target cannot diverge.
export function createAdvancedOrderOverlay({ getState, getPane, getLine, t }) {
  let root, owner, drag, frame = 0, syncFrame = 0
  const rows = new Map()
  const pendingPrices = new Map()
  const toY = (info, price) => orderScale(info).toY(price)
  const toPrice = (info, y) => orderScale(info).toPrice(y)
  const priceOf = (levels, kind) => levels[kind] ?? (kind === 'stop' ? levels.ghostStop : levels.ghostTarget)
  const snap = (price, tick) => tick > 0 ? Number((Math.round(price / tick) * tick).toFixed(8)) : price
  const claim = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation() }
  const setPrice = (kind, price) => { if (price > 0) getLine(kind)?.setPrice(price) }
  const restoreLine = kind => {
    const state = getState(), price = priceOf(state.levels || {}, kind)
    if (!(price > 0)) return
    const label = orderLabel(state.levels, kind, price, state.theme, t)
    setPrice(kind, price)
    getLine(kind)?.setLineColor(label.ghost ? 'rgba(0, 0, 0, 0)' : label.color)
  }
  const placeRows = () => {
    const markers = [...rows.values()].filter(row => !row.element.hidden).map(row => ({
      kind: row.kind, y: Number.parseFloat(row.element.style.top), width: row.element.offsetWidth, height: row.element.offsetHeight,
      minRight: drag?.kind === row.kind ? drag.right : 64,
    }))
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
    row.element.dataset.ghost = String(label.ghost)
    row.element.style.setProperty('--order-color', label.color)
    row.body.style.color = label.textColor
    row.text.textContent = label.text
    row.quantity.textContent = String(levels.quantity ?? '—')
    row.quantity.hidden = label.compact
    if (row.kind !== 'entry') {
      const hint = t('Kéo để dời · ↑ ↓ chỉnh giá · Delete để bỏ')
      row.body.title = label.ghost ? hint : `${label.detail} · ${price} · ${hint}`
    }
    row.body.disabled = row.kind !== 'entry' && !state.orderEditable
    row.element.dataset.pending = String(levels.state === 'submitting' || !state.orderEditable)
    if (row.close) {
      row.close.disabled = !state.orderCloseable
      row.close.style.visibility = state.orderCloseable ? 'visible' : 'hidden'
    }
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
    if (!drag.moved) return
    const row = rows.get(drag.kind)
    setPrice(drag.kind, price)
    getLine(drag.kind)?.setLineColor(orderLabel(state.levels, drag.kind, price, state.theme, t).color)
    paintRow(row, state, price, true)
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
    if (!gesture.moved) { sync(); return }
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
    Promise.resolve(state.onOrderPriceChange(gesture.kind, gesture.price)).finally(() => {
      pendingPrices.delete(gesture.kind)
      if (!root) return
      restoreLine(gesture.kind)
      sync()
    })
  }
  const begin = event => {
    const body = event.target.closest?.('[data-order-drag]')
    const state = getState()
    if (!body || !root?.contains(body) || event.button !== 0 || drag || !state.orderEditable) return
    const kind = body.dataset.orderDrag, info = getPane(), value = priceOf(state.levels, kind)
    if (!info || !(value > 0)) return
    claim(event)
    body.focus({ preventScroll: true })
    drag = { kind, info, pointerId: event.pointerId, generation: state.orderGeneration, startY: toY(info, value), clientStartY: event.clientY, clientY: event.clientY, price: value, moved: false, right: Number.parseFloat(rows.get(kind).element.style.right) }
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
    const text = owner.createElement('span'), quantity = owner.createElement('span')
    text.className = 'wm-order-marker-text'; quantity.className = 'wm-order-marker-quantity'
    if (kind !== 'entry') {
      body.type = 'button'; body.dataset.orderDrag = kind
      body.setAttribute('aria-label', kind === 'stop' ? 'Kéo Stop loss' : 'Kéo Take profit')
      body.title = t('Kéo để dời · ↑ ↓ chỉnh giá · Delete để bỏ')
      const grip = owner.createElement('span')
      grip.className = 'wm-order-marker-grip'; grip.setAttribute('aria-hidden', 'true')
      body.append(grip)
    } else element.setAttribute('aria-label', t('Giá vào lệnh'))
    body.append(text, quantity); element.append(body)
    const row = { kind, element, body, text, quantity }
    if (kind === 'entry') {
      const close = owner.createElement('button')
      close.type = 'button'; close.className = 'wm-order-marker-close'; close.textContent = '×'
      close.setAttribute('aria-label', t('Đóng/hủy lệnh'))
      close.addEventListener('click', event => {
        claim(event)
        const state = getState()
        if (state.orderCloseable) { state.onOrderDragStart?.(); state.onOrderClose?.() }
      })
      element.append(close); row.close = close
    }
    root.append(element); rows.set(kind, row)
    return row
  }
  function sync() {
    if (drag) return
    const state = getState(), info = getPane()
    if (!state.levels || !info) { if (root) root.hidden = true; return }
    if (!root) {
      owner = info.doc
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
      owner.defaultView.addEventListener('blur', cancel)
    }
    root.hidden = false
    Object.assign(root.style, { left: `${info.rect.left}px`, top: `${info.rect.top}px`, width: `${info.rect.width}px`, height: `${info.height}px` })
    root.style.setProperty('--order-bg', nativeChartPalette(state.theme).canvas)
    root.style.setProperty('--order-ink', nativeChartPalette(state.theme).text)
    for (const kind of ['entry', 'stop', 'target']) {
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
      owner.defaultView.removeEventListener('blur', cancel)
    }
    root?.remove(); root = null; rows.clear(); pendingPrices.clear()
  } }
}
