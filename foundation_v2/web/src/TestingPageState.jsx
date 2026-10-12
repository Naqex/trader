import TestingReadState, { ReadRecoveryStatus } from './TestingReadState.jsx'
import { useEffect, useRef, useState } from 'react'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './testing-page-state.css'

export function TestingWelcome({ onBacktest, propHref, backtestHref, preview = false }) {
  const { t } = useTestingLocale()
  const Backtest = backtestHref ? 'a' : 'button'
  return <section className="wm-viewport-state wm-testing-welcome" data-testid="testing-welcome">
    <div><h1>{t('Welcome to Testing')}</h1>
      <p>{t('Choose how you want to test your strategy — by building data, or testing under prop firm rules')}</p>
      <div className="wm-welcome-actions">
        <Backtest className="wm-welcome-action" href={backtestHref} onClick={onBacktest} disabled={preview} type={backtestHref ? undefined : 'button'}><TestingIcon kind="plus" /><strong>{t('Backtesting session')}</strong><span>{t('Build data to refine your strategy')}</span></Backtest>
        {preview ? <button className="wm-welcome-action" disabled type="button"><TestingIcon kind="trophy" /><strong>{t('Prop firm session')}</strong><span>{t('Test your strategy against prop firm rules')}</span></button>
          : <a className="wm-welcome-action" href={propHref}><TestingIcon kind="trophy" /><strong>{t('Prop firm session')}</strong><span>{t('Test your strategy against prop firm rules')}</span></a>}
      </div>
    </div>
  </section>
}

export function TestingEmptyState({ kind = 'sessions', viewport = false, onClear }) {
  const { t } = useTestingLocale()
  const states = {
    datasets: ['ledger', 'Chưa có dữ liệu đã tải', 'Nhập CSV hoặc chọn nguồn dữ liệu để bắt đầu tải lịch sử.'],
    'filtered-datasets': ['search', 'Không có dữ liệu khớp bộ lọc', 'Thử đổi từ khóa hoặc điều chỉnh bộ lọc để xem dữ liệu đã tải.'],
    sessions: ['ledger', 'Chưa có phiên', 'Tạo phiên đầu tiên tại Tổng quan để bắt đầu luyện tập.'],
    denied: ['lock', 'Không có quyền truy cập', 'Bạn chưa có quyền xem dữ liệu trong workspace này. Hãy kiểm tra tài khoản và quyền được cấp.'],
    'page-error': ['info', 'Không mở được trang này', 'Điều hướng vẫn hoạt động. Bạn có thể mở mục khác để tiếp tục.'],
    'filtered-sessions': ['search', 'Không có phiên khớp bộ lọc', 'Thử đổi từ khóa hoặc điều chỉnh bộ lọc để xem phiên.'],
    trades: ['ledger', 'Chưa có giao dịch đóng', 'Giao dịch đã đóng trong phạm vi đang chọn sẽ xuất hiện tại đây.'],
    'filtered-trades': ['search', 'Không có giao dịch khớp bộ lọc.', 'Thử đổi phiên hoặc điều chỉnh bộ lọc để xem giao dịch.'],
    incomplete: ['ledger', 'Chưa đủ dữ liệu giao dịch.', 'Nguồn mới đọc được một phần; chưa thể kết luận phạm vi này không có giao dịch.'],
  }
  const [icon, title, detail] = states[kind]
  return <section className={`wm-trades-empty${viewport ? ' wm-viewport-state' : ''}`} role={['denied', 'page-error'].includes(kind) ? 'alert' : 'status'} data-testid={['trades', 'filtered-trades', 'incomplete'].includes(kind) ? 'testing-trades-empty' : 'testing-empty-state'} data-empty-kind={kind}>
    <TestingIcon kind={icon} size={32} />
    <h2>{t(title)}</h2>
    <p>{t(detail)}</p>
    {onClear && <button className="fxa-button" type="button" onClick={onClear}>{t('Xóa bộ lọc')}</button>}
  </section>
}

export function TestingTradesEmpty({ filtered = false, incomplete = false }) {
  return <TestingEmptyState kind={incomplete ? 'incomplete' : filtered ? 'filtered-trades' : 'trades'} />
}

export function TestingPageSkeleton({ view = 'overview', label = 'Đang tải dữ liệu…' }) {
  const { t } = useTestingLocale()
  const table = ['trade', 'market-data'].includes(view)
  return <section className={`wm-viewport-state wm-page-skeleton is-${view}`} role="status" aria-label={t(label)} aria-busy="true">
    <span className="sr-only">{t(label)}</span>
    <div className="wm-skeleton-toolbar" aria-hidden="true"><i /><i /><i /></div>
    <div className={table ? 'wm-skeleton-table' : 'wm-skeleton-panels'} aria-hidden="true">
      {Array.from({ length: table ? 12 : view === 'overview' ? 9 : 6 }, (_, index) => <i key={index} />)}
    </div>
  </section>
}

export function TestingResourceNotice({ state, resource, onRetry, recovery }) {
  const messages = {
    error: `Không tải được ${resource}.`,
    refreshing: `Đang cập nhật ${resource}…`,
    stale: `Chưa cập nhật được ${resource}. Đang giữ bản đã đọc trước đó.`,
    partial: `${resource}: chỉ tính trên phần dữ liệu đã đọc được.`,
  }
  return messages[state] ? <div data-resource-state={state} aria-busy={state === 'refreshing'}><TestingReadState error={state === 'error'} message={messages[state]} onRetry={onRetry} recovery={recovery} /></div> : null
}

export function TestingResourceStatus({ state, resource, recovery, detail }) {
  const { t } = useTestingLocale()
  const element = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({})
  const hasMessage = Boolean(detail || ['refreshing', 'stale', 'partial'].includes(state))
  useEffect(() => {
    if (!open || !hasMessage) return
    const update = () => {
      const node = element.current
      if (!node?.open) return
      const anchor = node.querySelector('summary').getBoundingClientRect()
      const width = Math.min(280, window.innerWidth - 32)
      const height = node.querySelector('.wm-resource-status-detail').offsetHeight
      setPosition({ width, left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)), top: anchor.bottom + height + 8 > window.innerHeight ? Math.max(16, anchor.top - height - 8) : anchor.bottom + 8 })
    }
    const dismiss = event => { const node = element.current; if (node && !node.contains(event.target)) node.open = false }
    update()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    document.addEventListener('pointerdown', dismiss)
    return () => { window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); document.removeEventListener('pointerdown', dismiss) }
  }, [open, hasMessage])
  const messages = {
    refreshing: t('Đang cập nhật {resource}…', { resource: t(resource) }),
    stale: t('Chưa cập nhật được {resource}. Đang giữ bản đã đọc trước đó.', { resource: t(resource) }),
    partial: t('{resource}: chỉ tính trên phần dữ liệu đã đọc được.', { resource: t(resource) }),
  }
  const message = detail || messages[state]
  return <span className="wm-resource-status-slot">
    {message && <details ref={element} className={`wm-resource-status is-${state}`} data-resource-state={state} aria-busy={state === 'refreshing'} onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false }}>
      <summary aria-label={t(message)} title={t(message)}><TestingIcon kind={state === 'refreshing' ? 'history' : 'info'} size={16} /></summary>
      <div className="wm-resource-status-detail" style={position} role="status"><p>{t(message)}</p><ReadRecoveryStatus recovery={recovery} /></div>
    </details>}
  </span>
}
