import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import './notifications.css'

const NotificationContext = createContext(null)
export const useNotifications = () => useContext(NotificationContext)

function Notification({ notice, onDismiss }) {
  const { t } = useTestingLocale()
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (notice.tone === 'error' || paused) return
    const timer = setTimeout(() => onDismiss(notice.id), 6000)
    return () => clearTimeout(timer)
  }, [notice, paused, onDismiss])
  return <div className={`wm-notification is-${notice.tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    <p role={notice.tone === 'error' ? 'alert' : 'status'}>{t(notice.message)}</p>
    <button type="button" aria-label={t('Đóng thông báo')} onClick={() => onDismiss(notice.id)}>×</button>
  </div>
}

export function NotificationProvider({ children }) {
  const { t } = useTestingLocale()
  const [notices, setNotices] = useState([])
  const sequence = useRef(0)
  const dismiss = useCallback(id => setNotices(items => items.filter(item => item.id !== id)), [])
  const notify = useCallback((message, tone = 'success') => {
    const notice = { id: ++sequence.current, message, tone }
    setNotices(items => [...items.filter(item => item.message !== message), notice].slice(-3))
  }, [])
  return <NotificationContext.Provider value={notify}>{children}<aside className="wm-notifications" aria-label={t('Thông báo thao tác')}>{notices.map(notice => <Notification key={notice.id} notice={notice} onDismiss={dismiss} />)}</aside></NotificationContext.Provider>
}
