import { displayDate } from './dateFormat.js'
import { closeTime } from './sessionPerformanceModel.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useId, useState } from 'react'
import { SessionActions } from './SessionActions.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { canResumeSession } from './sessionCatalog.js'
import SessionKindBadge from './SessionKindBadge.jsx'

import { sessionRemainingDays, sessionSettingsFacts } from './sessionSettingsModel.js'
import './dashboard-session.css'

const date = value => Number.isFinite(Number(value)) && value != null ? displayDate(new Date(Number(value) * 1000)) : '-'

function SessionIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'edit' ? <path d="m16 3 5 5-12 12H4v-5ZM13 6l5 5" /> : kind === 'analytics' ? <path d="M5 20V11m7 9V4m7 16V8" /> : kind === 'duplicate' ? <><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M16 8V3H4v13h4" /></> : kind === 'summary' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : kind === 'calendar' ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></> : kind === 'balance' ? <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></> : kind === 'play' ? <path d="m9 6 9 6-9 6Z" fill="currentColor" stroke="none" /> : <path d="m5 9 7 7 7-7" />}</svg>
}

export default function DashboardSessionCard({ item, detail, dataset, href, onManage, onRemember, preview = false, actionsDisabled = false }) {
  const dashboardMoney = (value, currency) => fmt(value, currency ? ` ${currency}` : '')
  const date = value => closeTime(value) ? displayDate(closeTime(value)) : '-'

  const { t, locale, fmt } = useTestingLocale()

  const [expanded, setExpanded] = useState(false)
  const [visited, setVisited] = useState(false)
  const panelId = useId()
  const model = detail?.model, payload = detail?.payload || {}
  const facts = sessionSettingsFacts(item, dataset, payload, model, detail?.replayRecord)
  const toggleExpanded = () => { setVisited(true); setExpanded(value => !value) }
  const name = item.name || item.record_id
  const knownProgress = Number.isInteger(item.row_count) && item.row_count > 0 && Number.isInteger(item.cursor_index)
  const remaining = knownProgress ? Math.max(0, item.row_count - item.cursor_index - 1) : null
  const days = sessionRemainingDays(dataset, null, detail?.replayRecord)
  const disabledCopy = item.archived || item.dataset_available !== true
  return <article className={`fx-dashboard-session-card${expanded ? ' is-expanded' : ''}`} data-session-id={item.record_id}>
    <div className="fx-dashboard-session-card-head" onClick={event => {
      if (event.target.closest('a, button, input, select, textarea')) return
      toggleExpanded()
    }}>
      {preview ? <button type="button" className="fx-dashboard-card-play" disabled aria-label={t("Tiếp tục {name}", { name: name })} data-tooltip={t("Chart cần phiên thật")}><SessionIcon kind="play" /></button> : canResumeSession(item) ? <a className="fx-dashboard-card-play" href={href('replay', { select: null, surface: 'workspace' })} onClick={onRemember} aria-label={t("Tiếp tục {name}", { name: name })}><SessionIcon kind="play" /></a> : <span className="fx-dashboard-card-play is-unavailable" data-tooltip={t("Phiên hoặc dataset chưa sẵn sàng")}><SessionIcon kind="play" /></span>}
      <div className="fx-dashboard-card-info"><h3 className="session-title-line"><span className="session-title-text">{name}</span>{days !== null && <span className="fx-dashboard-days" data-tooltip={t("Số ngày lịch còn lại từ vị trí replay đến cuối dataset")}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="m11 2-7 9h5l-1 7 8-10h-5Z" /></svg>{t("{count} days", { count: days })}</span>}<SessionKindBadge item={item} />{item.archived && <small>{t("Đã lưu trữ")}</small>}</h3><div className="fx-dashboard-card-facts"><span data-tooltip={t("Phạm vi dataset")}><SessionIcon kind="calendar" />{date(dataset?.first_timestamp)} – {date(dataset?.last_timestamp)}</span><span data-tooltip={facts.currency ? t("Account balance") : t("Chưa rõ đơn vị tiền tệ")}><SessionIcon kind="balance" />{dashboardMoney(facts.balance, facts.currency)}</span></div><span className="fx-dashboard-card-asset">{item.instrument_id || '-'}</span></div>
      <div className="fx-dashboard-card-progress">{knownProgress && <progress aria-label={t("Tiến độ {name}", { name: name })} value={Math.min(item.row_count, item.cursor_index + 1)} max={item.row_count} />}<small>{days !== null ? t("Remaining {count} days", { count: days.toLocaleString(locale) }) : remaining !== null ? t("Còn {count} nến", { count: remaining.toLocaleString(locale) }) : '-'}</small></div>
      <div className="fx-dashboard-card-actions">
        <SessionActions item={item} onAction={onManage} disabled={actionsDisabled} />
        <button type="button" className="fx-dashboard-card-icon" aria-label={t("Sửa {name}", { name: name })} data-tooltip={t("Cài đặt phiên")} disabled={actionsDisabled} onClick={() => onManage('rename', item)}><SessionIcon kind="edit" /></button>
        <a className="fx-dashboard-card-icon" aria-label={t("Analytics {name}", { name: name })} data-tooltip={t("Analytics")} href={href('analytics')}><SessionIcon kind="analytics" /></a>
        <button type="button" className="fx-dashboard-card-icon" aria-label={t("Tạo bản sao {name}", { name: name })} data-tooltip={t("Tạo bản sao")} disabled={disabledCopy || actionsDisabled} onClick={() => onManage('duplicate', item)}><SessionIcon kind="duplicate" /></button>
        <a className="fx-dashboard-card-summary" aria-label={t("Summary {name}", { name: name })} href={href('replay')} onClick={preview ? undefined : onRemember}><SessionIcon kind="summary" />{t("Summary")}</a>
        <button type="button" className="fx-dashboard-card-icon fx-dashboard-card-expand" aria-label={t(expanded ? 'Thu gọn {name}' : 'Mở rộng {name}', { name })} aria-expanded={expanded} aria-controls={panelId} onClick={toggleExpanded}><SessionIcon /></button>
      </div>
    </div>
    <div className="fx-dashboard-card-disclosure" id={panelId} aria-hidden={!expanded} inert={!expanded}>
      <div className="fx-dashboard-card-disclosure-inner">
        {visited && <div className="fx-dashboard-card-charts">{detail?.status === 'loading' || !detail ? <TestingSkeleton label="Đang tải kết quả phiên…" rows={3} /> : detail.status === 'error' ? <TestingReadState error message="Chưa đọc được kết quả phiên." /> : <SessionPerformance chartsOnly model={model} payload={payload} item={item} href={href} />}</div>}
      </div>
    </div>
  </article>
}
