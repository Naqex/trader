import { useId } from 'react'
import ProjectDateInput from './ProjectDateInput.jsx'
import { displayDate } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import { randomSessionDate, sessionDateValue, sessionDefaultEnd, sessionEndShortcut, sessionPeriodState } from './sessionPeriod.js'
import { FieldError, fieldValidationProps } from './FormValidation.jsx'

export default function SessionPeriodFields({ range, value, onChange, disabled, error }) {
  const { t } = useTestingLocale(), id = useId()
  const state = sessionPeriodState(value, range)
  const update = patch => onChange({ ...value, ...patch })
  if (!range?.valid) return <div className="quick-session-period-error" role="alert">{t('Các tài sản không có khoảng thời gian chung để replay.')}</div>
  const min = sessionDateValue(range.min), max = sessionDateValue(range.max)
  const invalidStart = !value.start || state.start === null || state.start < range.min || state.start >= range.max
  const periodError = error || (value.start && !state.valid ? 'Chọn ngày bắt đầu và kết thúc trong khoảng dữ liệu; ngày kết thúc phải sau ngày bắt đầu.' : '')
  const errorId = `${id}-error`
  const randomDate = () => { const start = randomSessionDate(range, value); if (start) update({ start }) }
  return <div className="quick-session-field quick-session-period">
    <span id={`${id}-title`}>{t('Thời gian phiên')} <span className="quick-session-required" aria-hidden="true">*</span></span>
    <section className="quick-session-period-body" aria-labelledby={`${id}-title`}>
      <div className="quick-session-period-grid">
        <div className="quick-session-period-field">
          <label htmlFor={`${id}-start`}>{t('Ngày bắt đầu')}</label>
          <div className="quick-session-period-start">
            <ProjectDateInput id={`${id}-start`} type="datetime-local" required step="60" min={min} max={max} value={value.start} disabled={disabled} aria-label={t('Ngày bắt đầu phiên (UTC)')} {...fieldValidationProps(periodError && invalidStart, errorId)} aria-describedby={`${id}-hint${periodError && invalidStart ? ` ${errorId}` : ''}`} onChange={event => update({ start: event.target.value })} />
            <button className="quick-session-period-random" type="button" aria-label={t('Chọn ngày bắt đầu ngẫu nhiên')} title={t('Chọn ngày bắt đầu ngẫu nhiên')} disabled={disabled || randomSessionDate(range, value, () => 0) === null} onClick={randomDate}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="15" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="15" r="1" fill="currentColor" stroke="none" /></svg>
            </button>
          </div>
        </div>
        <div className="quick-session-period-field">
          <div className="quick-session-period-end-label"><label htmlFor={`${id}-end`}>{t('Ngày kết thúc')}</label>
            <div className="quick-session-period-shortcuts" aria-label={t('Thời lượng phiên')}>
              {[[ 'day', '+1D'], ['week', '+1W'], ['month', '+1M']].map(([unit, label]) => {
                const timestamp = sessionEndShortcut(state.start, unit)
                return <button key={unit} type="button" disabled={disabled || state.start === null || timestamp > range.max} aria-label={t(unit === 'day' ? 'Kết thúc sau 1 ngày' : unit === 'week' ? 'Kết thúc sau 1 tuần' : 'Kết thúc sau 1 tháng')} onClick={() => update({ endMode: 'custom', end: sessionDateValue(timestamp) })}>{label}</button>
              })}
            </div>
          </div>
          {value.endMode === 'custom' ? <ProjectDateInput id={`${id}-end`} type="datetime-local" todayTime="end-of-day" required step="60" min={value.start || min} max={max} value={value.end} disabled={disabled} aria-label={t('Ngày kết thúc phiên (UTC)')} {...fieldValidationProps(periodError && !invalidStart, errorId)} aria-describedby={`${id}-hint${periodError && !invalidStart ? ` ${errorId}` : ''}`} onChange={event => update({ end: event.target.value })} /> : <input id={`${id}-end`} value={t('Tự động')} readOnly disabled aria-label={t('Ngày kết thúc phiên (UTC)')} />}
        </div>
      </div>
      <p id={`${id}-hint`} className="quick-session-period-hint">{t(value.endMode === 'custom' ? 'Phiên dừng ở ngày bạn chọn.' : 'Replay tiếp tục đến hết dữ liệu đã tải.')} <span>{t('Khoảng dữ liệu: {from} – {to} · UTC', { from: displayDate(range.min, { timeStyle: 'short' }), to: displayDate(range.max, { timeStyle: 'short' }) })}</span></p>
      <div className="quick-session-period-modes" role="group" aria-label={t('Cách kết thúc phiên')}>
        {[['auto', 'Tự động'], ['custom', 'Tùy chọn']].map(([mode, label]) => <button type="button" key={mode} aria-pressed={value.endMode === mode} disabled={disabled} onClick={() => update({ endMode: mode, ...(mode === 'custom' && !value.end ? { end: sessionDefaultEnd(range, state.start) || max } : {}) })}>{t(label)}</button>)}
      </div>
      <FieldError id={errorId} error={periodError} />
    </section>
  </div>
}
