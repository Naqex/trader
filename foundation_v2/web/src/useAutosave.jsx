import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createAutosave } from './autosave.js'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'

export const AutosaveBoundaryContext = createContext(null)
// A resource keeps one writer while its panel is closed/reopened during a save.
const resources = new Map()

export function useAutosaveBoundary(onClose) {
  const controllers = useRef(new Set()), locked = useRef(false)
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  const [closing, setClosing] = useState(false)
  const [active, setActive] = useState(null)
  const requestTransition = async action => {
    if (locked.current) return
    locked.current = true; setClosing(true)
    try {
      const results = await Promise.all([...controllers.current].map(controller => controller.flush({drain:true})))
      if (results.every(Boolean)) { await action(); return true }
      return false
    } finally { locked.current = false; setClosing(false) }
  }
  const boundary = useMemo(() => ({ register(controller) { controllers.current.add(controller); setActive(controller); return () => { controllers.current.delete(controller); setActive([...controllers.current][0] || null) } }, forceClose: () => latestClose.current() }), [])
  return { boundary, requestClose:()=>requestTransition(()=>latestClose.current()), requestTransition, closing, active }
}

export default function useAutosave({ identity, adapter, initialValue }) {
  const boundary = useContext(AutosaveBoundaryContext)
  const entry = useMemo(() => {
    if (resources.has(identity)) return resources.get(identity)
    let storage
    try { storage = window.sessionStorage } catch { /* Browser policy may disable local recovery. */ }
    const resource = { adapter, users:0 }
    resource.controller = createAutosave({ key:identity, initialValue, storage, adapter:{
      load:(...args)=>resource.adapter.load(...args), save:(...args)=>resource.adapter.save(...args), validate:(...args)=>resource.adapter.validate?.(...args), reconcile:(...args)=>resource.adapter.reconcile?.(...args),
      migrateRecovery:recovery=>resource.adapter.migrateRecovery?.(recovery) ?? recovery,
    } })
    resources.set(identity,resource)
    return resource
  }, [identity])
  entry.adapter = adapter
  const controller = entry.controller
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    entry.users++
    void controller.start()
    const unregister = boundary?.register(controller)
    const leaving = event => { if (controller.isDirty()) { event.preventDefault(); event.returnValue = '' } }
    const hidden = () => { if (document.visibilityState === 'hidden') void controller.flush() }
    window.addEventListener('beforeunload', leaving); document.addEventListener('visibilitychange', hidden)
    return () => {
      entry.users--; unregister?.(); window.removeEventListener('beforeunload', leaving); document.removeEventListener('visibilitychange', hidden)
      if (!entry.users) void controller.dispose().then(()=>{if(!entry.users && !controller.isDirty() && resources.get(identity) === entry)resources.delete(identity)})
    }
  }, [controller, boundary])
  return { ...state, change: controller.change, flush: controller.flush, retry: controller.retry, discardAndReload: controller.discardAndReload, forceClose: boundary?.forceClose }
}

export function AutosaveStatus({ save }) {
  const { t, timezone } = useTestingLocale()
  const failed = ['error', 'conflict', 'invalid'].includes(save.phase)
  const message = save.phase === 'loading' ? 'Đang đọc ghi chú…' : save.phase === 'saving' ? 'Đang lưu…' : save.phase === 'dirty' ? 'Chưa lưu' : save.phase === 'saved' ? null : ''
  if(save.phase==='idle' && save.localBackup)return null
  return <div className="wm-autosave-status" data-state={save.phase}>
    <span role={failed ? 'alert' : 'status'} aria-live="polite">{failed ? t(save.error) : message === null ? <>{t(save.record?.revision>1?'Sửa lần cuối':'Đã lưu lúc')} <time dateTime={save.savedAt}>{displayDate(save.savedAt, { timeStyle: 'medium', timeZone: timezone })}</time></> : t(message)}</span>
    {!save.localBackup && <small role="alert">{t('Trình duyệt không giữ được bản nháp. Đợi lưu xong trước khi rời trang.')}</small>}
    {save.phase === 'error' && <button type="button" className="fxa-button" onClick={() => void save.retry()}>{t('Thử lại')}</button>}
    {save.phase === 'conflict' && <button type="button" className="fxa-button" onClick={() => { if (window.confirm(t('Thay bản nháp hiện tại bằng bản đã lưu trên server?'))) void save.discardAndReload() }}>{t('Tải bản đã lưu')}</button>}
    {failed && save.forceClose && save.localBackup && <button type="button" className="fxa-button" onClick={save.forceClose}>{t('Giữ bản nháp và đóng')}</button>}
  </div>
}

export function AutosaveBoundaryStatus({ controller, forceClose }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return <AutosaveStatus save={{...state, retry:controller.retry, discardAndReload:controller.discardAndReload, forceClose}}/>
}
