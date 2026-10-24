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

const durations = { success:5000, info:7000, warning:8000, error:10000 }

export function NotificationSurface({ as:Element='div', tone='info', persistent=false, onDismiss, className='', children, ...props }) {
  const duration = persistent ? 0 : durations[tone] || durations.info
  const remaining = useRef(duration), dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const [hovered,setHovered] = useState(false), [focused,setFocused] = useState(false)
  const [hidden,setHidden] = useState(document.visibilityState==='hidden')
  useEffect(()=>{
    const changed=()=>setHidden(document.visibilityState==='hidden')
    document.addEventListener('visibilitychange',changed)
    return ()=>document.removeEventListener('visibilitychange',changed)
  },[])
  useEffect(()=>{remaining.current=duration},[duration])
  useEffect(()=>{
    if (!duration || hovered || focused || hidden || !dismiss.current) return
    const started=performance.now()
    const timer=setTimeout(()=>dismiss.current?.(),remaining.current)
    return ()=>{clearTimeout(timer);remaining.current=Math.max(0,remaining.current-(performance.now()-started))}
  },[duration,hovered,focused,hidden])
  return <Element {...props} className={`wm-notification is-${tone} ${className}`.trim()} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false)}}>{children}</Element>
}

function Notification({ notice, onDismiss }) {
  const { t } = useTestingLocale()
  const order = notice.order
  const orderTitle = { executed: 'Đã khớp lệnh market', closed: 'Closed your open position on', partial_closed: 'Partially closed your open position on', cancelled: 'Cancelled your pending order on' }[order?.status] || 'Đã gửi lệnh market chờ khớp'
  const structured = Boolean(notice.title)
  const role = notice.tone === 'error' ? 'alert' : 'status'
  return <NotificationSurface tone={notice.tone} persistent={notice.persistent} onDismiss={()=>onDismiss(notice.id)} className={`${order ? 'is-order' : ''}${structured ? ' is-structured' : ''}`} data-order-status={order?.status}>
    {order ? <>
      <span className={`wm-notification-mark is-${order.side === 'BUY' ? 'buy' : 'sell'}`} aria-hidden="true">✓</span>
      <div className="wm-notification-content" role={role}>
        <strong>{t(orderTitle)}</strong>
        <span className="wm-notification-symbol">{order.symbol}</span>
        <span className={`wm-notification-order-line is-${order.side === 'BUY' ? 'buy' : 'sell'}`}><b>{t(order.side === 'BUY' ? 'Buy' : 'Sell')}</b> {order.price == null ? order.quantity : t('{quantity} tại {price}', { quantity: order.quantity, price: order.price })}</span>
        {order.detail && <span className="wm-notification-detail">{t(order.detail, order.values)}</span>}
      </div>
    </> : structured ? <>
      <span className={`wm-notification-mark ${notice.tone === 'error' ? 'is-error' : 'is-neutral'}`} aria-hidden="true">{notice.tone === 'error' ? '×' : '✓'}</span>
      <div className="wm-notification-content" role={role}>
        <strong>{t(notice.title)}</strong>
        <span className="wm-notification-detail">{t(notice.message, notice.values)}</span>
      </div>
    </> : <p role={role}>{t(notice.message || notice.text)}</p>}
    <button type="button" aria-label={t('Đóng thông báo')} onClick={() => onDismiss(notice.id)}>×</button>
  </NotificationSurface>
}

export function NotificationProvider({ children }) {
  const { t } = useTestingLocale()
  const [notices, setNotices] = useState([])
  const [viewport, setViewport] = useState(null)
  const sequence = useRef(0)
  const dismiss = useCallback(id => setNotices(items => items.filter(item => item.id !== id)), [])
  const notify = useCallback((messageOrNotice, tone = 'success') => {
    const input = typeof messageOrNotice === 'string' ? { message: messageOrNotice, tone } : { tone, ...messageOrNotice }
    const key = input.order ? `order:${input.order.operationId || ''}:${input.order.status}:${input.order.side}:${input.order.symbol}:${input.order.quantity}:${input.order.price}` : `message:${input.title || ''}:${input.message || input.text}:${JSON.stringify(input.values || {})}`
    const notice = { id: ++sequence.current, ...input, key }
    setNotices(items => [...items.filter(item => item.key !== key), notice].slice(-3))
  }, [])
  return <NotificationContext.Provider value={notify}><NotificationViewportContext.Provider value={viewport}>{children}</NotificationViewportContext.Provider><aside ref={setViewport} className="wm-notifications" aria-label={t('Thông báo thao tác')}>{notices.map(notice => <Notification key={notice.id} notice={notice} onDismiss={dismiss} />)}</aside></NotificationContext.Provider>
}
