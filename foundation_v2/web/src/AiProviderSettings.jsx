import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import ChatGptAccount from './ChatGptAccount.jsx'
import { aiErrorCopy, googleOAuthUrl } from './aiProvider.js'

const endpoint = '/api/v2/ai/assistant/account'
const providers = [{ value: 'local-gateway', label: 'CLIProxyAPI local', localize: false }, { value: 'chatgpt-web', label: 'ChatGPT Web', localize: false }]

export default function AiProviderSettings({ workspace, language }) {
  const en = language === 'en'
  const say = (vi, english) => en ? english : vi
  const [account, setAccount] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null), epoch = useRef(0), submitting = useRef(false)
  const oauthWindow = useRef(null)

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
      if (action === 'login') { oauthWindow.current?.close(); oauthWindow.current = null }
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
  const active = gateway && account?.operation?.kind === 'login'
  const managed = gateway && account?.runtime?.managed && !account.runtime.external
  const running = managed && account.runtime.running
  const authUrl = googleOAuthUrl(account?.operation?.auth_url)
  useEffect(() => {
    if (authUrl && oauthWindow.current && !oauthWindow.current.closed) {
      oauthWindow.current.location.replace(authUrl); oauthWindow.current = null
    } else if (!active && !pending && oauthWindow.current) {
      oauthWindow.current.close(); oauthWindow.current = null
    }
  }, [authUrl, active, pending])
  useEffect(() => {
    if (!active || pending || error) return
    const timer = setTimeout(() => void load(), 1500)
    return () => clearTimeout(timer)
  }, [active, pending, account, error])
  useEffect(() => () => { oauthWindow.current?.close(); oauthWindow.current = null }, [])

  function connectGoogle() {
    if (submitting.current || active) return
    // Open on the user's gesture so async OAuth startup is not blocked as a popup.
    oauthWindow.current = window.open('about:blank', '_blank')
    if (oauthWindow.current) {
      oauthWindow.current.opener = null
      oauthWindow.current.document.title = say('Đăng nhập Google', 'Google sign-in')
      oauthWindow.current.document.body.textContent = say('Đang mở trang đăng nhập Google…', 'Opening Google sign-in…')
    }
    void load('login')
  }
  const locked = pending || active
  const status = active ? authUrl ? say('Chờ đăng nhập Google', 'Waiting for Google sign-in') : say('Đang mở đăng nhập Google…', 'Preparing Google sign-in…')
    : pending ? say('Đang đọc kết nối…', 'Checking connection…')
    : managed && !running ? say('Đã tắt', 'Stopped')
    : account?.status === 'catalog_ready' ? say('Đã tải model', 'Models loaded')
    : account?.status === 'empty' ? say('Chưa có model', 'No models available')
    : say('Chưa sẵn sàng', 'Not ready')

  return <>
    <section className="settings-chatgpt" aria-labelledby="ai-provider-title" data-testid="ai-provider-settings">
      <div className="settings-heading"><div><h1 id="ai-provider-title">{say('Nhà cung cấp AI', 'AI provider')}</h1><p className="settings-note">{say('Kết nối dùng chung trên máy này.', 'Connection shared on this machine.')}</p></div>
        {gateway && <span className="settings-status" role="status">{status}</span>}</div>
      <div className="chatgpt-model-fields ai-provider-fields">
        <label><span>{say('Nhà cung cấp', 'Provider')}</span><FxSelect label={say('Nhà cung cấp AI', 'AI provider')} value={account?.provider || ''} disabled={locked || !account}
          options={providers} onChange={provider => void load('provider', { provider })} /></label>
        {gateway && account.models?.length > 0 && <label><span>Model</span><FxSelect label="Model AI" value={account.selection?.model || ''} disabled={locked}
          options={account.models.map(item => ({ value: item.id, label: item.name, localize: false }))}
          onChange={model => void load('selection', { model, effort: null })} /></label>}
      </div>
      {error && <p className="settings-message is-error" role="alert">{error}</p>}
      {gateway && <>
        {!managed && <p className="settings-note">{account.endpoint}</p>}
        {account.error && !(managed && !running && account.error === 'ai_gateway_unavailable') && <p className="settings-message is-warn" role="status">{aiErrorCopy(account.error, en)}</p>}
        {active && <p className="settings-note">{authUrl ? say('Hoàn tất đăng nhập trong tab Google vừa mở.', 'Complete sign-in in the Google tab.') : say('Đang chuẩn bị trang đăng nhập Google…', 'Preparing the Google sign-in page…')}{authUrl && <> <a className="context-link" href={authUrl} target="_blank" rel="noopener noreferrer">{say('Mở trang đăng nhập', 'Open sign-in page')} ↗</a></>}</p>}
        {!managed && account.status === 'empty' && <p className="settings-note">{say('Đăng nhập tài khoản qua CLIProxyAPI, rồi tải lại model.', 'Sign in through CLIProxyAPI, then refresh the models.')}</p>}
        {account.status === 'catalog_ready' && !account.selection && <p className="settings-note">{say('Chọn model để bắt đầu trò chuyện.', 'Select a model to start chatting.')}</p>}
        <div className="chatgpt-account-actions">
          {managed && (active ? <button type="button" className="wm-button" disabled={pending} onClick={() => void load('cancel')}>{say('Hủy đăng nhập', 'Cancel sign-in')}</button> : <>
            {!running && account.runtime.accounts > 0 && <button type="button" className="wm-button is-primary" disabled={pending} onClick={() => void load('start')}>{say('Bật kết nối', 'Start connection')}</button>}
            <button type="button" className={`wm-button ${!account.runtime.accounts ? 'is-primary' : ''}`} disabled={pending} onClick={connectGoogle}>{account.runtime.accounts ? say('Thêm tài khoản Google', 'Add Google account') : say('Kết nối Google', 'Connect Google')}</button>
            {running && <button type="button" className="wm-button" disabled={pending} onClick={() => void load('stop')}>{say('Tắt kết nối', 'Stop connection')}</button>}
          </>)}
          {(!active || error) && <button type="button" className="wm-button" disabled={pending} onClick={() => void load(active ? null : 'refresh')}>{active ? say('Thử lại', 'Retry') : say('Tải lại model', 'Refresh models')}</button>}
        </div>
      </>}
      {!account && !pending && <button type="button" className="wm-button" onClick={() => void load()}>{say('Thử lại', 'Retry')}</button>}
    </section>
    {account?.provider === 'chatgpt-web' && <ChatGptAccount workspace={workspace} language={language} />}
  </>
}
