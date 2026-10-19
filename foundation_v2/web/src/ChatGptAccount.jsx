import { useEffect, useRef, useState } from 'react'
import FxSelect from './FxSelect.jsx'

const endpoint = '/api/v2/ai/chatgpt/account'
const phases = {
  stopped: 'Chưa khởi động', disconnected: 'Chưa đăng nhập', saved: 'Có phiên đã lưu', connected: 'Đã xác minh đăng nhập',
  opening_browser: 'Đang mở Chrome…', waiting_for_browser: 'Đang chờ bạn đăng nhập', verifying: 'Đang xác minh…',
  testing: 'Đang kiểm tra model…', error: 'Cần kiểm tra kết nối',
}
const errors = {
  chatgpt_core_not_installed: 'Chưa cài ChatGPT Web core cho máy này. Xem hướng dẫn kết nối trong dự án.',
  chatgpt_port_in_use: 'Cổng kết nối đang được dùng bởi một tiến trình khác. Hãy dừng bản core chạy thủ công rồi thử lại.',
  chatgpt_busy: 'Kết nối đang xử lý một tác vụ. Chờ hoàn tất hoặc hủy tác vụ hiện tại.',
  login_failed: 'Chưa xác minh được đăng nhập. Hãy thử lại, đăng nhập trực tiếp trên ChatGPT rồi đóng cửa sổ Chrome riêng.',
  probe_failed: 'Model chưa trả lời thành công. Phiên đăng nhập, model hoặc hạn mức có thể đã thay đổi. Thử model khác hoặc đăng nhập lại.',
}
const effortNames = { low: 'Nhanh', medium: 'Vừa', high: 'Cao', xhigh: 'Rất cao', max: 'Pro', ultra: 'Ultra' }

export default function ChatGptAccount({ workspace }) {
  const [account, setAccount] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const request = useRef(null)
  const epoch = useRef(0)

  useEffect(() => {
    const current = ++epoch.current
    const controller = new AbortController()
    request.current = controller
    setAccount(null); setError(''); setLoading(true); setDenied(false); setPending(false)
    read(null, null, controller.signal).then(value => { if (current === epoch.current) setAccount(value) })
      .catch(failure => { if (failure.name !== 'AbortError' && current === epoch.current) showError(failure) })
      .finally(() => { if (current === epoch.current) setLoading(false) })
    return () => { epoch.current++; controller.abort(); request.current?.abort() }
  }, [workspace])

  useEffect(() => {
    if (!account?.operation || account.stale || pending) return
    const controller = new AbortController()
    const current = epoch.current
    // Poll only an active login/test; an idle Settings page does no background work.
    const timer = setTimeout(() => {
      read(null, null, controller.signal).then(value => { if (current === epoch.current) { setAccount(value); setError('') } })
        .catch(failure => { if (failure.name !== 'AbortError' && current === epoch.current) { showError(failure); setAccount(previous => ({ ...previous, stale: true })) } })
    }, 1500)
    return () => { clearTimeout(timer); controller.abort() }
  }, [account, pending, workspace])

  async function read(action, body, signal) {
    const response = await fetch(`${endpoint}${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET', signal,
      headers: { 'X-Workspace-Id': workspace, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      ...(action ? { body: JSON.stringify(body || {}) } : {}),
    })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) {
      const failure = new Error(errors[value.detail] || (response.status === 403 ? 'Workspace này không có quyền quản lý kết nối.' : 'Không đọc được kết nối ChatGPT. Hãy thử lại.'))
      failure.denied = response.status === 403
      throw failure
    }
    return value
  }
  function showError(failure) { setError(failure.message); setDenied(!!failure.denied) }
  async function act(action, body) {
    if (pending) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const current = ++epoch.current
    setPending(true); setError('')
    try {
      let value = await read(action, body, controller.signal)
      if (action === 'start' && !value.login_state_present) value = await read('login', {}, controller.signal)
      if (current === epoch.current) { setAccount(value); setDenied(false) }
    } catch (failure) { if (failure.name !== 'AbortError' && current === epoch.current) showError(failure) }
    finally { if (current === epoch.current) { setPending(false); setLoading(false) } }
  }
  const active = !!account?.operation
  const selection = account?.selection
  const model = account?.models?.find(item => item.id === selection?.model)
  const failure = error || errors[account?.error]
  const locked = pending || active || denied

  return <section className="settings-chatgpt" aria-labelledby="chatgpt-account-title" data-testid="chatgpt-account">
    <div className="settings-heading">
      <div><h2 id="chatgpt-account-title">ChatGPT</h2><p className="settings-note">Kết nối tài khoản ChatGPT của bạn để dùng AI trong MT5. Phiên đăng nhập riêng cho ứng dụng trên máy này.</p></div>
      <span className={`settings-status ${account?.test && !failure ? 'is-good' : ''}`} role="status">{loading ? 'Đang đọc kết nối…' : account?.stale ? 'Trạng thái chưa cập nhật' : phases[account?.status] || 'Chưa xác định'}</span>
    </div>
    {failure && <p className="settings-message is-error" role="alert">{failure}</p>}
    {account?.status === 'waiting_for_browser' && <p className="settings-note" role="status">Đăng nhập trên trang ChatGPT trong cửa sổ Chrome vừa mở, rồi đóng cửa sổ đó để hoàn tất. Ứng dụng không nhận mật khẩu của bạn.</p>}
    {account?.status === 'verifying' && <p className="settings-note">Đang kiểm tra phiên đăng nhập và các mức suy luận mà tài khoản hỗ trợ…</p>}
    {account?.login_state_present && <>
      <div className="chatgpt-model-fields">
        <label><span>Model</span><FxSelect label="Model ChatGPT" value={selection?.model || ''} disabled={locked}
          options={(account.models || []).map(item => ({ value: item.id, label: item.name, localize: false }))}
          onChange={value => { const next = account.models.find(item => item.id === value); act('selection', { model: value, effort: next.efforts.includes('high') ? 'high' : next.efforts[0] }) }} /></label>
        <label><span>Mức suy luận</span><FxSelect label="Mức suy luận ChatGPT" value={selection?.effort || ''} disabled={locked}
          options={(model?.efforts || []).map(value => ({ value, label: effortNames[value] || value }))}
          onChange={value => act('selection', { model: selection.model, effort: value })} /></label>
      </div>
      <p className="settings-note">Danh sách dựa trên khả năng ghi nhận khi đăng nhập. “Kiểm tra kết nối” gửi một câu thử ngắn tới model đã chọn.</p>
      {account.test && <p className="chatgpt-test-result" role="status">Đã nhận phản hồi · {account.models.find(item => item.id === account.test.model)?.name || account.test.model} · {effortNames[account.test.effort]} · {new Date(account.test.at).toLocaleTimeString('vi-VN')}</p>}
    </>}
    <div className="chatgpt-account-actions">
      {!loading && !active && <button type="button" className={!account?.login_state_present ? 'is-primary' : ''} disabled={pending || denied}
        onClick={() => act(account?.status === 'stopped' ? 'start' : 'login')}>{account?.login_state_present ? 'Đăng nhập lại' : 'Kết nối ChatGPT'}</button>}
      {account?.login_state_present && !active && <button type="button" className="is-primary" disabled={locked} onClick={() => act('probe')}>Kiểm tra kết nối</button>}
      {active && <button type="button" disabled={pending || denied} onClick={() => act('cancel')}>Hủy {account.operation.kind === 'login' ? 'đăng nhập' : 'kiểm tra'}</button>}
      {account?.login_state_present && !active && <button type="button" disabled={locked} onClick={() => act('disconnect')}>Ngắt kết nối</button>}
      <button type="button" disabled={pending} onClick={() => act(null)}>Làm mới</button>
    </div>
  </section>
}
