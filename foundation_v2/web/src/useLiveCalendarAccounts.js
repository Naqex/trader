import { useEffect, useState } from 'react'
import { manualSnapshot } from './liveLedgerModel.js'
import { combineCalendarAccounts } from './liveCalendarAccounts.js'

export default function useLiveCalendarAccounts({ workspace, enabled, selection, items, broker, accounts, records, preview }) {
  const ids = selection === null ? items.map(item => item.record_id) : selection
  const primary = broker?.connection_id ? `broker:${broker.connection_id}` : 'broker'
  const extra = ids.filter(id => id.startsWith('broker:') && id !== primary)
  const remoteKey = JSON.stringify(extra)
  const scope = `${workspace}:${remoteKey}`
  const [remote, setRemote] = useState({ scope, values: {} })
  useEffect(() => {
    if (!enabled || preview || !extra.length) return
    const controller = new AbortController(), cache = new Map()
    let reading = false
    const poll = async () => {
      if (reading || controller.signal.aborted) return
      reading = true
      const values = {}
      let cursor = 0
      const worker = async () => {
        while (cursor < extra.length && !controller.signal.aborted) {
          const id = extra[cursor++], previous = cache.get(id)
          try {
            const response = await fetch(`/api/v2/live/status?${new URLSearchParams({ connection_id: id.slice(7) })}`, { headers: { 'X-Workspace-Id': workspace, ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}) }, signal: controller.signal })
            if (response.status === 304 && previous) values[id] = previous.payload
            else {
              if (!response.ok) throw new Error('unavailable')
              const payload = await response.json()
              if (payload.connection_id !== id.slice(7)) throw new Error('identity_mismatch')
              values[id] = payload
              cache.set(id, { payload, etag: response.headers.get('etag') })
            }
          } catch { values[id] = null }
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(4, extra.length) }, worker))
        if (!controller.signal.aborted) setRemote({ scope, values })
      } finally { reading = false }
    }
    void poll()
    const visible = () => { if (document.visibilityState !== 'hidden') void poll() }
    const timer = setInterval(visible, 5000)
    document.addEventListener('visibilitychange', visible)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [workspace, enabled, preview, remoteKey, scope])
  if (!enabled) return { payload: null, issue: '' }
  return combineCalendarAccounts(ids.map(id => ({ id, payload: id === primary ? broker : id.startsWith('broker:') ? remote.scope === scope ? remote.values[id] : null : manualSnapshot(accounts.find(item => item.record_id === id), records) })))
}
