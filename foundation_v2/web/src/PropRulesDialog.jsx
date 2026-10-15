import { useEffect, useId, useRef } from 'react'
import ChartIcon from './ChartIcon.jsx'
import './PropRulesDialog.css'

function percentage(current, target) {
  const value = Number(current)
  const limit = Number(target)
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return 0
  return Math.max(0, Math.min(100, value / limit * 100))
}

export default function PropRulesDialog({ open, rules, error, pendingAction, analyticsHref, retryHref, onClose, onTransition, formatMoney, statusLabel, t }) {
  const dialog = useRef(null)
  const opener = useRef(null)
  const titleId = useId()

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
  const terminalPass = rules.status === 'completed_pass'
  const terminalCopy = terminalPass ? t('Challenge đã đạt mục tiêu.') : t('Challenge đã kết thúc.')
  const profitPercent = percentage(rules.profitTarget.current, rules.profitTarget.target)
  const dailyPercent = percentage(rules.dailyLoss.used, rules.dailyLoss.limit)
  const overallPercent = percentage(rules.overallDrawdown.used, rules.overallDrawdown.limit)
  const actionBusy = Boolean(pendingAction)

  return <dialog ref={dialog} className="prop-rules-dialog" data-testid="prop-rules-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!actionBusy) onClose() }} onClick={event => { if (event.target === dialog.current && !actionBusy) onClose() }}>
    <header className="prop-rules-dialog-header">
      <div>
        <span className="prop-rules-eyebrow">{t('PROP FIRM')}</span>
        <h2 id={titleId}>{t('Prop Firm Rules')}</h2>
        <p>{t('Phase')} {rules.phaseIndex} · {statusLabel('prop_attempt', rules.status)}</p>
      </div>
      <button type="button" className="wm-dialog-close" aria-label={t('Đóng Prop Firm Rules')} disabled={actionBusy} onClick={onClose}><ChartIcon name="close" /></button>
    </header>

    <div className="prop-rules-dialog-body">
      {rules.terminal && <section className={`prop-rules-outcome ${terminalPass ? 'is-pass' : 'is-fail'}`} role="status">
        <strong>{terminalCopy}</strong>
        <span>{terminalPass ? t('Bạn có thể xem analytics của attempt này.') : t('Một giới hạn đã bị vi phạm hoặc challenge đã hết hạn.')}</span>
      </section>}

      <section className="prop-rules-balance" aria-label={t('Balance và Equity')}>
        <div><span>{t('Balance')}</span><strong>{formatMoney(rules.balance, rules.currency)}</strong></div>
        <div><span>{t('Equity')}</span><strong>{formatMoney(rules.equity, rules.currency)}</strong></div>
      </section>

      <section className="prop-rules-objectives" aria-label={t('Challenge rules')}>
        <article>
          <div><span>{t('Profit target')}</span><strong>{formatMoney(rules.profitTarget.current, rules.currency)} <small>/ {formatMoney(rules.profitTarget.target, rules.currency)}</small></strong></div>
          <progress max="100" value={profitPercent} aria-label={t('Tiến độ profit target')} />
          <em className={rules.profitTarget.hit ? 'is-good' : ''}>{rules.profitTarget.hit ? t('Đạt') : t('Đang theo dõi')}</em>
        </article>
        <article>
          <div><span>{t('Daily loss')}</span><strong>{formatMoney(rules.dailyLoss.used, rules.currency)} <small>/ {formatMoney(rules.dailyLoss.limit, rules.currency)}</small></strong></div>
          <progress max="100" value={dailyPercent} aria-label={t('Mức daily loss đã dùng')} />
          <em className={rules.dailyLoss.breached ? 'is-breach' : ''}>{rules.dailyLoss.breached ? t('Vi phạm') : t('Trong giới hạn')}</em>
        </article>
        <article>
          <div><span>{t('Overall drawdown')}{rules.overallDrawdown.kind === 'trailing' ? ` · ${t('trailing')}` : ''}</span><strong>{formatMoney(rules.overallDrawdown.used, rules.currency)} <small>/ {formatMoney(rules.overallDrawdown.limit, rules.currency)}</small></strong></div>
          <progress max="100" value={overallPercent} aria-label={t('Mức overall drawdown đã dùng')} />
          <em className={rules.overallDrawdown.breached ? 'is-breach' : ''}>{rules.overallDrawdown.breached ? t('Vi phạm') : t('Trong giới hạn')}</em>
        </article>
      </section>

      <dl className="prop-rules-facts">
        <div><dt>{t('Qualifying days')}</dt><dd>{rules.qualifyingDays} <small>/ {rules.minimumDays || '—'}</small></dd></div>
        <div><dt>{t('Elapsed')}</dt><dd>{rules.elapsedDays ?? '—'}{rules.maxDays ? ` / ${rules.maxDays} ${t('ngày')}` : ''}</dd></div>
      </dl>

      {error && <p className="prop-rules-error" role="alert">{t('Không đồng bộ được rule state:')} {error}</p>}
    </div>

    <footer className="prop-rules-dialog-footer">
      {rules.status === 'ready' && <button type="button" className="wm-button is-primary" disabled={actionBusy} onClick={() => onTransition('start')}>{pendingAction === 'prop:start' ? t('Đang bắt đầu…') : t('Bắt đầu challenge')}</button>}
      {rules.status === 'running' && <button type="button" className="wm-button" disabled={actionBusy} onClick={() => onTransition('pause')}>{pendingAction === 'prop:pause' ? t('Đang tạm dừng…') : t('Tạm dừng')}</button>}
      {rules.status === 'paused' && <button type="button" className="wm-button is-primary" disabled={actionBusy} onClick={() => onTransition('resume')}>{pendingAction === 'prop:resume' ? t('Đang tiếp tục…') : t('Tiếp tục')}</button>}
      {rules.terminal && retryHref && <a className="wm-button" href={retryHref}>{t('Thử challenge khác')}</a>}
      {analyticsHref && <a className="wm-button" href={analyticsHref}>{terminalPass ? t('Xem analytics / report') : t('Mở analytics')}</a>}
    </footer>
  </dialog>
}
