import { useEffect, useState } from 'react'
import { subscribeWorkspaceEvents } from './workspaceEvents.js'
import { useTestingLocale } from './testingLocale.jsx'
import { TestingResourceStatus } from './TestingPageState.jsx'

export default function WorkspaceConnectionNote({ workspace, enabled, previewState }) {
  const { t } = useTestingLocale()
  const [status, setStatus] = useState('connected')
  useEffect(() => {
    if (!enabled) return
    let timer
    const update = state => {
      clearTimeout(timer)
      if (navigator.onLine === false) setStatus('offline')
      else if (state === 'connected' || state === 'denied' || state === 'paused') setStatus(state)
      else timer = setTimeout(() => setStatus('reconnecting'), 3000)
    }
    const off = subscribeWorkspaceEvents(workspace, ({ event, data }) => {
      if (event === 'connection') update(data.state)
    })
    const offline = () => update('disconnected')
    window.addEventListener('offline', offline)
    window.addEventListener('online', offline)
    return () => { off(); clearTimeout(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', offline) }
  }, [workspace, enabled])
  const shown = enabled ? status : previewState
  const text = shown === 'offline' ? 'Đang ngoại tuyến' : shown === 'reconnecting' ? 'Đang nối lại cập nhật' : ''
  return <span className="wm-connection-note" data-testid="workspace-connection" data-connection-state={shown}>
    <TestingResourceStatus state={text ? 'stale' : undefined} detail={text ? `${t(text)}. ${t('Dữ liệu đã đọc vẫn được giữ trên màn hình.')}` : undefined} />
    <span className="sr-only" role="status">{t(text)}</span>
  </span>
}
