import { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import LegacyPositions from './LegacyPositions.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import LegacyModal from './LegacyModal.jsx'
import FxSelect from './FxSelect.jsx'
import { useNotifications } from './Notifications.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { finiteNumber } from './replayOrderModel.js'
import { defaultScalperPreset, readScalperPreset, scalperPresetStorageKey, scalperProtection } from './legacyScalperPreset.js'
import './LegacyTradingBar.css'

export default function LegacyTradingBar({ order, analyticsHref, propRulesAction, symbol, theme, sessionId, workspace, readStatus, onPresetChange }) {
  const { t, fmt } = useTestingLocale()
  const notify = useNotifications()
  useEffect(() => { if (order.notice && notify) notify(order.notice, order.notice.kind === 'error' ? 'error' : 'success') }, [order.notice, notify])
  const [positionsOpen, setPositionsOpen] = useState(false), [maximized, setMaximized] = useState(false), [height, setHeight] = useState(260)
  const [overflowReserve, setOverflowReserve] = useState(null)
  const [resizing, setResizing] = useState(false)
  const [balanceAnchor, setBalanceAnchor] = useState(null)
  const storageKey = scalperPresetStorageKey(workspace, sessionId)
  const [preset, setPreset] = useState(() => readScalperPreset(workspace, sessionId)), [draft, setDraft] = useState(defaultScalperPreset), [scalperAnchor, setScalperAnchor] = useState(null), [error, setError] = useState('')
  const workspaceRef = useRef(null), drag = useRef(null), hideBalance = useRef(null)
  const resizeFrame = useRef(null), pendingResize = useRef(null)
  const restoredHeight = useRef(260)
  const positionsLayout = useRef(null)
  positionsLayout.current = { open: positionsOpen, maximized, height, overflowReserve }
  useEffect(() => () => { clearTimeout(hideBalance.current); cancelAnimationFrame(resizeFrame.current) }, [])
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(preset)) } catch { /* The confirmation flow works without browser storage. */ } }, [storageKey, preset])
  const execution = order.execution, account = order.account, tickPending = order.tick.options === null && !order.executionConfig?.forceBar, disabled = order.disabled || Boolean(order.active) || (!execution && (!order.canInitialize || tickPending)), currency = execution?.cost_model?.account_ccy || order.configuredCurrency || order.costs?.account_ccy
  const money = value => {
    const amount = finiteNumber(value)
    if (amount === null) return '—'
    if (!currency) return fmt(amount)
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) } catch { return fmt(amount, ' ' + currency) }
  }
  const realized = finiteNumber(account?.balance) !== null && finiteNumber(account?.starting_balance) !== null ? Number(account.balance) - Number(account.starting_balance) : null
  const [quantity, setQuantity] = useState(() => String(order.instrument?.quantity_min || '0.01'))
  useEffect(() => { setQuantity(String(order.instrument?.quantity_min || '0.01')) }, [workspace, sessionId, order.instrument?.instrument_id])
  const openOrder = side => { setError(''); order.quickTrade(side, quantity, preset) }
  const quantityStep = direction => {
    const current = finiteNumber(quantity), step = finiteNumber(order.instrument?.quantity_step), minimum = finiteNumber(order.instrument?.quantity_min), maximum = finiteNumber(order.instrument?.quantity_max)
    if (disabled || current === null || !(step > 0)) return
    const next = Number((current + direction * step).toFixed(8))
    if ((minimum !== null && next < minimum) || (maximum !== null && next > maximum)) return
    setQuantity(String(next))
  }
  const resizeBounds = () => {
    const main = workspaceRef.current?.closest('.replay-main')
    const available = main?.clientHeight || 600
    const barHeight = workspaceRef.current?.querySelector('.legacy-trading-bar')?.offsetHeight || 48
    const chart = main?.querySelector('.chart-frame')
    const chartMinimum = chart ? parseFloat(getComputedStyle(chart).minHeight) || 240 : 240
    return { normal: Math.max(0, Math.floor(available - barHeight - chartMinimum)), full: Math.max(0, Math.floor(available - barHeight)), barHeight, width: main?.clientWidth, viewportHeight: window.innerHeight, reserve: available - (chart?.offsetHeight || available) }
  }
  const resize = (value, bounds = resizeBounds(), preview = false) => {
    const clamped = Math.round(Math.max(0, Math.min(value, bounds.full)))
    const next = !preview && clamped < 48 ? 0 : clamped
    if (!preview && next > 0 && next >= bounds.full) { setPositionsOpen(true); setMaximized(true); return }
    // Keep the native chart at its minimum size while the table slides over it.
    const reserve = next > bounds.normal ? bounds.normal + bounds.barHeight : null
    setOverflowReserve(current => current === reserve ? current : reserve)
    setMaximized(current => current ? false : current)
    const open = next > 0
    setPositionsOpen(current => current === open ? current : open)
    if (open) setHeight(current => current === next ? current : next)
    if (!preview && next > 0) restoredHeight.current = next
  }
  const finishResize = commit => {
    const gesture = drag.current
    if (!gesture) return
    cancelAnimationFrame(resizeFrame.current); resizeFrame.current = null
    if (commit && gesture.value !== undefined) resize(gesture.value)
    else {
      const layout = gesture.layout
      setPositionsOpen(layout.open); setHeight(layout.height); setMaximized(layout.maximized); setOverflowReserve(layout.overflowReserve)
    }
    setResizing(false)
    pendingResize.current = null; drag.current = null
  }
  useEffect(() => {
    const main = workspaceRef.current?.closest('.replay-main')
    if (!main) return
    const observer = new ResizeObserver(() => {
      const layout = positionsLayout.current
      // The main column is expected to change height while the grip is moving.
      // Cancelling on that change made the gesture fight the chart's own resize
      // observer near the minimum-height boundary. Only a real horizontal or
      // viewport resize invalidates the cached drag bounds.
      if (drag.current) { if (main.clientWidth !== drag.current.bounds.width || window.innerHeight !== drag.current.bounds.viewportHeight) finishResize(false); return }
      if (!layout.open || layout.maximized) return
      resize(layout.height)
    })
    observer.observe(main)
    const cancel = () => finishResize(false)
    window.addEventListener('blur', cancel)
    return () => { observer.disconnect(); window.removeEventListener('blur', cancel) }
  }, [])
  const dismissBalance = () => { hideBalance.current = setTimeout(() => setBalanceAnchor(null), 160) }
  const showBalance = anchor => { clearTimeout(hideBalance.current); setBalanceAnchor(anchor) }
  // Once the chart reaches its minimum height, slide the table over it during
  // the gesture too. Keeping it in flow would push the table below the viewport
  // and then jump back when the pointer is released.
  const overlay = !maximized && positionsOpen && overflowReserve !== null
  // This control changes panel height, so it needs a vertical affordance. The
  // generic expand/collapse paths are horizontal chevrons and read as broken
  // icons in the bottom trading bar.
  const positionsIcon = 'down'
  const maximizeIcon = maximized ? 'contract-corners' : 'expand-corners'
  return <div ref={workspaceRef} className={`legacy-trading-workspace ${resizing ? 'is-resizing' : ''} ${overlay ? 'is-expanded' : maximized ? 'is-maximized' : ''}`} style={overlay ? { height: overflowReserve, '--positions-height': `${positionsOpen ? height : 0}px` } : undefined}>
    <div className="chart-trading-bar legacy-trading-bar" role="group" aria-label={t('Giao dịch mô phỏng')}>
      <div className="chart-trading-actions">
        {['BUY', 'SELL'].map(side => <button key={side} type="button" className={side.toLowerCase()} disabled={disabled} onClick={() => openOrder(side)} title={t('Đặt lệnh nhanh theo khối lượng đã chọn')}>{t(side === 'BUY' ? 'Buy' : 'Sell')}</button>)}
        <div className="legacy-quantity-control"><input aria-label={t('Khối lượng nhanh')} type="number" min={order.instrument?.quantity_min || '0'} max={order.instrument?.quantity_max || undefined} step={order.instrument?.quantity_step || 'any'} value={quantity} disabled={disabled} onChange={event => setQuantity(event.target.value)} /><div><button type="button" aria-label={t('Tăng khối lượng')} disabled={disabled || !(Number(order.instrument?.quantity_step) > 0)} onClick={() => quantityStep(1)}><ChartIcon name="down" style={{ transform: 'rotate(180deg)' }} /></button><button type="button" aria-label={t('Giảm khối lượng')} disabled={disabled || !(Number(order.instrument?.quantity_step) > 0)} onClick={() => quantityStep(-1)}><ChartIcon name="down" /></button></div></div>
        <button type="button" className={`legacy-scalper-button ${preset.enabled ? 'is-enabled' : ''}`} aria-label="Scalper mode" title="Scalper mode" aria-expanded={Boolean(scalperAnchor)} aria-pressed={preset.enabled} onClick={event => {
          const next = structuredClone(preset)
          for (const key of ['stop', 'target']) {
            if (!preset.enabled) next[key].enabled = false
            if (next[key].unit === 'pips' && !(Number(order.instrument?.pip_size) > 0) && order.instrument?.asset_class && order.instrument.asset_class !== 'fx' && Number(order.instrument.tick_size) > 0) next[key].unit = 'ticks'
          }
          setDraft(next); setError(''); setScalperAnchor(event.currentTarget)
        }}><ChartIcon name="rocket" /></button>
      </div>
      <button type="button" className="legacy-positions-grip" aria-label={t('Kéo để chỉnh chiều cao danh sách lệnh')} title={t('Kéo để chỉnh chiều cao danh sách lệnh')} aria-expanded={positionsOpen}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || drag.current) return
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.focus({ preventScroll: true })
          const bounds = resizeBounds()
          drag.current = { y: event.clientY, height: maximized ? bounds.full : positionsOpen ? height : 0, bounds, layout: { ...positionsLayout.current } }
          if (maximized) resize(bounds.full, bounds, true)
          setResizing(true)
          event.preventDefault()
        }}
        onPointerMove={event => {
          if (!drag.current || (drag.current.value === undefined && Math.abs(drag.current.y - event.clientY) <= 3)) return
          drag.current.value = drag.current.height + drag.current.y - event.clientY
          pendingResize.current = { value: drag.current.value }
          if (resizeFrame.current !== null) return
          resizeFrame.current = requestAnimationFrame(() => {
            resizeFrame.current = null
            if (pendingResize.current && drag.current) resize(pendingResize.current.value, drag.current.bounds, true)
            pendingResize.current = null
          })
        }} onPointerUp={() => finishResize(true)} onPointerCancel={() => finishResize(false)} onLostPointerCapture={() => finishResize(false)}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finishResize(false); return }
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || drag.current) return
          event.preventDefault(); event.stopPropagation()
          if (event.key === 'Home') resize(0)
          else if (event.key === 'End') resize(resizeBounds().full)
          else if (!positionsOpen) resize(event.key === 'ArrowUp' ? restoredHeight.current : 0)
          else resize((maximized ? resizeBounds().full : height) + (event.key === 'ArrowUp' ? 30 : -30))
        }}><ChartIcon name="grip-horizontal" /></button>
      <div className="chart-trading-account">
        {readStatus}
        <a className="legacy-analytics-link" href={analyticsHref} aria-label={t('Analytics')} title={t('Analytics')}><ChartIcon name="analytics" /><span>{t('Analytics')}</span></a>
        {propRulesAction && <button type="button" className="legacy-prop-rules-link" data-testid="prop-rules-button" onClick={propRulesAction.onClick}><ChartIcon name="shield" />{propRulesAction.label}</button>}
        <button type="button" className="legacy-balance-pill" aria-label={t('Thông tin tài khoản')} aria-expanded={Boolean(balanceAnchor)} onPointerEnter={event => { if (event.pointerType === 'mouse' && matchMedia('(hover:hover)').matches) showBalance(event.currentTarget) }} onPointerLeave={dismissBalance} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) showBalance(event.currentTarget) }} onBlur={dismissBalance} onClick={event => balanceAnchor ? setBalanceAnchor(null) : showBalance(event.currentTarget)}><ChartIcon name="wallet" /><strong>{money(account?.balance ?? order.configuredBalance)}</strong></button>
        <button type="button" aria-label={t(positionsOpen ? 'Thu gọn danh sách lệnh' : 'Mở danh sách lệnh')} aria-expanded={positionsOpen} onClick={() => {
          if (positionsOpen) { setMaximized(false); setPositionsOpen(false); return }
          const bounds = resizeBounds()
          resize(Math.min(bounds.normal, restoredHeight.current), bounds)
        }}><ChartIcon name={positionsIcon} style={{ transform: positionsOpen ? 'rotate(180deg)' : undefined }} /></button>
        <button type="button" aria-label={t(maximized ? 'Thu nhỏ danh sách lệnh' : 'Mở rộng danh sách lệnh')} aria-pressed={maximized} onClick={() => { if (maximized) resize(Math.min(resizeBounds().normal, restoredHeight.current)); else { setPositionsOpen(true); setMaximized(true) } }}><ChartIcon name={maximizeIcon} /></button>
      </div>
    </div>
    <div className="legacy-resizable-positions" hidden={!positionsOpen} style={maximized && !resizing ? undefined : { height: positionsOpen ? height : 0 }}><LegacyPositions execution={execution} assetStates={order.assetStates} symbol={symbol} active={positionsOpen} /></div>
    {error && !scalperAnchor && <p className="legacy-preset-error" role="alert">{t(error)}<button type="button" onClick={() => setError('')} aria-label={t('Đóng thông báo')}>×</button></p>}
    {balanceAnchor && <LegacyPopover anchor={balanceAnchor} theme={theme} label={t('Thông tin tài khoản')} onClose={() => { clearTimeout(hideBalance.current); setBalanceAnchor(null) }}><dl className="legacy-account-details" onPointerEnter={() => clearTimeout(hideBalance.current)} onPointerLeave={dismissBalance}>{(account ? [['Equity', account.equity], ['Realized PnL', realized], ['Unrealized PnL', account.floating_pl]] : [['Account Balance', order.configuredBalance]]).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value)}</dd></div>)}</dl></LegacyPopover>}
    {scalperAnchor && <LegacyModal theme={theme} label="Scalper mode" className="legacy-scalper-modal" onClose={() => { setScalperAnchor(null); setError('') }}><form className="legacy-scalper-settings" onSubmit={event => {
      event.preventDefault()
      try {
        const next = { ...draft, enabled: draft.stop.enabled || draft.target.enabled }
        if (next.enabled) scalperProtection(next, order.reference, 'BUY', order.instrument)
        setPreset(next); onPresetChange?.(next); setScalperAnchor(null); setError('')
      } catch (failure) { setError(failure.message) }
    }}>
      {[['stop', 'Stop loss'], ['target', 'Take profit']].map(([key, label]) => <fieldset key={key}><label className="legacy-scalper-toggle"><input type="checkbox" role="switch" checked={draft[key].enabled} onChange={event => setDraft(current => ({ ...current, [key]: { ...current[key], enabled: event.target.checked } }))} /><span>{t(label)}</span></label><div className={`legacy-scalper-distance ${!draft[key].enabled ? 'is-off' : ''}`}><input aria-label={t('Khoảng cách {name}', { name: label })} type="number" min="0.00000001" step="any" required disabled={!draft[key].enabled} value={draft[key].enabled ? draft[key].value : ''} onChange={event => setDraft(current => ({ ...current, [key]: { ...current[key], value: event.target.value } }))} /><div className="legacy-scalper-units" role="group" aria-label={t('Đơn vị {name}', { name: label })}>{[['percent', '%'], ['pips', 'Pips'], ...(order.instrument?.asset_class && order.instrument.asset_class !== 'fx' && Number(order.instrument.tick_size) > 0 ? [['ticks', 'Ticks']] : [])].map(([unit, caption]) => <button key={unit} type="button" aria-pressed={draft[key].unit === unit} disabled={!draft[key].enabled || (unit === 'pips' && !(Number(order.instrument?.pip_size) > 0)) || (unit === 'ticks' && !(Number(order.instrument?.tick_size) > 0))} onClick={() => setDraft(current => ({ ...current, [key]: { ...current[key], unit } }))}>{caption}</button>)}</div></div></fieldset>)}
      <label className="legacy-scalper-toggle is-unavailable" title={t('Chưa hỗ trợ tự dời SL về hòa vốn')}><input type="checkbox" role="switch" disabled /><span>Auto Break-even</span></label>
      <label>{t('Chiến lược')}<FxSelect className="is-field" label="Chiến lược" value="session" disabled options={[{ value:'session', label:'Mặc định của phiên' }]} /></label>
      {error && <p role="alert">{t(error)}</p>}
      <footer><button type="button" onClick={() => { setScalperAnchor(null); setError('') }}>{t('Discard')}</button><button type="submit" className="legacy-scalper-save" disabled={order.disabled}>{t('Save')}</button></footer>
    </form></LegacyModal>}
  </div>
}
