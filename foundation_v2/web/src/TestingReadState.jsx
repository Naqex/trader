import React from 'react'
import { useTestingLocale } from './testingLocale.jsx'

export function TestingSkeleton({ label = 'Đang tải dữ liệu…', rows = 4 }) {
  const { t } = useTestingLocale()
  return <div className="wm-skeleton" role="status" aria-label={t(label)} aria-busy="true"><span className="sr-only">{t(label)}</span>{Array.from({ length: rows }, (_, index) => <span key={index} aria-hidden="true" />)}</div>
}

export function ReadRecoveryStatus({ recovery }) {
  const { t } = useTestingLocale()
  if (!recovery) return null
  const text = recovery.offline ? t('Đang ngoại tuyến. Sẽ cập nhật khi có mạng.')
    : recovery.retryAt ? t('Tự thử lại sau {seconds} giây.', { seconds: recovery.seconds })
    : recovery.exhausted ? t('Chưa kết nối được. Sẽ kiểm tra lại khi bạn quay về ứng dụng.') : ''
  return text ? <small className="wm-read-recovery" aria-live="off" data-testid="read-recovery" data-retry-at={recovery.retryAt || undefined}>{text}</small> : null
}

export default function TestingReadState({ message, error = false, onRetry, recovery }) {
  const { t } = useTestingLocale()
  return <div className="wm-read-state" role={error ? 'alert' : 'status'}><p>{t(message)}</p><ReadRecoveryStatus recovery={recovery} />{onRetry && !recovery && <button type="button" className="fxa-button" onClick={onRetry}>{t('Thử lại')}</button>}</div>
}

export class TestingRouteBoundary extends React.Component {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() { return this.state.error ? this.props.fallback || <TestingReadState error message="Không tải được trang." /> : this.props.children }
}
