import { useEffect, useRef, useState } from 'react'
import AiModelPicker from './AiModelPicker.jsx'
import assistantPolicy from '../../api-rust/src/ai-assistant-policy.md?raw'
import './ai-chat.css'

export function AiSparkles() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m9 4 2.1 5.9L17 12l-5.9 2.1L9 20l-2.1-5.9L1 12l5.9-2.1L9 4Z" /><path d="m19 2 1.1 3.9L24 7l-3.9 1.1L19 12l-1.1-3.9L14 7l3.9-1.1L19 2Z" /></svg>
}

const base = '/api/v2/ai/chatgpt'
const screens = { unknown: ['Chưa xác định', 'Unknown'], overview: ['Tổng quan', 'Overview'], replay: ['Replay', 'Replay'], trade: ['Giao dịch', 'Trading'], analytics: ['Phân tích', 'Analytics'], playbook: ['Chiến lược', 'Strategies'], learn: ['Học tập', 'Learning'], settings: ['Cài đặt', 'Settings'], 'market-data': ['Dữ liệu', 'Market data'], prop: ['Prop firm', 'Prop firm'], journal: ['Nhật ký', 'Journal'], sessions: ['Phiên', 'Sessions'] }

function ChatIcon({ name }) {
  const paths = {
    history: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 4v16" /></>,
    new: <><path d="M13 5H5v14h14v-8M15 4l5 5M10 14l1-5 7-7 4 4-7 7-5 1Z" /></>,
    settings: <><path d="m9 4 1-2h4l1 2 2 1 2 0 2 4-1 2v2l1 2-2 4h-2l-2 1-1 2h-4l-1-2-2-1H5l-2-4 1-2v-2L3 9l2-4h2l2-1Z" /><circle cx="12" cy="12" r="3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    edit: <><path d="m14 4 6 6M4 20l2-7L17 2l5 5-11 11-7 2Z" /></>,
    delete: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    clock: <><path d="M3 4v5h5M3 9a9 9 0 1 1 0 6M12 6v6l4 2" /></>,
    strategies: <><path d="M4 4v16h16M7 15l4-5 4 3 5-8M16 5h4v4" /></>,
    chart: <><path d="M6 3v4m0 8v6M12 3v8m0 6v4M18 3v3m0 8v7" /><path d="M4 7h4v8H4zM10 11h4v6h-4zM16 6h4v8h-4z" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function AiChatPanel({ workspace, open, modal, onClose, settingsHref, language, screen = 'unknown' }) {
  const en = language === 'en'
  const say = (vi, english) => en ? english : vi
  const currentScreen = Object.hasOwn(screens, screen) ? screen : 'unknown'
  const screenName = key => (screens[key] || screens.unknown)[en ? 1 : 0]
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  const [waiting, setWaiting] = useState(null)
  const [cancelled, setCancelled] = useState(false)
  const [savedChats, setSavedChats] = useState([])
  const [chatId, setChatId] = useState(() => crypto.randomUUID())
  const [chatTitle, setChatTitle] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mentor, setMentor] = useState({ name: 'Mentor', description: '' })
  const [dialog, setDialog] = useState(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [resizeWidth, setResizeWidth] = useState(null)
  const dialogRef = useRef(null)
  const dialogTrigger = useRef(null)
  const drag = useRef(null)
  const resizeFrame = useRef(null)
  const panel = useRef(null)
  const composer = useRef(null)
  const scroll = useRef(null)
  const mounted = useRef(true)
  const active = useRef(null)
  const stopRequested = useRef(false)
  const submitting = useRef(false)

  const description = mentor.description || say('Cùng tìm hiểu trading, backtest và WMREPLAY.', 'Explore trading, backtesting and WMREPLAY.')
  const currentChat = { id: chatId, title: chatTitle || messages[0]?.content.slice(0, 90), messages, draft, error, cancelled }
  const chats = messages.length ? [currentChat, ...savedChats.filter(item => item.id !== chatId)] : savedChats
  function archiveCurrent() {
    if (messages.length) setSavedChats(previous => [currentChat, ...previous.filter(item => item.id !== chatId)])
  }
  function newChat() {
    if (submitting.current) return
    archiveCurrent(); setChatId(crypto.randomUUID()); setChatTitle(''); setMessages([]); setDraft(''); setError(''); setCancelled(false); setHistoryOpen(false)
    requestAnimationFrame(() => composer.current?.focus())
  }
  function openChat(item) {
    if (submitting.current) return
    archiveCurrent(); setChatId(item.id); setChatTitle(item.title); setMessages(item.messages); setDraft(item.draft); setError(item.error); setCancelled(item.cancelled); setHistoryOpen(false)
    requestAnimationFrame(() => composer.current?.focus())
  }
  function closeDialog() {
    setDialog(null)
    requestAnimationFrame(() => {
      if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus()
      else panel.current?.querySelector('[aria-pressed]')?.focus()
    })
  }
  function showDialog(value, trigger) { dialogTrigger.current = trigger; setDialog(value) }
  useEffect(() => {
    if (open && dialog) dialogRef.current?.showModal()
  }, [open, dialog?.type])
  function saveDialog(event) {
    event.preventDefault()
    if (dialog.type === 'settings') setMentor({ name: dialog.name.trim(), description: dialog.description.trim() })
    if (dialog.type === 'rename') {
      if (dialog.id === chatId) setChatTitle(dialog.name.trim())
      setSavedChats(previous => previous.map(item => item.id === dialog.id ? { ...item, title: dialog.name.trim() } : item))
    }
    if (dialog.type === 'delete') {
      setSavedChats(previous => previous.filter(item => item.id !== dialog.id))
      if (dialog.id === chatId) { setChatId(crypto.randomUUID()); setChatTitle(''); setMessages([]); setDraft(''); setError(''); setCancelled(false) }
    }
    closeDialog()
  }
  const maxWidth = Math.max(360, Math.min(760, viewportWidth - 620))
  function resize(next) {
    const width = Math.round(Math.max(360, Math.min(Math.min(760, window.innerWidth - 620), next)))
    cancelAnimationFrame(resizeFrame.current)
    resizeFrame.current = requestAnimationFrame(() => {
      panel.current?.closest('.fx-shell-story').style.setProperty('--wm-ai-width', `${width}px`)
      setResizeWidth(width)
    })
  }
  useEffect(() => {
    const update = () => {
      setViewportWidth(window.innerWidth)
      if (resizeWidth !== null && window.innerWidth > 1100) resize(resizeWidth)
    }
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('resize', update); cancelAnimationFrame(resizeFrame.current) }
  }, [resizeWidth])

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
    if (code === 'chatgpt_model_unavailable') return say('Câu hỏi chưa được gửi. Chưa xác minh được model trên ChatGPT Web. Kiểm tra Cài đặt AI.', 'Your question was not sent. The model could not be verified on ChatGPT Web. Check AI settings.')
    if (code === 'chatgpt_turn_not_found') return say('Phản hồi không còn trên máy chủ. Cuộc trò chuyện vẫn ở đây; bạn có thể bắt đầu lại.', 'This response is no longer on the server. You can start a new chat.')
    if (code === 'chatgpt_timeout') return say('Đã hết thời gian chờ phản hồi. Kiểm tra kết nối trước khi gửi lại.', 'The response timed out. Check your connection before sending again.')
    if (code === 'workspace_access_denied' || code === 'trusted_identity_missing') return say('Workspace này chưa được cấp quyền dùng AI.', 'This workspace does not have AI access.')
    if (code === 'invalid_chat_messages') return say('Hội thoại vượt giới hạn hoặc nội dung không hợp lệ. Hãy mở cuộc trò chuyện mới.', 'The conversation exceeds the limit or contains invalid content. Start a new chat.')
    if (code === 'invalid_chat_context') return say('Ngữ cảnh màn hình không hợp lệ. Hãy tải lại trang.', 'Invalid screen context. Reload the page.')
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
    const shell = panel.current?.closest('.fx-shell-story')
    return () => {
      mounted.current = false; stopRequested.current = true
      shell?.style.removeProperty('--wm-ai-width')
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
      const picker = panel.current?.querySelector('.wm-ai-selection:popover-open')
      if (picker && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.hidePopover(); picker.previousElementSibling?.focus(); return }
      const overlay = dialogRef.current?.open ? dialogRef.current : null
      if (!overlay && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab' || (!modal && !overlay)) return
      const elements = [...(overlay || panel.current).querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(item => item.getClientRects().length)
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const element = panel.current
    element.addEventListener('keydown', keydown)
    // The close control is always focusable, including while disconnected.
    const focus = element.querySelector('.wm-ai-body:not([hidden]) textarea:not(:disabled)') || element.querySelector('[data-chat-close]')
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
    const payload = { messages: [...history, { role: 'user', content }], context: { screen: currentScreen, locale: en ? 'en' : 'vi' } }
    if (payload.messages.length > 63 || new TextEncoder().encode(JSON.stringify(payload)).length > 49152) {
      setError(errorCopy('invalid_chat_messages')); return
    }
    submitting.current = true; stopRequested.current = false
    setBusy(true); setError(''); setCancelled(false); setDraft('')
    setMessages(previous => [...previous, { role: 'user', content, screen: currentScreen, status: 'running', id: 'submitting' }])
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
  useEffect(() => {
    if (open && connected && !historyOpen && !dialogRef.current?.open) composer.current?.focus()
  }, [open, connected])
  return <aside id="wm-ai-chat" className={`wm-ai-chat ${historyOpen ? 'is-history' : messages.length ? 'is-conversation' : 'is-welcome'}`} ref={panel} hidden={!open} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-labelledby="wm-ai-title" data-testid="ai-chat">
    {!modal && <div className="wm-ai-resize" role="separator" tabIndex={0} aria-label={say('Độ rộng chat AI', 'AI chat width')} aria-orientation="vertical" aria-valuemin={360} aria-valuemax={maxWidth} aria-valuenow={resizeWidth || Math.round(Math.min(600, Math.max(360, viewportWidth * .38)))}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: panel.current.getBoundingClientRect().width }; panel.current.dataset.resizing = 'true' }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX) }}
      onPointerUp={event => { drag.current = null; delete panel.current.dataset.resizing; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onLostPointerCapture={() => { drag.current = null; if (panel.current) delete panel.current.dataset.resizing }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); resize(event.key === 'Home' ? 360 : event.key === 'End' ? maxWidth : panel.current.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20)) }} />}
    <header className="wm-ai-header">
      <div className="wm-ai-header-actions">
        <button type="button" aria-pressed={historyOpen} onClick={() => setHistoryOpen(value => !value)} aria-label={say('Chat gần đây', 'Recent chats')} title={say('Chat gần đây', 'Recent chats')}><ChatIcon name="history" /></button>
        <button type="button" disabled={busy} aria-pressed={!historyOpen && !messages.length} onClick={newChat} aria-label={say('Cuộc trò chuyện mới', 'New chat')} title={say('Cuộc trò chuyện mới', 'New chat')}><ChatIcon name="new" /></button>
      </div>
      <div className="wm-ai-identity"><button type="button" onClick={event => showDialog({ type: 'settings', ...mentor }, event.currentTarget)} aria-label={say('Cài đặt trợ lý', 'Assistant settings')} title={say('Cài đặt trợ lý', 'Assistant settings')}><ChatIcon name="settings" /></button><h2 id="wm-ai-title">{mentor.name}</h2></div>
      <button type="button" className="wm-dialog-close" data-chat-close onClick={onClose} aria-label={say('Đóng chat AI', 'Close AI chat')} title={say('Đóng chat AI', 'Close AI chat')}><ChatIcon name="close" /></button>
    </header>
    {historyOpen && <section className="wm-ai-history" aria-labelledby="wm-ai-history-title">
      <h3 id="wm-ai-history-title"><ChatIcon name="clock" />{say('Chat gần đây', 'Recent chats')}</h3>
      {!chats.length && <div className="wm-ai-history-empty">
        <svg className="wm-ai-empty-sketch" viewBox="0 0 180 112" fill="none" aria-hidden="true">{[18, 46, 74].map((y, index) => <g key={y} opacity={index === 1 ? '.8' : '.4'}><rect x={index === 1 ? 10 : 24} y={y} width="142" height="22" rx="6" /><circle cx={index === 1 ? 23 : 37} cy={y + 11} r="3" /><path d={`M${index === 1 ? 34 : 48} ${y + 9}h66m-66 5h44`} /></g>)}</svg>
        <p>{say('Chưa có cuộc trò chuyện', 'No chats yet')}</p>
        <button type="button" onClick={newChat}><ChatIcon name="new" />{say('Chat mới', 'New chat')}</button>
      </div>}
      <ul>{chats.map(item => <li key={item.id}>
        <button type="button" className="wm-ai-history-open" disabled={busy} onClick={() => openChat(item)}><span>{item.title}</span><ChatIcon name="arrow" /></button>
        <button type="button" className="wm-ai-history-delete" disabled={busy} aria-label={`${say('Xóa chat', 'Delete chat')}: ${item.title}`} onClick={event => showDialog({ type: 'delete', id: item.id, name: item.title }, event.currentTarget)}><ChatIcon name="delete" /></button>
        <button type="button" className="wm-ai-history-edit" disabled={busy} aria-label={`${say('Đổi tên chat', 'Rename chat')}: ${item.title}`} onClick={event => showDialog({ type: 'rename', id: item.id, name: item.title }, event.currentTarget)}><ChatIcon name="edit" /></button>
      </li>)}</ul>
      {busy && <button className="wm-ai-history-return" type="button" onClick={() => setHistoryOpen(false)}>{say('Quay lại chat đang chờ', 'Return to active chat')} →</button>}
    </section>}
    <div className="wm-ai-body" hidden={historyOpen}>
    <div className="wm-ai-transcript" ref={scroll} role="log" aria-label={say('Nội dung trò chuyện', 'Conversation')} aria-live="polite" aria-relevant="additions text">
      {!messages.length && <div className="wm-ai-welcome"><span className="wm-ai-welcome-icon"><AiSparkles /></span><h3>{mentor.name}</h3><p>{description}</p></div>}
      {messages.map((item, index) => <div className={`wm-ai-message is-${item.role}`} key={index}><span className="wm-ai-speaker">{item.role === 'user' ? `${say('Bạn', 'You')} · ${screenName(item.screen)}` : mentor.name}</span><div>{item.content}</div>{item.role === 'user' && ['failed', 'cancelled'].includes(item.status) && <small>{item.status === 'cancelled' ? say('Đã dừng', 'Stopped') : say('Chưa có phản hồi', 'No response')}</small>}</div>)}
      {busy && <p className="wm-ai-thinking" role="status"><span />{say('Đang chờ ChatGPT…', 'Waiting for ChatGPT…')}</p>}
    </div>
    <div className="wm-ai-bottom">
      {error && <p className="wm-ai-error" role="alert">{error}</p>}
      {cancelled && <p className="wm-ai-note" role="status">{say('Đã dừng chờ phản hồi.', 'Response stopped.')}</p>}
      {loading ? <p className="wm-ai-note" role="status">{say('Đang đọc kết nối…', 'Checking connection…')}</p> : !connected && <div className="wm-ai-connect"><p>{account?.operation ? say('Hoàn tất đăng nhập hoặc kiểm tra trong Cài đặt.', 'Finish login or the connection test in Settings.') : say('Kết nối ChatGPT để bắt đầu trò chuyện.', 'Connect ChatGPT to start chatting.')}</p>{account?.status === 'stopped' && <button type="button" disabled={changing} onClick={() => changeAccount('start')}>{say('Nạp kết nối đã lưu', 'Load saved connection')}</button>}<a href={settingsHref} onClick={onClose}>{say('Mở Cài đặt AI', 'Open AI settings')} ↗</a>{!account && <button type="button" disabled={loading} onClick={() => void loadAccount(new AbortController().signal)}>{say('Thử kết nối lại', 'Refresh connection')}</button>}</div>}
      <form className="wm-ai-composer" onSubmit={send}>
        <label className="wm-ai-sr" htmlFor="wm-ai-input">{say('Tin nhắn cho AI', 'Message AI')}</label>
        <textarea id="wm-ai-input" ref={composer} value={draft} onChange={event => setDraft(event.target.value)} disabled={!connected || changing} maxLength={16000} placeholder={say('Hỏi Mentor…', 'Ask Mentor…')} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event) } }} />
        <div className="wm-ai-composer-footer">
          <div className="wm-ai-tools">
            <span title={say('Chiến lược · Chưa kết nối với chat AI', 'Strategies · Not connected to AI chat yet')}><button type="button" disabled aria-label={say('Chiến lược · Sắp có', 'Strategies · Coming soon')}><ChatIcon name="strategies" /></button></span>
            <span title={say('Phân tích biểu đồ · Chưa kết nối dữ liệu phiên', 'Analyze your chart · Session data is not connected yet')}><button type="button" disabled aria-label={say('Phân tích biểu đồ · Sắp có', 'Analyze chart · Coming soon')}><ChatIcon name="chart" /></button></span>
          </div>
          <div className="wm-ai-models">{connected ? <AiModelPicker models={account.models} selection={account.selection} disabled={busy} saving={changing} active={open && !historyOpen} en={en} onSelect={value => changeAccount('selection', value)} /> : <span>ChatGPT Web</span>}</div>
          {busy ? <button type="button" className="wm-ai-send" onClick={stop} aria-label={say('Dừng phản hồi', 'Stop response')} title={say('Dừng phản hồi', 'Stop response')}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button> : <button type="submit" className="wm-ai-send" disabled={!draft.trim() || !connected || changing} aria-label={say('Gửi tin nhắn', 'Send message')} title={say('Gửi tin nhắn', 'Send message')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>}
        </div>
      </form>
    </div>
    </div>
    {open && dialog && <dialog className="wm-ai-settings" ref={dialogRef} aria-labelledby="wm-ai-dialog-title" onCancel={event => { event.preventDefault(); closeDialog() }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog() } }}>
      <form onSubmit={saveDialog}>
        <header><h3 id="wm-ai-dialog-title">{dialog.type === 'settings' ? say('Cài đặt trợ lý', 'Assistant settings') : dialog.type === 'rename' ? say('Đổi tên chat', 'Rename chat') : say('Xóa cuộc trò chuyện?', 'Delete conversation?')}</h3><button type="button" className="wm-dialog-close" onClick={closeDialog} aria-label={say('Đóng hộp thoại', 'Close dialog')}><ChatIcon name="close" /></button></header>
        {dialog.type === 'delete' ? <p className="wm-ai-delete-copy">{dialog.name}</p> : <label>{say('Tên', 'Name')}<input autoFocus required maxLength={dialog.type === 'settings' ? 40 : 90} value={dialog.name} onChange={event => setDialog(value => ({ ...value, name: event.target.value }))} /></label>}
        {dialog.type === 'settings' && <>
          <label>{say('Mô tả', 'Description')}<textarea rows={2} maxLength={240} placeholder={description} value={dialog.description} onChange={event => setDialog(value => ({ ...value, description: event.target.value }))} /></label>
          <label>{say('Hướng dẫn trả lời', 'Instructions')}<textarea className="wm-ai-instructions" rows={7} readOnly value={assistantPolicy} aria-describedby="wm-ai-policy-note" /></label>
          <p id="wm-ai-policy-note">{say('Chỉ tùy chỉnh hiển thị. Chat lưu trong tab, chưa đọc biểu đồ hay tài khoản.', 'Display settings only. Chats stay in this tab; no chart or account data is read.')}</p>
          <a href={settingsHref} onClick={() => { setDialog(null); onClose() }}>{say('Kết nối ChatGPT và chọn model', 'ChatGPT connection and model settings')} ↗</a>
        </>}
        <footer><button type="button" onClick={closeDialog}>{say('Hủy', 'Cancel')}</button><button className={dialog.type === 'delete' ? 'is-danger' : 'is-primary'} type="submit" disabled={dialog.type !== 'delete' && !dialog.name.trim()}>{dialog.type === 'delete' ? say('Xóa', 'Delete') : say('Xác nhận', 'Confirm')}</button></footer>
      </form>
    </dialog>}
  </aside>
}
