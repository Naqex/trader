import { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './LegacyTradingBar.css'

// Share replay's visual controls, while keeping every broker action in its
// existing preview/confirmation flow. This component never submits an order.
export default function Mt5TradingBar({ snapshot, positions, instrument, quantity, onQuantity, onOrder, disabled, open, onOpenChange, analyticsHref, theme, children }) {
  const { t, fmt } = useTestingLocale()
  const root = useRef(null), gesture = useRef(null)
  const [height, setHeight] = useState(230), [maximum, setMaximum] = useState(450), [expanded, setExpanded] = useState(false)
  const [balanceAnchor, setBalanceAnchor] = useState(null)
  useEffect(() => {
    const main = root.current.closest('.replay-main')
    const chart = main.querySelector('.chart-frame'), bar = root.current.querySelector('.chart-trading-bar')
    const measure = () => {
      if (!main.isConnected || !chart.isConnected || !bar.isConnected) return
      const chartMinimum = parseFloat(getComputedStyle(chart).minHeight) || 240
      setMaximum(Math.max(0, main.clientHeight - bar.offsetHeight - chartMinimum))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(main); measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (!open) setExpanded(false) }, [open])
  const resize = value => { setHeight(Math.max(Math.min(80,maximum), Math.min(value, maximum))); setExpanded(false); onOpenChange(true) }
  const amount = value => {
    if (!Number.isFinite(value)) return '—'
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency:snapshot.account.currency }).format(value) }
    catch { return fmt(value, snapshot?.account?.currency ? ` ${snapshot.account.currency}` : '') }
  }
  const step = direction => {
    const value = Number(quantity), lotStep = Number(instrument?.quantity_step)
    if (!quantity || !Number.isFinite(value) || !(lotStep > 0)) return
    const next = Number((value + direction * lotStep).toFixed(8))
    if (next >= instrument.quantity_min && next <= instrument.quantity_max) onQuantity(String(next))
  }
  const floating = positions.length && positions.every(item => Number.isFinite(item.profit)) ? positions.reduce((sum,item) => sum + item.profit,0) : null
  const cancelResize = () => { if (gesture.current) { setHeight(gesture.current.height); onOpenChange(gesture.current.open); gesture.current=null } }
  return <div ref={root} className={`legacy-trading-workspace mt5-trading-workspace${expanded && open ? ' is-maximized' : ''}`}>
    <footer className="chart-trading-bar legacy-trading-bar mt5-trading-bar" aria-label={t('Giao dịch MT5')}>
      <div className="chart-trading-actions">
        {['BUY','SELL'].map(side => <button key={side} type="button" className={side.toLowerCase()} disabled={disabled} onClick={() => onOrder(side)} data-tooltip={`${side === 'BUY' ? 'Ask' : 'Bid'}: ${fmt(side === 'BUY' ? snapshot?.quote?.ask : snapshot?.quote?.bid,'',8)}`} aria-label={t(side === 'BUY' ? 'Buy' : 'Sell')}>{t(side === 'BUY' ? 'Buy' : 'Sell')}</button>)}
        <div className="legacy-quantity-control"><input aria-label={t('Khối lượng nhanh')} type="number" min={instrument?.quantity_min || 0} max={instrument?.quantity_max} step={instrument?.quantity_step || 'any'} value={quantity} disabled={disabled} onChange={event => onQuantity(event.target.value)} /><div>{[1,-1].map(direction => <button key={direction} type="button" aria-label={t(direction === 1 ? 'Tăng khối lượng' : 'Giảm khối lượng')} disabled={disabled || !quantity || !(instrument?.quantity_step > 0)} onClick={() => step(direction)}><ChartIcon name="down" style={direction === 1 ? {transform:'rotate(180deg)'} : undefined}/></button>)}</div></div>
        <span className="live-badge">{snapshot?.mode === 'real' ? t('Real') : snapshot?.mode === 'demo' ? t('Demo') : 'MT5'}</span>
      </div>
      {!expanded && <button type="button" className="legacy-positions-grip" role="separator" aria-label={t('Kéo để chỉnh chiều cao danh sách lệnh')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={open ? Math.min(height,maximum) : 0}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current={y:event.clientY,height:Math.min(height,maximum),open}; setExpanded(false) }}
        onPointerMove={event => { if (gesture.current) resize((gesture.current.open ? gesture.current.height : 0) + gesture.current.y - event.clientY) }}
        onPointerUp={event => { gesture.current=null; if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={cancelResize} onLostPointerCapture={cancelResize}
        onKeyDown={event => { if (event.key === 'Escape') {cancelResize(); return} if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return; event.preventDefault(); if (event.key === 'Home') onOpenChange(false); else resize(event.key === 'End' ? maximum : (open ? Math.min(height,maximum) : 0) + (event.key === 'ArrowUp' ? 30 : -30)) }}><ChartIcon name="grip-horizontal"/></button>}
      <div className="chart-trading-account">
        <a className="legacy-analytics-link" href={analyticsHref} aria-label={t('Analytics')} data-tooltip={t('Analytics')}><ChartIcon name="analytics"/><span>{t('Analytics')}</span></a>
        <button type="button" className="legacy-balance-pill" aria-label={t('Thông tin tài khoản')} aria-expanded={Boolean(balanceAnchor)} onClick={event => setBalanceAnchor(balanceAnchor ? null : event.currentTarget)}><ChartIcon name="wallet"/><strong>{amount(snapshot?.account?.equity)}</strong>{floating !== null && <span className={`legacy-floating-pnl ${floating < 0 ? 'is-loss' : 'is-gain'}`}>{floating >= 0 ? '+' : ''}{amount(floating)}</span>}</button>
        <button type="button" aria-label={t(open ? 'Thu gọn danh sách lệnh' : 'Mở danh sách lệnh')} aria-expanded={open} data-tooltip={`${t('Vị thế')} (${positions.length})`} onClick={() => onOpenChange(!open)}><ChartIcon name="down" style={open ? {transform:'rotate(180deg)'} : undefined}/></button>
        <button type="button" aria-label={t(expanded ? 'Thu nhỏ danh sách lệnh' : 'Mở rộng danh sách lệnh')} aria-pressed={expanded} onClick={() => {setExpanded(!expanded); onOpenChange(true)}}><ChartIcon name={expanded ? 'contract-corners' : 'expand-corners'}/></button>
      </div>
    </footer>
    <div className="legacy-resizable-positions mt5-positions-dock" hidden={!open} style={expanded ? undefined : {height:Math.min(height,maximum)}}>{children}</div>
    {balanceAnchor && <LegacyPopover anchor={balanceAnchor} theme={theme} label={t('Thông tin tài khoản')} onClose={() => setBalanceAnchor(null)}><dl className="legacy-account-details">{[['Balance',snapshot?.account?.balance],['Equity',snapshot?.account?.equity],['Free margin',snapshot?.account?.margin_free]].map(([label,value]) => <div key={label}><dt>{t(label)}</dt><dd>{amount(value)}</dd></div>)}</dl></LegacyPopover>}
  </div>
}
