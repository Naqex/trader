import { useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { assetTradingDefaults } from './sessionTradingOptions.js'
import './session-trading-options.css'

const specFor = asset => asset.instrument_spec || asset.replay_instrument_spec
export default function SessionTradingOptions({ assets, value, onChange, disabled, error, id }) {
  const { t } = useTestingLocale()
  const [fixedSlippage, setFixedSlippage] = useState({})
  const settings = asset => value.assets[asset.dataset_id] || assetTradingDefaults()
  const update = (asset, field, next) => onChange({ ...value, assets:{ ...value.assets, [asset.dataset_id]:{ ...settings(asset), [field]:next } } })
  const field = (asset, key, label) => <label><span>{t(label)}</span><input type="text" inputMode="decimal" aria-label={`${t(label)} · ${asset.instrument_id}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-options-error` : undefined} value={settings(asset)[key]} disabled={disabled} onChange={event => update(asset,key,event.target.value)} /></label>
  const assetName = asset => <div className="session-option-asset"><strong>{asset.instrument_id}</strong><small>{specFor(asset)?.asset_class === 'fx' ? 'Forex' : specFor(asset)?.asset_class || t('Tài sản')}</small></div>
  return <section className="session-trading-options" aria-label={t('Tùy chọn giao dịch')}>
    <section className="session-option-section session-cost-surface" data-option="costs">
      <header className="session-option-heading"><div><h3>{t('Spread và commission')}</h3><p>{t(value.costs_enabled ? 'Áp dụng chi phí bạn đặt riêng cho từng tài sản.' : 'Khớp tại giá chart, không trừ spread hoặc commission.')}</p></div><button type="button" role="switch" aria-label={t('Spread và commission')} aria-checked={value.costs_enabled} className="session-option-switch" disabled={disabled} onClick={() => onChange({ ...value, costs_enabled:!value.costs_enabled })}><span /></button></header>
      {!assets.length ? <div className="session-options-empty"><strong>{t('Chọn tài sản trước')}</strong><p>{t('Quay lại Cơ bản để chọn tài sản. Các tùy chọn được lưu riêng cho từng tài sản.')}</p></div> : value.costs_enabled && <div className="session-asset-options session-cost-table">
        <div className="session-cost-columns" aria-hidden="true"><span /><span>Spread</span><span>Commission</span><span>{t('Thu phí')}</span></div>
        {assets.map(asset => <fieldset className="session-cost-grid" key={asset.dataset_id}><legend>{asset.instrument_id}</legend>
          <div>{assetName(asset)}<small className="session-cost-unit">{t('Đơn vị giá')} · {specFor(asset)?.account_ccy || 'USD'}/{specFor(asset)?.asset_class === 'fx' ? 'lot' : 'quantity'}</small></div>
          {field(asset,'spread_price','Spread · đơn vị giá')}
          {field(asset,'commission_per_lot',`Commission · ${specFor(asset)?.account_ccy || 'USD'}/${specFor(asset)?.asset_class === 'fx' ? 'lot' : 'quantity'}`)}
          <div className="session-option-charge"><span>{t('Thu phí')}</span><FxSelect className="is-field" label={`${t('Thu phí')} · ${asset.instrument_id}`} value={settings(asset).commission_charge} disabled={disabled} onChange={next => update(asset,'commission_charge',next)} options={[{value:'round_trip',label:t('Cả lượt mở + đóng')},{value:'per_side',label:t('Mỗi chiều')}]} /></div>
        </fieldset>)}<p className="session-options-hint">{t('Ví dụ EUR/USD: spread 0.00010 = 1 pip. Đây là spread mô phỏng cố định, không phải spread lịch sử.')}</p>
      </div>}
    </section>
    {assets.length > 0 && <>
      <section className="session-option-section" data-option="leverage"><h3 className="session-option-caption">{t('Đòn bẩy và ký quỹ')}</h3><div className="session-option-surface">{assets.map(asset => <div className="session-assumption-row" key={asset.dataset_id}><div>{assetName(asset)}<p>{t('Chưa hỗ trợ cho mô hình replay theo nến này.')}</p></div><FxSelect className="is-field" label={`${t('Đòn bẩy và ký quỹ')} · ${asset.instrument_id}`} value="off" disabled options={[{value:'off',label:t('Tắt')}]} /></div>)}</div></section>
      <section className="session-option-section" data-option="hedging"><h3 className="session-option-caption">Hedging</h3><div className="session-option-surface">{assets.map(asset => <div className="session-assumption-row" key={asset.dataset_id}><div>{assetName(asset)}<p>{t('Hiện giữ tối đa một vị thế trên mỗi tài sản; chưa hỗ trợ BUY và SELL đồng thời cùng tài sản.')}</p></div><div className="session-option-unavailable"><button type="button" role="switch" aria-label={`Hedging · ${asset.instrument_id}`} aria-checked="false" className="session-option-switch" disabled><span /></button><small>{t('Chưa khả dụng')}</small></div></div>)}</div></section>
      <section className="session-option-section" data-option="slippage"><h3 className="session-option-caption">{t('Trượt giá')}</h3><div className="session-option-surface">{assets.map(asset => {
        const fixed = fixedSlippage[asset.dataset_id] ?? Number(settings(asset).slippage_price) > 0
        return <div className="session-slippage-asset" key={asset.dataset_id}><div className="session-assumption-row"><div>{assetName(asset)}<p>{t(fixed ? 'Chi phí cố định theo đơn vị giá, mỗi chiều.' : 'Khớp đúng giá, không tính trượt giá.')}</p></div><div className="session-slippage-modes" role="group" aria-label={`${t('Trượt giá')} · ${asset.instrument_id}`}>
          {[['off','Tắt'],['fixed','Cố định']].map(([mode,label]) => <button key={mode} type="button" aria-pressed={fixed === (mode === 'fixed')} disabled={disabled} onClick={() => { setFixedSlippage(current => ({...current,[asset.dataset_id]:mode === 'fixed'})); if(mode === 'off') update(asset,'slippage_price','0') }}>{t(label)}</button>)}
        </div></div>{fixed && <div className="session-slippage-value">{field(asset,'slippage_price','Trượt giá · đơn vị giá / chiều')}</div>}</div>
      })}<p className="session-options-hint">{t('Mặc định 0. Mức cố định được tính vào chi phí mỗi chiều; không dịch vị trí giá khớp trên chart.')}</p></div></section>
    </>}
    {error && <p id={`${id}-options-error`} className="wm-field-error" role="alert">{t(error)}</p>}
    <p className="session-options-hint">{t('Cấu hình được giữ cố định sau khi tạo phiên. Tạo phiên mới để đổi cách tính chi phí.')}</p>
  </section>
}
