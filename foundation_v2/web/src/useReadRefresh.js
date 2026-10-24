import { useEffect, useRef, useState } from 'react'
import { createReadRecovery } from './readRecovery.js'
import { subscribeWorkspaceEvents } from './workspaceEvents.js'

const IDLE = { retryAt: null, seconds: null, offline: false, exhausted: false, connection: 'paused' }

// Reconcile persisted reads on return to the app; never retries a mutation.
export default function useReadRefresh(refresh, enabled = true, { workspace, resources = [], error, pending = false, scopeKey, reconcileInitial = false } = {}) {
  const latest = useRef(refresh)
  latest.current = refresh
  const controller = useRef(null)
  const read = useRef({ error, pending })
  read.current = { error, pending }
  const [recovery, setRecovery] = useState(IDLE)
  const resourcesKey = [...new Set(resources)].sort().join(',')
  useEffect(() => {
    if (!enabled) { setRecovery(IDLE); return }
    if (workspace) {
      const current = createReadRecovery({ refresh: () => latest.current(), onChange: setRecovery,
        workspace, resources: resourcesKey ? resourcesKey.split(',') : [], subscribe: subscribeWorkspaceEvents, reconcileInitial })
      controller.current = current
      current.update(read.current)
      return () => { current.dispose(); if (controller.current === current) controller.current = null }
    }
    setRecovery(IDLE)
    let last = 0
    const reconcile = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 2000) return
      last = Date.now()
      latest.current()
    }
    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    return () => { window.removeEventListener('focus', reconcile); window.removeEventListener('online', reconcile) }
  }, [enabled, workspace, resourcesKey, scopeKey, reconcileInitial])
  useEffect(() => { controller.current?.update({ error, pending }) }, [error, pending])
  return recovery
}
