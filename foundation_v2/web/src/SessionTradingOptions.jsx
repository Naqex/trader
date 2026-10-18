import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { assetTradingDefaults } from './sessionTradingOptions.js'
import './session-trading-options.css'

export default function SessionTradingOptions({ assets, value, onChange, disabled, error, id }) {
  const { t } = useTestingLocale()
  const update = (dataset, field, next) => onChange({ ...value, assets: { ...value.assets, [dataset]: { ...(value.assets[dataset] || assetTradingDefaults()), [field]: next } } })
  const field = (asset, key, label) => <label><span>{t(label)}</span><input type="text" inputMode="decimal" aria-label={`${t(label)} · ${asset.instrument_id}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-options-error` : undefined} value={(value.assets[asset.dataset_id] || assetTradingDefaults())[key]} disabled={disabled} onChange={event => update(asset.dataset_id, key, event.target.value)} /></label>
  return <section className="session-trading-options" aria-label={t('Tùy chọn giao dịch')}>
    <section className="session-option-section">
      <header className="session-option-heading"><div><h3>{t('Spread và commission')}</h3><p>{t(value.costs_enabled ? 'Áp dụng chi phí bạn đặt riêng cho từng tài sản.' : 'Khớp tại giá chart, không trừ spread hoặc commission.')}</p></div><button type="button" role="switch" aria-label={t('Spread và commission')} aria-checked={value.costs_enabled} className="session-option-switch" disabled={disabled} onClick={() => onChange({ ...value, costs_enabled: !value.costs_enabled })}><span /></button></header>
      {!assets.length ? <div className="session-options-empty"><strong>{t('Chọn tài sản trước')}</strong><p>{t('Quay lại Cơ bản để chọn tài sản. Các tùy chọn được lưu riêng cho từng tài sản.')}</p></div> : value.costs_enabled && <div className="session-asset-options">{assets.map(asset => {
        const spec = asset.instrument_spec || asset.replay_instrument_spec
        const settings = value.assets[asset.dataset_id] || assetTradingDefaults()
        return <fieldset key={asset.dataset_id}><legend>{asset.instrument_id}</legend><div className="session-cost-grid">
          {field(asset, 'spread_price', 'Spread · đơn vị giá')}
          {field(asset, 'commission_per_lot', `Commission · ${spec?.account_ccy || 'USD'}/${spec?.asset_class === 'fx' ? 'lot' : 'quantity'}`)}
          <div className="session-option-charge"><span>{t('Thu phí')}</span><FxSelect className="is-field" label={t('Thu phí')} value={settings.commission_charge} disabled={disabled} onChange={next => update(asset.dataset_id, 'commission_charge', next)} options={[{ value: 'round_trip', label: t('Cả lượt mở + đóng') }, { value: 'per_side', label: t('Mỗi chiều') }]} /></div>
        </div></fieldset>
      })}<p className="session-options-hint">{t('Ví dụ EUR/USD: spread 0.00010 = 1 pip. Đây là spread mô phỏng cố định, không phải spread lịch sử.')}</p></div>}
    </section>
    {assets.length > 0 && <>
      <section className="session-option-section"><header className="session-option-heading"><div><h3>{t('Trượt giá')}</h3><p>{t('Mặc định 0. Mức cố định được tính vào chi phí mỗi chiều; không dịch vị trí giá khớp trên chart.')}</p></div></header><div className="session-asset-options">{assets.map(asset => <fieldset key={asset.dataset_id}><legend>{asset.instrument_id}</legend>{field(asset, 'slippage_price', 'Trượt giá · đơn vị giá / chiều')}</fieldset>)}</div></section>
      <section className="session-option-section session-option-unavailable"><div><h3>{t('Đòn bẩy và ký quỹ')}</h3><p>{t('Chưa hỗ trợ cho mô hình replay theo nến này.')}</p></div><span>{t('Chưa khả dụng')}</span></section>
      <section className="session-option-section session-option-unavailable"><div><h3>Hedging</h3><p>{t('Hiện giữ tối đa một vị thế trên mỗi tài sản; chưa hỗ trợ BUY và SELL đồng thời cùng tài sản.')}</p></div><span>{t('Chưa khả dụng')}</span></section>
    </>}
    {error && <p id={`${id}-options-error`} className="wm-field-error" role="alert">{t(error)}</p>}
    <p className="session-options-hint">{t('Cấu hình được giữ cố định sau khi tạo phiên. Tạo phiên mới để đổi cách tính chi phí.')}</p>
  </section>
}
