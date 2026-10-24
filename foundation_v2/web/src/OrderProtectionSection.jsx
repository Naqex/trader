import { useTestingLocale } from './testingLocale.jsx'
import { protectionPips, protectionPrice } from './orderProtection.js'

// Estimates and permission rules stay in each execution adapter.
export default function OrderProtectionSection({ kind, draft, instrument, reference, enabled, disabled, toggleDisabled, required = false, editing = false, hidePrice = false, onToggle, onChange, estimate, children }) {
  const { t } = useTestingLocale()
  const label = kind === 'stopLoss' ? 'Stop loss' : 'Take profit'
  const hasPips = Number(instrument?.pip_size) > 0 && reference > 0
  return <section className={editing ? 'legacy-edit-protection' : 'legacy-new-protection'} data-protection={kind}>
    <div className="legacy-protection-row"><label><input type="checkbox" role="switch" aria-label={t(label)} checked={enabled} disabled={disabled || toggleDisabled || required} onChange={event => onToggle(event.target.checked)} />{t(label)}{required && ' *'}</label>{enabled && estimate}</div>
    {enabled && <>
      {!hidePrice && <div className={`legacy-order-grid ${hasPips ? '' : 'is-price-only'}`}><label>{t(label)}<input aria-label={t(label)} type="number" min="0" required step={instrument?.tick_size || 'any'} value={draft[kind]} disabled={disabled} onChange={event => onChange(kind,event.target.value)} /></label>
        {hasPips && <label>{t(kind === 'stopLoss' ? 'Stop loss in pips' : 'Take profit in pips')}<input type="number" step="any" value={protectionPips(draft[kind], reference, draft.side, kind, instrument)} disabled={disabled} onChange={event => onChange(kind, protectionPrice(event.target.value, reference, draft.side, kind, instrument))} /></label>}
      </div>}
      {children}
    </>}
  </section>
}
