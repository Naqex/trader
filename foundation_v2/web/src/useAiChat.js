import { useEffect, useRef, useState } from 'react'
import { aiErrorCopy } from './aiProvider.js'
import { readRunEvents, runPending } from './aiRunClient.js'
import { chatHistory, finishReply, prependHistory } from './aiTranscript.js'

const base = '/api/v2/ai/assistant'
const providerName = id => id === 'local-gateway' ? 'CLIProxyAPI' : 'ChatGPT Web'
const modelKey = (provider, model) => `${provider}::${model}`
const builtinMentor = { id: 'mentor', name: 'Mentor', description: '', revision: 0, builtin: true }

export default function useAiChat({ workspace, open, en, screen }) {
  const [routes, setRoutes] = useState([]), [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false), [changing, setChanging] = useState(false)
  const [messages, setMessages] = useState([]), [draft, setDraft] = useState(''), [error, setError] = useState('')
  const [chatId, setChatId] = useState(() => crypto.randomUUID()), [chatTitle, setChatTitle] = useState('')
  const [chats, setChats] = useState([]), [next, setNext] = useState(null), [waiting, setWaiting] = useState(null)
  const [cancelled, setCancelled] = useState(false), [historyOpen, setHistoryOpen] = useState(false)
  const [partial, setPartial] = useState(''), [reconnect, setReconnect] = useState(0)
  const [phase, setPhase] = useState(null), [stopping, setStopping] = useState(false), [continuation, setContinuation] = useState(null)
  const [stoppedRun, setStoppedRun] = useState(null)
  const [older, setOlder] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [agents, setAgents] = useState([builtinMentor]), [agentId, setAgentId] = useState('mentor')
  const [agentsLoading, setAgentsLoading] = useState(false)
  const agentRef = useRef(builtinMentor)
  const rosterRef = useRef([builtinMentor])
  const active = useRef(null), controller = useRef(null), epoch = useRef(0), submitting = useRef(false), selectedRef = useRef(null), defaultSelection = useRef(null)
  const unresolved = useRef(null), unresolvedPrompt = useRef(null)
  const accountRevision = useRef(0)
  const accountError = useRef(null)
  const storedId = `wm-ai-chat:${workspace}`
  const storedAgent = `wm-ai-agent:${workspace}`
  const say = (vi, english) => en ? english : vi
  function errorCopy(code) { return aiErrorCopy(code, en) }
  async function request(path, method = 'GET', body, signal) {
    const response = await fetch(`${base}${path}`, { method, signal, headers: { 'X-Workspace-Id': workspace, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) { const failure = new Error(typeof value.detail === 'string' ? value.detail : 'ai_request_failed'); failure.status = response.status; throw failure }
    return value
  }
  function choose(value) { selectedRef.current = value; setSelected(value) }
  function remember(id) { try { localStorage.setItem(storedId, id); localStorage.setItem(storedAgent, agentRef.current.id) } catch {} }
  async function readChat(id, signal) {
    const value = await request(`/conversations/${id}`, 'GET', undefined, signal)
    // A page may start inside a continued answer. Restore its beginning before sending context.
    for (let pages = 0; pages < 64 && value.next && value.messages[0]?.role === 'assistant' && value.messages[0].continuation_of; pages++) {
      const older = await request(`/conversations/${id}?${new URLSearchParams(value.next)}`, 'GET', undefined, signal)
      value.messages = prependHistory(older.messages, value.messages)
      value.next = older.next
    }
    return value
  }
  async function list(signal, cursor = null, id = agentRef.current.id) {
    const version = epoch.current
    const query = `?${new URLSearchParams({ ...(cursor || {}), agent_id: id })}`
    const value = await request(`/conversations${query}`, 'GET', undefined, signal)
    if (signal?.aborted || version !== epoch.current || id !== agentRef.current.id) return
    setChats(previous => cursor ? [...previous, ...value.items.filter(v => !previous.some(p => p.id === v.id))] : value.items)
    setNext(value.next)
  }
  async function loadAccount(signal) {
    const revision = ++accountRevision.current
    setLoading(true)
    try {
      const [account, catalog, profiles] = await Promise.all([request('/account', 'GET', undefined, signal), request('/catalog', 'GET', undefined, signal), request('/profiles', 'GET', undefined, signal)])
      if (signal?.aborted || revision !== accountRevision.current) return
      setRoutes(catalog.routes)
      if (accountError.current) { const message = accountError.current; setError(previous => previous === message ? '' : previous); accountError.current = null }
      defaultSelection.current = profiles.chat_default?.selection || { provider: account.provider, ...account.selection }
      if (!selectedRef.current) choose(defaultSelection.current)
    } catch (failure) { if (!signal?.aborted && revision === accountRevision.current) { accountError.current = errorCopy(failure.message); setError(accountError.current) } }
    finally { if (!signal?.aborted && revision === accountRevision.current) setLoading(false) }
  }
  function leave() {
    epoch.current++; controller.current?.abort(); active.current = null; submitting.current = false
    unresolved.current = null
    setWaiting(null); setPartial(''); setError(''); setCancelled(false); setPhase(null); setStopping(false); setContinuation(null); setStoppedRun(null)
    setOlder(null); setRestoring(false)
  }
  function newChat() {
    leave(); const id = crypto.randomUUID(); setChatId(id); remember(id); choose(defaultSelection.current); setChatTitle(''); setMessages([]); setDraft(''); setHistoryOpen(false)
  }
  function selectAgent(agent) {
    agentRef.current = agent; setAgentId(agent.id)
    newChat(); setChats([]); setNext(null)
    void list().catch(f => setError(errorCopy(f.message)))
  }
  async function saveAgent(value, create = false) {
    const version = epoch.current
    const body = { name: value.name, description: value.description, instructions: value.instructions, knowledge: value.knowledge, ...(!create ? { revision: value.revision } : {}) }
    const saved = await request(create ? '/agents' : `/agents/${value.id}`, create ? 'POST' : 'PATCH', body)
    if (version !== epoch.current) throw new Error('ai_request_failed')
    rosterRef.current = create ? [...rosterRef.current, saved] : rosterRef.current.map(a => a.id === saved.id ? saved : a)
    setAgents(previous => create ? [...previous, saved] : previous.map(a => a.id === saved.id ? saved : a))
    if (create) selectAgent(saved)
    else if (agentRef.current.id === saved.id) agentRef.current = saved
  }
  async function readAgent(id) {
    const version = epoch.current
    const value = await request(`/agents/${id}`)
    if (version !== epoch.current) throw new Error('ai_request_failed')
    const metadata = { id: value.id, name: value.name, description: value.description, builtin: value.builtin, revision: value.revision, knowledge_count: value.knowledge.length }
    rosterRef.current = rosterRef.current.map(a => a.id === id ? metadata : a)
    setAgents(rosterRef.current)
    if (agentRef.current.id === id) agentRef.current = metadata
    return value
  }
  function adopt(value) {
    const run = value.run
    const id = value.agent_id || 'mentor'
    agentRef.current = rosterRef.current.find(a => a.id === id) || { id, revision: 0 }
    setAgentId(id)
    setChatId(value.id); remember(value.id); setChatTitle(value.title); choose(value.selection)
    const items = value.messages.map(message => ({ ...message, status: runPending(message) ? 'running' : message.status }))
    setOlder(value.next)
    setMessages(items); setCancelled(run?.status === 'cancelled'); setPartial(runPending(run) ? run?.text || '' : '')
    setPhase(run?.phase || null); setStopping(run?.status === 'cancelling'); setContinuation(runPending(run) ? run.continuation_of || null : null)
    setStoppedRun(run?.status === 'cancelled' ? run.id : null)
    if (runPending(run)) { active.current = run.id; setWaiting({ id: run.id, sequence: 0 }) }
    else if (['failed', 'interrupted'].includes(run?.status)) setError(errorCopy(run.error))
  }
  async function openChat(item) {
    leave(); const version = epoch.current; setLoading(true)
    try { const value = await readChat(item.id); if (version === epoch.current) { adopt(value); setDraft(''); setHistoryOpen(false) } }
    catch (failure) { if (version === epoch.current) setError(errorCopy(failure.message)) }
    finally { if (version === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    const abort = new AbortController()
    leave(); setMessages([]); setDraft(''); setChats([]); setNext(null); choose(null)
    agentRef.current = builtinMentor; rosterRef.current = [builtinMentor]; setAgentId('mentor'); setAgents([builtinMentor])
    const id = crypto.randomUUID(); setChatId(id); setChatTitle('')
    if (open) {
      let selectedAgent = 'mentor'
      try { selectedAgent = localStorage.getItem(storedAgent) || 'mentor' } catch {}
      agentRef.current = { ...builtinMentor, id: selectedAgent }; setAgentId(selectedAgent)
      setAgentsLoading(true)
      void request('/agents', 'GET', undefined, abort.signal).then(roster => {
        if (abort.signal.aborted) return
        rosterRef.current = roster.items || [builtinMentor]; setAgents(rosterRef.current)
        const previousAgent = agentRef.current.id
        agentRef.current = rosterRef.current.find(a => a.id === agentRef.current.id) || builtinMentor
        setAgentId(agentRef.current.id)
        if (previousAgent !== agentRef.current.id) void list(abort.signal).catch(() => {})
      }).catch(f => { if (!abort.signal.aborted) setError(errorCopy(f.message)) }).finally(() => { if (!abort.signal.aborted) setAgentsLoading(false) })
      void loadAccount(abort.signal)
      void list(abort.signal).catch(f => { if (!abort.signal.aborted) setError(errorCopy(f.message)) })
      let saved
      try { saved = localStorage.getItem(storedId) } catch {}
      if (saved) {
        const version = epoch.current
        setRestoring(true)
        void readChat(saved, abort.signal).then(value => { if (!abort.signal.aborted && version === epoch.current) { const previousAgent = agentRef.current.id; adopt(value); if (previousAgent !== agentRef.current.id) void list(abort.signal).catch(() => {}) } }).catch(f => { if (!abort.signal.aborted && version === epoch.current && f.message !== 'chatgpt_turn_not_found') setError(errorCopy(f.message)) }).finally(() => { if (!abort.signal.aborted && version === epoch.current) setRestoring(false) })
      }
    }
    return () => { abort.abort(); controller.current?.abort(); epoch.current++; active.current = null; submitting.current = false }
  }, [workspace, open])
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    const refresh = event => {
      if (event.detail?.workspace !== workspace) return
      if (event.detail.error) { accountRevision.current++; setLoading(false); accountError.current = errorCopy(event.detail.error); setError(accountError.current) }
      else void loadAccount(abort.signal)
    }
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
        setPartial(streamText); setPhase(value.phase || null); setStopping(value.status === 'cancelling'); return true
      }
      done = true; active.current = null; submitting.current = false; setWaiting(null); setPartial('')
      setMessages(previous => finishReply(previous, value))
      setStopping(false); setContinuation(null); setPhase(null); setStoppedRun(value.status === 'cancelled' ? value.id : null)
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
  async function send(event, continueRun = null) {
    event.preventDefault()
    if ((!draft.trim() && !continueRun) || submitting.current || waiting || loading || agentsLoading || restoring || !selectedRef.current) return
    const content = continueRun ? say('Tiếp tục câu trả lời vừa dừng từ đúng chỗ dở dang. Chỉ viết phần tiếp theo, không nhắc lại phần đã viết.', 'Continue the stopped response from exactly where it ended. Write only the continuation without repeating the existing text.') : draft.trim(), version = epoch.current
    const history = chatHistory(messages)
    const outgoing = chatHistory([...history, { role: 'user', content }])
    const retrying = unresolved.current?.conversation_id === chatId && unresolved.current.continuation_of === (continueRun || undefined) && unresolvedPrompt.current === content
    const body = retrying ? unresolved.current
      : { conversation_id: chatId, idempotency_key: crypto.randomUUID(), messages: outgoing, context: { screen, locale: en ? 'en' : 'vi' }, expected_selection: selectedRef.current, agent: { id: agentRef.current.id, revision: agentRef.current.revision }, ...(continueRun ? { continuation_of: continueRun } : {}) }
    if (body.messages.length > 63 || new TextEncoder().encode(JSON.stringify(body)).length > 49152) { setError(errorCopy('invalid_chat_messages')); return }
    submitting.current = true; setError(''); setCancelled(false); if (!continueRun) setDraft(''); setPartial(''); setContinuation(continueRun); setPhase(null); setStopping(false)
    unresolved.current = body; unresolvedPrompt.current = content
    if (!continueRun) setMessages(previous => retrying && previous.some(item => item.id === 'submitting') ? previous.map(item => item.id === 'submitting' ? { ...item, status: 'running' } : item) : [...previous, { role: 'user', content, screen, status: 'running', id: 'submitting' }])
    try {
      const value = await request('/chat', 'POST', body)
      if (version !== epoch.current) return
      unresolved.current = null
      remember(chatId); active.current = value.id; setMessages(previous => previous.map(v => v.id === 'submitting' ? { ...v, id: value.id } : v))
      setWaiting({ id: value.id, sequence: 0 }); void list().catch(() => {})
    } catch (failure) {
      if (version !== epoch.current) return
      // The POST response may be lost after commit. Resolve its conversation before offering another send.
      try { const value = await readChat(chatId); if (version === epoch.current && value.run?.request_key === body.idempotency_key) { unresolved.current = null; adopt(value); return } } catch {}
      if (failure.status && failure.status < 500) unresolved.current = null
      if (version === epoch.current) { setError(errorCopy(failure.message)); if (!continueRun) setDraft(content); setContinuation(null); setCancelled(!!continueRun); setMessages(previous => previous.map(v => v.id === 'submitting' ? { ...v, status: 'failed' } : v)) }
    } finally { if (version === epoch.current) submitting.current = false }
  }
  async function stop() {
    if (!active.current || stopping) return
    setStopping(true)
    try { await request(`/chat/${active.current}`, 'DELETE') }
    catch (failure) { setStopping(false); setError(errorCopy(failure.message)) }
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
    try { const value = await request(`/conversations/${chatId}?${new URLSearchParams(older)}`); if (version === epoch.current) { setMessages(previous => prependHistory(value.messages, previous)); setOlder(value.next) } }
    catch (failure) { if (version === epoch.current) setError(errorCopy(failure.message)) }
    finally { if (version === epoch.current) setLoading(false) }
  }
  const route = routes.find(value => value.provider === selected?.provider)
  const models = routes.flatMap(r => r.models.map(m => ({ ...m, id: modelKey(r.provider, m.id), sourceId: m.id, provider: r.provider, providerLabel: providerName(r.provider) })))
  const account = selected ? { ...route, provider: selected.provider, selection: selected, models: route?.models || [], ready: !!route?.ready && route.models.some(m => m.id === selected.model) } : null
  const pickerSelection = selected?.model ? { ...selected, model: modelKey(selected.provider, selected.model) } : { model: '', effort: null }
  function selectModel(value) { const model = models.find(m => m.id === value.model); if (model) choose({ provider: model.provider, model: model.sourceId, effort: value.effort }) }
  const continued = continuation && messages.at(-1)?.role === 'assistant' && messages.at(-1).id === continuation
  const visibleMessages = continued ? messages.map((item, index) => index === messages.length - 1 ? { ...item, content: item.content + partial, status: 'running' } : item) : messages
  return { account, loading: loading || restoring || agentsLoading, changing, messages: visibleMessages, draft, setDraft, error, cancelled, stopping, phase, hasPartial: !!partial, continueReply: event => void send(event, stoppedRun), busy: !!waiting || submitting.current, chatId, chatTitle, chats, next, historyOpen, setHistoryOpen, partial: continued ? '' : partial, older, loadOlder,
    newChat, openChat, send, stop, loadAccount, changeAccount, renameChat, deleteChat, models, pickerSelection, selectModel,
    loadMore: () => list(undefined, next).catch(f => setError(errorCopy(f.message))), retryConnection: () => { setError(''); setReconnect(v => v + 1) },
    agents, agent: agents.find(a => a.id === agentId) || builtinMentor, selectAgent, saveAgent, readAgent,
    reportError: failure => setError(errorCopy(failure.message)), say }
}
