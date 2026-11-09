import { useTestingLocale } from './testingLocale.jsx'
import { setTimezone, timezoneOptionsAt } from './timezone.js'
import FxSelect from './FxSelect.jsx'
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
const TradeLabelSettings = lazy(() => import('./TradeLabelSettings.jsx'))
import { buildWorkspaceHref } from './workspaceContext.js'
import { useFxReplayContext } from './FxReplayShell.jsx'
import './settings.css'

const NOTION_STATUS_URL = '/api/v2/connectors/notion/oauth/status'

function apiError(response, payload) {
  const error = new Error(String(payload?.detail || `HTTP ${response.status}`))
  error.kind = response.status === 403 ? 'denied' : response.status === 404 || response.status === 503 ? 'unavailable' : 'error'
  error.status = response.status
  return error
}

async function readJson(url, workspace, signal) {
  const response = await fetch(url, { method: 'GET', headers: { 'X-Workspace-Id': workspace }, signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(response, payload)
  return payload
}

function display(value, fallback = 'Chưa rõ') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function statusLabel(status) {
  return {
    signed_in: 'Đã đăng nhập',
    connected: 'Đã kết nối',
    disconnected: 'Chưa kết nối',
    reconnect_required: 'Cần kết nối lại',
    expired: 'Đã hết hạn',
    revoked: 'Đã thu hồi',
    unavailable: 'Chưa cấu hình',
    loading: 'Đang đọc…',
    error: 'Không đọc được',
  }[status] || display(status)
}

function statusTone(status) {
  if (status === 'connected') return 'is-good'
  if (status === 'disconnected' || status === 'unavailable') return 'is-muted'
  if (status === 'loading') return 'is-loading'
  return 'is-warn'
}

function SettingState({ state, testId, children }) {
  const { t } = useTestingLocale()
  if (state === 'loading') return <p className="settings-message is-loading" role="status" data-testid={testId}>{t('Đang tải cài đặt…')}</p>
  if (state === 'denied') return <p className="settings-message is-error" role="alert" data-testid={testId}>{t('Bạn không có quyền xem cài đặt trong workspace này.')}</p>
  if (state === 'unavailable') return <p className="settings-message is-warn" role="status" data-testid={testId}>{children || t('Thông tin chưa được cấu hình.')}</p>
  if (state === 'error') return <p className="settings-message is-error" role="alert" data-testid={testId}>{children || t('Không tải được trạng thái.')}</p>
  return null
}

function Fact({ label, value, tone = '' }) {
  const { t } = useTestingLocale()
  return (
    <div className="settings-fact">
      <dt>{t(label)}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  )
}

function StatusBadge({ status, children }) {
  const { t } = useTestingLocale()
  return <span className={`settings-status ${statusTone(status)}`}><i aria-hidden="true" />{t(children || statusLabel(status))}</span>
}

export default function SettingsWorkspace({ workspace = 'tenant-a', query }) {
  const { t, timezone } = useTestingLocale()
  const labelsTab = query?.get('settings_tab') === 'labels'
  const [timezoneDraft, setTimezoneDraft] = useState(timezone), [timezoneStatus, setTimezoneStatus] = useState('')
  useEffect(() => { setTimezoneDraft(timezone) }, [timezone])
  const { appearance, applyAppearance } = useFxReplayContext()
  const [appearanceDraft, setAppearanceDraft] = useState(() => appearance || { theme: 'dark', language: 'vi' })
  const [appearanceStatus, setAppearanceStatus] = useState('')
  useEffect(() => {
    if (appearance) setAppearanceDraft(appearance)
  }, [appearance?.theme, appearance?.language])
  const appearanceDirty = appearanceDraft.theme !== appearance?.theme || appearanceDraft.language !== appearance?.language
  function changeAppearance(key, value) {
    setAppearanceDraft((current) => ({ ...current, [key]: value }))
    setAppearanceStatus('')
  }
  function saveAppearance(event) {
    event.preventDefault()
    setAppearanceStatus(applyAppearance(appearanceDraft) ? 'saved' : 'volatile')
  }
  const [session, setSession] = useState({ status: 'loading', payload: null, error: null })
  const [notion, setNotion] = useState({ status: 'loading', payload: null, error: null })
  const [execution, setExecution] = useState({ status: 'loading', payload: null, error: null })
  const [reloadToken, setReloadToken] = useState(0)
  const requestSeq = useRef(0)

  useEffect(() => {
    const refresh = () => setReloadToken(token => token + 1)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [])

  useEffect(() => {
    const requestId = ++requestSeq.current
    const controller = new AbortController()
    setSession({ status: 'loading', payload: null, error: null })
    setNotion({ status: 'loading', payload: null, error: null })
    setExecution({ status: 'loading', payload: null, error: null })

    for (const [url, update] of [
      ['/api/v2/session/status', setSession],
      [NOTION_STATUS_URL, setNotion],
      ['/api/v2/execution/capabilities', setExecution],
    ]) {
      readJson(url, workspace, controller.signal)
        .then((payload) => { if (requestId === requestSeq.current) update({ status: 'ready', payload, error: null }) })
        .catch((error) => {
          if (error.name !== 'AbortError' && requestId === requestSeq.current) update({ status: error.kind || 'error', payload: null, error })
        })
    }
    return () => {
      controller.abort()
      if (requestId === requestSeq.current) requestSeq.current += 1
    }
  }, [reloadToken, workspace])

  const requestedReturn = query?.get('from')
  const returnView = ['replay', 'learn', 'research'].includes(requestedReturn) ? requestedReturn : 'replay'
  const sessionPayload = session.payload || {}
  const sessionSnapshot = sessionPayload.session || {}
  const identity = sessionPayload.identity || {}
  const notionPayload = notion.payload || {}
  const notionStatus = notion.status === 'ready' ? notionPayload.status || 'disconnected' : notion.status
  const canShowFacts = session.status === 'ready'
  const sessionVerified = canShowFacts && sessionSnapshot.status === 'signed_in' && sessionSnapshot.workspace_id === workspace
  const mode = sessionVerified ? display(sessionPayload.auth_mode, t('Chưa rõ')) : t('Chưa xác minh phiên')
  const nextLink = buildWorkspaceHref(returnView, workspace, query, {
    from: returnView === 'learn' ? query?.get('return_from') : null,
    job: query?.get('job'), start: query?.get('start'),
  })
  const returnLabel = requestedReturn === returnView ? t('Quay lại {page}', { page: returnView === 'replay' ? t('Luyện tập') : returnView === 'learn' ? t('Học tập') : t('Nghiên cứu') }) : t('Mở luyện tập')
  const learnFrom = returnView === 'learn' ? query?.get('return_from') : returnView
  const learnHref = buildWorkspaceHref('learn', workspace, query, { from: learnFrom, job: learnFrom === 'research' ? query?.get('job') : null, start: query?.get('start') })
  const brokerCapability = execution.status === 'ready' ? execution.payload?.broker_execution_capability : undefined
  const brokerStatus = brokerCapability === false ? t('Đã khóa') : brokerCapability === true ? t('API cho biết có quyền') : t('Chưa xác minh · Đã khóa trên giao diện')

  const permissions = [
    ['Phiên workspace', sessionVerified ? 'Đã xác minh trên máy này' : 'Chưa xác minh', sessionVerified ? 'is-good' : 'is-warn'],
    ['Gửi lệnh broker', brokerStatus, 'is-warn'],
    ['Dữ liệu kiểm định độc lập', 'Không cấp quyền tại đây', 'is-warn'],
    ['Ghi / xuất lên cloud', notion.status === 'ready' ? display(notionPayload.export_mode, t('Chưa rõ')) : t('Chưa xác minh'), 'is-warn', true],
  ]

  return (
    <main className="settings-shell wm-page" data-testid="settings-workspace">
      <header className="settings-topbar wm-page-header">
        <h1>{t('Cài đặt')}</h1>
        <div className="settings-topbar-actions">
          <a className="context-link" href={nextLink}>{returnLabel}</a>
          {returnView !== 'learn' && <a className="context-link" href={learnHref}>{t('Học tập')}</a>}
        </div>
      </header>

      <nav className="settings-tabs" aria-label={t('Cài đặt')}>
        <a href={buildWorkspaceHref('settings',workspace,query,{settings_tab:null})} aria-current={!labelsTab ? 'page' : undefined}>{t('Chung')}</a>
        <a href={buildWorkspaceHref('settings',workspace,query,{settings_tab:'labels'})} aria-current={labelsTab ? 'page' : undefined}>{t('Nhãn giao dịch')}</a>
      </nav>
      {labelsTab ? <Suspense fallback={<p role="status">{t('Đang đọc nhãn…')}</p>}><TradeLabelSettings key={workspace} workspace={workspace}/></Suspense> : <>
      {applyAppearance && <section className="settings-appearance" aria-labelledby="settings-appearance-title">
        <div className="settings-heading"><div><h2 id="settings-appearance-title">{t('Giao diện')}</h2><p className="settings-note">{t('Lưu tùy chọn trên trình duyệt này.')}</p></div></div>
        <form className="settings-appearance-form" onSubmit={saveAppearance}>
          <label><span>{t('Chế độ màu')}</span><select value={appearanceDraft.theme} onChange={(event) => changeAppearance('theme', event.target.value)}><option value="dark">{t('Tối')}</option><option value="light">{t('Sáng')}</option></select></label>
          <label><span>{t('Ngôn ngữ')}</span><select value={appearanceDraft.language} onChange={(event) => changeAppearance('language', event.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
          <div className="settings-appearance-actions">
            <button type="submit" disabled={!appearanceDirty && appearanceStatus !== 'volatile'}>{t('Lưu giao diện')}</button>
          <button type="button" disabled={!appearanceDirty} onClick={() => { setAppearanceDraft(appearance); setAppearanceStatus('') }}>{t('Hủy thay đổi')}</button>
          </div>
        </form>
        <p className="settings-note" role="status" data-testid="settings-appearance-status">{appearanceStatus === 'saved' ? t('Đã lưu giao diện trên trình duyệt này.') : appearanceStatus === 'volatile' ? t('Đã áp dụng trong phiên này. Trình duyệt đang chặn lưu tùy chọn; bạn có thể thử lưu lại.') : appearanceDirty ? t('Có thay đổi chưa lưu.') : ''}</p>
      </section>}

      <section className="settings-timezone" aria-label={t('Múi giờ')}>
        <form onSubmit={event => { event.preventDefault(); setTimezoneStatus(setTimezone(timezoneDraft) ? 'saved' : 'volatile') }}>
          <label className="settings-timezone-label">{t('Múi giờ')}</label>
          <FxSelect label="Múi giờ" value={timezoneDraft} options={timezoneOptionsAt()} localizeOptions={false} searchable onChange={value => { setTimezoneDraft(value); setTimezoneStatus('') }} />
          <button type="submit" className="wm-button" disabled={timezoneDraft === timezone}>{t('Lưu thay đổi')}</button>
          <span role="status">{timezoneStatus === 'saved' ? t('Đã lưu thay đổi.') : timezoneStatus === 'volatile' ? t('Đã áp dụng trong phiên này. Trình duyệt đang chặn lưu tùy chọn; bạn có thể thử lưu lại.') : ''}</span>
        </form>
      </section>
      <a className="context-link settings-ai-link" href={buildWorkspaceHref('ai', workspace, query, { area: 'ai', section: 'connections', demo: null })}>{t('Kết nối AI')} ↗</a>

      <section className="settings-context" aria-label={t('Ngữ cảnh hiện tại')}>
        <div><span>Workspace</span><strong>{workspace}</strong></div>
        <div><span>{t('Chế độ truy cập')}</span><strong>{mode}</strong></div>
        <div><span>{t('Bộ dữ liệu đã chọn')}</span><strong>{display(query?.get('dataset'), t('Chưa chọn'))}</strong></div>
        <div><span>{t('Quyền giao dịch broker')}</span><strong className="is-warn">{brokerStatus}</strong></div>
      </section>

      {session.status === 'error' && <SettingState state="error" testId="settings-session-error">{t('Không tải được phiên workspace.')}</SettingState>}
      {session.status === 'denied' && <SettingState state="denied" testId="settings-session-denied" />}
      {session.status === 'unavailable' && <SettingState state="unavailable" testId="settings-session-unavailable">{t('Workspace này chưa được cấu hình phiên truy cập.')}</SettingState>}

      <section className="settings-grid" aria-label={t('Thiết lập và quyền workspace')}>
        <article className="settings-section settings-session" aria-labelledby="settings-session-title">
          <div className="settings-heading">
            <div><span>{t('Phiên workspace')}</span><h2 id="settings-session-title">{t('Phiên truy cập hiện tại')}</h2></div>
            {canShowFacts && <StatusBadge status={sessionSnapshot.status}>{statusLabel(sessionSnapshot.status)}</StatusBadge>}
          </div>
          {session.status === 'loading' && <SettingState state="loading" testId="settings-session-facts-loading" />}
          {session.status === 'ready' && (
            <dl className="settings-facts" data-testid="settings-session-facts">
              <Fact label="Chế độ xác thực" value={display(sessionPayload.auth_mode, t('Chưa rõ'))} />
              <Fact label="Xác thực production" value={t(sessionPayload.production_auth === true ? 'Bật' : 'Tắt')} tone="is-warn" />
              <Fact label="Danh tính" value={display(identity.marker, t('Chưa rõ'))} />
              <Fact label="Nguồn danh tính" value={display(identity.source, t('Chưa rõ'))} />
              <Fact label="ID phiên" value={display(sessionSnapshot.session_id, t('Chưa rõ'))} />
              <Fact label="Thông tin xác thực" value={t(sessionPayload.credentials_present === true ? 'Có' : 'Không')} />
            </dl>
          )}
          <p className="settings-note">{t('Phiên trên máy này không cấp quyền giao dịch broker.')}</p>
        </article>

        <article className="settings-section" aria-labelledby="settings-permissions-title">
          <div className="settings-heading"><div><h2 id="settings-permissions-title">{t('Trạng thái truy cập')}</h2></div><StatusBadge status="is-warn">Chỉ đọc</StatusBadge></div>
          <ul className="settings-permissions" data-testid="settings-permissions">
            {permissions.map(([label, value, tone, raw]) => <li key={label}><span>{t(label)}</span><strong className={tone}>{raw ? value : t(value)}</strong></li>)}
          </ul>
          {execution.status !== 'ready' && <SettingState state={execution.status} testId="settings-execution-state">{t('Chưa xác minh được quyền giao dịch. Các thao tác vẫn bị khóa.')}</SettingState>}
          {execution.status === 'ready' && <dl className="settings-facts" data-testid="settings-execution-facts">{[['Đặt lệnh', 'place'], ['Sửa lệnh', 'modify'], ['Hủy lệnh', 'cancel'], ['Đóng lệnh', 'close']].map(([label, key]) => <Fact key={key} label={label} value={t(execution.payload?.[key] === true ? 'API cho biết có quyền' : execution.payload?.[key] === false ? 'Đã khóa' : 'Chưa xác minh')} tone="is-warn" />)}</dl>}
        </article>

        <article className="settings-section settings-connector" aria-labelledby="settings-connector-title">
          <div className="settings-heading">
            <div><h2 id="settings-connector-title">Notion</h2></div>
            <StatusBadge status={notionStatus}>{statusLabel(notionStatus)}</StatusBadge>
          </div>
          {notion.status === 'loading' && <SettingState state="loading" testId="settings-notion-loading" />}
          {notion.status === 'denied' && <SettingState state="denied" testId="settings-notion-denied" />}
          {notion.status === 'unavailable' && <SettingState state="unavailable" testId="settings-notion-unavailable">{t('Chưa cấu hình Notion. Bạn vẫn dùng được dữ liệu trên máy này.')}</SettingState>}
          {notion.status === 'error' && <SettingState state="error" testId="settings-notion-error">{t('Không tải được trạng thái Notion.')}</SettingState>}
          {notion.status === 'ready' && (
            <dl className="settings-facts" data-testid="settings-notion-facts">
              <Fact label="OAuth" value={t(notionPayload.oauth_available ? 'Đã cấu hình' : 'Chưa cấu hình')} />
              <Fact label="Chế độ xuất" value={display(notionPayload.export_mode, t('Chưa rõ'))} tone="is-warn" />
              <Fact label="Ghi lên cloud" value={t(notionPayload.cloud_write === true ? 'Bật' : 'Tắt')} tone="is-warn" />
              <Fact label="Danh tính / quyền truy cập" value={t(notionPayload.provider_identity_verified && notionPayload.provider_permission_verified ? 'Đã xác minh' : 'Chưa xác minh')} tone="is-warn" />
              <Fact label="Lưu token" value={display(notionPayload.token_persistence, t('Chưa rõ'))} />
            </dl>
          )}
          <p className="settings-note">{t('Trang này chỉ xem trạng thái kết nối, không đăng nhập hay gửi dữ liệu lên Notion.')}</p>
        </article>

        <article className="settings-section settings-local" aria-labelledby="settings-local-title">
          <div className="settings-heading"><div><h2 id="settings-local-title">{t('Nguồn dữ liệu')}</h2></div><StatusBadge status="connected">Trên máy này</StatusBadge></div>
          <dl className="settings-facts">
            <Fact label="Biểu đồ / replay" value={t('Bộ dữ liệu trên máy này')} />
            <Fact label="Khoảng dữ liệu đã xác minh" value={t('Chưa bật')} tone="is-warn" />
            <Fact label="Học tập" value={t('Khóa học trên máy · Chỉ đọc')} />
            <Fact label="Mô phỏng" value={t('Demo trên máy này')} />
          </dl>
        </article>
      </section>

      </> }
    </main>
  )
}
