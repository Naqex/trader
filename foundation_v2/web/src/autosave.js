import same from 'fast-deep-equal'

// Serializes edits per resource. The adapter owns identity, validation and revisions.
export function createAutosave({ key, adapter, initialValue, storage, delay = 900, later = setTimeout, cancel = clearTimeout }) {
  const storageKey = `naqex-draft-v1:${key}`
  let recovered
  try { recovered = JSON.parse(storage?.getItem(storageKey) || 'null') } catch { /* Unavailable storage must not prevent editing. */ }
  if (recovered && adapter.migrateRecovery) recovered = adapter.migrateRecovery(recovered)
  let state = { phase: 'loading', ready: false, value: recovered?.value ?? initialValue, record: null, savedAt: null, error: null, localBackup: Boolean(storage) }
  let base = recovered?.base ?? initialValue, attempt = recovered?.attempt || null
  let loaded = false, timer, loading, writing, disposed = false
  const listeners = new Set()
  const dirty = () => !same(state.value, base)
  function emit(patch) {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  function backup() {
    try {
      if (dirty() || attempt) storage?.setItem(storageKey, JSON.stringify({ value: state.value, base, attempt, record: state.record }))
      else storage?.removeItem(storageKey)
    } catch { if (state.localBackup) emit({ localBackup: false }) }
  }
  function schedule() {
    cancel(timer)
    if (loaded && dirty() && !['error', 'conflict'].includes(state.phase)) timer = later(() => { void flush() }, delay)
  }
  async function load({ discard = false } = {}) {
    if (loading) return loading
    emit({ phase: 'loading', error: null })
    loading = (async () => {
      try {
        const remote = await adapter.load(recovered?.record)
        const hadDraft = dirty() || attempt
        const savedAttempt = attempt && same(remote.value, attempt.value)
        if (!discard && hadDraft && !same(remote.value, base) && !same(remote.value, state.value) && !savedAttempt) {
          emit({ phase: 'conflict', error: 'Bản đã lưu đã thay đổi ở nơi khác. Bản nháp của bạn vẫn được giữ.' })
          return false
        }
        if (discard || !hadDraft) emit({ value: remote.value })
        base = remote.value
        if (discard || savedAttempt || same(state.value, base)) attempt = null
        loaded = true
        emit({ ready: true, record: remote.record, savedAt: remote.savedAt, phase: dirty() ? 'dirty' : remote.record ? 'saved' : 'idle', error: null })
        backup(); recovered = null; schedule()
        return true
      } catch (error) {
        emit({ phase: 'error', error: error.message || 'Không đọc được ghi chú.' })
        return false
      } finally { loading = null }
    })()
    return loading
  }
  async function flush({ retry = false, drain = false } = {}) {
    cancel(timer)
    if (loading) await loading
    if (!loaded) return !dirty() && !attempt
    if (state.phase === 'conflict') return false
    if (writing) { await writing; return dirty() && !['error', 'conflict', 'invalid'].includes(state.phase) ? flush({ drain }) : !dirty() && !attempt }
    if (state.phase === 'error' && !retry) return false
    if (!dirty() && !attempt) return true
    const validation = adapter.validate?.(attempt?.value ?? state.value)
    if (validation) { emit({ phase: 'invalid', error: validation }); return false }
    if (attempt && (!attempt.startedAt || Date.now()-attempt.startedAt >= 24*60*60*1000)) {
      emit({phase:'conflict',error:'Yêu cầu lưu cũ chưa được xác nhận. Giữ bản nháp và kiểm tra bản đã lưu trước khi tiếp tục.'})
      return false
    }
    const submitted = attempt || { value: structuredClone(state.value), record: state.record, startedAt:Date.now() }
    attempt = submitted; backup()
    emit({ phase: 'saving', error: null })
    writing = (async () => {
      try {
        let reconciled
        if (retry && adapter.reconcile) {
          try { reconciled = await adapter.reconcile(submitted) } catch (error) { error.outcomeKnown = false; throw error }
        }
        const result = reconciled || await adapter.save(submitted.value, submitted.record, submitted)
        if (same(state.value,submitted.value)) emit({value:result.value})
        base = result.value; attempt = null
        emit({ record: result.record, savedAt: result.savedAt, phase: dirty() ? 'dirty' : 'saved', error: null })
        backup()
        return true
      } catch (error) {
        if (error.status === 409) {
          attempt = null
          emit({ phase: 'conflict', error: 'Bản đã lưu đã thay đổi ở nơi khác. Bản nháp của bạn vẫn được giữ.' })
        } else {
          // Retrying an unknown outcome must use the exact submitted snapshot.
          if (error.outcomeKnown !== false) attempt = null
          emit({ phase: 'error', error: error.outcomeKnown === false ? 'Chưa xác nhận được kết quả lưu. Giữ bản nháp và thử lại để kiểm tra.' : error.message || 'Không lưu được ghi chú. Bản nháp vẫn được giữ.' })
        }
        backup(); return false
      } finally { writing = null }
    })()
    const ok = await writing
    if (ok && dirty()) {
      if (disposed || drain) return flush({drain:true})
      schedule()
    }
    return ok && !dirty()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    start() { disposed = false; return loaded ? Promise.resolve(true) : load() },
    change(value) {
      if (!loaded || state.phase === 'conflict') return
      emit({ value, ...(state.phase === 'error' || state.phase === 'saving' ? {} : { phase: same(value, base) ? state.record ? 'saved' : 'idle' : 'dirty', error: null }) })
      backup(); schedule()
    },
    flush,
    retry: () => loaded ? flush({ retry: true }) : load(),
    discardAndReload: () => { attempt = null; return load({ discard: true }) },
    isDirty: () => dirty() || Boolean(attempt),
    dispose() { disposed = true; cancel(timer); backup(); return flush({drain:true}) },
  }
}
