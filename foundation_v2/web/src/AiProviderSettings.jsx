import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import ChatGptAccount from './ChatGptAccount.jsx'
import { aiErrorCopy } from './aiProvider.js'

const endpoint = '/api/v2/ai/assistant/account'
const providers = [{ value: 'local-gateway', label: 'CLIProxyAPI local', localize: false }, { value: 'chatgpt-web', label: 'ChatGPT Web', localize: false }]

export default function AiProviderSettings({ workspace, language }) {
  const en = language === 'en'
  const say = (vi, english) => en ? english : vi
  const [account, setAccount] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null), epoch = useRef(0), submitting = useRef(false)

  async function load(action, body) {
    if (submitting.current) return
    submitting.current = true
    request.current?.abort()
    const controller = new AbortController(), current = ++epoch.current
    request.current = controller
    setPending(true); setError('')
    try {
      const response = await fetch(`${endpoint}${action ? `/${action}` : ''}`, {
        method: action ? 'POST' : 'GET', signal: controller.signal,
        headers: { 'X-Workspace-Id': workspace, ...(action ? { 'Content-Type': 'application/json' } : {}) },
        ...(action ? { body: JSON.stringify(body || {}) } : {}),
      })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'ai_gateway_unavailable')
      if (current === epoch.current) {
        setAccount(value)
        window.dispatchEvent(new CustomEvent('wm-ai-provider-change', { detail: { workspace } }))
      }
    } catch (failure) {
      if (failure.name !== 'AbortError' && current === epoch.current) setError(aiErrorCopy(failure.message, en))
    } finally {
      if (current === epoch.current) { submitting.current = false; setPending(false) }
    }
  }
  useEffect(() => {
    submitting.current = false; setAccount(null)
    void load()
    return () => { epoch.current++; submitting.current = false; request.current?.abort() }
  }, [workspace])

  const gateway = account?.provider === 'local-gateway'
  const status = pending ? say('Đang đọc kết nối…', 'Checking connection…')
    : account?.status === 'catalog_ready' ? say('Đã tải model', 'Models loaded')
    : account?.status === 'empty' ? say('Chưa có model', 'No models available')
    : say('Chưa sẵn sàng', 'Not ready')

  return <>
    <section className="settings-chatgpt" aria-labelledby="ai-provider-title" data-testid="ai-provider-settings">
      <div className="settings-heading"><div><h2 id="ai-provider-title">AI</h2><p className="settings-note">{say('Kết nối dùng chung trên máy này.', 'Connection shared on this machine.')}</p></div>
        {gateway && <span className="settings-status" role="status">{status}</span>}</div>
      <div className="chatgpt-model-fields ai-provider-fields">
        <label><span>{say('Nhà cung cấp', 'Provider')}</span><FxSelect label={say('Nhà cung cấp AI', 'AI provider')} value={account?.provider || ''} disabled={pending || !account}
          options={providers} onChange={provider => void load('provider', { provider })} /></label>
        {gateway && account.models?.length > 0 && <label><span>Model</span><FxSelect label="Model AI" value={account.selection?.model || ''} disabled={pending}
          options={account.models.map(item => ({ value: item.id, label: item.name, localize: false }))}
          onChange={model => void load('selection', { model, effort: null })} /></label>}
      </div>
      {error && <p className="settings-message is-error" role="alert">{error}</p>}
      {gateway && <>
        <p className="settings-note">{account.endpoint}</p>
        {account.error && <p className="settings-message is-warn" role="status">{aiErrorCopy(account.error, en)}</p>}
        {account.status === 'empty' && <p className="settings-note">{say('Đăng nhập tài khoản qua CLIProxyAPI, rồi tải lại model.', 'Sign in through CLIProxyAPI, then refresh the models.')}</p>}
        {account.status === 'catalog_ready' && !account.selection && <p className="settings-note">{say('Chọn model để bắt đầu trò chuyện.', 'Select a model to start chatting.')}</p>}
        <div className="chatgpt-account-actions"><button type="button" disabled={pending} onClick={() => void load('refresh')}>{say('Tải lại model', 'Refresh models')}</button></div>
      </>}
      {!account && !pending && <button type="button" onClick={() => void load()}>{say('Thử lại', 'Retry')}</button>}
    </section>
    {account?.provider === 'chatgpt-web' && <ChatGptAccount workspace={workspace} />}
  </>
}
