import { useEffect, useRef, useState } from 'react'
import AiModelPicker from './AiModelPicker.jsx'
import AiAgentPicker from './AiAgentPicker.jsx'
import AiAgentFields from './AiAgentFields.jsx'
import AiSourcePicker, { AiSourceProvenance } from './AiSourcePicker.jsx'
import { aiErrorCopy } from './aiProvider.js'
import AiSparkles from './AiSparkles.jsx'
import useAiChat from './useAiChat.js'

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
    plus: <path d="M12 5v14M5 12h14" />,
    clock: <><path d="M3 4v5h5M3 9a9 9 0 1 1 0 6M12 6v6l4 2" /></>,
    strategies: <><path d="M4 4v16h16M7 15l4-5 4 3 5-8M16 5h4v4" /></>,
    chart: <><path d="M6 3v4m0 8v6M12 3v8m0 6v4M18 3v3m0 8v7" /><path d="M4 7h4v8H4zM10 11h4v6h-4zM16 6h4v8h-4z" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function AiChatPanel({ workspace, open, modal, standalone = false, onClose, settingsHref, language, screen = 'unknown' }) {
  const en = language === 'en'
  const say = (vi, english) => en ? english : vi
  const currentScreen = Object.hasOwn(screens, screen) ? screen : 'unknown'
  const [source, setSource] = useState(null), [sourceOpen, setSourceOpen] = useState(false)
  useEffect(() => { setSource(null); setSourceOpen(false) }, [workspace])
  const screenName = key => (screens[key] || screens.unknown)[en ? 1 : 0]
  const { account, loading, changing, messages, draft, setDraft, error, cancelled, busy, stopping, phase, hasPartial, continueReply, chatId, chats, next,
    historyOpen, setHistoryOpen, partial, older, loadOlder, newChat, openChat, send, stop, changeAccount, loadAccount,
    renameChat, deleteChat, models, pickerSelection, selectModel, loadMore, retryConnection, reportError,
    agents, agent: mentor, selectAgent, saveAgent, readAgent } = useAiChat({ workspace, open, en, screen: currentScreen, source })
  const [dialog, setDialog] = useState(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [resizeWidth, setResizeWidth] = useState(null)
  const dialogRef = useRef(null)
  const dialogTrigger = useRef(null)
  const drag = useRef(null)
  const resizeFrame = useRef(null)
  const panel = useRef(null)
  const composer = useRef(null)
  const scroll = useRef(null)
  const restoringScroll = useRef(false)
  const description = mentor.description || say('Cùng tìm hiểu trading, backtest và Naqex Trader.', 'Explore trading, backtesting and Naqex Trader.')
  function closeDialog() {
    if (savingRef.current) return
    setDialog(null)
    requestAnimationFrame(() => {
      if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus()
      else (panel.current?.querySelector('.wm-ai-agent-trigger') || panel.current?.querySelector('[aria-pressed]'))?.focus()
    })
  }
  function showDialog(value, trigger) { dialogTrigger.current = trigger; setDialog(value) }
  useEffect(() => { setDialog(null) }, [workspace])
  function createAgent(trigger) { showDialog({ type: 'create', name: '', description: '', instructions: '', knowledge: [] }, trigger) }
  async function editAgent(trigger) {
    try {
      const value = mentor.builtin ? { ...mentor, description, instructions: '', knowledge: [] } : await readAgent(mentor.id)
      showDialog({ ...value, type: 'settings' }, trigger)
    } catch (failure) { reportError(failure) }
  }
  useEffect(() => {
    if (open && dialog) dialogRef.current?.showModal()
  }, [open, dialog?.type])
  async function saveDialog(event) {
    event.preventDefault()
    if (savingRef.current || dialog.reading) return
    savingRef.current = true; setSaving(true)
    try {
      if (dialog.type === 'create' || (dialog.type === 'settings' && !dialog.builtin)) await saveAgent(dialog, dialog.type === 'create')
      if (dialog.type === 'rename') await renameChat(dialog.id, dialog.name.trim())
      if (dialog.type === 'delete') await deleteChat(dialog.id)
      savingRef.current = false; closeDialog()
    } catch (failure) { setDialog(value => value && ({ ...value, error: aiErrorCopy(failure.message, en) })) }
    finally { savingRef.current = false; setSaving(false) }
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

  useEffect(() => {
    if (!open) return
    function keydown(event) {
      const picker = panel.current?.querySelector('.wm-ai-selection:popover-open, .wm-ai-agent-menu:popover-open')
      if (picker && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.hidePopover(); picker.previousElementSibling?.focus(); return }
      const overlay = dialogRef.current?.open ? dialogRef.current : null
      if (!standalone && !overlay && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose() }
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
  }, [open, modal, onClose, standalone])
  useEffect(() => {
    if (open && scroll.current && !restoringScroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages, busy, open, error])
  useEffect(() => {
    if (open && !historyOpen && !loading) composer.current?.focus()
  }, [chatId, historyOpen, loading, open])
  async function showOlder() {
    const element=scroll.current, height=element.scrollHeight, top=element.scrollTop
    restoringScroll.current=true
    await loadOlder()
    requestAnimationFrame(()=>{element.scrollTop=top+element.scrollHeight-height;restoringScroll.current=false})
  }

  const connected = !!(account?.ready ?? account?.login_state_present) && !account?.operation && !!account?.selection
  useEffect(() => {
    if (open && connected && !loading && !historyOpen && !dialogRef.current?.open) composer.current?.focus()
  }, [open, connected, loading])
  const Title = standalone ? 'h1' : 'h2'
  return <aside id="wm-ai-chat" className={`wm-ai-chat ${standalone ? 'is-standalone' : ''} ${historyOpen ? 'is-history' : messages.length ? 'is-conversation' : 'is-welcome'}`} ref={panel} hidden={!open} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-labelledby="wm-ai-title" data-testid="ai-chat">
    {!modal && !standalone && <div className="wm-ai-resize" role="separator" tabIndex={0} aria-label={say('Độ rộng chat AI', 'AI chat width')} aria-orientation="vertical" aria-valuemin={360} aria-valuemax={maxWidth} aria-valuenow={resizeWidth || Math.round(Math.min(600, Math.max(360, viewportWidth * .38)))}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: panel.current.getBoundingClientRect().width }; panel.current.dataset.resizing = 'true' }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX) }}
      onPointerUp={event => { drag.current = null; delete panel.current.dataset.resizing; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onLostPointerCapture={() => { drag.current = null; if (panel.current) delete panel.current.dataset.resizing }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); resize(event.key === 'Home' ? 360 : event.key === 'End' ? maxWidth : panel.current.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20)) }} />}
    <header className="wm-ai-header">
      <div className="wm-ai-header-actions">
        <button type="button" aria-pressed={historyOpen} onClick={() => setHistoryOpen(value => !value)} aria-label={say('Chat gần đây', 'Recent chats')} data-tooltip={say('Chat gần đây', 'Recent chats')}><ChatIcon name="history" /></button>
        <button type="button" aria-pressed={!historyOpen && !messages.length} onClick={newChat} aria-label={say('Cuộc trò chuyện mới', 'New chat')} data-tooltip={say('Cuộc trò chuyện mới', 'New chat')}><ChatIcon name="new" /></button>
      </div>
      <div className="wm-ai-identity"><button type="button" disabled={loading} onClick={event => void editAgent(event.currentTarget)} aria-label={say('Cài đặt trợ lý', 'Assistant settings')} data-tooltip={say('Cài đặt trợ lý', 'Assistant settings')}><ChatIcon name="settings" /></button><Title id="wm-ai-title">{agents.length > 1 ? <AiAgentPicker agents={agents} agent={mentor} active={open && !dialog} en={en} onSelect={selectAgent} onCreate={createAgent} /> : mentor.name}</Title></div>
      {standalone ? <a className="wm-ai-settings-link" href={settingsHref}>{say('Kết nối', 'Connections')}</a> : <button type="button" className="wm-dialog-close" data-chat-close onClick={onClose} aria-label={say('Đóng chat AI', 'Close AI chat')} data-tooltip={say('Đóng chat AI', 'Close AI chat')}><ChatIcon name="close" /></button>}
    </header>
    {agents.length === 1 && !historyOpen && <div className="wm-ai-create"><button type="button" disabled={loading} onClick={event => createAgent(event.currentTarget)}><ChatIcon name="plus" />{say('Tạo agent', 'Create agent')}</button></div>}
    {historyOpen && <section className="wm-ai-history" aria-labelledby="wm-ai-history-title">
      <h3 id="wm-ai-history-title"><ChatIcon name="clock" />{say('Chat gần đây', 'Recent chats')}</h3>
      {!chats.length && <div className="wm-ai-history-empty">
        <svg className="wm-ai-empty-sketch" viewBox="0 0 180 112" fill="none" aria-hidden="true">{[18, 46, 74].map((y, index) => <g key={y} opacity={index === 1 ? '.8' : '.4'}><rect x={index === 1 ? 10 : 24} y={y} width="142" height="22" rx="6" /><circle cx={index === 1 ? 23 : 37} cy={y + 11} r="3" /><path d={`M${index === 1 ? 34 : 48} ${y + 9}h66m-66 5h44`} /></g>)}</svg>
        <p>{say('Chưa có cuộc trò chuyện', 'No chats yet')}</p>
        <button type="button" onClick={newChat}><ChatIcon name="new" />{say('Chat mới', 'New chat')}</button>
      </div>}
      <ul>{chats.map(item => <li key={item.id}>
        <button type="button" className="wm-ai-history-open" onClick={() => openChat(item)}><span>{item.title}</span><ChatIcon name="arrow" /></button>
        <button type="button" className="wm-ai-history-delete" disabled={busy} aria-label={`${say('Xóa chat', 'Delete chat')}: ${item.title}`} onClick={event => showDialog({ type: 'delete', id: item.id, name: item.title }, event.currentTarget)}><ChatIcon name="delete" /></button>
        <button type="button" className="wm-ai-history-edit" disabled={busy} aria-label={`${say('Đổi tên chat', 'Rename chat')}: ${item.title}`} onClick={event => showDialog({ type: 'rename', id: item.id, name: item.title }, event.currentTarget)}><ChatIcon name="edit" /></button>
      </li>)}</ul>
      {next && <button type="button" onClick={loadMore}>{say('Xem thêm', 'Load more')}</button>}
      {busy && <button className="wm-ai-history-return" type="button" onClick={() => setHistoryOpen(false)}>{say('Quay lại chat đang chờ', 'Return to active chat')} →</button>}
    </section>}
    <div className="wm-ai-body" hidden={historyOpen}>
    <div className="wm-ai-transcript" ref={scroll} role="log" aria-label={say('Nội dung trò chuyện', 'Conversation')} aria-live="polite" aria-relevant="additions text">
      {older && <button type="button" disabled={loading} onClick={showOlder}>{say('Tin nhắn trước', 'Earlier messages')}</button>}
      {!messages.length && <div className="wm-ai-welcome"><span className="wm-ai-welcome-icon"><AiSparkles /></span><h3>{mentor.name}</h3><p>{description}</p></div>}
      {messages.map((item, index) => <div className={`wm-ai-message is-${item.role}`} key={index}><span className="wm-ai-speaker">{item.role === 'user' ? `${say('Bạn', 'You')} · ${screenName(item.screen)}` : mentor.name}</span><div>{item.content}</div>{item.role === 'assistant' && <AiSourceProvenance source={item.grounding?.source} en={en} />}{item.role === 'assistant' && ['failed', 'cancelled', 'interrupted'].includes(item.status) && <small>{item.status === 'cancelled' ? item.content ? say('Đã dừng', 'Stopped') : item.phase === 'thinking' ? say('Đã dừng khi đang suy nghĩ.', 'Stopped while thinking.') : say('Đã dừng trước khi có câu trả lời.', 'Stopped before a response arrived.') : say('Phản hồi bị gián đoạn', 'Response interrupted')}</small>}</div>)}
      {partial && <div className="wm-ai-message is-assistant"><span className="wm-ai-speaker">{mentor.name}</span><div>{partial}</div></div>}
      {busy && (!hasPartial || stopping) && <p className="wm-ai-thinking" role="status"><span />{stopping ? say('Đang dừng…', 'Stopping…') : phase === 'thinking' ? say('Đang suy nghĩ…', 'Thinking…') : say('Đang chờ phản hồi…', 'Waiting for a response…')}</p>}
    </div>
    <div className="wm-ai-bottom">
      {error && <p className="wm-ai-error" role="alert">{error}{busy && <button type="button" onClick={retryConnection}>{say('Kết nối lại', 'Reconnect')}</button>}</p>}
      {cancelled && !busy && <div className="wm-ai-continue"><button type="button" className="wm-button" disabled={!connected || loading || changing} onClick={continueReply}>{say('Tiếp tục', 'Continue')}</button></div>}
      {loading ? <p className="wm-ai-note" role="status">{say('Đang đọc kết nối…', 'Checking connection…')}</p> : !connected && <div className="wm-ai-connect"><p>{account?.operation ? say('Hoàn tất đăng nhập hoặc kiểm tra trong Cài đặt.', 'Finish login or the connection test in Settings.') : say('Chọn kết nối và model trong Cài đặt AI.', 'Select a connection and model in AI settings.')}</p>{account?.status === 'stopped' && <button type="button" disabled={changing} onClick={() => changeAccount('start')}>{say('Nạp kết nối đã lưu', 'Load saved connection')}</button>}<a href={settingsHref} onClick={onClose}>{say('Mở Cài đặt AI', 'Open AI settings')} ↗</a>{!account && <button type="button" disabled={loading} onClick={() => void loadAccount(new AbortController().signal)}>{say('Thử kết nối lại', 'Refresh connection')}</button>}</div>}
      <form className="wm-ai-composer" onSubmit={send}>
        {sourceOpen && <AiSourcePicker workspace={workspace} value={source} onChange={setSource} en={en} disabled={busy || loading} />}
        <label className="wm-ai-sr" htmlFor="wm-ai-input">{say('Tin nhắn cho AI', 'Message AI')}</label>
        <textarea id="wm-ai-input" ref={composer} value={draft} onChange={event => setDraft(event.target.value)} disabled={!connected || changing || loading} maxLength={16000} placeholder={say(`Hỏi ${mentor.name}…`, `Ask ${mentor.name}…`)} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event) } }} />
        <div className="wm-ai-composer-footer">
          <div className="wm-ai-tools"><button type="button" className="wm-ai-source-toggle" aria-expanded={sourceOpen} aria-label={say('Nguồn dữ liệu', 'Data source')} data-tooltip={say('Nguồn dữ liệu chỉ đọc', 'Read-only data source')} onClick={() => setSourceOpen(value => !value)}><ChatIcon name="chart" />{source && <span aria-hidden="true">•</span>}</button></div>
          <div className="wm-ai-models">{models.length ? <AiModelPicker models={models} selection={pickerSelection} disabled={loading} saving={changing} active={open && !historyOpen} en={en} onSelect={selectModel} /> : <span>{account?.provider === 'local-gateway' ? 'CLIProxyAPI local' : 'ChatGPT Web'}</span>}</div>
          {busy ? <button type="button" className="wm-ai-send" disabled={stopping} onClick={stop} aria-label={say('Dừng phản hồi', 'Stop response')} data-tooltip={say('Dừng phản hồi', 'Stop response')}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button> : <button type="submit" className="wm-ai-send" disabled={!draft.trim() || !connected || changing || loading} aria-label={say('Gửi tin nhắn', 'Send message')} data-tooltip={say('Gửi tin nhắn', 'Send message')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>}
        </div>
      </form>
    </div>
    </div>
    {open && dialog && <dialog className="wm-ai-settings" ref={dialogRef} aria-labelledby="wm-ai-dialog-title" onCancel={event => { event.preventDefault(); closeDialog() }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog() } }}>
      <form onSubmit={saveDialog}>
        <header><h3 id="wm-ai-dialog-title">{dialog.type === 'create' ? say('Tạo agent', 'Create agent') : dialog.type === 'settings' ? say('Cài đặt trợ lý', 'Assistant settings') : dialog.type === 'rename' ? say('Đổi tên chat', 'Rename chat') : say('Xóa cuộc trò chuyện?', 'Delete conversation?')}</h3><button type="button" className="wm-dialog-close" disabled={saving} onClick={closeDialog} aria-label={say('Đóng hộp thoại', 'Close dialog')}><ChatIcon name="close" /></button></header>
        {['create', 'settings'].includes(dialog.type) ? <AiAgentFields workspace={workspace} value={dialog} onChange={setDialog} en={en} disabled={saving} /> : dialog.type === 'delete' ? <p className="wm-ai-delete-copy">{dialog.name}</p> : <label>{say('Tên', 'Name')}<input autoFocus required maxLength={90} disabled={saving} value={dialog.name} onChange={event => setDialog(value => ({ ...value, name: event.target.value }))} /></label>}
        {dialog.error && <p className="wm-ai-error" role="alert">{dialog.error}</p>}
        <footer><button type="button" disabled={saving} onClick={closeDialog}>{dialog.builtin ? say('Đóng', 'Close') : say('Hủy', 'Cancel')}</button>{!dialog.builtin && <button className={dialog.type === 'delete' ? 'is-danger' : 'is-primary'} type="submit" disabled={saving || dialog.reading || (dialog.type !== 'delete' && !dialog.name.trim())}>{saving ? say('Đang lưu…', 'Saving…') : dialog.type === 'create' ? say('Tạo', 'Create') : dialog.type === 'delete' ? say('Xóa', 'Delete') : say('Lưu', 'Save')}</button>}</footer>
      </form>
    </dialog>}
  </aside>
}
