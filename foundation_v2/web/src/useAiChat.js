import { useEffect, useRef, useState } from 'react'
import { aiErrorCopy } from './aiProvider.js'
import { readRunEvents, runPending } from './aiRunClient.js'

const base = '/api/v2/ai/assistant'
const providerName = id => id === 'local-gateway' ? 'CLIProxyAPI' : 'ChatGPT Web'
const modelKey = (provider, model) => `${provider}::${model}`

export default function useAiChat({ workspace, open, en, screen }) {
  const [routes, setRoutes] = useState([]), [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false), [changing, setChanging] = useState(false)
  const [messages, setMessages] = useState([]), [draft, setDraft] = useState(''), [error, setError] = useState('')
  const [chatId, setChatId] = useState(() => crypto.randomUUID()), [chatTitle, setChatTitle] = useState('')
  const [chats, setChats] = useState([]), [next, setNext] = useState(null), [waiting, setWaiting] = useState(null)
  const [cancelled, setCancelled] = useState(false), [historyOpen, setHistoryOpen] = useState(false)
  const [partial, setPartial] = useState(''), [reconnect, setReconnect] = useState(0)
  const [older, setOlder] = useState(null)
  const active = useRef(null), controller = useRef(null), epoch = useRef(0), submitting = useRef(false), selectedRef = useRef(null), defaultSelection = useRef(null)
  const unresolved = useRef(null)
  const storedId = `wm-ai-chat:${workspace}`
  const say = (vi, english) => en ? english : vi
  function errorCopy(code) { return aiErrorCopy(code, en) }
  async function request(path, method = 'GET', body, signal) {
    const response = await fetch(`${base}${path}`, { method, signal, headers: { 'X-Workspace-Id': workspace, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) { const failure = new Error(typeof value.detail === 'string' ? value.detail : 'ai_request_failed'); failure.status = response.status; throw failure }
    return value
  }
  function choose(value) { selectedRef.current = value; setSelected(value) }
  function remember(id) { try { localStorage.setItem(storedId, id) } catch {} }
  async function list(signal, cursor = null) {
    const query = cursor ? `?${new URLSearchParams(cursor)}` : ''
    const value = await request(`/conversations${query}`, 'GET', undefined, signal)
    if (signal?.aborted) return
    setChats(previous => cursor ? [...previous, ...value.items.filter(v => !previous.some(p => p.id === v.id))] : value.items)
    setNext(value.next)
  }
  async function loadAccount(signal) {
    setLoading(true)
    try {
      const [account, catalog, profiles] = await Promise.all([request('/account', 'GET', undefined, signal), request('/catalog', 'GET', undefined, signal), request('/profiles', 'GET', undefined, signal)])
      if (signal?.aborted) return
      setRoutes(catalog.routes)
      defaultSelection.current = profiles.chat_default?.selection || { provider: account.provider, ...account.selection }
      if (!selectedRef.current) choose(defaultSelection.current)
    } catch (failure) { if (!signal?.aborted) setError(errorCopy(failure.message)) }
    finally { if (!signal?.aborted) setLoading(false) }
  }
  function leave() {
    epoch.current++; controller.current?.abort(); active.current = null; submitting.current = false
    unresolved.current = null
    setWaiting(null); setPartial(''); setError(''); setCancelled(false)
    setOlder(null)
  }
  function newChat() {
    leave(); const id = crypto.randomUUID(); setChatId(id); remember(id); choose(defaultSelection.current); setChatTitle(''); setMessages([]); setDraft(''); setHistoryOpen(false)
  }
  function adopt(value) {
    const run = value.run
    setChatId(value.id); remember(value.id); setChatTitle(value.title); choose(value.selection)
    const items = value.messages.map(message => ({ ...message, status: runPending(message) ? 'running' : message.status }))
    setOlder(value.next)
    setMessages(items); setCancelled(run?.status === 'cancelled'); setPartial(runPending(run) ? run?.text || '' : '')
    if (runPending(run)) { active.current = run.id; setWaiting({ id: run.id, sequence: 0 }) }
    else if (['failed', 'interrupted'].includes(run?.status)) setError(errorCopy(run.error))
  }
  async function openChat(item) {
    leave(); const version = epoch.current; setLoading(true)
    try { const value = await request(`/conversations/${item.id}`); if (version === epoch.current) { adopt(value); setDraft(''); setHistoryOpen(false) } }
    catch (failure) { if (version === epoch.current) setError(errorCopy(failure.message)) }
    finally { if (version === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    const abort = new AbortController()
    leave(); setMessages([]); setDraft(''); setChats([]); setNext(null); choose(null)
    const id = crypto.randomUUID(); setChatId(id); setChatTitle('')
    if (open) {
      void loadAccount(abort.signal)
      void list(abort.signal).catch(f => { if (!abort.signal.aborted) setError(errorCopy(f.message)) })
      let saved
      try { saved = localStorage.getItem(storedId) } catch {}
      if (saved) void request(`/conversations/${saved}`, 'GET', undefined, abort.signal).then(value => { if (!abort.signal.aborted) adopt(value) }).catch(f => { if (!abort.signal.aborted && f.message !== 'chatgpt_turn_not_found') setError(errorCopy(f.message)) })
    }
    return () => { abort.abort(); controller.current?.abort(); epoch.current++; active.current = null; submitting.current = false }
  }, [workspace, open])
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    const refresh = event => { if (event.detail?.workspace === workspace) void loadAccount(abort.signal) }
    window.addEventListener('wm-ai-provider-change', refresh)
    window.addEventListener('wm-ai-profile-change', refresh)
    return () => { abort.abort(); window.removeEventListener('wm-ai-provider-change', refresh); window.removeEventListener('wm-ai-profile-change', refresh) }
  }, [open, workspace])
  useEffect(() => {
    if (!waiting || !open) return
    const abort = new AbortController(); controller.current = abort
    const version = epoch.current; let sequence = waiting.sequence || 0, done = false, streamText = ''
    const apply = value => {
      if (abort.signal.aborted || version !== epoch.current) return false
      sequence = Math.max(sequence, value.sequence || 0)
      if (runPending(value)) {
        if (typeof value.delta === 'string') {
          if (new TextEncoder().encode(streamText).length !== value.offset) throw new Error('ai_stream_gap')
          streamText += value.delta
        } else if (typeof value.text === 'string') streamText = value.text
        setPartial(streamText); return true
      }
      done = true; active.current = null; submitting.current = false; setWaiting(null); setPartial('')
      setMessages(previous => previous.map(item => item.id === value.id || item.status === 'running' ? { ...item, status: value.status } : item)
        .concat(value.status === 'completed' ? [{ role: 'assistant', content: value.text, status: 'completed', selection: value.selection }] : []))
      setCancelled(value.status === 'cancelled')
      if (['failed', 'interrupted'].includes(value.status)) setError(errorCopy(value.error))
      void list(abort.signal).catch(() => {})
      return false
    }
    void (async () => {
      for (let attempt = 0; attempt < 5 && !abort.signal.aborted && !done; attempt++) {
        try {
          const response = await fetch(`${base}/chat/${waiting.id}/events?after=${sequence}`, { headers: { 'X-Workspace-Id': workspace }, signal: abort.signal })
          await readRunEvents(response, apply, abort.signal)
          if (!done && !abort.signal.aborted) apply(await request(`/chat/${waiting.id}`, 'GET', undefined, abort.signal))
        } catch {
          // Repair an event gap with a snapshot of the same run, never a new inference.
          if (!abort.signal.aborted) try { apply(await request(`/chat/${waiting.id}`, 'GET', undefined, abort.signal)) } catch {}
        }
        if (!done && !abort.signal.aborted) await new Promise(resolve => { const timer = setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)); abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
      }
      if (!done && !abort.signal.aborted) setError(errorCopy('ai_reconnect_required'))
    })()
    return () => abort.abort()
  }, [waiting?.id, workspace, open, reconnect])
  async function send(event) {
    event.preventDefault()
    if (!draft.trim() || submitting.current || waiting || loading || !selectedRef.current) return
    const content = draft.trim(), version = epoch.current
    const history = messages.filter(item => item.status === 'completed').map(({ role, content }) => ({ role, content }))
    const body = unresolved.current?.conversation_id === chatId && unresolved.current.messages.at(-1).content === content ? unresolved.current
      : { conversation_id: chatId, idempotency_key: crypto.randomUUID(), messages: [...history, { role: 'user', content }], context: { screen, locale: en ? 'en' : 'vi' }, expected_selection: selectedRef.current }
    if (body.messages.length > 63 || new TextEncoder().encode(JSON.stringify(body)).length > 49152) { setError(errorCopy('invalid_chat_messages')); return }
    submitting.current = true; setError(''); setCancelled(false); setDraft(''); setPartial('')
    unresolved.current = body
    setMessages(previous => [...previous, { role: 'user', content, screen, status: 'running', id: 'submitting' }])
    try {
      const value = await request('/chat', 'POST', body)
      if (version !== epoch.current) return
      unresolved.current = null
      remember(chatId); active.current = value.id; setMessages(previous => previous.map(v => v.id === 'submitting' ? { ...v, id: value.id } : v))
      setWaiting({ id: value.id, sequence: 0 }); void list().catch(() => {})
    } catch (failure) {
      if (version !== epoch.current) return
      // The POST response may be lost after commit. Resolve its conversation before offering another send.
      try { const value = await request(`/conversations/${chatId}`); if (version === epoch.current && value.run?.request_key === body.idempotency_key) { unresolved.current = null; adopt(value); return } } catch {}
      if (failure.status && failure.status < 500) unresolved.current = null
      if (version === epoch.current) { setError(errorCopy(failure.message)); setDraft(content); setMessages(previous => previous.map(v => v.id === 'submitting' ? { ...v, status: 'failed' } : v)) }
    } finally { if (version === epoch.current) submitting.current = false }
  }
  async function stop() {
    if (!active.current) return
    try { await request(`/chat/${active.current}`, 'DELETE') }
    catch (failure) { setError(errorCopy(failure.message)) }
  }
  async function changeAccount(action, body) {
    if (action === 'selection') { choose(body); return }
    setChanging(true)
    try { await request(`/account/${action}`, 'POST', body || {}); await loadAccount() }
    catch (failure) { setError(errorCopy(failure.message)) }
    finally { setChanging(false) }
  }
  async function renameChat(id, title) {
    const current = await request(`/conversations/${id}`)
    await request(`/conversations/${id}`, 'PATCH', { title, revision: current.revision })
    if (id === chatId) setChatTitle(title)
    await list()
  }
  async function deleteChat(id) { await request(`/conversations/${id}`, 'DELETE'); if (id === chatId) newChat(); await list() }
  async function loadOlder() {
    if (!older || loading) return
    const version = epoch.current; setLoading(true)
    try { const value = await request(`/conversations/${chatId}?${new URLSearchParams(older)}`); if (version === epoch.current) { setMessages(previous => [...value.messages, ...previous]); setOlder(value.next) } }
    catch (failure) { if (version === epoch.current) setError(errorCopy(failure.message)) }
    finally { if (version === epoch.current) setLoading(false) }
  }
  const route = routes.find(value => value.provider === selected?.provider)
  const models = routes.flatMap(r => r.models.map(m => ({ ...m, id: modelKey(r.provider, m.id), sourceId: m.id, provider: r.provider, name: `${m.name} · ${providerName(r.provider)}` })))
  const account = selected ? { ...route, provider: selected.provider, selection: selected, models: route?.models || [], ready: !!route?.ready && route.models.some(m => m.id === selected.model) } : null
  const pickerSelection = selected?.model ? { ...selected, model: modelKey(selected.provider, selected.model) } : { model: '', effort: null }
  function selectModel(value) { const model = models.find(m => m.id === value.model); if (model) choose({ provider: model.provider, model: model.sourceId, effort: value.effort }) }
  return { account, loading, changing, messages, draft, setDraft, error, cancelled, busy: !!waiting || submitting.current, chatId, chatTitle, chats, next, historyOpen, setHistoryOpen, partial, older, loadOlder,
    newChat, openChat, send, stop, loadAccount, changeAccount, renameChat, deleteChat, models, pickerSelection, selectModel,
    loadMore: () => list(undefined, next).catch(f => setError(errorCopy(f.message))), retryConnection: () => { setError(''); setReconnect(v => v + 1) },
    reportError: failure => setError(errorCopy(failure.message)), say }
}
