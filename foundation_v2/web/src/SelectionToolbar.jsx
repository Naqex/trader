import { useTestingLocale } from './testingLocale.jsx'
import './trade-journal-preview.css'

export default function SelectionToolbar({ label, summary, onClose, onSelectAll, selectAllLabel='Chọn tất cả', selectAllHint, busy=false, actions=[] }) {
  const { t } = useTestingLocale()
  return <div className="wm-trade-selection-bar" role="region" aria-label={label} aria-busy={busy}>
    <div className="wm-trade-selection-head">
      <button type="button" className="wm-trade-selection-close" aria-label={t('Bỏ chọn')} disabled={busy} onClick={onClose}>×</button>
      <strong role="status">{summary}</strong>
      <button type="button" className="wm-trade-selection-all" data-tooltip={selectAllHint} disabled={busy} onClick={onSelectAll}>{t(selectAllLabel)}</button>
    </div>
    {actions.length>0 && <div className="wm-trade-selection-actions">{actions.map(action=><button key={action.id} type="button" className={`wm-trade-selection-action${action.danger?' is-danger':''}`} disabled={busy || action.disabled} data-tooltip={action.hint} onClick={action.onClick}>{action.icon}{action.label}</button>)}</div>}
  </div>
}
