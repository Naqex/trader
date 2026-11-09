import { ownerFetch } from './ownerSession.js'
import { displayDate, displayTime } from './dateFormat.js'
import { useEffect, useRef, useState } from 'react'
import LegacyModal from './LegacyModal.jsx'
import AppIcon from './AppIcon.jsx'
import { AiPageHeader, AiStatus } from './AiStudio.jsx'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { aiErrorCopy, googleOAuthUrl } from './aiProvider.js'

const providers = [
  { id: 'local-gateway', name: 'CLIProxyAPI', icon: 'layers', description: ['Dùng nhiều nhà cung cấp AI qua một cổng', 'Use several AI providers through one gateway'] },
  { id: 'chatgpt-web', name: 'ChatGPT Web', icon: 'comment', description: ['Dùng phiên đăng nhập ChatGPT của bạn', 'Use your ChatGPT sign-in'] },
]
const endpoint = '/api/v2/ai/assistant/connections'

function expectedGatewayStop(value) {
  return value?.runtime?.managed && !value.runtime.running && !value.runtime.external
    && (!value.error || ['ai_gateway_unavailable', 'ai_gateway_stopped'].includes(value.error))
}

export default function AiProviderSettings({ workspace, language }) {
  const { appearance, buildHref } = useFxReplayContext()
  const en = language === 'en', say = (vi, english) => en ? english : vi
  const [records, setRecords] = useState({}), [detail, setDetail] = useState(null), [pending, setPending] = useState(null)
  const requests = useRef(new Map()), generation = useRef(0), submitting = useRef(false), oauthWindow = useRef(null)

  async function read(provider, action, body = {}) {
    const version = generation.current
    requests.current.get(provider)?.abort()
    const controller = new AbortController()
    requests.current.set(provider, controller)
    setRecords(previous => ({ ...previous, [provider]: { ...previous[provider], loading: true, error: '' } }))
    try {
      const response = await ownerFetch(`${endpoint}/${provider}${action ? `/${action}` : ''}`, {
        method: action ? 'POST' : 'GET', signal: controller.signal,
        headers: { 'X-Workspace-Id': workspace, ...(action ? { 'Content-Type': 'application/json' } : {}) },
        ...(action ? { body: JSON.stringify(body) } : {}),
      })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'ai_transport_failed')
      if (version !== generation.current || controller.signal.aborted) return
      setRecords(previous => ({ ...previous, [provider]: { value, loading: false, error: '', updatedAt: new Date() } }))
      if (action) window.dispatchEvent(new CustomEvent('wm-ai-provider-change', { detail: { workspace } }))
      const url = googleOAuthUrl(value.operation?.auth_url)
      if (provider === 'local-gateway' && url && oauthWindow.current && !oauthWindow.current.closed) {
        oauthWindow.current.location.replace(url); oauthWindow.current = null
      } else if (provider === 'local-gateway' && !value.operation && oauthWindow.current) {
        oauthWindow.current.close(); oauthWindow.current = null
      }
    } catch (failure) {
      if (version !== generation.current || controller.signal.aborted) return
      setRecords(previous => ({ ...previous, [provider]: { ...previous[provider], loading: false, error: failure.message } }))
      if (action === 'login') { oauthWindow.current?.close(); oauthWindow.current = null }
    }
  }
  useEffect(() => {
    setRecords({}); setDetail(null); setPending(null); submitting.current = false
    providers.forEach(provider => void read(provider.id))
    const refresh = event => {
      if (event.detail?.workspace !== workspace || event.detail.source !== 'gateway-panel') return
      if (event.detail.error) {
        requests.current.get('local-gateway')?.abort()
        setRecords(previous => ({ ...previous, 'local-gateway': { ...previous['local-gateway'], loading: false, error: event.detail.error } }))
      } else void read('local-gateway')
    }
    window.addEventListener('wm-ai-provider-change', refresh)
    return () => {
      window.removeEventListener('wm-ai-provider-change', refresh)
      generation.current++; requests.current.forEach(controller => controller.abort())
      oauthWindow.current?.close(); oauthWindow.current = null
    }
  }, [workspace])
  const gateway = records['local-gateway'], web = records['chatgpt-web']
  useEffect(() => {
    // Only a user-started login/test polls. Inspecting a connection sends no inference.
    const active = providers.filter(({ id }) => records[id]?.value?.operation && !records[id]?.loading && !records[id]?.error)
    if (!active.length) return
    const timer = setTimeout(() => active.forEach(({ id }) => void read(id)), 1500)
    return () => clearTimeout(timer)
  }, [gateway, web])

  async function act(provider, action) {
    if (submitting.current) return
    submitting.current = true; setPending({ provider, action })
    if (provider === 'local-gateway' && action === 'login') {
      oauthWindow.current = window.open('about:blank', '_blank')
      if (oauthWindow.current) {
        oauthWindow.current.opener = null
        oauthWindow.current.document.title = say('Đăng nhập Google', 'Google sign-in')
        oauthWindow.current.document.body.textContent = say('Đang mở trang đăng nhập Google…', 'Opening Google sign-in…')
      }
    }
    const version = generation.current
    try { await read(provider, action) }
    finally { if (version === generation.current) { submitting.current = false; setPending(null) } }
  }
  function status(provider, record) {
    const value = record?.value
    if (record?.loading && !value) return say('Đang tải…', 'Loading…')
    if (record?.error) return say('Chưa cập nhật được', 'Update failed')
    if (!value) return say('Chưa có dữ liệu', 'No data')
    if (value.operation) return value.operation.kind === 'login' ? say('Chờ đăng nhập', 'Waiting for sign-in') : say('Đang kiểm tra…', 'Testing…')
    if (provider === 'local-gateway') {
      if (expectedGatewayStop(value)) return say('Đã tắt', 'Stopped')
      if (value.error) return say('Cần kiểm tra', 'Needs attention')
      return value.status === 'catalog_ready' ? say('Đã tải model', 'Models loaded') : value.status === 'empty' ? say('Chưa có model', 'No models') : say('Cần kiểm tra', 'Needs attention')
    }
    if (value.stale) return say('Trạng thái cũ', 'Out of date')
    if (value.error) return say('Cần kiểm tra', 'Needs attention')
    if (value.status === 'stopped') return say('Chưa khởi động', 'Not started')
    return value.login_state_present ? say('Đã đăng nhập', 'Signed in') : say('Chưa đăng nhập', 'Signed out')
  }
  function tone(provider, record) {
    const value = record?.value
    if (record?.error || value?.operation) return 'warning'
    if (!value) return 'muted'
    if (provider === 'local-gateway') {
      if (expectedGatewayStop(value)) return 'muted'
      if (value.error) return 'warning'
      return value.status === 'catalog_ready' ? 'positive' : 'warning'
    }
    if (value.stale || value.error) return 'warning'
    return value.status !== 'stopped' && value.login_state_present ? 'positive' : 'muted'
  }
  function stored(provider, value) {
    if (provider === 'local-gateway') return Number.isInteger(value?.runtime?.accounts) ? say(`${value.runtime.accounts} tài khoản đã lưu`, `${value.runtime.accounts} saved accounts`) : '-'
    return value?.login_state_present === true ? say('Có phiên đã lưu', 'Saved session') : value?.login_state_present === false ? say('Chưa có phiên', 'No saved session') : '-'
  }
  function actions(provider, record) {
    const value = record?.value
    if (!value) return <button className="wm-button" type="button" disabled={record?.loading || !!pending} onClick={() => void read(provider)}>{say('Thử lại', 'Retry')}</button>
    const locked = !!pending || record.loading, operation = value.operation
    const managed = provider === 'local-gateway' && value.runtime?.managed && !value.runtime.external
    if (operation) return <>
      <button type="button" className="wm-button" disabled={locked} onClick={() => void act(provider, 'cancel')}>{say('Hủy', 'Cancel')}</button>
      {record.error && <button type="button" className="wm-button" disabled={locked} onClick={() => void read(provider)}>{say('Cập nhật trạng thái', 'Refresh status')}</button>}
    </>
    if (provider === 'local-gateway') return <>
      {managed && !value.runtime.running && value.runtime.accounts > 0 && <button type="button" className="wm-button is-primary" disabled={locked} onClick={() => void act(provider, 'start')}>{say('Bật kết nối', 'Start connection')}</button>}
      {managed && <button type="button" className={`wm-button ${!value.runtime.accounts ? 'is-primary' : ''}`} disabled={locked} onClick={() => void act(provider, 'login')}>{value.runtime.accounts ? say('Thêm tài khoản Google', 'Add Google account') : say('Kết nối Google', 'Connect Google')}</button>}
      {managed && value.runtime.running && <button type="button" className="wm-button" disabled={locked} onClick={() => void act(provider, 'stop')}>{say('Tắt kết nối', 'Stop connection')}</button>}
      <button type="button" className="wm-button" disabled={locked} onClick={() => void act(provider, 'refresh')}>{say('Tải lại model', 'Refresh models')}</button>
      {managed && value.runtime.management_url === 'http://127.0.0.1:17852/management.html' && <a className="wm-button" href={buildHref('ai', { area: 'ai', section: 'gateway' })}>{say('Mở trang quản trị', 'Open management')}</a>}
    </>
    return <>
      <button type="button" className="wm-button is-primary" disabled={locked} onClick={() => void act(provider, value.status === 'stopped' ? 'start' : 'login')}>{value.status === 'stopped' ? say('Bật kết nối', 'Start connection') : value.login_state_present ? say('Đăng nhập lại', 'Sign in again') : say('Đăng nhập ChatGPT', 'Sign in to ChatGPT')}</button>
      {value.login_state_present && <button type="button" className="wm-button" disabled={locked || !value.selection} onClick={() => void act(provider, 'probe')}>{say('Kiểm tra phản hồi', 'Test response')}</button>}
      {value.login_state_present && <button type="button" className="wm-button" disabled={locked} onClick={() => void act(provider, 'disconnect')}>{say('Ngắt kết nối', 'Disconnect')}</button>}
    </>
  }
  const selected = providers.find(provider => provider.id === detail), record = records[detail], value = record?.value
  const connectionError = record?.error || (detail === 'local-gateway' && expectedGatewayStop(value) ? null : value?.error)
  const authUrl = googleOAuthUrl(value?.operation?.auth_url)
  return <section className="ai-connections" data-testid="ai-provider-settings" aria-labelledby="ai-connections-title">
    <AiPageHeader id="ai-connections-title" title={say('Kết nối', 'Connections')} description={say('Tài khoản và dịch vụ AI trên máy này.', 'AI accounts and services on this machine.')}>
      <button type="button" className="wm-button" disabled={!!pending || providers.some(p => records[p.id]?.loading || records[p.id]?.value?.operation)} onClick={() => providers.forEach(p => void read(p.id))}><AppIcon name="refresh" size={16} />{say('Làm mới', 'Refresh')}</button>
    </AiPageHeader>
    <ul className="ai-list ai-connection-list">
      {providers.map(provider => {
        const item = records[provider.id], account = item?.value
        return <li key={provider.id}><button type="button" className={`ai-list-row ai-connection-row${detail === provider.id ? ' is-selected' : ''}`} data-testid={`connection-${provider.id}`} aria-haspopup="dialog" aria-labelledby={`ai-connection-name-${provider.id}`} aria-describedby={`ai-connection-state-${provider.id}`} onClick={() => setDetail(provider.id)}>
          <AppIcon name={provider.icon} size={20} className="ai-provider-icon" />
          <span className="ai-connection-name"><strong id={`ai-connection-name-${provider.id}`}>{provider.name}</strong><small>{provider.description[en ? 1 : 0]}</small></span>
          <span className="ai-connection-state" id={`ai-connection-state-${provider.id}`}><AiStatus tone={tone(provider.id, item)} role="status">{status(provider.id, item)}</AiStatus><small>{stored(provider.id, account)}{Array.isArray(account?.models) && (account.models.length > 0 || account.status === 'empty') && <> · {account.models.length} model{en && account.models.length !== 1 ? 's' : ''}</>}</small></span>
          <AppIcon name="chevron-right" size={16} className="ai-row-chevron" />
        </button></li>
      })}
    </ul>
    {selected && <LegacyModal theme={appearance?.theme} label={selected.name} closeLabel={say('Đóng chi tiết kết nối', 'Close connection details')} onClose={() => setDetail(null)} className="ai-connection-drawer" overlayClassName="ai-connection-overlay">
      <div className="ai-connection-body">
        <div className="ai-detail-status"><AiStatus tone={tone(detail, record)} role="status">{status(detail, record)}</AiStatus>{record?.updatedAt && <small>{say('Cập nhật', 'Updated')} {displayTime(record.updatedAt)}</small>}</div>
        {connectionError && <p className="ai-inline-error" role="alert">{aiErrorCopy(connectionError, en)}</p>}
        <div className="ai-connection-actions">{actions(detail, record)}</div>
        {detail === 'local-gateway' && value?.runtime?.management_available && !value.runtime.running && <p className="ai-detail-note">{say('Bật kết nối để mở trang quản trị.', 'Start the connection to open management.')}</p>}
        {value?.operation?.kind === 'login' && <p className="ai-detail-note">{detail === 'local-gateway' ? say('Hoàn tất đăng nhập trong tab Google.', 'Complete sign-in in the Google tab.') : say('Đăng nhập trong cửa sổ Chrome vừa mở, rồi đóng cửa sổ đó.', 'Sign in in the separate Chrome window, then close it.')}{authUrl && <> <a href={authUrl} target="_blank" rel="noopener noreferrer">{say('Mở trang đăng nhập', 'Open sign-in page')} ↗</a></>}</p>}
        <section className="ai-detail-section"><h3>{say('Tài khoản', 'Accounts')}</h3><p>{stored(detail, value)}</p><dl className="ai-detail-values"><div><dt>{say('Hạn mức còn lại', 'Remaining quota')}</dt><dd>{say('Chưa có dữ liệu', 'No data')}</dd></div></dl></section>
        <section className="ai-detail-section"><h3>{say('Model khả dụng', 'Available models')}{value?.models?.length > 0 && <span className="ai-count">{value.models.length}</span>}</h3>
          {value?.models?.length ? <ul className="ai-catalog-list">{value.models.map(model => <li key={model.id}><span>{model.name}</span>{model.efforts?.length > 0 && <small>{model.efforts.join(' · ')}</small>}</li>)}</ul> : <p className="ai-detail-note">{record?.loading ? say('Đang tải…', 'Loading…') : say('Chưa tải được danh sách model.', 'No model catalog loaded.')}</p>}
        </section>
        <section className="ai-detail-section"><h3>{say('Kiểm tra phản hồi', 'Response test')}</h3>
          {value?.test ? <><p>{say('Đã nhận phản hồi', 'Response received')}</p><p className="ai-detail-note">{value.test.model} · {displayDate(value.test.at, { timeStyle: 'medium' })}</p></> : <p className="ai-detail-note">{say('Chưa có kết quả kiểm tra.', 'No test result recorded.')}</p>}
          {detail === 'chatgpt-web' && value?.login_state_present && <p className="ai-detail-note">{say('Kiểm tra sẽ gửi một câu thử tới model đã chọn.', 'Testing sends a short prompt to the selected model.')}{value.selection?.model && <> {value.selection.model}</>}</p>}
        </section>
        <details className="ai-detail-section ai-advanced"><summary>{say('Nâng cao', 'Advanced')}</summary><dl className="ai-detail-values">
          {value?.endpoint && <div><dt>Endpoint</dt><dd>{value.endpoint}</dd></div>}
          <div><dt>{say('Quản lý kết nối', 'Connection management')}</dt><dd>{detail === 'chatgpt-web' || value?.runtime?.managed && !value.runtime.external ? 'Naqex Trader' : say('Bên ngoài ứng dụng', 'External')}</dd></div>
          <div><dt>{say('Phạm vi', 'Scope')}</dt><dd>{say('Dùng chung trên máy này', 'Shared on this machine')}</dd></div>
          {detail === 'local-gateway' && value?.runtime?.management_version && <div><dt>{say('Trang quản trị', 'Management Center')}</dt><dd>{value.runtime.management_version}</dd></div>}
        </dl>{detail === 'local-gateway' && value?.runtime?.management_available && <p className="ai-detail-note">{say('Lần đầu đăng nhập trang quản trị, chạy lệnh này ở thư mục dự án rồi dán khóa:', 'For the first management sign-in, run this in the project folder and paste the key:')}<br /><code>.\scripts\ai_gateway.ps1 -Action CopyManagementKey</code></p>}</details>
      </div>
    </LegacyModal>}
  </section>
}
