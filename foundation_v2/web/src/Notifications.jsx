import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTestingLocale } from './testingLocale.jsx'
import './notifications.css'

const NotificationContext = createContext(null)
const NotificationViewportContext = createContext(null)
export const useNotifications = () => useContext(NotificationContext)

export function NotificationSlot({ children }) {
  const viewport = useContext(NotificationViewportContext)
  return viewport ? createPortal(children, viewport) : null
}

function Notification({ notice, onDismiss }) {
  const { t } = useTestingLocale()
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (notice.tone === 'error' || paused) return
    const timer = setTimeout(() => onDismiss(notice.id), 6000)
    return () => clearTimeout(timer)
  }, [notice, paused, onDismiss])
  const order = notice.order
  const structured = Boolean(notice.title)
  const role = notice.tone === 'error' ? 'alert' : 'status'
  return <div className={`wm-notification is-${notice.tone}${order ? ' is-order' : ''}${structured ? ' is-structured' : ''}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    {order ? <>
      <span className={`wm-notification-mark is-${order.side === 'BUY' ? 'buy' : 'sell'}`} aria-hidden="true">✓</span>
      <div className="wm-notification-content" role={role}>
        <strong>{t(order.status === 'executed' ? 'Đã khớp lệnh market' : 'Đã gửi lệnh market chờ khớp')}</strong>
        <span className="wm-notification-symbol">{order.symbol}</span>
        <span className={`wm-notification-order-line is-${order.side === 'BUY' ? 'buy' : 'sell'}`}><b>{t(order.side === 'BUY' ? 'Buy' : 'Sell')}</b> {t('{quantity} tại {price}', { quantity: order.quantity, price: order.price })}</span>
      </div>
    </> : structured ? <>
      <span className="wm-notification-mark is-neutral" aria-hidden="true">✓</span>
      <div className="wm-notification-content" role={role}>
        <strong>{t(notice.title)}</strong>
        <span className="wm-notification-detail">{t(notice.message, notice.values)}</span>
      </div>
    </> : <p role={role}>{t(notice.message || notice.text)}</p>}
    <button type="button" aria-label={t('Đóng thông báo')} onClick={() => onDismiss(notice.id)}>×</button>
  </div>
}

export function NotificationProvider({ children }) {
  const { t } = useTestingLocale()
  const [notices, setNotices] = useState([])
  const [viewport, setViewport] = useState(null)
  const sequence = useRef(0)
  const dismiss = useCallback(id => setNotices(items => items.filter(item => item.id !== id)), [])
  const notify = useCallback((messageOrNotice, tone = 'success') => {
    const input = typeof messageOrNotice === 'string' ? { message: messageOrNotice, tone } : { tone, ...messageOrNotice }
    const key = input.order ? `order:${input.order.status}:${input.order.side}:${input.order.symbol}:${input.order.quantity}:${input.order.price}` : `message:${input.title || input.message}:${JSON.stringify(input.values || {})}`
    const notice = { id: ++sequence.current, ...input, key }
    setNotices(items => [...items.filter(item => item.key !== key), notice].slice(-3))
  }, [])
  return <NotificationContext.Provider value={notify}><NotificationViewportContext.Provider value={viewport}>{children}</NotificationViewportContext.Provider><aside ref={setViewport} className="wm-notifications" aria-label={t('Thông báo thao tác')}>{notices.map(notice => <Notification key={notice.id} notice={notice} onDismiss={dismiss} />)}</aside></NotificationContext.Provider>
}
