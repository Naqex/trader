import { useEffect, useId, useRef } from 'react'
import ChartIcon from './ChartIcon.jsx'
import './PropRulesDialog.css'

function percentage(current, target) {
  if (current == null || target == null || Number(target) <= 0) return null
  return Number(current) / Number(target) * 100
}

function percentLabel(value) {
  return value == null ? '—' : `${Math.round(value * 100) / 100}%`
}

export default function PropRulesDialog({ open, rules, error, pendingAction, analyticsHref, retryHref, onClose, onTransition, onRetry, formatMoney, t }) {
  const dialog = useRef(null), opener = useRef(null), titleId = useId()
  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    dialog.current?.showModal()
    dialog.current?.querySelector('button:not(:disabled), a')?.focus()
    return () => {
      if (dialog.current?.open) dialog.current.close()
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }
  }, [open])

  if (!open || !rules) return null
  const terminalPass = rules.status === 'completed_pass', actionBusy = Boolean(pendingAction)
  const objectives = [
    { label: 'Profit target', current: rules.profitTarget.current, limit: rules.profitTarget.target, hit: rules.profitTarget.hit },
    { label: 'Max loss limit', current: rules.overallDrawdown.used, limit: rules.overallDrawdown.limit, breached: rules.overallDrawdown.breached },
    { label: 'Max daily loss limit', current: rules.dailyLoss.used, limit: rules.dailyLoss.limit, breached: rules.dailyLoss.breached },
  ]
  const policy = { must_be_flat: 'Cần đóng hết lệnh', carry: 'Giữ lệnh', close_by_simulator: 'Tự động đóng lệnh' }[rules.positionPolicy] || '—'

  return <dialog ref={dialog} className="prop-rules-dialog" data-testid="prop-rules-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!actionBusy) onClose() }} onClick={event => { if (event.target === dialog.current && !actionBusy) onClose() }}>
    <header className="prop-rules-dialog-header">
      <h2 id={titleId}>{t('Stats & Rules')}</h2>
      <button type="button" className="wm-dialog-close" aria-label={t('Đóng Prop Firm Rules')} disabled={actionBusy} onClick={onClose}><ChartIcon name="close" /></button>
    </header>
    <div className="prop-rules-dialog-body">
      {rules.evaluationBlocked && <p role="status">{t('Chưa đủ dữ liệu trong nến để đánh giá giới hạn equity. Số dư và vị thế vẫn được lưu; tiến độ challenge tạm chưa xác định.')}</p>}
      {rules.terminal && <section className={`prop-rules-outcome ${terminalPass ? 'is-pass' : 'is-fail'}`} role="status">
        <strong>{t(terminalPass ? 'Thử thách đã đạt mục tiêu.' : 'Thử thách đã kết thúc.')}</strong>
        <span>{t(terminalPass ? 'Bạn có thể xem báo cáo của lần thử này.' : 'Một giới hạn đã bị vi phạm hoặc thử thách đã hết hạn.')}</span>
      </section>}
      <section className="prop-rules-objectives" aria-label={t('Challenge rules')}>
        {objectives.map(objective => {
          const progress = percentage(objective.current, objective.limit)
          const remaining = objective.current == null || objective.limit == null ? null : Math.max(0, objective.limit - objective.current)
          return <article key={objective.label} className={objective.breached ? 'is-breach' : objective.hit ? 'is-good' : ''}>
            <h3>{t(objective.label)}</h3>
            <div className="prop-rules-objective-stat">
              <div><strong>{formatMoney(objective.current, rules.currency)}</strong><small>({percentLabel(percentage(objective.current, rules.initialBalance))})</small></div>
              <progress max="100" value={progress == null ? undefined : Math.max(0, Math.min(100, progress))} aria-label={t(objective.label)} />
              <div><span>{formatMoney(remaining, rules.currency)} {t('còn lại')}</span>{(objective.breached || objective.hit) && <span className="prop-rules-objective-state" aria-label={t(objective.breached ? 'Vi phạm' : 'Đạt')}>{objective.breached ? '!' : '✓'}</span>}</div>
            </div>
          </article>
        })}
      </section>
      <div className="prop-rules-challenge-heading"><h3>{t('Prop Firm Challenge')}</h3></div>
      <div className="prop-rules-detail-grid">
        <section className="prop-rules-detail-panel" aria-label={t('Profit and Drawdown')}>
          <h4>{t('Profit and Drawdown')}</h4>
          <dl>
            <div><dt>{t('Profit target')}</dt><dd><span className="prop-rules-value-pill">{percentLabel(percentage(rules.profitTarget.target, rules.initialBalance))}</span></dd></div>
            <div><dt>{t('Max loss limit')}</dt><dd><span className="prop-rules-value-pill">{percentLabel(percentage(rules.overallDrawdown.limit, rules.initialBalance))}</span><span className="prop-rules-value-pill">{t(rules.overallDrawdown.kind === 'trailing' ? 'Trailing' : 'Static')}</span></dd></div>
            <div><dt>{t('Max daily loss limit')}</dt><dd><span className="prop-rules-value-pill">{percentLabel(percentage(rules.dailyLoss.limit, rules.initialBalance))}</span></dd></div>
          </dl>
        </section>
        <section className="prop-rules-detail-panel prop-rules-restrictions" aria-label={t('Hạn chế giao dịch')}>
          <h4>{t('Hạn chế giao dịch')}</h4>
          <dl>
            {['Giao dịch khi có tin tức', 'Giữ lệnh qua đêm', 'Giữ lệnh qua giờ đóng cửa', 'Giữ lệnh qua cuối tuần'].map(label => <div key={label}><dt>{t(label)}</dt><dd>{t('Không giới hạn')}</dd></div>)}
            <div><dt>{t('Hedging (lệnh đối ứng)')}</dt><dd>{t('Không hỗ trợ')}</dd></div>
            <div><dt>{t('Khi đạt mục tiêu')}</dt><dd>{t(policy)}</dd></div>
          </dl>
        </section>
      </div>
      {error && <p className="prop-rules-error" role="alert">{t('Không đồng bộ được quy tắc:')} {error} {onRetry && <button type="button" className="wm-button" disabled={actionBusy} onClick={onRetry}>{t('Thử lại')}</button>}</p>}
    </div>
    {(rules.status === 'paused' || rules.terminal) && <footer className="prop-rules-dialog-footer">
      {rules.status === 'paused' && <button type="button" className="wm-button is-primary" disabled={actionBusy} onClick={() => onTransition('resume')}>{pendingAction === 'prop:resume' ? t('Đang tiếp tục…') : t('Tiếp tục')}</button>}
      {rules.terminal && retryHref && <a className="wm-button" href={retryHref}>{t('Thử thách mới')}</a>}
      {analyticsHref && <a className="wm-button" href={analyticsHref}>{t('Xem báo cáo')}</a>}
    </footer>}
  </dialog>
}
