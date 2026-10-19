import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import './ai-chat.css'

export function AiSparkles() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m9 4 2.1 5.9L17 12l-5.9 2.1L9 20l-2.1-5.9L1 12l5.9-2.1L9 4Z" /><path d="m19 2 1.1 3.9L24 7l-3.9 1.1L19 12l-1.1-3.9L14 7l3.9-1.1L19 2Z" /></svg>
}

const base = '/api/v2/ai/chatgpt'
const effortNames = { low: ['Nhanh', 'Fast'], medium: ['Vừa', 'Medium'], high: ['Cao', 'High'], xhigh: ['Rất cao', 'Extra high'], max: ['Pro', 'Pro'], ultra: ['Ultra', 'Ultra'] }

export default function AiChatPanel({ workspace, open, modal, onClose, settingsHref, language }) {
  const en = language === 'en'
  const say = (vi, english) => en ? english : vi
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  const [waiting, setWaiting] = useState(null)
  const [cancelled, setCancelled] = useState(false)
  const panel = useRef(null)
  const composer = useRef(null)
  const scroll = useRef(null)
  const mounted = useRef(true)
  const active = useRef(null)
  const stopRequested = useRef(false)
  const submitting = useRef(false)

  async function call(path, method = 'GET', body, signal) {
    const response = await fetch(`${base}${path}`, {
      method, signal, headers: { 'X-Workspace-Id': workspace, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) { const failure = new Error(typeof value.detail === 'string' ? value.detail : 'chatgpt_unavailable'); failure.status = response.status; throw failure }
    return value
  }
  function errorCopy(code) {
    if (code === 'chatgpt_busy') return say('ChatGPT đang bận. Chờ tác vụ hiện tại hoàn tất rồi gửi lại.', 'ChatGPT is busy. Wait for the active task before sending again.')
    if (code === 'chatgpt_login_required') return say('Bạn cần đăng nhập ChatGPT trong Cài đặt.', 'Connect ChatGPT in Settings first.')
    if (code === 'chatgpt_turn_not_found') return say('Phản hồi không còn trên máy chủ. Cuộc trò chuyện vẫn ở đây; bạn có thể bắt đầu lại.', 'This response is no longer on the server. You can start a new chat.')
    if (code === 'chatgpt_timeout') return say('Đã hết thời gian chờ phản hồi. Kiểm tra kết nối trước khi gửi lại.', 'The response timed out. Check your connection before sending again.')
    if (code === 'workspace_access_denied' || code === 'trusted_identity_missing') return say('Workspace này chưa được cấp quyền dùng AI.', 'This workspace does not have AI access.')
    if (code === 'invalid_chat_messages') return say('Hội thoại vượt giới hạn hoặc nội dung không hợp lệ. Hãy mở cuộc trò chuyện mới.', 'The conversation exceeds the limit or contains invalid content. Start a new chat.')
    return say('Chưa nhận được phản hồi. Kiểm tra phiên đăng nhập, model và hạn mức trong Cài đặt. Ứng dụng không tự gửi lại.', 'No response received. Check your login, model and limits in Settings. The app does not resend automatically.')
  }
  async function loadAccount(signal) {
    setLoading(true); setError('')
    try { const value = await call('/account', 'GET', undefined, signal); if (!signal.aborted) setAccount(value) }
    catch (failure) { if (!signal.aborted) { setAccount(null); setError(errorCopy(failure.message)) } }
    finally { if (!signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; stopRequested.current = true
      if (active.current) void call(`/chat/${active.current}`, 'DELETE').catch(() => {})
    }
  }, [workspace])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void loadAccount(controller.signal)
    composer.current?.focus()
    return () => controller.abort()
  }, [open, workspace])
  useEffect(() => {
    if (!open) return
    function keydown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab' || !modal) return
      const elements = [...panel.current.querySelectorAll('button:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]')].filter(item => item.getClientRects().length)
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const element = panel.current
    element.addEventListener('keydown', keydown)
    // The close control is always focusable, including while disconnected.
    const focus = element.querySelector('textarea:not(:disabled)') || element.querySelector('[data-chat-close]')
    focus?.focus()
    return () => element.removeEventListener('keydown', keydown)
  }, [open, modal, onClose])
  useEffect(() => {
    if (open && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages, busy, open, error])

  function finish(value) {
    const id = active.current
    if (!id) return
    active.current = null; submitting.current = false
    setBusy(false); setWaiting(null)
    setMessages(previous => previous.map(item => item.id === id ? { ...item, status: value.status } : item)
      .concat(value.status === 'completed' ? [{ role: 'assistant', content: value.text, status: 'completed', selection: value.selection }] : []))
    if (value.status === 'failed') setError(errorCopy(value.error))
    setCancelled(value.status === 'cancelled')
  }
  useEffect(() => {
    if (!waiting) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const value = await call(`/chat/${waiting.id}`, 'GET', undefined, controller.signal)
        if (controller.signal.aborted || !mounted.current) return
        if (value.status === 'running') setWaiting({ id: waiting.id })
        else finish(value)
      } catch (failure) {
        if (controller.signal.aborted || !mounted.current) return
        // A failed status read must not leave an unowned provider request running.
        void call(`/chat/${waiting.id}`, 'DELETE').catch(() => {})
        finish({ status: 'failed', error: failure.message })
      }
    }, 1000)
    return () => { clearTimeout(timer); controller.abort() }
  }, [waiting, workspace])

  async function send(event) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || submitting.current || !account?.login_state_present || account.operation) return
    const history = messages.filter(item => item.status === 'completed').map(({ role, content }) => ({ role, content }))
    const payload = { messages: [...history, { role: 'user', content }] }
    if (payload.messages.length > 63 || new TextEncoder().encode(JSON.stringify(payload)).length > 49152) {
      setError(errorCopy('invalid_chat_messages')); return
    }
    submitting.current = true; stopRequested.current = false
    setBusy(true); setError(''); setCancelled(false); setDraft('')
    setMessages(previous => [...previous, { role: 'user', content, status: 'running', id: 'submitting' }])
    try {
      // Keep the POST alive until its ID is known so unmount can cancel the exact turn.
      const value = await call('/chat', 'POST', payload)
      active.current = value.id
      if (!mounted.current || stopRequested.current) {
        const result = await call(`/chat/${value.id}`, 'DELETE')
        if (mounted.current) { setMessages(previous => previous.map(item => item.id === 'submitting' ? { ...item, id: value.id } : item)); finish(result) }
        return
      }
      setMessages(previous => previous.map(item => item.id === 'submitting' ? { ...item, id: value.id } : item))
      setWaiting({ id: value.id })
    } catch (failure) {
      if (!mounted.current) return
      if (active.current) {
        const id = active.current
        setMessages(previous => previous.map(item => item.id === 'submitting' ? { ...item, id } : item))
        setError(errorCopy(failure.message)); setWaiting({ id })
        return
      }
      submitting.current = false
      setBusy(false); setError(errorCopy(failure.message))
      setMessages(previous => previous.map(item => item.id === 'submitting' ? { ...item, status: 'failed' } : item))
    }
  }
  async function stop() {
    stopRequested.current = true
    if (!active.current) return
    const id = active.current
    setWaiting(null)
    try { const value = await call(`/chat/${id}`, 'DELETE'); if (mounted.current) finish(value) }
    catch (failure) { if (mounted.current) { setError(errorCopy(failure.message)); setWaiting({ id }) } }
  }
  async function changeAccount(action, body) {
    if (changing || submitting.current) return
    setChanging(true); setError('')
    try { const value = await call(`/account/${action}`, 'POST', body || {}); if (mounted.current) setAccount(value) }
    catch (failure) { if (mounted.current) setError(errorCopy(failure.message)) }
    finally { if (mounted.current) setChanging(false) }
  }
  const connected = !!account?.login_state_present && !account?.operation && !!account?.selection
  const model = account?.models?.find(item => item.id === account?.selection?.model)
  return <aside id="wm-ai-chat" className="wm-ai-chat" ref={panel} hidden={!open} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-labelledby="wm-ai-title" data-testid="ai-chat">
    <header className="wm-ai-header">
      <span className="wm-ai-mark"><AiSparkles /></span><h2 id="wm-ai-title">WMREPLAY <span>AI</span></h2>
      <div className="wm-ai-header-actions">
        <button type="button" disabled={busy} onClick={() => { setMessages([]); setError(''); setCancelled(false); setDraft(''); composer.current?.focus() }} aria-label={say('Cuộc trò chuyện mới', 'New chat')} title={say('Cuộc trò chuyện mới', 'New chat')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
        <a href={settingsHref} onClick={onClose} aria-label={say('Cài đặt AI', 'AI settings')} title={say('Cài đặt AI', 'AI settings')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--fx-shell-bg)" /><circle cx="15" cy="17" r="3" fill="var(--fx-shell-bg)" /></svg></a>
        <button type="button" data-chat-close onClick={onClose} aria-label={say('Đóng chat AI', 'Close AI chat')} title={say('Đóng chat AI', 'Close AI chat')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
    </header>
    <div className="wm-ai-transcript" ref={scroll} role="log" aria-label={say('Nội dung trò chuyện', 'Conversation')} aria-live="polite" aria-relevant="additions text">
      {!messages.length && <div className="wm-ai-welcome"><span className="wm-ai-welcome-icon"><AiSparkles /></span><h3>{say('Cùng làm rõ ý tưởng của bạn', 'Let’s explore your ideas')}</h3><p>{say('Hỏi về một ý tưởng, nhờ giải thích hoặc cùng phác thảo hướng đi tiếp theo.', 'Ask a question, explore an idea or work through your next step.')}</p></div>}
      {messages.map((item, index) => <div className={`wm-ai-message is-${item.role}`} key={index}><span className="wm-ai-speaker">{item.role === 'user' ? say('Bạn', 'You') : 'WMREPLAY AI'}</span><div>{item.content}</div>{item.role === 'user' && ['failed', 'cancelled'].includes(item.status) && <small>{item.status === 'cancelled' ? say('Đã dừng', 'Stopped') : say('Chưa có phản hồi', 'No response')}</small>}</div>)}
      {busy && <p className="wm-ai-thinking" role="status"><span />{say('Đang chờ ChatGPT…', 'Waiting for ChatGPT…')}</p>}
    </div>
    <div className="wm-ai-bottom">
      {error && <p className="wm-ai-error" role="alert">{error}</p>}
      {cancelled && <p className="wm-ai-note" role="status">{say('Đã dừng chờ phản hồi.', 'Response stopped.')}</p>}
      {loading ? <p className="wm-ai-note" role="status">{say('Đang đọc kết nối…', 'Checking connection…')}</p> : !connected && <div className="wm-ai-connect"><p>{account?.operation ? say('Hoàn tất đăng nhập hoặc kiểm tra trong Cài đặt.', 'Finish login or the connection test in Settings.') : say('Kết nối ChatGPT để bắt đầu trò chuyện.', 'Connect ChatGPT to start chatting.')}</p>{account?.status === 'stopped' && <button type="button" disabled={changing} onClick={() => changeAccount('start')}>{say('Nạp kết nối đã lưu', 'Load saved connection')}</button>}<a href={settingsHref} onClick={onClose}>{say('Mở Cài đặt AI', 'Open AI settings')} ↗</a>{!account && <button type="button" disabled={loading} onClick={() => void loadAccount(new AbortController().signal)}>{say('Thử kết nối lại', 'Refresh connection')}</button>}</div>}
      <form className="wm-ai-composer" onSubmit={send}>
        <label className="wm-ai-sr" htmlFor="wm-ai-input">{say('Tin nhắn cho AI', 'Message AI')}</label>
        <textarea id="wm-ai-input" ref={composer} value={draft} onChange={event => setDraft(event.target.value)} disabled={!connected || changing} maxLength={16000} placeholder={say('Bạn muốn hỏi điều gì?', 'What would you like to ask?')} rows={3} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event) } }} />
        <div className="wm-ai-composer-footer">
          <div className="wm-ai-models">{connected ? <>
            <FxSelect label={say('Model AI', 'AI model')} value={account.selection.model} disabled={busy || changing} options={account.models.map(item => ({ value: item.id, label: item.name, localize: false }))} onChange={value => { const next = account.models.find(item => item.id === value); void changeAccount('selection', { model: value, effort: next.efforts.includes('high') ? 'high' : next.efforts[0] }) }} />
            <FxSelect label={say('Mức suy luận AI', 'AI reasoning effort')} value={account.selection.effort} disabled={busy || changing} options={(model?.efforts || []).map(value => ({ value, label: effortNames[value]?.[en ? 1 : 0] || value, localize: false }))} onChange={value => void changeAccount('selection', { model: account.selection.model, effort: value })} />
          </> : <span>ChatGPT Web</span>}</div>
          {busy ? <button type="button" className="wm-ai-send" onClick={stop} aria-label={say('Dừng phản hồi', 'Stop response')} title={say('Dừng phản hồi', 'Stop response')}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button> : <button type="submit" className="wm-ai-send" disabled={!draft.trim() || !connected || changing} aria-label={say('Gửi tin nhắn', 'Send message')} title={say('Gửi tin nhắn', 'Send message')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>}
        </div>
      </form>
      <p className="wm-ai-disclosure">{say('Chỉ gửi nội dung bạn nhập · Hội thoại lưu tạm trong trang này.', 'Only your messages are sent · Chat stays in this page temporarily.')}</p>
    </div>
  </aside>
}
