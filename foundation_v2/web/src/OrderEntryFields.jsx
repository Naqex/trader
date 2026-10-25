import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './order-entry-fields.css'

// Shared ticket fields; the caller owns execution semantics and confirmation.
export default function OrderEntryFields({ draft, instrument, disabled, conditionalOrders, onSide, onType, onChange, reference, quantityLabel }) {
  const { t } = useTestingLocale()
  return <div className="legacy-order-grid wm-order-entry-fields">
    <label>{t('Hướng')}<FxSelect className="is-field" label="Hướng" value={draft.side} disabled={disabled} onChange={onSide} options={[{ value:'BUY', label:t('Buy') }, { value:'SELL', label:t('Sell') }]} /></label>
    <label>{t('Loại lệnh')}<FxSelect className="is-field" label="Loại lệnh" value={draft.orderType || 'market'} disabled={disabled || !conditionalOrders} onChange={onType} options={(conditionalOrders ? ['market','limit','stop'] : ['market']).map(value => ({ value, label:value[0].toUpperCase() + value.slice(1) }))} /></label>
    <label>{t(quantityLabel || (instrument?.asset_class === 'fx' ? 'Khối lượng (lot)' : 'Khối lượng (quantity)'))}<input aria-label={t('Khối lượng lệnh')} type="number" min={instrument?.quantity_min || '0'} max={instrument?.quantity_max || undefined} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled} onChange={event => onChange('quantity',event.target.value)} /></label>
    <label>{t('Giá vào lệnh')}<input aria-label={t('Giá vào lệnh')} type={draft.orderType && draft.orderType !== 'market' ? 'number' : 'text'} min="0" step={instrument?.tick_size || 'any'} disabled={disabled} readOnly={!draft.orderType || draft.orderType === 'market'} value={draft.orderType && draft.orderType !== 'market' ? draft.entryPrice : reference ?? '-'} onChange={event => onChange('entryPrice',event.target.value)} /></label>
  </div>
}
